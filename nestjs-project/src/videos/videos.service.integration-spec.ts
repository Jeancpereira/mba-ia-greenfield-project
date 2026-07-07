import { Test } from '@nestjs/testing';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';
import type { ConfigType } from '@nestjs/config';
import { getQueueToken } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import type { TestingModule } from '@nestjs/testing';
import { Queue } from 'bullmq';
import { DataSource, Repository } from 'typeorm';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import { VerificationToken } from '../auth/entities/verification-token.entity';
import { Channel } from '../channels/entities/channel.entity';
import queueConfig from '../config/queue.config';
import storageConfig from '../config/storage.config';
import {
  cleanAllTables,
  createTestDataSource,
} from '../test/create-test-data-source';
import { fetchPresigned } from '../test/presigned-http';
import { User } from '../users/entities/user.entity';
import { Video, VideoStatus } from './entities/video.entity';
import { PROCESS_VIDEO_JOB, VIDEO_QUEUE } from './video-queue.constants';
import { VideosModule } from './videos.module';
import { VideosService } from './videos.service';

const ALL_ENTITIES = [User, Channel, RefreshToken, VerificationToken, Video];

// Real DB + real MinIO + real Redis (Compose services).
describe('VideosService (integration)', () => {
  let module: TestingModule;
  let service: VideosService;
  let dataSource: DataSource;
  let queue: Queue;
  let userRepository: Repository<User>;
  let channelRepository: Repository<Channel>;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [storageConfig, queueConfig],
        }),
        BullModule.forRootAsync({
          inject: [queueConfig.KEY],
          useFactory: (queueCfg: ConfigType<typeof queueConfig>) => ({
            connection: {
              host: queueCfg.redisHost,
              port: queueCfg.redisPort,
            },
          }),
        }),
        TypeOrmModule.forRoot(createTestDataSource(ALL_ENTITIES).options),
        VideosModule,
      ],
    }).compile();

    service = module.get(VideosService);
    dataSource = module.get(DataSource);
    queue = module.get(getQueueToken(VIDEO_QUEUE));
    userRepository = dataSource.getRepository(User);
    channelRepository = dataSource.getRepository(Channel);
  });

  afterAll(async () => {
    await queue.obliterate({ force: true });
    await module.close();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
    await queue.drain();
  });

  let counter = 0;
  async function createUserWithChannel(): Promise<{
    userId: string;
    channelId: string;
  }> {
    const user = await userRepository.save(
      userRepository.create({
        email: `vs_user_${Date.now()}_${++counter}@example.com`,
        password: 'hashed',
      }),
    );
    const channel = await channelRepository.save(
      channelRepository.create({
        name: `VS Channel ${counter}`,
        nickname: `vs_chan_${Date.now()}_${counter}`,
        user_id: user.id,
      }),
    );
    return { userId: user.id, channelId: channel.id };
  }

  const dto = {
    title: 'Integration video',
    file_name: 'movie.mp4',
    file_size: 1024,
    mime_type: 'video/mp4',
  };

  it('should initiate an upload: draft row + multipart session', async () => {
    const { userId, channelId } = await createUserWithChannel();

    const result = await service.initiateUpload(userId, dto);

    expect(result.video.status).toBe(VideoStatus.DRAFT);
    expect(result.video.channel_id).toBe(channelId);
    expect(result.video.slug).toHaveLength(11);
    expect(result.video.upload_id).toBeTruthy();
    expect(result.partCount).toBe(1);
  });

  it('should complete the upload: object stored, status processing, job enqueued', async () => {
    const { userId } = await createUserWithChannel();
    const body = Buffer.from('fake video bytes');
    const { video } = await service.initiateUpload(userId, {
      ...dto,
      file_size: body.length,
    });

    const [part] = await service.getPartUrls(userId, video.slug, [1]);
    const putResponse = await fetchPresigned(part.url, {
      method: 'PUT',
      body,
    });
    expect(putResponse.status).toBe(200);

    const completed = await service.completeUpload(userId, video.slug, {
      parts: [{ part_number: 1, etag: putResponse.headers.etag! }],
    });

    expect(completed.status).toBe(VideoStatus.PROCESSING);
    expect(completed.upload_id).toBeNull();

    const jobs = await queue.getJobs(['waiting', 'delayed', 'active']);
    const job = jobs.find(
      (j) => j.name === PROCESS_VIDEO_JOB && j.data.videoId === video.id,
    );
    expect(job).toBeDefined();
  });

  it('should reject completing twice (state machine)', async () => {
    const { userId } = await createUserWithChannel();
    const body = Buffer.from('x');
    const { video } = await service.initiateUpload(userId, {
      ...dto,
      file_size: body.length,
    });

    const [part] = await service.getPartUrls(userId, video.slug, [1]);
    const putResponse = await fetchPresigned(part.url, {
      method: 'PUT',
      body,
    });
    await service.completeUpload(userId, video.slug, {
      parts: [{ part_number: 1, etag: putResponse.headers.etag! }],
    });

    await expect(
      service.completeUpload(userId, video.slug, {
        parts: [{ part_number: 1, etag: 'stale' }],
      }),
    ).rejects.toThrow('state');
  });

  it('should reject and delete the stored object when the uploaded size does not match the declared file_size', async () => {
    const { userId } = await createUserWithChannel();
    const { video } = await service.initiateUpload(userId, {
      ...dto,
      file_size: 999999,
    });

    const [part] = await service.getPartUrls(userId, video.slug, [1]);
    const putResponse = await fetchPresigned(part.url, {
      method: 'PUT',
      body: Buffer.from('mismatched size body'),
    });

    await expect(
      service.completeUpload(userId, video.slug, {
        parts: [{ part_number: 1, etag: putResponse.headers.etag! }],
      }),
    ).rejects.toThrow('size');
  });
});
