# StreamTube API (nestjs-project)

Backend do **StreamTube** — plataforma de compartilhamento de vídeos. API REST em **NestJS 11 + TypeScript** com PostgreSQL (TypeORM), autenticação JWT, e-mails transacionais, upload multipart direto ao object storage (S3/MinIO) e worker de processamento de vídeos (FFmpeg + BullMQ).

Visão geral do projeto, arquitetura e funcionalidades por fase: veja o [README raiz](../README.md) e `../docs/`.

## Serviços (Docker Compose)

Tudo roda em containers — comandos `npm`/`npx` sempre dentro do container `nestjs-api`.

| Serviço | Descrição | Porta |
|---------|-----------|-------|
| `nestjs-api` | API NestJS | 3000 |
| `db` | PostgreSQL 17 (`streamtube`/`streamtube`) | 5432 |
| `mailpit` | Captura de e-mails (SMTP + UI) | 1025 / 8025 |
| `minio` | Object storage S3-compatible (bucket `streamtube`) | 9000 / 9001 |
| `redis` | Backing store do BullMQ | 6379 |
| `video-worker` | Worker FFmpeg (entrypoint `src/worker/main.ts`) | — |

## Como rodar

```bash
# Sobe toda a stack
docker compose up -d

# Instala dependências (primeira vez)
docker compose exec nestjs-api npm install

# Cria o schema (obrigatório — synchronize desabilitado)
docker compose exec nestjs-api npm run migration:run

# Dev server com hot-reload
docker compose exec -d nestjs-api npm run start:dev
```

- API: http://localhost:3000
- Swagger (opcional): http://localhost:3000/api/docs com `SWAGGER_ENABLED=true`
- Variáveis de ambiente: copie `.env.example` para `.env` (`APP_URL` é a URL do **frontend**, usada nos links dos e-mails)

## Como testar

```bash
docker compose exec nestjs-api npm test -- --runInBand   # unit + integração
docker compose exec nestjs-api npm run test:e2e          # end-to-end (supertest)
docker compose exec nestjs-api npm run test:cov          # cobertura
docker compose exec nestjs-api npx tsc --noEmit          # type-check
docker compose exec nestjs-api npm run lint              # ESLint
```

Sufixos de teste: `*.spec.ts` (unitário, tudo mockado), `*.integration-spec.ts` (banco/serviços reais), `*.e2e-spec.ts` (HTTP completo, em `test/`). Suítes de integração/e2e compartilham o banco e devem rodar com `--runInBand`.

## Estrutura

```
src/
├── auth/        # Cadastro, login, JWT + refresh rotation, confirmação/reset por e-mail
├── users/       # Entidade e serviço de usuários
├── channels/    # Canal 1:1 por usuário
├── videos/      # Upload multipart, streaming, download + processing/ (worker FFmpeg)
├── storage/     # Cliente S3/MinIO (presigned URLs, multipart, lifecycle)
├── worker/      # Entrypoint do video-worker (consumidor da fila video-processing)
├── mail/        # E-mails transacionais (Handlebars)
├── common/      # Filtros, exceptions de domínio, OpenAPI helpers
├── config/      # Configs namespaced validadas com Joi
└── database/    # data-source e migrations
```
