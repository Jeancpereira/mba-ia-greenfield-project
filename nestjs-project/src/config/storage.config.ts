import { registerAs } from '@nestjs/config';

export default registerAs('storage', () => ({
  endpoint: process.env.S3_ENDPOINT || 'http://minio:9000',
  publicEndpoint: process.env.S3_PUBLIC_ENDPOINT || 'http://localhost:9000',
  bucket: process.env.S3_BUCKET || 'streamtube',
  accessKey: process.env.S3_ACCESS_KEY || 'streamtube',
  secretKey: process.env.S3_SECRET_KEY || 'streamtube1234',
  region: process.env.S3_REGION || 'us-east-1',
  presignExpiresSeconds: parseInt(
    process.env.S3_PRESIGN_EXPIRES_SECONDS || '3600',
    10,
  ),
}));
