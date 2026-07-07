import { Test } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { getRepositoryToken } from '@nestjs/typeorm';
import { QueryFailedError } from 'typeorm';
import {
  InvalidUploadStateException,
  NotVideoOwnerException,
  SlugGenerationFailedException,
  UploadIncompleteException,
  VideoNotFoundException,
} from '../common/exceptions/domain.exception';
import { Channel } from '../channels/entities/channel.entity';
import { StorageService } from '../storage/storage.service';
import { Video, VideoStatus } from './entities/video.entity';
import { VideosService } from './videos.service';
import { PROCESS_VIDEO_JOB, VIDEO_QUEUE } from './video-queue.constants';

function slugUniqueViolation(): QueryFailedError {
  const error = new QueryFailedError('INSERT', [], new Error('duplicate'));
  Object.assign(error, {
    code: '23505',
    detail: 'Key (slug)=(abc) already exists.',
  });
  return error;
}

describe('VideosService', () => {
  const videoRepository = {
    create: jest.fn(),
    save: jest.fn(),
    findOne: jest.fn(),
  };
  const channelRepository = {
    findOneByOrFail: jest.fn(),
  };
  const storageService = {
    createMultipartUpload: jest.fn(),
    abortMultipartUpload: jest.fn(),
    presignUploadPart: jest.fn(),
    completeMultipartUpload: jest.fn(),
    presignGetUrl: jest.fn(),
  };
  const videoQueue = { add: jest.fn() };

  let service: VideosService;

  const userId = 'user-1';
  const channel = { id: 'channel-1', user_id: userId } as Channel;

  beforeEach(async () => {
    jest.resetAllMocks();

    const module = await Test.createTestingModule({
      providers: [
        VideosService,
        { provide: getRepositoryToken(Video), useValue: videoRepository },
        { provide: getRepositoryToken(Channel), useValue: channelRepository },
        { provide: StorageService, useValue: storageService },
        { provide: getQueueToken(VIDEO_QUEUE), useValue: videoQueue },
      ],
    }).compile();

    service = module.get(VideosService);

    channelRepository.findOneByOrFail.mockResolvedValue(channel);
    videoRepository.create.mockImplementation(
      (data: Partial<Video>) => data as Video,
    );
    storageService.createMultipartUpload.mockResolvedValue('upload-1');
  });

  const dto = {
    title: 'My video',
    file_name: 'movie.mp4',
    file_size: 250 * 1024 * 1024,
    mime_type: 'video/mp4',
  };

  describe('initiateUpload', () => {
    it('should create a draft with slug, storage key and upload session', async () => {
      videoRepository.save.mockImplementation((video: Video) =>
        Promise.resolve(video),
      );

      const result = await service.initiateUpload(userId, dto);

      expect(result.video.status).toBe(VideoStatus.DRAFT);
      expect(result.video.slug).toHaveLength(11);
      expect(result.video.original_key).toMatch(
        /^videos\/[0-9a-f-]{36}\/original\.mp4$/,
      );
      expect(result.video.upload_id).toBe('upload-1');
      expect(result.partSize).toBe(100 * 1024 * 1024);
      expect(result.partCount).toBe(3);
    });

    it('should retry slug generation on unique violation', async () => {
      videoRepository.save
        .mockRejectedValueOnce(slugUniqueViolation())
        .mockImplementation((video: Video) => Promise.resolve(video));

      await service.initiateUpload(userId, dto);

      expect(videoRepository.save).toHaveBeenCalledTimes(2);
      const firstSlug = (videoRepository.save.mock.calls[0][0] as Video).slug;
      const secondSlug = (videoRepository.save.mock.calls[1][0] as Video).slug;
      expect(firstSlug).not.toBe(secondSlug);
    });

    it('should give up after exhausting slug attempts and abort the multipart upload', async () => {
      videoRepository.save.mockRejectedValue(slugUniqueViolation());

      await expect(service.initiateUpload(userId, dto)).rejects.toThrow(
        SlugGenerationFailedException,
      );
      expect(storageService.abortMultipartUpload).toHaveBeenCalledTimes(1);
    });

    it('should abort the multipart upload on non-slug save failures', async () => {
      videoRepository.save.mockRejectedValue(new Error('db down'));

      await expect(service.initiateUpload(userId, dto)).rejects.toThrow(
        'db down',
      );
      expect(storageService.abortMultipartUpload).toHaveBeenCalledTimes(1);
    });
  });

  function draftVideo(overrides: Partial<Video> = {}): Video {
    return {
      id: 'video-1',
      slug: 'abcdefghijk',
      status: VideoStatus.DRAFT,
      upload_id: 'upload-1',
      original_key: 'videos/video-1/original.mp4',
      channel,
      ...overrides,
    } as Video;
  }

  describe('getPartUrls', () => {
    it('should presign one url per requested part', async () => {
      videoRepository.findOne.mockResolvedValue(draftVideo());
      storageService.presignUploadPart.mockResolvedValue('https://signed');

      const result = await service.getPartUrls(userId, 'abcdefghijk', [1, 2]);

      expect(result).toHaveLength(2);
      expect(storageService.presignUploadPart).toHaveBeenCalledWith(
        'videos/video-1/original.mp4',
        'upload-1',
        1,
      );
    });

    it('should reject a non-owner', async () => {
      videoRepository.findOne.mockResolvedValue(
        draftVideo({
          channel: { id: 'other', user_id: 'other-user' } as Channel,
        }),
      );

      await expect(
        service.getPartUrls(userId, 'abcdefghijk', [1]),
      ).rejects.toThrow(NotVideoOwnerException);
    });

    it('should reject when the video is not a draft', async () => {
      videoRepository.findOne.mockResolvedValue(
        draftVideo({ status: VideoStatus.PROCESSING, upload_id: null }),
      );

      await expect(
        service.getPartUrls(userId, 'abcdefghijk', [1]),
      ).rejects.toThrow(InvalidUploadStateException);
    });

    it('should reject an unknown slug', async () => {
      videoRepository.findOne.mockResolvedValue(null);

      await expect(
        service.getPartUrls(userId, 'missing-slug', [1]),
      ).rejects.toThrow(VideoNotFoundException);
    });
  });

  describe('completeUpload', () => {
    const completeDto = { parts: [{ part_number: 1, etag: 'etag-1' }] };

    it('should flip status to processing and enqueue the processing job', async () => {
      const video = draftVideo();
      videoRepository.findOne.mockResolvedValue(video);
      videoRepository.save.mockImplementation((v: Video) => Promise.resolve(v));

      const result = await service.completeUpload(
        userId,
        'abcdefghijk',
        completeDto,
      );

      expect(result.status).toBe(VideoStatus.PROCESSING);
      expect(result.upload_id).toBeNull();
      expect(videoQueue.add).toHaveBeenCalledWith(
        PROCESS_VIDEO_JOB,
        { videoId: 'video-1' },
        expect.objectContaining({ attempts: 3 }),
      );
    });

    it('should map storage completion failures to UPLOAD_INCOMPLETE', async () => {
      videoRepository.findOne.mockResolvedValue(draftVideo());
      storageService.completeMultipartUpload.mockRejectedValue(
        new Error('InvalidPart'),
      );

      await expect(
        service.completeUpload(userId, 'abcdefghijk', completeDto),
      ).rejects.toThrow(UploadIncompleteException);
      expect(videoQueue.add).not.toHaveBeenCalled();
    });
  });

  describe('findBySlug (visibility per TD-09)', () => {
    it('should hide non-ready videos from anonymous callers', async () => {
      videoRepository.findOne.mockResolvedValue(draftVideo());

      await expect(service.findBySlug('abcdefghijk')).rejects.toThrow(
        VideoNotFoundException,
      );
    });

    it('should hide non-ready videos from non-owners', async () => {
      videoRepository.findOne.mockResolvedValue(draftVideo());

      await expect(
        service.findBySlug('abcdefghijk', 'other-user'),
      ).rejects.toThrow(VideoNotFoundException);
    });

    it('should show a non-ready video to its owner', async () => {
      videoRepository.findOne.mockResolvedValue(draftVideo());

      const video = await service.findBySlug('abcdefghijk', userId);
      expect(video.status).toBe(VideoStatus.DRAFT);
    });

    it('should show ready videos to anyone', async () => {
      videoRepository.findOne.mockResolvedValue(
        draftVideo({ status: VideoStatus.READY }),
      );

      const video = await service.findBySlug('abcdefghijk');
      expect(video.status).toBe(VideoStatus.READY);
    });
  });

  describe('getStreamUrl / getDownloadUrl', () => {
    it('should refuse streaming a non-ready video even for the owner', async () => {
      videoRepository.findOne.mockResolvedValue(draftVideo());

      await expect(service.getStreamUrl('abcdefghijk', userId)).rejects.toThrow(
        VideoNotFoundException,
      );
    });

    it('should presign the original for streaming when ready', async () => {
      videoRepository.findOne.mockResolvedValue(
        draftVideo({ status: VideoStatus.READY }),
      );
      storageService.presignGetUrl.mockResolvedValue('https://signed');

      const url = await service.getStreamUrl('abcdefghijk');

      expect(url).toBe('https://signed');
      expect(storageService.presignGetUrl).toHaveBeenCalledWith(
        'videos/video-1/original.mp4',
      );
    });

    it('should presign the download with an attachment filename', async () => {
      videoRepository.findOne.mockResolvedValue(
        draftVideo({ status: VideoStatus.READY }),
      );
      storageService.presignGetUrl.mockResolvedValue('https://signed');

      await service.getDownloadUrl('abcdefghijk');

      expect(storageService.presignGetUrl).toHaveBeenCalledWith(
        'videos/video-1/original.mp4',
        { downloadFileName: 'abcdefghijk.mp4' },
      );
    });
  });
});
