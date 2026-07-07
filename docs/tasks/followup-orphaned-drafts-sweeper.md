# Follow-up: sweeper for orphaned draft videos

**Status:** not implemented — noted as a follow-up during the round-01 bugfix pass on the videos upload flow.

## Problem

A video is created as `draft` in Postgres as soon as `POST /videos` opens the
S3 multipart upload session. If the client abandons the upload (crash, tab
closed, network loss) before calling `POST /videos/{slug}/upload/complete`,
the `draft` row and its half-uploaded S3 parts are never cleaned up. Over
time this accumulates orphaned rows and storage usage that no user-facing
flow will ever reference again (the video never becomes visible — `findBySlug`
hides non-`ready` videos from everyone but the owner, and the owner has no UI
to retry/delete a stuck draft in this phase).

## Proposed follow-up

A scheduled job (e.g. a BullMQ repeatable job or a cron-triggered command)
that periodically:

1. Finds `videos` rows with `status = 'draft'` and `created_at` older than a
   threshold (e.g. 48h).
2. Calls `StorageService.abortMultipartUpload` for each (best-effort; the
   MinIO bucket-level lifecycle rule described below is a backstop for the
   raw multipart parts, not for the Postgres row).
3. Deletes the `videos` row (or marks it `failed` with an
   `error_reason` for auditing, if we want to keep a trail).

This is out of scope for the current bugfix round (SI-05) since it requires
a new scheduled-job mechanism and a decision on soft-delete vs hard-delete —
tracked here so it isn't lost.

## Related: MinIO incomplete-multipart-upload lifecycle rule

See `docs/decisions/` (or the round-01 bugfix notes) for why the
`AbortIncompleteMultipartUpload` S3 lifecycle action could not be configured
on the `streamtube` bucket with the MinIO version pinned in this project —
it is accepted by both `mc ilm rule import` and a direct
`PutBucketLifecycleConfiguration` call (no validation error), but the server
silently drops the field instead of persisting it. This sweeper is the
practical substitute for that missing lifecycle guarantee in this
environment.
