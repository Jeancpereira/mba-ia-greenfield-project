---
scope_type: phase
related_phases: [3]
status: decided
date: 2026-07-06
scope_description: "Backend infrastructure for video upload and processing: queue technology, 10GB upload strategy, worker topology, metadata/thumbnail extraction, unique URL generation, streaming/download delivery, status lifecycle, and object-storage usage."
---

# Technical Decisions — Phase 03: Upload e Processamento de Vídeos

_Subprojects in scope:_

- `nestjs-project/` — backend that delivers the video module (upload initiation, multipart presigned upload, processing queue, video worker, streaming/download endpoints) plus the new Compose infrastructure (object storage, queue broker, worker container).
- `next-frontend/` — Frontend deferred: the video UI (upload screen, player) is out of this phase's scope per the challenge definition. Cross-layer TDs below (upload protocol, streaming delivery) define the contract the frontend will consume in a future phase. No frontend-only decision in this document.

---

## TD-01: Queue Technology for Background Processing

**Scope:** Backend

**Capability:** Serviço de processamento em segundo plano (filas)

**Context:** The architecture diagram (`docs/diagrams/software-arch.mermaid`) marks the message queue as **TBD** — this is the genuinely open stack decision of the phase. The queue receives one job per completed upload and delivers it to the video worker. Requirements: retries with backoff, failure visibility (jobs that exhaust retries must be inspectable), and consumption from a separate worker process.

**Options:**

### Option A: BullMQ + Redis (`@nestjs/bullmq`)
- Redis-backed job queue with an official NestJS wrapper (`@nestjs/bullmq` v11, matching NestJS 11). Producers register queues in modules; consumers are `@Processor()` classes. Adds one Compose service (`redis`).
- **Pros:** First-class NestJS integration (DI, decorators, testability). Retries/backoff/delays native. Failed-job set works as a DLQ for inspection. De-facto standard for NestJS background jobs; huge community.
- **Cons:** Adds Redis as new infrastructure. At-least-once semantics only (job handlers must be idempotent). Redis persistence must be considered for durability.

### Option B: RabbitMQ (`@nestjs/microservices` RMQ transport)
- Dedicated AMQP broker; NestJS consumes via the microservices transport layer or `amqplib`.
- **Pros:** Purpose-built message broker; robust ack/nack, dead-letter exchanges, management UI.
- **Cons:** Heaviest option for a single queue: AMQP concepts (exchanges, bindings) and broker operation for no gain at this scale. NestJS RMQ transport is oriented to RPC/microservices messaging, not job queues — no built-in retry/backoff job semantics; those must be hand-built with DLX TTL patterns.

### Option C: pg-boss (queue on PostgreSQL)
- Job queue implemented over the existing PostgreSQL using `SKIP LOCKED`. No new broker.
- **Pros:** Zero new infrastructure — reuses the `db` service. Transactional enqueue with domain writes. Retries/backoff supported.
- **Cons:** No official NestJS integration (manual wiring). Couples job throughput to the primary database. Smaller ecosystem. The phase explicitly showcases queue infrastructure ("fila e worker subindo no Compose"); a queue hidden inside Postgres demonstrates less of the intended architecture.

**Recommendation:** **Option A (BullMQ + Redis)** — the official `@nestjs/bullmq` integration gives job semantics (retries, backoff, failed-job inspection) out of the box with idiomatic NestJS modules/processors; Redis is a single lightweight Compose service, and the worker consumes the same queue from a standalone process, matching the target architecture (API publishes → queue → worker).

**Decision:** A (BullMQ + Redis)

---

## TD-02: 10GB Upload Strategy

**Scope:** Cross-layer

**Capability:** Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance; Pré-cadastro automático do vídeo como rascunho ao iniciar o upload

**Context:** Files up to 10GB must reach object storage without the API ever buffering or proxying the payload — routing bytes through the API is an automatic-failure criterion. The handshake (who requests what, in which order) is a contract the future frontend will consume, hence Cross-layer. Depends on TD-08 (storage layout/endpoints).

**Options:**

### Option A: S3 Multipart Upload with presigned part URLs
- API endpoint initiates: creates the video row as `draft` + calls `CreateMultipartUpload`, returns `uploadId`. Client requests presigned URLs per part (~100MB each), PUTs parts directly to MinIO, then calls the API to `CompleteMultipartUpload`.
- **Pros:** Bypasses the API entirely for bytes. Parts are individually retryable/resumable — a dropped connection loses one part, not 10GB. No single-PUT 5GB S3 limit. Native S3 API — works identically on AWS S3 in production.
- **Cons:** More endpoints (initiate / sign-part / complete) and client-side orchestration. Abandoned multipart uploads need lifecycle cleanup (documented as a known limitation, out of this phase's scope).

### Option B: Single presigned PUT URL
- API returns one presigned PUT URL; client uploads the whole file in one request.
- **Pros:** Simplest possible contract (one endpoint, one PUT).
- **Cons:** S3/MinIO cap single PUTs at 5GB — **cannot satisfy the 10GB requirement**. No resumability: any network failure restarts the entire transfer. Disqualified.

### Option C: TUS resumable-upload protocol (tusd)
- Dedicated tusd server implementing the TUS spec; uploads land in MinIO via the tusd S3 backend.
- **Pros:** Standardized resumable protocol with mature client libraries; strong resume semantics across sessions.
- **Cons:** A whole extra service + hook integration to keep video records in sync; duplicates what S3 multipart already provides given storage is S3-compatible. Overkill for the scope.

**Recommendation:** **Option A (multipart presigned)** — it is the native S3 mechanism for large objects: satisfies 10GB (Option B cannot), gives per-part retry, keeps the API on the control plane only, and adds no new service (unlike Option C).

**Decision:** A (S3 Multipart Upload with presigned part URLs, part size ~100MB)

---

## TD-03: Video Worker Topology

**Scope:** Backend

**Capability:** Processamento automático do vídeo após upload (extração de duração e metadados); Geração automática de thumbnail a partir de um frame do vídeo

**Context:** The architecture defines a separate Video Worker container consuming the queue. The open question is where its code lives and how it boots, given the existing single-app `nestjs-project/`. Depends on TD-01 (queue).

**Options:**

### Option A: Second entrypoint in `nestjs-project` (standalone Nest app)
- `src/worker/main.ts` bootstraps a minimal Nest application context registering only the BullMQ processor + TypeORM + storage providers. Compose service `video-worker` uses the same image with a different command (`npm run start:worker`).
- **Pros:** Shares entities, config, migrations and test suite — zero duplication. One `npm install`, one tsconfig, one lint. Processor code is testable inside the existing Jest setup.
- **Cons:** API and worker share a dependency tree (deploy coupling). Care needed so the API never registers the processor (worker-only module).

### Option B: Separate project directory (`video-worker/`)
- Independent Node/Nest project at the repo root with its own package.json.
- **Pros:** Total isolation; worker dependencies don't touch the API.
- **Cons:** Duplicates entities/config/typeorm setup or forces a shared package (monorepo tooling the repo doesn't have). Second test suite, second lint, second Dockerfile — high cost, no benefit at this scale.

### Option C: Convert to Nest CLI monorepo (`apps/api`, `apps/worker`)
- Restructure `nestjs-project` into a nest-cli monorepo with two apps and shared libs.
- **Pros:** Cleanest long-term layout for multiple runtimes.
- **Cons:** Restructures the Phase 01–02 foundation (paths, Dockerfile, jest, CI conventions) — high blast radius, contradicts "continuidade, não retrabalho".

**Recommendation:** **Option A (second entrypoint)** — the worker is the same domain and same stack; a standalone Nest bootstrap in the existing project delivers the separate-container architecture with zero duplication and no foundation rework.

**Decision:** A (second entrypoint `src/worker/main.ts`, Compose service `video-worker`, same image, command `npm run start:worker`)

---

## TD-04: Metadata & Thumbnail Extraction Tooling

**Scope:** Backend

**Capability:** Processamento automático do vídeo após upload (extração de duração e metadados); Geração automática de thumbnail a partir de um frame do vídeo

**Context:** The worker must extract duration/metadata and capture a frame as thumbnail. FFmpeg/ffprobe are the de-facto tools (already named in the architecture); the decision is how to invoke them from Node and where the binary comes from. Depends on TD-03 (worker topology — the container image must ship the binaries).

**Options:**

### Option A: Spawn `ffprobe`/`ffmpeg` binaries directly (`child_process`)
- Install ffmpeg via apt in `Dockerfile.dev`; call `ffprobe -print_format json` and `ffmpeg -ss ... -frames:v 1` through `child_process.execFile`, parsing JSON output.
- **Pros:** Zero npm dependencies; full control of flags; ffprobe's JSON output is a stable documented interface; the same image serves API and worker so processor tests run in the normal suite.
- **Cons:** Command lines and JSON parsing are hand-rolled (small, contained surface).

### Option B: `fluent-ffmpeg` wrapper
- npm wrapper exposing a chainable API over ffmpeg.
- **Pros:** Friendlier API, screenshots helper.
- **Cons:** Package is in maintenance mode (repository archived/read-only in 2024–2025); typings lag; adds a dependency to wrap two fixed commands. Not worth it.

### Option C: WASM ffmpeg (`@ffmpeg/ffmpeg`)
- FFmpeg compiled to WebAssembly, no system binary.
- **Pros:** No system dependency.
- **Cons:** Made for browsers; memory-bound (whole file in memory — impossible for 10GB), far slower. Disqualified for server-side large files.

**Recommendation:** **Option A (spawn binaries)** — two fixed invocations (probe JSON + single-frame capture) don't justify a wrapper dependency, and the maintained-binary + `child_process` path is the most robust for large files streamed from storage.

**Decision:** A (ffmpeg/ffprobe binaries in the container image, invoked via `child_process`)

---

## TD-05: Unique Public URL Strategy

**Scope:** Backend

**Capability:** URL única por vídeo, sem conflito com outros vídeos

**Context:** Each video needs a short, unique, URL-safe public identifier (YouTube-style), distinct from the internal primary key, guaranteed collision-free.

**Options:**

### Option A: nanoid slug (11 chars) + DB unique index + retry on collision
- Generate an 11-char nanoid (URL-safe alphabet) at video creation; a unique index on `videos.slug` is the hard guarantee; on the (astronomically rare) unique-violation, regenerate and retry.
- **Pros:** ~68 bits of entropy at 11 chars (YouTube-like length); collision probability negligible; DB index makes correctness absolute regardless of generator; tiny dependency (`nanoid`).
- **Cons:** Requires the retry-on-violation branch (a few lines).

### Option B: UUID v4 in the URL
- Use the row's UUID directly as public identifier.
- **Pros:** Zero extra code — PK already exists.
- **Cons:** 36-char URLs — fails the "URL curta" spirit of the plan; exposes internal identifier.

### Option C: hashids/sqids over a numeric sequence
- Encode an auto-increment counter into a short reversible string.
- **Pros:** Guaranteed unique by construction (no collision handling).
- **Cons:** Sequential — enumerable/guessable (leaks volume, allows scraping); needs a separate numeric sequence since PKs are UUIDs.

**Recommendation:** **Option A (nanoid + unique index)** — short non-enumerable URLs with a database-enforced uniqueness guarantee; the retry branch is trivial.

**Decision:** A (nanoid 11-char slug, unique index, regenerate on collision)

---

## TD-06: Streaming & Download Delivery

**Scope:** Cross-layer

**Capability:** Reprodução via streaming (sem necessidade de download completo); Download do vídeo pelo usuário

**Context:** Playback must start without downloading the whole file (HTTP Range / `206 Partial Content`), and users can download the original. The question is whether video bytes flow through the API or directly from storage — a contract the future frontend player consumes. The architecture diagram already draws `frontend → storage (Streams)`. Depends on TD-02/TD-08.

**Options:**

### Option A: API issues 302 redirect to a presigned GET URL
- `GET /videos/{slug}/stream` validates status/authorization and redirects (302) to a short-lived presigned MinIO URL; MinIO serves Range/206 natively. Download endpoint identical plus `response-content-disposition=attachment`.
- **Pros:** API stays on the control plane — zero video bytes through Nest. Range/seek handled by the storage engine (battle-tested). Matches the architecture diagram. Works unchanged on real S3/CDN later.
- **Cons:** Presigned URLs are bearer tokens while valid (mitigated by short expiry). Two hostnames involved (see TD-08 dual endpoint).

### Option B: API proxies bytes with Range support
- Nest endpoint reads from MinIO (`GetObject` with Range passthrough) and streams to the client with 206 handling.
- **Pros:** Single origin; per-request auth on every byte range; view-counting hooks trivially.
- **Cons:** Every seek and every concurrent viewer flows through the API — memory/CPU/socket pressure, exactly the "impacto na performance" the phase forbids. Hand-rolled Range edge cases.

**Recommendation:** **Option A (redirect to presigned GET)** — delegates Range semantics to storage, keeps the API light, and matches the target architecture; authorization happens at the API before the redirect.

**Decision:** A (302 redirect to presigned GET; download variant sets `Content-Disposition: attachment`)

---

## TD-07: Video Status Lifecycle & Failure Policy

**Scope:** Backend

**Capability:** Transversal — covers: Pré-cadastro automático do vídeo como rascunho ao iniciar o upload; Processamento automático do vídeo após upload (extração de duração e metadados); Geração automática de thumbnail a partir de um frame do vídeo

**Context:** The video row is created before any byte is uploaded and must reflect the pipeline stage. The project plan names the cycle "rascunho → processando → pronto/erro". What happens when processing fails must be explicit.

**Options:**

### Option A: `draft → processing → ready | failed` (4 states)
- `draft` from initiate until upload completion (covers the whole upload window); `processing` when the completion endpoint enqueues the job; worker success → `ready`; after queue retries exhaust (3 attempts, exponential backoff) → `failed` + persisted `error_reason`.
- **Pros:** Mirrors the project plan exactly. `draft` remains the editable pre-publication state Phase 04 builds on. Failure is terminal, inspectable (reason + BullMQ failed set).
- **Cons:** No distinction between "never uploaded" and "upload in progress" (acceptable: a multipart session can stay open indefinitely; both are simply "no processable file yet").

### Option B: Add explicit `uploading` state (5 states)
- `draft → uploading → processing → ready | failed`, flipping on first signed part.
- **Pros:** Finer-grained progress reporting.
- **Cons:** State flip on part-signing is unreliable (parts can be signed and never sent); duplicates what the multipart session already knows; complicates the Phase 04 draft semantics for no consumer in this phase.

### Option C: Option A + manual reprocess endpoint (`failed → processing`)
- Same as A plus an operator/user retry endpoint.
- **Pros:** Recovery path without DB surgery.
- **Cons:** Not requested by any capability of the phase — scope creep; BullMQ retries already cover transient failures.

**Recommendation:** **Option A** — the smallest state machine that matches the plan's own wording; upload progress is an upload-session concern, not a video state.

**Decision:** A (`draft → processing → ready | failed`; 3 attempts, exponential backoff; terminal `failed` persists `error_reason`)

---

## TD-08: Object Storage Usage — Key Layout & Presign Endpoints

**Scope:** Backend

**Capability:** Serviço de armazenamento de arquivos (vídeos e thumbnails)

**Context:** Storage engine is **not** open — the architecture fixes S3-compatible storage; locally MinIO runs in Compose (production would swap the endpoint to real S3). What must be decided is bucket/key organization and how presigned URLs work across the Compose network boundary (containers reach MinIO at `minio:9000`; the user's browser/test client reaches it at `localhost:9000` — a presigned URL is only valid for the host it was signed for).

**Options:**

### Option A: Single bucket, prefixed keys, dual-endpoint S3 clients
- One bucket (`streamtube`), keys `videos/{videoId}/original{ext}` and `thumbnails/{videoId}.jpg`. Two S3 client configs: internal (`S3_ENDPOINT=http://minio:9000`) for API/worker object operations; public (`S3_PUBLIC_ENDPOINT=http://localhost:9000`) used exclusively to sign URLs handed to external clients. Path-style addressing (`forcePathStyle: true`).
- **Pros:** One bucket to provision/lifecycle; keys carry ownership by prefix; the dual-client split is the standard MinIO-behind-Docker answer and maps 1:1 to prod (public endpoint becomes the S3/CDN domain).
- **Cons:** Two client instances to wire (one provider each — small DI cost).

### Option B: Two buckets (`videos`, `thumbnails`), single internal endpoint
- Separate buckets per asset type; sign everything against `minio:9000`.
- **Pros:** Per-type bucket policies possible.
- **Cons:** Presigned URLs signed for `minio:9000` are unreachable/invalid from the host — breaks manual verification and e2e clients outside the Compose network. Two buckets double provisioning for no policy need in this phase.

**Recommendation:** **Option A** — the dual-endpoint split is what makes presigned URLs actually work from outside the Compose network, and a single prefixed bucket is simpler to provision and migrate.

**Decision:** A (bucket `streamtube`; prefixed keys; internal client for object ops, public-endpoint client for presigning)

---

## TD-09: Access Policy for Streaming & Download in This Phase

**Scope:** Backend

**Capability:** Reprodução via streaming (sem necessidade de download completo); Download do vídeo pelo usuário

**Context:** Publication/visibility (public vs unlisted) only arrives in Phase 04, and anonymous viewing is a Phase 05 capability — but streaming/download must be demonstrable now. The global JWT guard (Phase 02) protects everything by default with `@Public()` opt-out. The question is who may hit stream/download before visibility exists.

**Options:**

### Option A: Public (`@Public()`) when status is `ready`; 404 otherwise
- Stream/download endpoints are anonymous; any `ready` video is servable by slug. Non-`ready` (draft/processing/failed) returns 404. Upload/management endpoints remain authenticated + channel-owner-only.
- **Pros:** Anticipates the platform's core semantic (anonymous watching, Phase 05) without inventing visibility rules; evaluators verify streaming with plain curl; slug non-enumerability (TD-05) prevents listing.
- **Cons:** Videos are watchable by direct link before "publication" exists (equivalent to unlisted — acceptable interim semantic, tightened by Phase 04).

### Option B: Owner-only until Phase 04
- All video endpoints require auth; stream/download check channel ownership.
- **Pros:** Most conservative exposure.
- **Cons:** "Streaming funcionando" (acceptance criterion) sits behind login; contradicts the target anonymous-viewing model and adds throwaway checks Phase 04/05 would remove.

**Recommendation:** **Option A** — public-if-ready is the semantic the platform converges to; it keeps the acceptance criteria verifiable and removes no future work.

**Decision:** A (`@Public()` stream/download for `ready` videos; 404 for non-ready; management endpoints owner-only)

---

## Decisions Summary

| ID | Scope | Decision | Recommendation | Choice |
|----|-------|----------|---------------|--------|
| TD-01 | Backend | Queue technology | BullMQ + Redis | A (BullMQ + Redis) |
| TD-02 | Cross-layer | 10GB upload strategy | Multipart presigned | A (multipart presigned, ~100MB parts) |
| TD-03 | Backend | Worker topology | Second entrypoint | A (standalone Nest entrypoint, separate container) |
| TD-04 | Backend | Metadata/thumbnail tooling | Spawn ffmpeg/ffprobe | A (binaries via child_process) |
| TD-05 | Backend | Unique public URL | nanoid + unique index | A (nanoid 11 chars) |
| TD-06 | Cross-layer | Streaming & download delivery | Redirect to presigned GET | A (302 + presigned GET) |
| TD-07 | Backend | Status lifecycle & failure | draft→processing→ready/failed | A (4 states, 3 retries, error_reason) |
| TD-08 | Backend | Storage key layout & presign endpoints | Single bucket + dual endpoint | A (bucket `streamtube`, dual S3 clients) |
| TD-09 | Backend | Stream/download access policy | Public if `ready` | A (@Public() when ready, else 404) |
