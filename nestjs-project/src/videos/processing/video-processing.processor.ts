import { createWriteStream } from 'fs';
import { mkdtemp, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { extname, join } from 'path';
import { pipeline } from 'stream/promises';
import { Logger } from '@nestjs/common';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import type { Job } from 'bullmq';
import { Repository } from 'typeorm';
import { StorageService } from '../../storage/storage.service';
import { STORAGE_KEYS } from '../../storage/storage.constants';
import { Video, VideoStatus } from '../entities/video.entity';
import { VIDEO_QUEUE } from '../video-queue.constants';
import type { ProcessVideoJobPayload } from '../video-queue.constants';
import { FfmpegService } from './ffmpeg.service';

@Processor(VIDEO_QUEUE)
export class VideoProcessingProcessor extends WorkerHost {
  private readonly logger = new Logger(VideoProcessingProcessor.name);

  constructor(
    @InjectRepository(Video)
    private readonly videoRepository: Repository<Video>,
    private readonly storageService: StorageService,
    private readonly ffmpegService: FfmpegService,
  ) {
    super();
  }

  async process(job: Job<ProcessVideoJobPayload>): Promise<void> {
    const { videoId } = job.data;
    const video = await this.videoRepository.findOneBy({ id: videoId });
    if (!video) {
      this.logger.warn(`Video ${videoId} not found — dropping job`);
      return;
    }
    if (video.status === VideoStatus.READY) {
      // At-least-once delivery: a redelivered job for an already-processed
      // video is a no-op.
      return;
    }

    const workDir = await mkdtemp(join(tmpdir(), 'video-'));
    try {
      const extension = extname(video.original_key) || '.mp4';
      const localVideoPath = join(workDir, `original${extension}`);
      const localThumbnailPath = join(workDir, 'thumbnail.jpg');

      const objectStream = await this.storageService.getObjectStream(
        video.original_key,
      );
      await pipeline(objectStream, createWriteStream(localVideoPath));

      const probe = await this.ffmpegService.probe(localVideoPath);
      await this.ffmpegService.captureThumbnail(
        localVideoPath,
        localThumbnailPath,
      );

      const thumbnailKey = STORAGE_KEYS.thumbnail(video.id);
      await this.storageService.putObject(
        thumbnailKey,
        await readFile(localThumbnailPath),
        'image/jpeg',
      );

      video.duration_seconds = probe.durationSeconds;
      video.metadata = probe.metadata;
      video.thumbnail_key = thumbnailKey;
      video.status = VideoStatus.READY;
      await this.videoRepository.save(video);

      this.logger.log(`Video ${video.id} processed (slug ${video.slug})`);
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  }

  @OnWorkerEvent('failed')
  async onFailed(
    job: Job<ProcessVideoJobPayload> | undefined,
    error: Error,
  ): Promise<void> {
    if (!job) return;
    const attemptsAllowed = job.opts.attempts ?? 1;
    this.logger.warn(
      `Job ${job.id} failed (attempt ${job.attemptsMade}/${attemptsAllowed}): ${error.message}`,
    );
    if (job.attemptsMade < attemptsAllowed) {
      return; // BullMQ will retry with backoff
    }

    // Retries exhausted — terminal failure (TD-07).
    await this.videoRepository.update(
      { id: job.data.videoId },
      {
        status: VideoStatus.FAILED,
        error_reason: error.message.slice(0, 1024),
      },
    );
  }
}
