---
kind: phase
name: phase-03-videos
test_specs_aware: true
sources_mtime:
  docs/phases/phase-03-videos/context.md: "2026-07-06T17:28:42-0300"
  docs/phases/phase-03-videos/library-refs.md: "2026-07-06T17:28:33-0300"
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-07-06T17:25:36-0300"
---

# Phase 03 — Upload e Processamento de Vídeos

## Objective

Deliver upload of videos up to 10GB without impacting API performance (multipart presigned direct-to-storage), automatic draft pre-registration at upload start, automatic background processing (duration/metadata extraction and thumbnail generation via a queue-fed video worker), unique per-video URLs, streaming playback without full download, and user download — backed by new Compose infrastructure (MinIO object storage, Redis queue, video worker container).

---

## Step Implementations

### SI-03.1 — Infra: storage, fila e configuração de ambiente

**Description:** Provisiona a infraestrutura nova da fase (MinIO, Redis, ffmpeg na imagem) e a fundação de configuração/env — separada do comportamento que os SIs seguintes implementam.

**Technical actions:**

1. Adicionar `ffmpeg` ao `nestjs-project/Dockerfile.dev` via apt — binários `ffmpeg`/`ffprobe` disponíveis para API e worker na mesma imagem (per `phase-03-videos/TD-04`)
2. Adicionar serviços `minio` (com volume e healthcheck) e `redis` ao `nestjs-project/compose.yaml`, mais job de bootstrap do bucket `streamtube` via `mc` (per `phase-03-videos/TD-01`, `phase-03-videos/TD-08`)
3. Adicionar env vars a `.env`/`.env.example` (`S3_ENDPOINT`, `S3_PUBLIC_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `REDIS_HOST`, `REDIS_PORT`) e estendê-las no schema Joi `src/config/env.validation.ts` (convenção herdada da fase 01)
4. Criar `src/config/storage.config.ts` e `src/config/queue.config.ts` com `registerAs` namespaced (convenção herdada da fase 01)
5. Instalar dependências no container: `@nestjs/bullmq`, `bullmq`, `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`, `nanoid@^3` (per `library-refs.md`)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `env.validation` | Integration: novas keys obrigatórias validadas (falha sem `S3_ENDPOINT` etc.) | `src/config/env.validation.integration-spec.ts` (estender) |

**Dependencies:** none

**Acceptance criteria:**

- `docker compose up -d` sobe `minio`, `redis` e demais serviços com status running/healthy
- Bucket `streamtube` existe no MinIO após o bootstrap (`mc ls` ou equivalente)
- Boot da aplicação falha com mensagem de validação quando uma env nova obrigatória está ausente
- `ffprobe -version` executa com sucesso dentro do container `nestjs-api`

---

### SI-03.2 — Entidade Video, migration e módulo

**Description:** Cria a tabela `videos` ligada ao canal, a entidade TypeORM, o gerador de slug e o esqueleto do módulo — a base de dados que todos os SIs seguintes consomem.

**Technical actions:**

1. Criar `src/videos/entities/video.entity.ts` — campos, enum de status, relação `@ManyToOne` com `Channel` conforme `### Data Model → Video` (per `phase-03-videos/TD-07`)
2. Gerar migration `<timestamp>-CreateVideos.ts` via TypeORM CLI — tabela `videos`, enum `videos_status_enum`, FK `channel_id`, unique index em `slug`, índices em `channel_id` e `status` (regra `typeorm-migrations`)
3. Criar `src/videos/slug.util.ts` — `customAlphabet` do `nanoid@^3` com alfabeto URL-safe de 64 chars, tamanho 11 (per `phase-03-videos/TD-05`, `library-refs.md → nanoid`)
4. Criar `src/videos/videos.module.ts` e registrar em `AppModule`

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `Video` | Integration: constraints, defaults (`status = draft`), unique em `slug`, FK com `channels` | `src/videos/entities/video.entity.integration-spec.ts` |
| migrations | Integration: estender o teste de migrations existente para cobrir a nova tabela | `src/database/migrations.integration-spec.ts` (estender) |
| `slug.util` | Unit: comprimento 11, alfabeto URL-safe, unicidade estatística básica | `src/videos/slug.util.spec.ts` |
| `VideosModule` | Unit: compilation test | `src/videos/videos.module.spec.ts` |

**Dependencies:** SI-03.1 — nanoid instalado

**Acceptance criteria:**

- `npm run migration:run` cria a tabela `videos` com enum, FK e unique index em `slug`
- `npm run migration:revert` desfaz a migration sem resíduo (enum incluído)
- Inserção de dois vídeos com o mesmo `slug` viola o unique index
- Vídeo criado sem status explícito persiste com `status = draft`

---

### SI-03.3 — StorageService (S3/MinIO dual-endpoint)

**Description:** Camada de acesso ao object storage com os dois clients S3 (interno para operações, público para presign) que upload, streaming e worker usam.

**Technical actions:**

1. Criar `src/storage/storage.module.ts` — providers para dois `S3Client` (`S3_ENDPOINT` interno; `S3_PUBLIC_ENDPOINT` para assinatura), `forcePathStyle: true`, credenciais via `storage.config` (per `phase-03-videos/TD-08`, `library-refs.md → @aws-sdk/client-s3`)
2. Criar `src/storage/storage.service.ts` — `createMultipartUpload`, `presignUploadPart`, `completeMultipartUpload`, `abortMultipartUpload`, `presignGetUrl(key, { disposition? })`, `putObject`, `getObjectStream`, `headObject` (per `phase-03-videos/TD-02`, `phase-03-videos/TD-06`, `library-refs.md → @aws-sdk/s3-request-presigner`)
3. Definir `src/storage/storage.constants.ts` — layout de chaves `videos/{videoId}/original{ext}` e `thumbnails/{videoId}.jpg` (per `phase-03-videos/TD-08`)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `StorageService` | Integration: MinIO real — roundtrip multipart (initiate → parts → complete → head), presigned GET responde 200 e 206 com header `Range`, presigned GET com disposition attachment | `src/storage/storage.service.integration-spec.ts` |
| `StorageModule` | Unit: compilation test | `src/storage/storage.module.spec.ts` |

**Dependencies:** SI-03.1 — MinIO no Compose, SDK instalado

**Acceptance criteria:**

- Upload multipart de um objeto pequeno via service resulta em objeto íntegro no bucket `streamtube`
- URL presigned gerada é acessível de fora da rede Compose (endpoint público) e responde `206 Partial Content` a uma requisição com `Range: bytes=0-99`
- URL presigned de download inclui `Content-Disposition: attachment`

---

### SI-03.4 — VideosService: ciclo de upload e producer da fila

**Description:** Regra de negócio do ciclo de upload — pré-cadastro draft, presign de partes, complete com enfileiramento — e as exceções de domínio do módulo.

**Technical actions:**

1. Criar DTOs `src/videos/dto/create-video.dto.ts`, `part-urls.dto.ts`, `complete-upload.dto.ts` — validações conforme `### API Contracts → Validation Rules — video upload` (class-validator, convenção herdada)
2. Criar `src/videos/exceptions/` — `VideoNotFoundException`, `NotVideoOwnerException`, `InvalidUploadStateException`, `UploadIncompleteException`, `SlugGenerationFailedException` mapeadas no filtro de domínio existente com os `errorCode`s do `### Error Catalog`
3. Registrar a fila em `VideosModule` — `BullModule.forRootAsync` (connection via `queue.config`) + `BullModule.registerQueue({ name: 'video-processing' })`; constantes em `src/videos/video-queue.constants.ts` (per `phase-03-videos/TD-01`, `library-refs.md → @nestjs/bullmq`)
4. Criar `src/videos/videos.service.ts` — `initiateUpload` (cria draft com slug + `CreateMultipartUpload`, retry de slug em colisão), `getPartUrls`, `completeUpload` (complete S3 + `HeadObject` + status `processing` + `queue.add('process-video', { videoId }, { attempts: 3, backoff: { type: 'exponential', delay: 5000 } })`), `findBySlug` com regra de visibilidade (per `phase-03-videos/TD-02`, `TD-05`, `TD-07`, `TD-09`)
5. Implementar checagem de ownership (vídeo.channel pertence ao usuário autenticado) nos métodos de gestão (per `### Authorization Matrix`)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideosService` | Unit: branch logic — retry de slug em colisão, transições de status inválidas, ownership, visibilidade por status (mocks de repo/storage/queue) | `src/videos/videos.service.spec.ts` |
| `VideosService` | Integration: DB + MinIO + Redis reais — initiate cria draft com upload session; complete flipa para processing e enfileira job (asserção via API do BullMQ) | `src/videos/videos.service.integration-spec.ts` |

**Dependencies:** SI-03.2 — entity/migration; SI-03.3 — StorageService

**Acceptance criteria:**

- `initiateUpload` persiste vídeo `draft` com `slug` de 11 chars, `original_key` no layout do TD-08 e `upload_id` preenchido
- `completeUpload` em vídeo `draft` com partes válidas deixa `status = processing` e um job `process-video` na fila `video-processing` com `{ videoId }`
- `completeUpload` em vídeo fora de `draft` lança exceção com `errorCode: "INVALID_UPLOAD_STATE"`
- `getPartUrls`/`completeUpload` por usuário que não é dono do canal lança `errorCode: "NOT_VIDEO_OWNER"`
- `findBySlug` de vídeo não-`ready` para não-dono resulta em `errorCode: "VIDEO_NOT_FOUND"`

---

### SI-03.5 — VideosController: endpoints REST

**Description:** Superfície HTTP do módulo — os 6 endpoints do `### API Contracts`, com autorização conforme a matrix e documentação OpenAPI.

**Technical actions:**

1. Criar `src/videos/videos.controller.ts` — `POST /videos`, `POST /videos/:slug/upload/part-urls`, `POST /videos/:slug/upload/complete`, `GET /videos/:slug`, `GET /videos/:slug/stream`, `GET /videos/:slug/download`; shapes de request/response conforme `### API Contracts` verbatim
2. Aplicar `@Public()` em `GET :slug`, `stream` e `download` (redirect 302 via presigned GET; anônimo só vê `ready`) e `@CurrentUser()` nos endpoints autenticados (per `phase-03-videos/TD-06`, `TD-09`, `### Authorization Matrix`)
3. Decorar com `@nestjs/swagger` (convenção herdada `openapi-docs-nestjs/TD-01`) e regenerar `openapi.json` via script de sync (per `openapi-docs-nestjs/TD-02`)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideosController` + DTOs | E2E: fluxo de upload (initiate → part-urls → complete com MinIO/Redis reais), validação de payload (400), auth (401/403), visibilidade (404 para draft de terceiro), stream/download 302 para `ready` e 404 para não-`ready` | `test/videos.e2e-spec.ts` |

**Dependencies:** SI-03.4 — service pronto

**Acceptance criteria:**

- `POST /videos` autenticado com payload válido retorna `201` com `id`, `slug`, `status: "draft"` e bloco `upload` (upload_id, part_size, part_count)
- `POST /videos` com `file_size` acima de 10GB retorna `400` (validation error)
- `POST /videos/{slug}/upload/complete` válido retorna `202` com `status: "processing"`
- `GET /videos/{slug}/stream` de vídeo `ready` retorna `302` com `Location` presigned; de vídeo `draft` retorna `404` com `errorCode: "VIDEO_NOT_FOUND"`
- `GET /videos/{slug}` anônimo de vídeo `ready` retorna `200` sem `error_reason`; do dono inclui status real em qualquer estado
- Endpoints de gestão sem token retornam `401`

---

### SI-03.6 — Video Worker: processor, ffmpeg e container

**Description:** O consumidor da fila — entrypoint NestJS standalone em container próprio, extração de metadados via ffprobe e thumbnail via ffmpeg, com política de falha terminal.

**Technical actions:**

1. Criar `src/videos/processing/ffmpeg.service.ts` — `probe(filePath)` (`ffprobe -print_format json -show_format -show_streams` via `child_process.execFile`, parse de duração/codec/dimensões) e `captureThumbnail(filePath, outPath)` (`ffmpeg -ss 1 -i in -frames:v 1 -q:v 4`) (per `phase-03-videos/TD-04`)
2. Criar `src/videos/processing/video-processing.processor.ts` — `@Processor('video-processing')` extends `WorkerHost`: baixa original para tmp (stream), probe, thumbnail, upload `thumbnails/{videoId}.jpg`, update `duration_seconds`/`metadata`/`thumbnail_key`/`status = ready`; `@OnWorkerEvent('failed')` grava `status = failed` + `error_reason` quando `attemptsMade >= attempts` (per `phase-03-videos/TD-07`, `### Events/Messages`)
3. Criar `src/worker/worker.module.ts` (TypeORM + Storage + processor, sem controllers) e `src/worker/main.ts` — bootstrap standalone `NestFactory.createApplicationContext` (per `phase-03-videos/TD-03`)
4. Adicionar script `start:worker` ao `package.json` e serviço `video-worker` ao `compose.yaml` (mesma imagem, command `npm run start:worker`, depends_on db/redis/minio)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `FfmpegService` | Integration: ffprobe/ffmpeg reais contra fixture de vídeo pequeno (duração correta, thumbnail JPEG gerada) | `src/videos/processing/ffmpeg.service.integration-spec.ts` |
| `VideoProcessingProcessor` | Integration: DB + MinIO reais — processa job stub e deixa vídeo `ready` com metadados/thumbnail; erro de probe em arquivo inválido propaga (retry da fila) | `src/videos/processing/video-processing.processor.integration-spec.ts` |
| `WorkerModule` | Unit: compilation test | `src/worker/worker.module.spec.ts` |

**Dependencies:** SI-03.3 — StorageService; SI-03.4 — fila registrada e status model

**Acceptance criteria:**

- Processamento de um vídeo real pequeno resulta em `status = ready`, `duration_seconds` correto (±1s), `metadata` com codec/dimensões e objeto `thumbnails/{videoId}.jpg` existente no bucket
- Processamento de objeto que não é vídeo lança erro (job vai a retry; após 3 tentativas o vídeo termina `failed` com `error_reason` preenchido)
- `docker compose up -d` sobe o container `video-worker` consumindo a fila (job enfileirado é processado sem a API)

---

### SI-03.7 — E2E do pipeline completo (upload → processamento → streaming)

**Description:** Prova de ponta a ponta do fluxo da fase com infra real — worker in-process no teste, conforme decisão de teste da fase.

**Technical actions:**

1. Adicionar fixture de vídeo pequeno (~1s, alguns KB) em `test/fixtures/` e helper de upload multipart via presigned URLs (fetch/undici contra MinIO)
2. Criar `test/video-processing.e2e-spec.ts` — sobe app API + instancia `WorkerModule` in-process (Redis/MinIO/ffmpeg reais): fluxo feliz (initiate → upload partes → complete → poll até `ready` → `GET stream` 302 → fetch presigned com `Range` espera 206 → download com attachment) e fluxo de falha (arquivo não-vídeo → poll até `failed` com `error_reason`) (per decisão de e2e do plano/grilling)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| Pipeline completo | E2E: fluxo feliz + fluxo de falha com worker in-process e infra real | `test/video-processing.e2e-spec.ts` |

**Dependencies:** SI-03.5 — endpoints; SI-03.6 — processor

**Acceptance criteria:**

- Fluxo feliz: vídeo enviado por multipart presigned termina `ready` com thumbnail e metadados sem nenhum byte de vídeo passando pela API
- `GET /videos/{slug}/stream` seguido do fetch da URL presigned com `Range: bytes=0-1023` retorna `206 Partial Content`
- Fluxo de falha: arquivo inválido termina `failed` com `error_reason` não-nulo após esgotar retries

---

### SI-03.8 — Documentação de IA e OpenAPI

**Description:** Alinha a documentação viva ao código real da fase — seção de vídeos nos CLAUDE.md e spec OpenAPI regenerada.

**Technical actions:**

1. Regenerar `nestjs-project/openapi.json` via script de sync e conferir os 6 endpoints novos (per `openapi-docs-nestjs/TD-02`)
2. Atualizar `nestjs-project/CLAUDE.md` — serviços novos do Compose (minio/redis/video-worker), comandos (`start:worker`), módulo de vídeos, fila e storage
3. Atualizar `CLAUDE.md` raiz — estado da Fase 03 e componentes novos da arquitetura

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `openapi.json` | Integration: teste de export existente continua verde com os endpoints novos | `src/openapi-export.integration-spec.ts` (existente) |

**Dependencies:** SI-03.7 — fase funcional completa

**Acceptance criteria:**

- `openapi.json` contém os paths `/videos`, `/videos/{slug}/upload/part-urls`, `/videos/{slug}/upload/complete`, `/videos/{slug}`, `/videos/{slug}/stream`, `/videos/{slug}/download`
- `CLAUDE.md` (raiz e nestjs-project) descrevem apenas serviços, comandos e endpoints que existem no código

---

## Technical Specifications

### Data Model

#### Video

| Field | Type | Constraints |
|-------|------|-------------|
| id | uuid | PK, generated (uuid_generate_v4) |
| channel_id | uuid | FK → channels.id, not null |
| title | varchar(255) | not null |
| slug | varchar(21) | unique, not null — nanoid 11-char public identifier (per phase-03-videos/TD-05; column sized with headroom) |
| status | enum `videos_status_enum` (`draft`, `processing`, `ready`, `failed`) | not null, default `draft` (per phase-03-videos/TD-07) |
| original_key | varchar(512) | not null — storage key `videos/{id}/original{ext}` (per phase-03-videos/TD-08) |
| thumbnail_key | varchar(512) | nullable — `thumbnails/{id}.jpg`, filled by worker |
| upload_id | varchar(512) | nullable — S3 multipart UploadId; set at initiate, cleared on complete |
| mime_type | varchar(255) | not null — declared content type (`video/*`) |
| file_size | bigint | not null — declared size in bytes, ≤ 10737418240 (10GB) |
| duration_seconds | int | nullable — filled by worker (ffprobe) |
| metadata | jsonb | nullable — ffprobe summary (codec, width, height, bitrate), filled by worker |
| error_reason | varchar(1024) | nullable — terminal failure reason (per phase-03-videos/TD-07) |
| created_at | timestamp | not null, default now() |
| updated_at | timestamp | not null, default now() |

**Relations:** `Channel` has many `Video` (one-to-many); `Video` belongs to one `Channel` (`channel_id`).
**Indexes:** unique on `slug`; index on `channel_id`; index on `status`.

**Status transitions (per phase-03-videos/TD-07):** `draft → processing` (upload completed, job enqueued); `processing → ready` (worker success); `processing → failed` (queue retries exhausted; `error_reason` persisted). No other transitions in this phase.

### API Contracts

#### POST /videos (SI-03.5)

Initiates an upload: pre-registers the video as `draft` (per phase-03-videos/TD-02) and opens the S3 multipart upload session.

**Request headers:**
- Content-Type: application/json
- Authorization: Bearer {access_token}

**Request body:**
- title: string, required — min 1, max 255 characters
- file_name: string, required — original file name (extension used to derive `original_key`)
- file_size: number, required — bytes; min 1, max 10737418240 (10GB)
- mime_type: string, required — must match `video/*`

**Response 201:**
- id: string (uuid)
- slug: string
- status: "draft"
- upload:
  - upload_id: string — S3 multipart UploadId
  - part_size: number — bytes per part (104857600 = 100MB; last part may be smaller, min 5MB per S3 rules)
  - part_count: number — ceil(file_size / part_size)

**Error responses:**
- 400 validation error: when the request body fails schema validation (size > 10GB, non-video mime_type, missing fields)
- 401 UNAUTHORIZED: missing/invalid token

---

#### POST /videos/{slug}/upload/part-urls (SI-03.5)

Returns presigned PUT URLs for a batch of parts, signed against the public storage endpoint (per phase-03-videos/TD-08).

**Request headers:**
- Content-Type: application/json
- Authorization: Bearer {access_token}

**Request body:**
- part_numbers: number[], required — each 1..part_count, max 100 entries per call

**Response 200:**
- urls: array of
  - part_number: number
  - url: string — presigned PUT URL (client sends the raw part bytes; response ETag header must be retained for complete)
  - expires_in: number — seconds

**Error responses:**
- 401 UNAUTHORIZED: missing/invalid token
- 403 NOT_VIDEO_OWNER: authenticated user does not own the video's channel
- 404 VIDEO_NOT_FOUND: slug unknown
- 409 INVALID_UPLOAD_STATE: video status is not `draft` or upload session absent
- 400 validation error: part_numbers out of range/empty

---

#### POST /videos/{slug}/upload/complete (SI-03.5)

Completes the multipart upload, flips status to `processing` and enqueues the processing job (per phase-03-videos/TD-02, TD-07).

**Request headers:**
- Content-Type: application/json
- Authorization: Bearer {access_token}

**Request body:**
- parts: array, required — one entry per uploaded part
  - part_number: number, required
  - etag: string, required — ETag returned by the storage on the part PUT

**Response 202:**
- id: string (uuid)
- slug: string
- status: "processing"

**Error responses:**
- 401 UNAUTHORIZED: missing/invalid token
- 403 NOT_VIDEO_OWNER: authenticated user does not own the video's channel
- 404 VIDEO_NOT_FOUND: slug unknown
- 409 INVALID_UPLOAD_STATE: video status is not `draft` or upload session absent
- 400 UPLOAD_INCOMPLETE: storage rejected the part list (missing parts / ETag mismatch)

---

#### GET /videos/{slug} (SI-03.5)

Video details/status. Anonymous callers see only `ready` videos; the owner sees any status (per phase-03-videos/TD-09).

**Request headers:**
- Authorization: Bearer {access_token} — optional

**Response 200:**
- id: string (uuid)
- slug: string
- title: string
- status: string — full lifecycle visible to owner; always "ready" for anonymous
- duration_seconds: number | null
- metadata: object | null
- thumbnail_url: string | null — presigned GET for the thumbnail (short-lived)
- error_reason: string | null — owner only
- created_at: string (ISO-8601)

**Error responses:**
- 404 VIDEO_NOT_FOUND: slug unknown, or video not `ready` and caller is not the owner

---

#### GET /videos/{slug}/stream (SI-03.5)

Streaming entry point: 302 redirect to a presigned GET on the storage; Range/206 is served by the storage engine (per phase-03-videos/TD-06, TD-09).

**Response 302:**
- Location: presigned GET URL (public endpoint, short-lived)

**Error responses:**
- 404 VIDEO_NOT_FOUND: slug unknown or video not `ready`

---

#### GET /videos/{slug}/download (SI-03.5)

Same as stream, with `ResponseContentDisposition: attachment; filename="{file_name}"` on the presigned URL (per phase-03-videos/TD-06).

**Response 302:**
- Location: presigned GET URL with content-disposition attachment

**Error responses:**
- 404 VIDEO_NOT_FOUND: slug unknown or video not `ready`

---

#### Validation Rules — video upload

- `title`: required, string, min 1, max 255
- `file_name`: required, string, must contain an extension
- `file_size`: required, integer, 1 .. 10737418240
- `mime_type`: required, string matching `^video\/`
- `part_numbers`: required, non-empty int array, each within 1..part_count
- `parts[].etag`: required, non-empty string

### Authorization Matrix

Per phase-03-videos/TD-09: management endpoints are authenticated + channel-owner-only; stream/download are `@Public()` for `ready` videos. The global JWT guard (phase-02-auth) protects everything by default; public rows use the `@Public()` opt-out decorator.

| Endpoint | Anonymous | Authenticated (non-owner) | Owner |
|----------|-----------|---------------------------|-------|
| POST /videos | ✗ | ✓ (creates on own channel) | ✓ |
| POST /videos/{slug}/upload/part-urls | ✗ | ✗ | ✓ |
| POST /videos/{slug}/upload/complete | ✗ | ✗ | ✓ |
| GET /videos/{slug} | ✓ (ready only) | ✓ (ready only) | ✓ (any status) |
| GET /videos/{slug}/stream | ✓ (ready only) | ✓ (ready only) | ✓ (ready only) |
| GET /videos/{slug}/download | ✓ (ready only) | ✓ (ready only) | ✓ (ready only) |

### Error Catalog

Error response shape inherited from phase-02-auth/TD-07 (domain exception filter, `{ statusCode, error, message }` with machine-readable codes).

| errorCode | HTTP | Trigger |
|-----------|------|---------|
| VIDEO_NOT_FOUND | 404 | Slug desconhecido, ou vídeo não-`ready` acessado por quem não é o dono (stream/download/details) |
| NOT_VIDEO_OWNER | 403 | Usuário autenticado tenta operar upload de vídeo de canal alheio |
| INVALID_UPLOAD_STATE | 409 | part-urls/complete chamado com vídeo fora de `draft` ou sem sessão multipart aberta |
| UPLOAD_INCOMPLETE | 400 | Storage rejeita o CompleteMultipartUpload (partes faltando / ETag divergente) |
| SLUG_GENERATION_FAILED | 500 | Retries de geração de slug esgotados em colisão de unique index (probabilidade desprezível; per phase-03-videos/TD-05) |

### Events/Messages

#### video.process (queue `video-processing`, job name `process-video`)

**Payload:**

```json
{ "videoId": "uuid" }
```

**Producer:** `VideosService` — API process, on upload complete (per phase-03-videos/TD-01, TD-02)
**Consumer:** `VideoProcessingProcessor` — standalone worker process/container `video-worker` only (per phase-03-videos/TD-01, TD-03)
**Trigger:** `POST /videos/{slug}/upload/complete` succeeds (status flipped to `processing`)
**Delivery semantics:** at-least-once via BullMQ — handler idempotent (overwrite-by-key thumbnail, idempotent status update); `attempts: 3`, backoff exponencial `delay: 5000ms`; após esgotar, `@OnWorkerEvent('failed')` grava `status = failed` + `error_reason` (per phase-03-videos/TD-01, TD-07)
**Processing steps (worker):** download do objeto original (stream para disco temporário) → `ffprobe -print_format json` (duração + metadados) → `ffmpeg -ss 1 -frames:v 1` (thumbnail JPEG) → upload `thumbnails/{videoId}.jpg` → update `duration_seconds`, `metadata`, `thumbnail_key`, `status = ready` (per phase-03-videos/TD-04)

---

## Dependency Map

```
SI-03.1 (root — infra: minio/redis/ffmpeg/env/deps)
├── SI-03.2 — depends on SI-03.1 (nanoid instalado antes do slug util)
│   └── SI-03.4 — depends on SI-03.2 + SI-03.3 (entity e storage antes do service)
│       └── SI-03.5 — depends on SI-03.4 (service antes do controller)
│           └── SI-03.7 — depends on SI-03.5 + SI-03.6 (endpoints e processor antes do e2e do pipeline)
│               └── SI-03.8 — depends on SI-03.7 (documentação fecha a fase funcional)
├── SI-03.3 — depends on SI-03.1 (MinIO e SDK antes do StorageService)
└── SI-03.6 — depends on SI-03.3 + SI-03.4 (storage e fila antes do processor/worker)
```

---

## Deliverables

- [ ] SI-03.1 — Infra: storage, fila e configuração de ambiente
- [ ] SI-03.2 — Entidade Video, migration e módulo
- [ ] SI-03.3 — StorageService (S3/MinIO dual-endpoint)
- [ ] SI-03.4 — VideosService: ciclo de upload e producer da fila
- [ ] SI-03.5 — VideosController: endpoints REST
- [ ] SI-03.6 — Video Worker: processor, ffmpeg e container
- [ ] SI-03.7 — E2E do pipeline completo (upload → processamento → streaming)
- [ ] SI-03.8 — Documentação de IA e OpenAPI

**Full test suites:**

- [ ] Backend tests pass (`docker compose exec nestjs-api npm test -- --runInBand`)
- [ ] E2E tests pass (`docker compose exec nestjs-api npm run test:e2e`)
- [ ] Type/compilation checks pass (`docker compose exec nestjs-api npx tsc --noEmit` — exit 0)
- [ ] Lint passes (`docker compose exec nestjs-api npm run lint` — 0 errors)
