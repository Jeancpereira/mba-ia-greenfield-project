import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import type { TestingModule } from '@nestjs/testing';
import storageConfig from '../config/storage.config';
import { fetchPresigned } from '../test/presigned-http';
import { StorageModule } from './storage.module';
import { StorageService } from './storage.service';

// Exercises the real MinIO from the Compose stack (bucket `streamtube`).
// Presigned URLs are fetched via the fetchPresigned helper — see its docblock
// for the public-vs-internal endpoint rationale.
describe('StorageService (integration)', () => {
  let module: TestingModule;
  let service: StorageService;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [storageConfig] }),
        StorageModule,
      ],
    }).compile();
    service = module.get(StorageService);
  });

  afterAll(async () => {
    await module.close();
  });

  function uniqueKey(suffix: string): string {
    return `test/storage-spec-${Date.now()}-${suffix}`;
  }

  it('should complete a multipart upload roundtrip', async () => {
    const key = uniqueKey('multipart');
    // 5MB minimum per part (except the last); single-part upload is valid.
    const body = Buffer.alloc(5 * 1024 * 1024, 1);

    const uploadId = await service.createMultipartUpload(key, 'video/mp4');
    expect(uploadId).toBeTruthy();

    const url = await service.presignUploadPart(key, uploadId, 1);
    const putResponse = await fetchPresigned(url, { method: 'PUT', body });
    expect(putResponse.status).toBe(200);
    const etag = putResponse.headers.etag;
    expect(etag).toBeTruthy();

    await service.completeMultipartUpload(key, uploadId, [
      { partNumber: 1, etag: etag! },
    ]);

    const head = await service.headObject(key);
    expect(head.contentLength).toBe(body.length);
  });

  it('should presign a GET url that serves 206 for Range requests', async () => {
    const key = uniqueKey('range');
    await service.putObject(key, Buffer.alloc(1024, 7), 'video/mp4');

    const url = await service.presignGetUrl(key);
    const response = await fetchPresigned(url, {
      headers: { Range: 'bytes=0-99' },
    });

    expect(response.status).toBe(206);
    expect(response.body.length).toBe(100);
  });

  it('should presign a download url with attachment disposition', async () => {
    const key = uniqueKey('download');
    await service.putObject(key, Buffer.alloc(64, 3), 'video/mp4');

    const url = await service.presignGetUrl(key, {
      downloadFileName: 'my-video.mp4',
    });
    const response = await fetchPresigned(url);

    expect(response.status).toBe(200);
    expect(response.headers['content-disposition']).toContain(
      'attachment; filename="my-video.mp4"',
    );
  });

  it('should abort a multipart upload without leaving an object', async () => {
    const key = uniqueKey('abort');
    const uploadId = await service.createMultipartUpload(key, 'video/mp4');

    await service.abortMultipartUpload(key, uploadId);

    await expect(service.headObject(key)).rejects.toThrow();
  });
});
