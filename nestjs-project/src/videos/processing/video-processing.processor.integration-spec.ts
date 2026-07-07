import { readFile } from 'fs/promises';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { getRepositoryToken, TypeOrmModule } from '@nestjs/typeorm';
import type { TestingModule } from '@nestjs/testing';
import type { Job } from 'bullmq';
import { DataSource, Repository } from 'typeorm';
import { RefreshToken } from '../../auth/entities/refresh-token.entity';
import { VerificationToken } from '../../auth/entities/verification-token.entity';
import { Channel } from '../../channels/entities/channel.entity';
import storageConfig from '../../config/storage.config';
import { StorageModule } from '../../storage/storage.module';
import { StorageService } from '../../storage/storage.service';
import { STORAGE_KEYS } from '../../storage/storage.constants';
import {
  cleanAllTables,
  createTestDataSource,
} from '../../test/create-test-data-source';
import { User } from '../../users/entities/user.entity';
import { Video, VideoStatus } from '../entities/video.entity';
import type { ProcessVideoJobPayload } from '../video-queue.constants';
import { FfmpegService } from './ffmpeg.service';
import { VideoProcessingProcessor } from './video-processing.processor';

const ALL_ENTITIES = [User, Channel, RefreshToken, VerificationToken, Video];
const FIXTURE = join(__dirname, '../../../test/fixtures/sample.mp4');

function jobStub(videoId: string, overrides: Partial<Job> = {}) {
  return {
    data: { videoId },
    opts: { attempts: 3 },
    attemptsMade: 1,
    id: 'job-1',
    ...overrides,
  } as Job<ProcessVideoJobPayload>;
}

// Real DB + real MinIO + real ffmpeg. The processor is invoked directly with
// a job stub — queue delivery itself is covered by the pipeline e2e.
describe('VideoProcessingProcessor (integration)', () => {
  let module: TestingModule;
  let processor: VideoProcessingProcessor;
  let storageService: StorageService;
  let dataSource: DataSource;
  let videoRepository: Repository<Video>;
  let userRepository: Repository<User>;
  let channelRepository: Repository<Channel>;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [storageConfig] }),
        TypeOrmModule.forRoot(createTestDataSource(ALL_ENTITIES).options),
        TypeOrmModule.forFeature([Video]),
        StorageModule,
      ],
      providers: [FfmpegService, VideoProcessingProcessor],
    }).compile();

    processor = module.get(VideoProcessingProcessor);
    storageService = module.get(StorageService);
    dataSource = module.get(DataSource);
    videoRepository = module.get(getRepositoryToken(Video));
    userRepository = dataSource.getRepository(User);
    channelRepository = dataSource.getRepository(Channel);
  });

  afterAll(async () => {
    await module.close();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
  });

  let counter = 0;
  async function seedProcessingVideo(objectBody: Buffer): Promise<Video> {
    const user = await userRepository.save(
      userRepository.create({
        email: `proc_${Date.now()}_${++counter}@example.com`,
        password: 'hashed',
      }),
    );
    const channel = await channelRepository.save(
      channelRepository.create({
        name: `Proc ${counter}`,
        nickname: `proc_${Date.now()}_${counter}`,
        user_id: user.id,
      }),
    );

    const id = randomUUID();
    const key = STORAGE_KEYS.originalVideo(id, '.mp4');
    await storageService.putObject(key, objectBody, 'video/mp4');

    return videoRepository.save(
      videoRepository.create({
        id,
        channel_id: channel.id,
        title: 'Processing video',
        slug: `p${Date.now()}${counter}`.slice(0, 11).padEnd(11, 'z'),
        status: VideoStatus.PROCESSING,
        original_key: key,
        mime_type: 'video/mp4',
        file_size: String(objectBody.length),
      }),
    );
  }

  it('should process a real video: metadata, thumbnail and status ready', async () => {
    const video = await seedProcessingVideo(await readFile(FIXTURE));

    await processor.process(jobStub(video.id));

    const processed = await videoRepository.findOneByOrFail({ id: video.id });
    expect(processed.status).toBe(VideoStatus.READY);
    expect(processed.duration_seconds).toBe(2);
    expect(processed.metadata).toMatchObject({ codec: 'h264', width: 320 });
    expect(processed.thumbnail_key).toBe(STORAGE_KEYS.thumbnail(video.id));

    const thumbnail = await storageService.headObject(processed.thumbnail_key!);
    expect(thumbnail.contentLength).toBeGreaterThan(0);
  });

  it('should throw on a non-video object so the queue can retry', async () => {
    const video = await seedProcessingVideo(Buffer.from('not a video at all'));

    await expect(processor.process(jobStub(video.id))).rejects.toThrow();

    const untouched = await videoRepository.findOneByOrFail({ id: video.id });
    expect(untouched.status).toBe(VideoStatus.PROCESSING);
  });

  it('should mark the video failed with a reason after retries are exhausted', async () => {
    const video = await seedProcessingVideo(Buffer.from('still not a video'));

    await processor.onFailed(
      jobStub(video.id, { attemptsMade: 3 } as Partial<Job>),
      new Error('File is not a processable video'),
    );

    const failed = await videoRepository.findOneByOrFail({ id: video.id });
    expect(failed.status).toBe(VideoStatus.FAILED);
    expect(failed.error_reason).toContain('not a processable video');
  });

  it('should not mark failed while retries remain', async () => {
    const video = await seedProcessingVideo(Buffer.from('x'));

    await processor.onFailed(
      jobStub(video.id, { attemptsMade: 1 } as Partial<Job>),
      new Error('transient'),
    );

    const untouched = await videoRepository.findOneByOrFail({ id: video.id });
    expect(untouched.status).toBe(VideoStatus.PROCESSING);
  });

  it('should skip already-ready videos (idempotent redelivery)', async () => {
    const video = await seedProcessingVideo(Buffer.from('x'));
    await videoRepository.update(
      { id: video.id },
      { status: VideoStatus.READY },
    );

    await expect(processor.process(jobStub(video.id))).resolves.toBeUndefined();
  });
});
