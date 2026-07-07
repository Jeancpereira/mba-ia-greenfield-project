import * as crypto from 'crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { Queue } from 'bullmq';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource, Repository } from 'typeorm';
import { AppModule } from '../src/app.module';
import { Channel } from '../src/channels/entities/channel.entity';
import { DomainExceptionFilter } from '../src/common/filters/domain-exception.filter';
import { ValidationExceptionFilter } from '../src/common/filters/validation-exception.filter';
import { StorageService } from '../src/storage/storage.service';
import { cleanAllTables } from '../src/test/create-test-data-source';
import { fetchPresigned } from '../src/test/presigned-http';
import { User } from '../src/users/entities/user.entity';
import { Video, VideoStatus } from '../src/videos/entities/video.entity';
import { VIDEO_QUEUE } from '../src/videos/video-queue.constants';

describe('Videos (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let jwtService: JwtService;
  let storageService: StorageService;
  let queue: Queue;
  let userRepository: Repository<User>;
  let channelRepository: Repository<Channel>;
  let videoRepository: Repository<Video>;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
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
    storageService = moduleFixture.get(StorageService);
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
  async function createAuthenticatedUser(): Promise<{
    userId: string;
    channelId: string;
    token: string;
  }> {
    const user = await userRepository.save(
      userRepository.create({
        email: `ve2e_${Date.now()}_${++counter}@example.com`,
        password: 'hashed',
        is_confirmed: true,
      }),
    );
    const channel = await channelRepository.save(
      channelRepository.create({
        name: `E2E Channel ${counter}`,
        nickname: `ve2e_chan_${Date.now()}_${counter}`,
        user_id: user.id,
      }),
    );
    const token = jwtService.sign({ sub: user.id, email: user.email });
    return { userId: user.id, channelId: channel.id, token };
  }

  const validPayload = {
    title: 'E2E video',
    file_name: 'movie.mp4',
    file_size: 1024,
    mime_type: 'video/mp4',
  };

  describe('POST /videos', () => {
    it('rejects anonymous callers with 401', async () => {
      await request(app.getHttpServer())
        .post('/videos')
        .send(validPayload)
        .expect(401);
    });

    it('rejects a file above 10GB with 400', async () => {
      const { token } = await createAuthenticatedUser();
      const response = await request(app.getHttpServer())
        .post('/videos')
        .set('Authorization', `Bearer ${token}`)
        .send({ ...validPayload, file_size: 10 * 1024 * 1024 * 1024 + 1 })
        .expect(400);
      expect(response.body.error).toBe('VALIDATION_ERROR');
    });

    it('rejects a non-video mime type with 400', async () => {
      const { token } = await createAuthenticatedUser();
      await request(app.getHttpServer())
        .post('/videos')
        .set('Authorization', `Bearer ${token}`)
        .send({ ...validPayload, mime_type: 'application/pdf' })
        .expect(400);
    });

    it('creates a draft with slug and upload session', async () => {
      const { token } = await createAuthenticatedUser();
      const response = await request(app.getHttpServer())
        .post('/videos')
        .set('Authorization', `Bearer ${token}`)
        .send(validPayload)
        .expect(201);

      expect(response.body.status).toBe('draft');
      expect(response.body.slug).toHaveLength(11);
      expect(response.body.upload.upload_id).toBeTruthy();
      expect(response.body.upload.part_size).toBe(100 * 1024 * 1024);
      expect(response.body.upload.part_count).toBe(1);
    });
  });

  describe('upload lifecycle', () => {
    it('runs initiate → part-urls → PUT part → complete and enqueues processing', async () => {
      const { token } = await createAuthenticatedUser();

      const initiate = await request(app.getHttpServer())
        .post('/videos')
        .set('Authorization', `Bearer ${token}`)
        .send(validPayload)
        .expect(201);
      const slug = initiate.body.slug as string;

      const partUrls = await request(app.getHttpServer())
        .post(`/videos/${slug}/upload/part-urls`)
        .set('Authorization', `Bearer ${token}`)
        .send({ part_numbers: [1] })
        .expect(200);
      expect(partUrls.body.urls).toHaveLength(1);

      const putResponse = await fetchPresigned(partUrls.body.urls[0].url, {
        method: 'PUT',
        body: Buffer.from('fake video bytes'),
      });
      expect(putResponse.status).toBe(200);

      const complete = await request(app.getHttpServer())
        .post(`/videos/${slug}/upload/complete`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          parts: [{ part_number: 1, etag: putResponse.headers.etag }],
        })
        .expect(202);
      expect(complete.body.status).toBe('processing');

      const jobs = await queue.getJobs(['waiting', 'delayed', 'active']);
      expect(jobs.some((job) => job.data.videoId === initiate.body.id)).toBe(
        true,
      );

      // Owner sees the processing video; anonymous callers get 404.
      const ownerView = await request(app.getHttpServer())
        .get(`/videos/${slug}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(ownerView.body.status).toBe('processing');

      await request(app.getHttpServer()).get(`/videos/${slug}`).expect(404);
    });

    it('rejects part-urls from a non-owner with 403', async () => {
      const owner = await createAuthenticatedUser();
      const stranger = await createAuthenticatedUser();

      const initiate = await request(app.getHttpServer())
        .post('/videos')
        .set('Authorization', `Bearer ${owner.token}`)
        .send(validPayload)
        .expect(201);

      const response = await request(app.getHttpServer())
        .post(`/videos/${initiate.body.slug}/upload/part-urls`)
        .set('Authorization', `Bearer ${stranger.token}`)
        .send({ part_numbers: [1] })
        .expect(403);
      expect(response.body.error).toBe('NOT_VIDEO_OWNER');
    });

    it('rejects completing a video that is not draft with 409', async () => {
      const { token, channelId } = await createAuthenticatedUser();
      const video = await videoRepository.save(
        videoRepository.create({
          channel_id: channelId,
          title: 'Ready video',
          slug: `rdy${Date.now()}`.slice(0, 11).padEnd(11, 'x'),
          status: VideoStatus.READY,
          original_key: 'videos/none/original.mp4',
          mime_type: 'video/mp4',
          file_size: '10',
        }),
      );

      const response = await request(app.getHttpServer())
        .post(`/videos/${video.slug}/upload/complete`)
        .set('Authorization', `Bearer ${token}`)
        .send({ parts: [{ part_number: 1, etag: 'x' }] })
        .expect(409);
      expect(response.body.error).toBe('INVALID_UPLOAD_STATE');
    });
  });

  describe('GET /videos/:slug + streaming + download', () => {
    async function seedReadyVideo(channelId: string): Promise<Video> {
      const id = crypto.randomUUID();
      const key = `videos/${id}/original.mp4`;
      await storageService.putObject(key, Buffer.alloc(2048, 5), 'video/mp4');
      return videoRepository.save(
        videoRepository.create({
          id,
          channel_id: channelId,
          title: 'Ready video',
          slug: `s${Date.now()}${counter}`.slice(0, 11).padEnd(11, 'y'),
          status: VideoStatus.READY,
          original_key: key,
          mime_type: 'video/mp4',
          file_size: '2048',
          duration_seconds: 12,
          metadata: { codec: 'h264' },
        }),
      );
    }

    it('serves details of a ready video to anonymous callers without error_reason', async () => {
      const { channelId } = await createAuthenticatedUser();
      const video = await seedReadyVideo(channelId);

      const response = await request(app.getHttpServer())
        .get(`/videos/${video.slug}`)
        .expect(200);

      expect(response.body.status).toBe('ready');
      expect(response.body.duration_seconds).toBe(12);
      expect(response.body).not.toHaveProperty('error_reason');
    });

    it('streams via 302 redirect and the presigned URL serves 206 for Range', async () => {
      const { channelId } = await createAuthenticatedUser();
      const video = await seedReadyVideo(channelId);

      const response = await request(app.getHttpServer())
        .get(`/videos/${video.slug}/stream`)
        .expect(302);

      const location = response.headers.location;
      expect(location).toContain('X-Amz-Signature');

      const ranged = await fetchPresigned(location, {
        headers: { Range: 'bytes=0-1023' },
      });
      expect(ranged.status).toBe(206);
      expect(ranged.body.length).toBe(1024);
    });

    it('downloads via 302 redirect with attachment disposition', async () => {
      const { channelId } = await createAuthenticatedUser();
      const video = await seedReadyVideo(channelId);

      const response = await request(app.getHttpServer())
        .get(`/videos/${video.slug}/download`)
        .expect(302);

      const downloaded = await fetchPresigned(response.headers.location);
      expect(downloaded.status).toBe(200);
      expect(downloaded.headers['content-disposition']).toContain('attachment');
    });

    it('returns 404 for stream/download of a non-ready video', async () => {
      const { token } = await createAuthenticatedUser();
      const initiate = await request(app.getHttpServer())
        .post('/videos')
        .set('Authorization', `Bearer ${token}`)
        .send(validPayload)
        .expect(201);

      await request(app.getHttpServer())
        .get(`/videos/${initiate.body.slug}/stream`)
        .expect(404);
      await request(app.getHttpServer())
        .get(`/videos/${initiate.body.slug}/download`)
        .expect(404);
    });

    it('returns 404 for an unknown slug', async () => {
      await request(app.getHttpServer()).get('/videos/nope-nope-1').expect(404);
    });
  });
});
