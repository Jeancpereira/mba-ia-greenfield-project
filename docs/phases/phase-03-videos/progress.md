# phase-03-videos — Progress

**Status:** completed
**SIs:** 8/8 completed

**Final verification (Definition of Done):**
- Unit + integration: 33 suites / 197 tests passing (`npm test -- --runInBand`)
- E2E: 5 suites / 66 tests passing, estável em 2 execuções consecutivas (`npm run test:e2e`)
- `npx tsc --noEmit`: exit 0
- `npm run lint`: 0 errors (194 warnings — unsafe-* em specs, permitidos pela config)

**Out-of-scope observations (follow-ups):**
- O script `test:e2e` não tinha `--runInBand` apesar do CLAUDE.md afirmar "already configured" — com 5 suítes e2e a execução paralela causava FK violations intermitentes (contaminação do banco compartilhado via `cleanAllTables`). Corrigido adicionando `--runInBand` ao script (alinhando código à convenção documentada).
- Multipart uploads abandonados não têm limpeza automática (lifecycle) — limitação conhecida documentada em TD-02.
- `next-frontend/openapi.json` sincronizado; codegen de types do frontend fica para a fase que retomar o frontend.

### SI-03.1 — Infra: storage, fila e configuração de ambiente
- **Status:** completed
- **Tests:** 12 passing (env.validation.integration-spec)
- **Observations:**
  - Serviço `video-worker` do Compose será adicionado no SI-03.6 (script `start:worker` ainda não existe; evitaria crash-loop).
  - Senha do MinIO `streamtube1234` (mínimo de 8 chars exigido pelo MinIO; `streamtube` tem 10 mas manteve-se par usuário/senha distinto por clareza).
  - Portas locais 5432/6379 ocupadas por outros projetos na máquina do dev — remapeadas em `compose.override.yaml` untracked (5434/6380); dentro da rede Compose nada muda.

### SI-03.2 — Entidade Video, migration e módulo
- **Status:** completed
- **Tests:** 11 passing (slug.util, videos.module, video.entity integration, migrations integration estendido)
- **Observations:**
  - Migration gerada via CLI (`1783425360381-CreateVideos.ts`); `migrations.integration-spec` estendido para 3 migrations/5 tabelas e drop do `videos_status_enum` no beforeAll.
  - `cleanAllTables` do helper de teste passou a limpar `videos` primeiro (FK com channels).

### SI-03.3 — StorageService (S3/MinIO dual-endpoint)
- **Status:** completed
- **Tests:** 5 passing (module compilation + integration com MinIO real: multipart roundtrip, 206 Range, attachment, abort)
- **Observations:**
  - Criado helper `src/test/presigned-http.ts`: URLs presigned são assinadas contra o endpoint público (`localhost:9000`), inalcançável de dentro do container onde o Jest roda — o helper conecta em `minio:9000` preservando o header `Host` original (assinatura cobre o Host). Semântica de produção preservada; testes herméticos.

### SI-03.4 — VideosService: ciclo de upload e producer da fila
- **Status:** completed
- **Tests:** 21 passing (unit com mocks + integration com DB/MinIO/Redis reais + module compilation)
- **Observations:**
  - `id` do vídeo gerado via `crypto.randomUUID()` no service (a chave de storage `videos/{id}/original{ext}` precisa do id antes do INSERT).
  - Falha no save após abrir a sessão multipart dispara `abortMultipartUpload` (não deixa sessão órfã no MinIO).
  - `BullModule.forRootAsync` registrado no `AppModule` (infra global, convenção fase 01); `registerQueue` no `VideosModule`.

### SI-03.5 — VideosController: endpoints REST
- **Status:** completed
- **Tests:** 19 passing (guard unit 7 + videos e2e 12 com MinIO/Redis reais)
- **Observations:**
  - `JwtAuthGuard` estendido: em rotas `@Public()`, Bearer válido presente anexa `request.user` best-effort (sem rejeitar tokens inválidos) — necessário pro dono ver o próprio vídeo não-`ready` via `GET /videos/:slug` (TD-09) e alinhado com o acesso anônimo da Fase 05. Casos novos cobertos no guard spec.
  - e2e autentica gerando JWT direto via `JwtService` (usuário/canal semeados por repositório) em vez do fluxo register→confirm→login — mais rápido e o fluxo completo de auth já é coberto por `auth.e2e-spec`.

### SI-03.6 — Video Worker: processor, ffmpeg e container
- **Status:** completed
- **Tests:** 9 passing (ffmpeg integration com fixture real, processor integration com DB/MinIO reais, worker module compilation)
- **Observations:**
  - `WorkerModule` precisa registrar `User` no `forFeature` além de `Video`/`Channel` — `autoLoadEntities` só descobre entidades registradas, e `Channel` referencia `User` (erro "Entity metadata for Channel#user was not found" no boot do container).
  - Fixture `test/fixtures/sample.mp4` (11KB, 2s, testsrc) gerada com o ffmpeg do próprio container e commitada.
  - Container `video-worker` sobe com a mesma imagem da API (`npm run start:worker`, watch mode) e loga "Video worker started — consuming queue".

### SI-03.7 — E2E do pipeline completo (upload → processamento → streaming)
- **Status:** completed
- **Tests:** 2 passing (fluxo feliz até ready + streaming 206 + download; fluxo de falha até failed com error_reason)
- **Observations:**
  - Worker instanciado in-process no teste (mesmos providers do WorkerModule) para determinismo; o container `video-worker` rodando em paralelo consome da mesma fila — efeitos idempotentes, sem interferência.

### SI-03.8 — Documentação de IA e OpenAPI
- **Status:** completed
- **Tests:** coberto pela final verification (openapi-export.integration-spec na suíte completa)
- **Observations:**
  - `openapi.json` regenerado com os 6 paths de vídeos e sincronizado para `next-frontend/openapi.json` via `scripts/sync-openapi.sh` (convenção next-frontend-openapi-typing/TD-02).
  - `CLAUDE.md` raiz (fila TBD → BullMQ/Redis, estado das fases) e `nestjs-project/CLAUDE.md` (serviços novos, `start:worker`, seção Videos Module) atualizados.
