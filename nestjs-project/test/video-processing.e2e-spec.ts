import { readFile } from 'fs/promises';
import { join } from 'path';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource, Repository } from 'typeorm';
import { AppModule } from '../src/app.module';
import { Channel } from '../src/channels/entities/channel.entity';
import { DomainExceptionFilter } from '../src/common/filters/domain-exception.filter';
import { ValidationExceptionFilter } from '../src/common/filters/validation-exception.filter';
import { StorageModule } from '../src/storage/storage.module';
import { cleanAllTables } from '../src/test/create-test-data-source';
import { fetchPresigned } from '../src/test/presigned-http';
import { User } from '../src/users/entities/user.entity';
import { Video, VideoStatus } from '../src/videos/entities/video.entity';
import { FfmpegService } from '../src/videos/processing/ffmpeg.service';
import { VideoProcessingProcessor } from '../src/videos/processing/video-processing.processor';
import { VIDEO_QUEUE } from '../src/videos/video-queue.constants';

const FIXTURE = join(__dirname, 'fixtures/sample.mp4');

/**
 * Full pipeline e2e: upload → queue → worker → ready → streaming/download.
 *
 * The BullMQ processor is instantiated IN-PROCESS (same providers the
 * `video-worker` container bootstraps via WorkerModule) so the test is
 * deterministic — but everything else is real: Postgres, Redis, MinIO and
 * the ffmpeg/ffprobe binaries.
 */
describe('Video processing pipeline (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let jwtService: JwtService;
  let queue: Queue;
  let userRepository: Repository<User>;
  let channelRepository: Repository<Channel>;
  let videoRepository: Repository<Video>;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule, TypeOrmModule.forFeature([Video]), StorageModule],
      providers: [FfmpegService, VideoProcessingProcessor],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalFilters(
      new DomainExceptionFilter(),
      new ValidationExceptionFilter(),
    );
    await app.init();

    dataSource = moduleFixture.get(DataSource);
    jwtService = moduleFixture.get(JwtService);
    queue = moduleFixture.get(getQueueToken(VIDEO_QUEUE));
    userRepository = dataSource.getRepository(User);
    channelRepository = dataSource.getRepository(Channel);
    videoRepository = dataSource.getRepository(Video);
  });

  afterAll(async () => {
    await queue.obliterate({ force: true });
    await app.close();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
    await queue.drain();
  });

  let counter = 0;
  async function createAuthenticatedUser(): Promise<{ token: string }> {
    const user = await userRepository.save(
      userRepository.create({
        email: `pipe_${Date.now()}_${++counter}@example.com`,
        password: 'hashed',
        is_confirmed: true,
      }),
    );
    await channelRepository.save(
      channelRepository.create({
        name: `Pipeline ${counter}`,
        nickname: `pipe_${Date.now()}_${counter}`,
        user_id: user.id,
      }),
    );
    return { token: jwtService.sign({ sub: user.id, email: user.email }) };
  }

  async function uploadFile(
    token: string,
    body: Buffer,
    fileName: string,
  ): Promise<{ id: string; slug: string }> {
    const initiate = await request(app.getHttpServer())
      .post('/videos')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'Pipeline video',
        file_name: fileName,
        file_size: body.length,
        mime_type: 'video/mp4',
      })
      .expect(201);
    const slug = initiate.body.slug as string;

    const partUrls = await request(app.getHttpServer())
      .post(`/videos/${slug}/upload/part-urls`)
      .set('Authorization', `Bearer ${token}`)
      .send({ part_numbers: [1] })
      .expect(200);

    const putResponse = await fetchPresigned(partUrls.body.urls[0].url, {
      method: 'PUT',
      body,
    });
    expect(putResponse.status).toBe(200);

    await request(app.getHttpServer())
      .post(`/videos/${slug}/upload/complete`)
      .set('Authorization', `Bearer ${token}`)
      .send({ parts: [{ part_number: 1, etag: putResponse.headers.etag }] })
      .expect(202);

    return { id: initiate.body.id as string, slug };
  }

  async function waitForStatus(
    videoId: string,
    targetStatuses: VideoStatus[],
    timeoutMs: number,
  ): Promise<Video> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const video = await videoRepository.findOneByOrFail({ id: videoId });
      if (targetStatuses.includes(video.status)) return video;
      if (Date.now() > deadline) {
        throw new Error(
          `Timed out waiting for ${targetStatuses.join('/')} — status is ${video.status}`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  it('processes a real upload end-to-end and serves streaming + download', async () => {
    const { token } = await createAuthenticatedUser();
    const fixture = await readFile(FIXTURE);

    const { id, slug } = await uploadFile(token, fixture, 'sample.mp4');

    const ready = await waitForStatus(id, [VideoStatus.READY], 30000);
    expect(ready.duration_seconds).toBe(2);
    expect(ready.metadata).toMatchObject({ codec: 'h264' });
    expect(ready.thumbnail_key).toBeTruthy();

    // Details are now public and expose the thumbnail
    const details = await request(app.getHttpServer())
      .get(`/videos/${slug}`)
      .expect(200);
    expect(details.body.status).toBe('ready');
    expect(details.body.thumbnail_url).toContain('X-Amz-Signature');

    // Streaming: 302 → presigned URL serving 206 for Range requests
    const stream = await request(app.getHttpServer())
      .get(`/videos/${slug}/stream`)
      .expect(302);
    const ranged = await fetchPresigned(stream.headers.location, {
      headers: { Range: 'bytes=0-1023' },
    });
    expect(ranged.status).toBe(206);
    expect(ranged.body.length).toBe(1024);

    // Download: 302 → presigned URL with attachment disposition
    const download = await request(app.getHttpServer())
      .get(`/videos/${slug}/download`)
      .expect(302);
    const attachment = await fetchPresigned(download.headers.location);
    expect(attachment.status).toBe(200);
    expect(attachment.headers['content-disposition']).toContain('attachment');
    expect(attachment.body.length).toBe(fixture.length);
  }, 60000);

  it('marks an invalid file as failed with error_reason after retries', async () => {
    const { token } = await createAuthenticatedUser();
    const garbage = Buffer.from('definitely not an mp4 file');

    const { id, slug } = await uploadFile(token, garbage, 'garbage.mp4');

    // 3 attempts with exponential backoff (5s, 10s) → terminal failure.
    const failed = await waitForStatus(id, [VideoStatus.FAILED], 60000);
    expect(failed.error_reason).toBeTruthy();

    // Owner sees the failure reason; anonymous callers still get 404.
    const ownerView = await request(app.getHttpServer())
      .get(`/videos/${slug}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(ownerView.body.status).toBe('failed');
    expect(ownerView.body.error_reason).toBeTruthy();

    await request(app.getHttpServer()).get(`/videos/${slug}`).expect(404);
    await request(app.getHttpServer())
      .get(`/videos/${slug}/stream`)
      .expect(404);
  }, 90000);
});
