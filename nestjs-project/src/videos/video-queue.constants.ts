export const VIDEO_QUEUE = 'video-processing';
export const PROCESS_VIDEO_JOB = 'process-video';

export const PROCESS_VIDEO_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5000 },
} as const;

export interface ProcessVideoJobPayload {
  videoId: string;
}

export const UPLOAD_PART_SIZE_BYTES = 100 * 1024 * 1024; // 100MB
export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024 * 1024; // 10GB
export const MAX_PART_URLS_PER_REQUEST = 100;
export const MAX_SLUG_ATTEMPTS = 5;
