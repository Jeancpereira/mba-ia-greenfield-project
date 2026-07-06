---
kind: phase
name: phase-03-videos
sources_mtime:
  docs/project-plan.md: "2026-07-06T16:06:25-0300"
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-07-06T16:23:45-0300"
  docs/decisions/technical-decisions-openapi-docs-nestjs.md: "2026-07-06T16:06:48-0300"
  docs/decisions/technical-decisions-next-frontend-openapi-typing.md: "2026-07-06T16:06:48-0300"
  docs/decisions/technical-decisions-next-frontend-config-base.md: "2026-07-06T16:06:48-0300"
  docs/decisions/technical-decisions-next-frontend-msw-foundation.md: "2026-07-06T16:06:48-0300"
  docs/phases/phase-01-configuracao-base/context.md: "2026-07-06T16:06:48-0300"
  docs/phases/phase-02-auth/context.md: "2026-07-06T16:06:48-0300"
  docs/phases/phase-02-auth-frontend/context.md: "2026-07-06T16:06:48-0300"
  .claude/skills/testing-guide-nestjs-project/SKILL.md: "2026-07-06T16:06:25-0300"
---

# phase-03-videos — Context

## Scope

**Phase name:** Upload e Processamento de Vídeos

**Capabilities** (literal, `docs/project-plan.md`):

- Serviço de armazenamento de arquivos (vídeos e thumbnails)
- Serviço de processamento em segundo plano (filas)
- Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance
- Pré-cadastro automático do vídeo como rascunho ao iniciar o upload
- Processamento automático do vídeo após upload (extração de duração e metadados)
- Geração automática de thumbnail a partir de um frame do vídeo
- URL única por vídeo, sem conflito com outros vídeos
- Reprodução via streaming (sem necessidade de download completo)
- Download do vídeo pelo usuário

**Out of scope:** _Not specified in project-plan.md._ Per challenge definition: frontend video UI (upload screen, player) is out of this phase — backend, worker, infrastructure and process artifacts only.

**Deliverables:** upload de até 10GB funcional, processamento automático do vídeo, streaming funcionando, URLs únicas geradas.

**Affected subprojects:** `nestjs-project/` (backend + worker + Compose infra). `next-frontend/` deferred.

**Deferred subprojects:** `next-frontend/` — video UI belongs to a future phase.

**Sequencing notes:** > Depende de: Fase 01, Fase 02

**Neighbors (for boundary detection only):**

- **Phase 02:** Fase 02 — Cadastro, Login e Gerenciamento de Conta (Depende de: Fase 01)
- **Phase 04:** Fase 04 — Gerenciamento de Vídeos e Canal (Depende de: Fase 02, Fase 03)

## Decisions Index

| Ref | Source | Scope | Topic | Status | Decision | Libraries |
|-----|--------|-------|-------|--------|----------|-----------|
| phase-03-videos/TD-01 | phase | Backend | Queue Technology for Background Processing | decided | A (BullMQ + Redis) | — |
| phase-03-videos/TD-02 | phase | Cross-layer | 10GB Upload Strategy | decided | A (S3 Multipart Upload, presigned part URLs) | — |
| phase-03-videos/TD-03 | phase | Backend | Video Worker Topology | decided | A (second entrypoint, Compose `video-worker`) | — |
| phase-03-videos/TD-04 | phase | Backend | Metadata & Thumbnail Extraction Tooling | decided | A (ffmpeg/ffprobe in image via child_process) | — |
| phase-03-videos/TD-05 | phase | Backend | Unique Public URL Strategy | decided | A (nanoid 11-char slug, unique index) | — |
| phase-03-videos/TD-06 | phase | Cross-layer | Streaming & Download Delivery | decided | A (302 redirect to presigned GET) | — |
| phase-03-videos/TD-07 | phase | Backend | Video Status Lifecycle & Failure Policy | decided | A (draft → processing → ready \| failed) | — |
| phase-03-videos/TD-08 | phase | Backend | Object Storage Usage — Key Layout & Presign Endpoints | decided | A (bucket `streamtube`; dual client) | — |
| phase-03-videos/TD-09 | phase | Backend | Access Policy for Streaming & Download in This Phase | decided | A (@Public() stream/download for `ready`) | — |

_Source files:_

- phase-03-videos — `docs/decisions/technical-decisions-phase-03-videos.md` (scope_type: phase, related_phases: [3])

## Capability Coverage

| Capability (from project-plan.md) | Covered by |
|-----------------------------------|------------|
| Serviço de armazenamento de arquivos (vídeos e thumbnails) | phase-03-videos/TD-08 |
| Serviço de processamento em segundo plano (filas) | phase-03-videos/TD-01 |
| Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance | phase-03-videos/TD-02 |
| Pré-cadastro automático do vídeo como rascunho ao iniciar o upload | phase-03-videos/TD-02, phase-03-videos/TD-07 |
| Processamento automático do vídeo após upload (extração de duração e metadados) | phase-03-videos/TD-03, phase-03-videos/TD-04, phase-03-videos/TD-07 |
| Geração automática de thumbnail a partir de um frame do vídeo | phase-03-videos/TD-03, phase-03-videos/TD-04, phase-03-videos/TD-07 |
| URL única por vídeo, sem conflito com outros vídeos | phase-03-videos/TD-05 |
| Reprodução via streaming (sem necessidade de download completo) | phase-03-videos/TD-06, phase-03-videos/TD-09 |
| Download do vídeo pelo usuário | phase-03-videos/TD-06, phase-03-videos/TD-09 |

## Decisions Detail

### phase-03-videos/TD-01

**Recommendation:** the official `@nestjs/bullmq` integration gives job semantics (retries, backoff, failed-job inspection) out of the box with idiomatic NestJS modules/processors; Redis is a single lightweight Compose service, and the worker consumes the same queue from a standalone process, matching the target architecture (API publishes → queue → worker).
**Libraries:** —

### phase-03-videos/TD-02

**Recommendation:** it is the native S3 mechanism for large objects: satisfies 10GB (Option B cannot), gives per-part retry, keeps the API on the control plane only, and adds no new service (unlike Option C).
**Libraries:** —

### phase-03-videos/TD-03

**Recommendation:** the worker is the same domain and same stack; a standalone Nest bootstrap in the existing project delivers the separate-container architecture with zero duplication and no foundation rework.
**Libraries:** —

### phase-03-videos/TD-04

**Recommendation:** two fixed invocations (probe JSON + single-frame capture) don't justify a wrapper dependency, and the maintained-binary + `child_process` path is the most robust for large files streamed from storage.
**Libraries:** —

### phase-03-videos/TD-05

**Recommendation:** short non-enumerable URLs with a database-enforced uniqueness guarantee; the retry branch is trivial.
**Libraries:** —

### phase-03-videos/TD-06

**Recommendation:** delegates Range semantics to storage, keeps the API light, and matches the target architecture; authorization happens at the API before the redirect.
**Libraries:** —

### phase-03-videos/TD-07

**Recommendation:** the smallest state machine that matches the plan's own wording; upload progress is an upload-session concern, not a video state.
**Libraries:** —

### phase-03-videos/TD-08

**Recommendation:** the dual-endpoint split is what makes presigned URLs actually work from outside the Compose network, and a single prefixed bucket is simpler to provision and migrate.
**Libraries:** —

### phase-03-videos/TD-09

**Recommendation:** public-if-ready is the semantic the platform converges to; it keeps the acceptance criteria verifiable and removes no future work.
**Libraries:** —

## Inherited Decisions Detail

### phase-01-configuracao-base/TD-01

**Recommendation:** Official, core-team-maintained, guaranteed NestJS 11 compatibility. The `registerAs()` factory pattern solves the TypeORM CLI sharing problem: the factory function can be imported as a plain function by `data-source.ts` while also serving as a DI injection token inside NestJS. Building a custom module recreates solved functionality; third-party packages carry maintenance risk.
**Libraries:** `@nestjs/config@^4.x`

### phase-01-configuracao-base/TD-02

**Recommendation:** First-class integration with `@nestjs/config` via `validationSchema`, requiring zero custom wiring. Handles string-to-number coercion natively. Using a different tool for env validation vs. request validation is reasonable — env config is validated once at startup, DTOs are validated per-request.
**Libraries:** `joi@^17.x`

### phase-01-configuracao-base/TD-03

**Recommendation:** The project roadmap explicitly calls for auth, email, and storage in upcoming phases. Namespaced configs provide clear file boundaries per domain, typed injection via `ConfigType<typeof databaseConfig>`, and natural scalability. The `registerAs()` factory is dual-purpose: DI token inside NestJS and plain importable function for `data-source.ts`.
**Libraries:** —

### phase-01-configuracao-base/TD-04

**Recommendation:** Natural outcome of choosing `@nestjs/config` with `registerAs`. The factory is already callable by design. `data-source.ts` imports it, calls `dotenv.config()`, then calls the factory. Zero duplication, minimal code, no extra abstraction.
**Libraries:** `dotenv` (transitive via `@nestjs/config`)

### phase-02-auth/TD-01

**Recommendation:** Argon2id — For a greenfield project in 2026, Argon2id is the OWASP-recommended choice. OWASP minimum: 19MiB memory, 2 iterations.
**Libraries:** `argon2@^0.41.x`

### phase-02-auth/TD-02

**Recommendation:** The project plan includes only email/password auth for now, but the plugin architecture costs little and future phases may add social login.
**Note:** Decision deliberately diverged from the Recommendation during implementation — custom guards were preferred over `@nestjs/passport` to keep the dependency surface smaller.
**Libraries:** `@nestjs/jwt@^11.0.0`

### phase-02-auth/TD-03

**Recommendation:** Refresh Token Rotation provides the strongest security model with automatic theft detection. PostgreSQL is already in the stack, so no new infrastructure needed.
**Libraries:** —

### phase-02-auth/TD-04

**Recommendation:** Random opaque tokens in DB — revocability is important; the tokens table can also serve future needs. Keeps email tokens decoupled from the JWT auth system.
**Libraries:** —

### phase-02-auth/TD-05

**Recommendation:** Best NestJS integration with minimal boilerplate. Supports SMTP (matching the architecture diagram), works with Mailpit for local development. Template engine support (Handlebars) simplifies email formatting.
**Libraries:** `@nestjs-modules/mailer@^2.x`, `handlebars@^4.x`

### phase-02-auth/TD-06

**Recommendation:** class-validator is the documented NestJS approach, and the project already uses decorators extensively (TypeORM entities, NestJS DI). Fewer integration surprises with NestJS 11.
**Libraries:** `class-validator@^0.14.x`, `class-transformer@^0.5.x`

### phase-02-auth/TD-07

**Recommendation:** Custom Domain Exception Filter provides machine-readable error codes without the overhead of RFC 9457's URI-based type system. A simple `{ statusCode, error, message }` format with domain codes balances clarity and simplicity.
**Libraries:** —

### phase-02-auth/TD-08

**Recommendation:** Native NestJS integration is decisive: the guard system allows scoping rate limiting via `APP_GUARD`, with `@SkipThrottle()` for exemptions. Single-instance, in-memory storage is sufficient.
**Libraries:** `@nestjs/throttler@^6.x`

### phase-02-auth/TD-09

**Recommendation:** Opaque tokens — since DB lookup is mandatory (TD-03), JWT signature adds no security value.
**Note:** Decision deliberately diverged — JWT was kept to reuse the access-token signing/verification infrastructure (`@nestjs/jwt`), single token format across the codebase.
**Libraries:** `@nestjs/jwt@^11.0.0`

### phase-02-auth/TD-10

**Recommendation:** A strict `[a-z0-9_]` allowlist is the simplest and most portable choice for URL-based channel handles; the `user_<random>` fallback provides a valid handle even for extreme email prefixes.
**Libraries:** —

### openapi-docs-nestjs/TD-01

**Recommendation:** é a única opção que preserva as decisões anteriores (`class-validator` em TD-06 de phase-02-auth) sem re-platform; o CLI plugin com `classValidatorShim: true` aproveita os decoradores `class-validator` existentes para inferir schemas, mantendo o boilerplate baixo.
**Libraries:** @nestjs/swagger

### openapi-docs-nestjs/TD-02

**Recommendation:** o custo marginal sobre Option A é apenas um npm script (~15 linhas) e o benefício é uma fundação correta para futura integração FE (codegen offline) sem perder a UI interativa que dev/QA usam. Decision: C (Runtime UI + openapi.json exportado).
**Libraries:** —

### openapi-docs-nestjs/TD-03

**Recommendation:** apenas em dev/staging via env flag — alinha com a postura defensiva já estabelecida em phase 02; o `openapi.json` commitado em TD-02 cumpre o papel de "spec consultável fora da UI".
**Libraries:** —

### next-frontend-openapi-typing/TD-01

**Recommendation:** Strict BFF makes a generated SDK surface valueless on the client; types-first (`openapi-typescript` `paths`) matches the FE foundation; MSW typing is solved by the same `paths` symbol. Decision: A (`openapi-typescript` + `openapi-fetch`).
**Libraries:** openapi-typescript, openapi-fetch

### next-frontend-openapi-typing/TD-02

**Recommendation:** committed local copy + repo-root sync script — preserves compose-stack independence; drift eliminated structurally when paired with TD-03's CI freshness check; committed local file is a real artifact in PR review.
**Libraries:** —

### next-frontend-openapi-typing/TD-03

**Recommendation:** committed + CI freshness check — the only option that makes contract drift both visible (in PR diffs) and impossible to merge accidentally (CI fail).
**Libraries:** —

### next-frontend-openapi-typing/TD-04

**Recommendation:** single `lib/api/contracts.ts` with explicit aliases — handles pass-through and reshape with the same mechanism; single grep target for "what shape does the BFF expose".
**Libraries:** —

### next-frontend-openapi-typing/TD-05

**Recommendation:** hand-written MSW handlers, typed via `paths` — determinism over auto-generation; coherence with TD-01 (`paths` as single contract anchor).
**Libraries:** —

### next-frontend-config-base/TD-01

**Recommendation:** Zod 4 — type-inference matches the FE's strict-TS culture; ecosystem gravity in Next.js / React 19; direct enablement of `@t3-oss/env-nextjs`.
**Libraries:** zod

### next-frontend-config-base/TD-02

**Recommendation:** `@t3-oss/env-nextjs` — combines type-level NEXT_PUBLIC_ prefix enforcement, runtime Proxy-based leak detection, and single-file consumer ergonomics.
**Libraries:** @t3-oss/env-nextjs

### next-frontend-config-base/TD-03

**Recommendation:** Strict BFF — single server-only `API_URL`; Route Handlers as the only NestJS caller. Eliminates CORS, eliminates public exposure of the backend URL.
**Libraries:** —

### next-frontend-msw-foundation/TD-01

**Recommendation:** per-domain modules + barrel (`mocks/handlers/<domain>.ts`) — MSW's own best-practice; domain ownership tracks the codebase; append-only growth.
**Libraries:** —

### next-frontend-msw-foundation/TD-02

**Recommendation:** test-only `setupServer` at the foundation; browser worker deferred until a real FE-offline-dev consumer exists.
**Libraries:** —

### next-frontend-msw-foundation/TD-03

**Recommendation:** hand-written deterministic defaults as the default + opt-in seeded faker scoped to bulk-collection builders only; `@faker-js/faker` installed only when the first bulk builder is authored.
**Libraries:** —

### next-frontend-msw-foundation/TD-04

**Recommendation:** universal handler set + `server.use(...)` overrides + `onUnhandledRequest: "error"` — canonical MSW v2 model; strongest version of "test stays inside its phase".
**Libraries:** —

## Inherited Conventions

- Backend config uses `@nestjs/config` with namespaced `registerAs(name, () => ({...}))` factories — one file per domain in `src/config/`. _(from phase 01)_
- Env variables are validated by a Joi schema in `src/config/env.validation.ts`, passed to `ConfigModule.forRoot({ validationSchema, validationOptions })`. _(from phase 01)_
- Config is injected into modules via `ConfigType<typeof xxxConfig>` and `@Inject(xxxConfig.KEY)`; the same factory is importable as a plain function. _(from phase 01)_
- `data-source.ts` loads `.env` via `import 'dotenv/config'` at the top, then imports `databaseConfig` and calls it as a plain function. _(from phase 01)_
- Database connection parameters (host, port, etc.) are sourced from a single `databaseConfig` factory — never duplicated between `AppModule` and the CLI data source. _(from phase 01)_
- `TypeOrmModule.forRootAsync` is used (not `forRoot`), with `imports: [ConfigModule]`, `inject: [databaseConfig.KEY]`, `useFactory` returning options. _(from phase 01)_

## Inherited Deferred Capabilities

| Capability | Status | Origin phase | Rationale |
|-----------|--------|--------------|-----------|
| Telas de frontend | deferred | phase-01-configuracao-base | `next-frontend/` is not initialized in this phase; UI surfaces start in a later phase. |
| Telas de cadastro, login, confirmação de conta e recuperação de senha | deferred | phase-02-auth | `next-frontend/` is not initialized in this phase; UI surfaces start in a later phase. |
| "Confirmação de conta via e-mail com link de ativação" | deferred | phase-02-auth-frontend | UI landing screen de-scoped 2026-05-14; FE confirmation flow picked up by a future phase. BE side unchanged in `phase-02-auth`. |
| "Logout" | deferred | phase-02-auth-frontend | logout button lives inside authenticated chrome (typically Phase 04). POST `/api/auth/logout` contract ready. |
| "Recuperação de senha (destination screen / set-new-password)" | deferred | phase-02-auth-frontend | reset-password destination screen absent from Figma; known gap until a later phase. |
| "Telas de cadastro, login, confirmação de conta e recuperação de senha" | deferred | phase-02-auth-frontend | umbrella bullet deferred to the phase that lands the missing screens (confirmação + reset destination). |

## Non-UI / Deferred Capabilities

_None._

## Testing Requirements

### nestjs-project

| Artifact type | Required layers |
|---------------|-----------------|
| Entity (`*.entity.ts`) | Integration: constraints, defaults, `select: false` |
| Service with branching + DB | Unit: branch logic (mock repo) + Integration: DB contract |
| Service with DB only (no branching) | Integration: DB contract |
| Service with configured lib (JWT, cache) | Unit: real lib with test config |
| Service with side-effect dep (email, storage) | Integration: real capture service (Mailpit/MinIO) or local adapter |
| Module with configured imports | Unit: compilation test |
| Controller | E2E only — do NOT write unit tests |
| DTO | E2E: one validation wiring test per endpoint |
| Guard (delegates to service for business logic) | E2E + Unit if complex internal logic |
| Guard (simple) | E2E only |
| Pipe (custom transformation/validation) | Unit |
| Interceptor (response transform, logging) | Unit and/or E2E |
| Exception Filter | Unit + E2E |
| Middleware | E2E |

### next-frontend

_Deferred subproject — frontend is out of scope for this phase._
