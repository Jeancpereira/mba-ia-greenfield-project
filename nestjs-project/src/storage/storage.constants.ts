export const S3_CLIENT_INTERNAL = 'S3_CLIENT_INTERNAL';
export const S3_CLIENT_PUBLIC = 'S3_CLIENT_PUBLIC';

export const STORAGE_KEYS = {
  originalVideo: (videoId: string, extension: string): string =>
    `videos/${videoId}/original${extension}`,
  thumbnail: (videoId: string): string => `thumbnails/${videoId}.jpg`,
} as const;
