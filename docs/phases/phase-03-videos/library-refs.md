---
libs:
  "@nestjs/bullmq":
    version: "^11.0.4"
    context7_id: "/nestjs/docs.nestjs.com"
    fetched_at: "2026-07-06T20:27:51Z"
  "bullmq":
    version: "^5.79.2"
    context7_id: "/taskforcesh/bullmq"
    fetched_at: "2026-07-06T20:27:51Z"
  "@aws-sdk/client-s3":
    version: "^3.1080.0"
    context7_id: "/websites/aws_amazon_sdk-for-javascript_v3_developer-guide"
    fetched_at: "2026-07-06T20:27:51Z"
  "@aws-sdk/s3-request-presigner":
    version: "^3.1080.0"
    context7_id: "/websites/aws_amazon_sdk-for-javascript_v3_developer-guide"
    fetched_at: "2026-07-06T20:27:51Z"
  "nanoid":
    version: "^3.3.15"
    context7_id: "/ai/nanoid"
    fetched_at: "2026-07-06T20:27:51Z"
sources_mtime:
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-07-06T17:25:36-0300"
---

# phase-03-videos — Library References

Docs fetched via Context7 (public API) on 2026-07-06, filtered to the surfaces this phase uses (TD-01, TD-02, TD-05, TD-08). Compatibility target: NestJS 11, Node ≥ 20, CommonJS output.

### @nestjs/bullmq (^11.0.4)

Official NestJS wrapper for BullMQ. Matches NestJS 11 (same major line).

- **Root registration** (AppModule / WorkerModule): `BullModule.forRootAsync({ inject: [redisConfig.KEY], useFactory: (cfg) => ({ connection: { host: cfg.host, port: cfg.port } }) })` — use `connection` (BullMQ v5 key), not the legacy Bull `redis` key.
- **Queue registration (producer side)**: `BullModule.registerQueue({ name: VIDEO_QUEUE })` in the module that publishes; inject with `@InjectQueue(VIDEO_QUEUE) private queue: Queue`.
- **Job publish**: `await this.queue.add(JOB_NAME, payload, { attempts: 3, backoff: { type: 'exponential', delay: 5000 } })` — retry policy per TD-07.
- **Consumer**: class annotated `@Processor(VIDEO_QUEUE)` extending `WorkerHost`, implementing `async process(job: Job<Payload>): Promise<void>`. Register as provider ONLY in the worker module so the API process never consumes (TD-03).
- **Failure hooks**: `@OnWorkerEvent('failed')` on the consumer class receives `(job, err)` — use to flip video status to `failed` when `job.attemptsMade >= job.opts.attempts`.

### bullmq (^5.79.2)

Underlying queue engine (peer of `@nestjs/bullmq`).

- **Retries/backoff**: job opts `{ attempts: N, backoff: { type: 'exponential' | 'fixed', delay: ms } }`; exponential delay = `delay * 2^(attemptsMade-1)`. Custom strategies via `settings.backoffStrategy` on the Worker.
- **Failed jobs**: after exhausting attempts the job lands in the `failed` set (inspectable DLQ); `job.failedReason` holds the last error message.
- **At-least-once**: handlers must be idempotent — processing may re-run after a crash mid-job (safe here: ffprobe/thumbnail writes are overwrite-by-key, status update is idempotent).
- **Connection**: `maxRetriesPerRequest: null` is required on the Worker connection (BullMQ enforces it; the NestJS wrapper sets it when given plain host/port).

### @aws-sdk/client-s3 (^3.1080.0)

S3 API client — works against MinIO with `endpoint` + `forcePathStyle: true`.

- **Client (MinIO)**: `new S3Client({ endpoint: 'http://minio:9000', region: 'us-east-1', credentials: { accessKeyId, secretAccessKey }, forcePathStyle: true })`. Two instances per TD-08: internal endpoint for object ops, public endpoint (`MINIO_PUBLIC_URL`) exclusively for presigning.
- **Multipart lifecycle (TD-02)**: `CreateMultipartUploadCommand({ Bucket, Key, ContentType })` → returns `UploadId`; per part `UploadPartCommand({ Bucket, Key, UploadId, PartNumber })` (presigned, see presigner); finish with `CompleteMultipartUploadCommand({ Bucket, Key, UploadId, MultipartUpload: { Parts: [{ ETag, PartNumber }] } })`; abandon with `AbortMultipartUploadCommand`.
- Part size: S3 minimum 5MB per part (except last); 10GB ÷ 100MB = 100 parts (max 10,000). Client must send parts ≥5MB.
- **Object ops used by worker**: `GetObjectCommand` (returns `Body` as stream — pipe to ffmpeg/disk), `PutObjectCommand` (thumbnail upload), `HeadObjectCommand` (existence/size check on complete).

### @aws-sdk/s3-request-presigner (^3.1080.0)

- `getSignedUrl(client, command, { expiresIn: seconds })` — signs any command; use the **public-endpoint client** so URLs are reachable from outside the Compose network (TD-08).
- Presigned part upload: `getSignedUrl(publicClient, new UploadPartCommand({ Bucket, Key, UploadId, PartNumber }), { expiresIn })`.
- Presigned GET for streaming (TD-06): `getSignedUrl(publicClient, new GetObjectCommand({ Bucket, Key }), { expiresIn })` — MinIO serves Range/206 on the resulting URL natively.
- Download variant: add `ResponseContentDisposition: 'attachment; filename="..."'` to the `GetObjectCommand` input.

### nanoid (^3.3.15)

Pinned to v3 — last CommonJS-native major (v4+ is ESM-only; project compiles to CJS). Same API as v5 for the used surface. See TD-05 revision 2026-07-06.

- `const { customAlphabet } = require('nanoid')` / `import { customAlphabet } from 'nanoid'` (CJS-safe in v3).
- Slug generator (TD-05): `const slugAlphabet = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ-_', 11)` — 64-char URL-safe alphabet, 11 chars ≈ 66 bits.
- Cryptographically secure by default (uses `crypto.randomBytes` pool). Uniform distribution guaranteed by the algorithm (reason to prefer over hand-rolled modulo).
- Collision guard remains the DB unique index + regenerate-and-retry on unique-violation.
