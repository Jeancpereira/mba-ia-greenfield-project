import { randomUUID } from 'crypto';
import { extname } from 'path';
import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { QueryFailedError, Repository } from 'typeorm';
import {
  InvalidUploadStateException,
  NotVideoOwnerException,
  SlugGenerationFailedException,
  UploadIncompleteException,
  VideoNotFoundException,
} from '../common/exceptions/domain.exception';
import { Channel } from '../channels/entities/channel.entity';
import { StorageService } from '../storage/storage.service';
import { STORAGE_KEYS } from '../storage/storage.constants';
import type { CompleteUploadDto } from './dto/complete-upload.dto';
import type { CreateVideoDto } from './dto/create-video.dto';
import { Video, VideoStatus } from './entities/video.entity';
import { generateSlug } from './slug.util';
import {
  MAX_SLUG_ATTEMPTS,
  PROCESS_VIDEO_JOB,
  PROCESS_VIDEO_JOB_OPTIONS,
  UPLOAD_PART_SIZE_BYTES,
  VIDEO_QUEUE,
} from './video-queue.constants';
import type { ProcessVideoJobPayload } from './video-queue.constants';

export interface InitiatedUpload {
  video: Video;
  partSize: number;
  partCount: number;
}

export interface PresignedPart {
  partNumber: number;
  url: string;
  expiresIn: number;
}

function isUniqueViolationOnSlug(err: unknown): boolean {
  if (!(err instanceof QueryFailedError)) return false;
  const e = err as QueryFailedError & { code?: unknown; detail?: unknown };
  return (
    e.code === '23505' &&
    typeof e.detail === 'string' &&
    e.detail.includes('slug')
  );
}

@Injectable()
export class VideosService {
  constructor(
    @InjectRepository(Video)
    private readonly videoRepository: Repository<Video>,
    @InjectRepository(Channel)
    private readonly channelRepository: Repository<Channel>,
    private readonly storageService: StorageService,
    @InjectQueue(VIDEO_QUEUE)
    private readonly videoQueue: Queue<ProcessVideoJobPayload>,
  ) {}

  async initiateUpload(
    userId: string,
    dto: CreateVideoDto,
  ): Promise<InitiatedUpload> {
    const channel = await this.channelRepository.findOneByOrFail({
      user_id: userId,
    });

    const videoId = randomUUID();
    const extension = extname(dto.file_name).toLowerCase();
    const originalKey = STORAGE_KEYS.originalVideo(videoId, extension);

    const uploadId = await this.storageService.createMultipartUpload(
      originalKey,
      dto.mime_type,
    );

    try {
      const video = await this.saveWithSlugRetry(() =>
        this.videoRepository.create({
          id: videoId,
          channel_id: channel.id,
          title: dto.title,
          slug: generateSlug(),
          status: VideoStatus.DRAFT,
          original_key: originalKey,
          upload_id: uploadId,
          mime_type: dto.mime_type,
          file_size: String(dto.file_size),
        }),
      );

      return {
        video,
        partSize: UPLOAD_PART_SIZE_BYTES,
        partCount: Math.ceil(dto.file_size / UPLOAD_PART_SIZE_BYTES),
      };
    } catch (error) {
      await this.storageService.abortMultipartUpload(originalKey, uploadId);
      throw error;
    }
  }

  async getPartUrls(
    userId: string,
    slug: string,
    partNumbers: number[],
  ): Promise<PresignedPart[]> {
    const video = await this.findOwnedDraft(userId, slug);

    const expiresIn = 3600;
    return Promise.all(
      partNumbers.map(async (partNumber) => ({
        partNumber,
        url: await this.storageService.presignUploadPart(
          video.original_key,
          video.upload_id!,
          partNumber,
        ),
        expiresIn,
      })),
    );
  }

  async completeUpload(
    userId: string,
    slug: string,
    dto: CompleteUploadDto,
  ): Promise<Video> {
    const video = await this.findOwnedDraft(userId, slug);

    try {
      await this.storageService.completeMultipartUpload(
        video.original_key,
        video.upload_id!,
        dto.parts.map((part) => ({
          partNumber: part.part_number,
          etag: part.etag,
        })),
      );
    } catch {
      throw new UploadIncompleteException();
    }

    video.status = VideoStatus.PROCESSING;
    video.upload_id = null;
    const saved = await this.videoRepository.save(video);

    await this.videoQueue.add(
      PROCESS_VIDEO_JOB,
      { videoId: saved.id },
      PROCESS_VIDEO_JOB_OPTIONS,
    );

    return saved;
  }

  /**
   * Visibility rule (TD-09): anonymous callers and non-owners only see
   * `ready` videos; the owner sees any status.
   */
  async findBySlug(slug: string, userId?: string): Promise<Video> {
    const video = await this.videoRepository.findOne({
      where: { slug },
      relations: { channel: true },
    });
    if (!video) {
      throw new VideoNotFoundException();
    }

    const isOwner = userId !== undefined && video.channel.user_id === userId;
    if (video.status !== VideoStatus.READY && !isOwner) {
      throw new VideoNotFoundException();
    }
    return video;
  }

  async getStreamUrl(slug: string, userId?: string): Promise<string> {
    const video = await this.findReadyBySlug(slug, userId);
    return this.storageService.presignGetUrl(video.original_key);
  }

  async getDownloadUrl(slug: string, userId?: string): Promise<string> {
    const video = await this.findReadyBySlug(slug, userId);
    const extension = extname(video.original_key);
    return this.storageService.presignGetUrl(video.original_key, {
      downloadFileName: `${video.slug}${extension}`,
    });
  }

  async getThumbnailUrl(video: Video): Promise<string | null> {
    if (!video.thumbnail_key) return null;
    return this.storageService.presignGetUrl(video.thumbnail_key);
  }

  private async findReadyBySlug(slug: string, userId?: string): Promise<Video> {
    const video = await this.findBySlug(slug, userId);
    if (video.status !== VideoStatus.READY) {
      // Owner may see details of a non-ready video, but stream/download only
      // exist for ready videos (TD-09).
      throw new VideoNotFoundException();
    }
    return video;
  }

  private async findOwnedDraft(userId: string, slug: string): Promise<Video> {
    const video = await this.videoRepository.findOne({
      where: { slug },
      relations: { channel: true },
    });
    if (!video) {
      throw new VideoNotFoundException();
    }
    if (video.channel.user_id !== userId) {
      throw new NotVideoOwnerException();
    }
    if (video.status !== VideoStatus.DRAFT || !video.upload_id) {
      throw new InvalidUploadStateException();
    }
    return video;
  }

  private async saveWithSlugRetry(build: () => Video): Promise<Video> {
    for (let attempt = 0; attempt < MAX_SLUG_ATTEMPTS; attempt++) {
      try {
        return await this.videoRepository.save(build());
      } catch (error) {
        if (!isUniqueViolationOnSlug(error)) {
          throw error;
        }
      }
    }
    throw new SlugGenerationFailedException();
  }
}
