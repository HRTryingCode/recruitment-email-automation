-- Audit B4 / M24: one-off backfill of EmailThread.lastMessageAt from the max
-- receivedAt of its messages. Out-of-order ingestion moved it backwards on
-- ~494 threads (206 candidate-linked) as of 2026-10-22.
--
-- DO NOT RUN without explicit human authorization (prod data write).
-- Run AFTER migration 9 is deployed, so no new regressions appear while it
-- runs. Idempotent; only moves values forward. Preview first:
--
--   SELECT count(*) FILTER (WHERE t."candidateId" IS NOT NULL) AS candidate_threads,
--          count(*) AS threads
--   FROM "EmailThread" t
--   JOIN (SELECT "threadId", max("receivedAt") AS m FROM "EmailMessage" GROUP BY 1) x
--     ON x."threadId" = t.id
--   WHERE x.m > t."lastMessageAt" + interval '1 minute';

BEGIN;
UPDATE "EmailThread" t
SET "lastMessageAt" = x.m
FROM (SELECT "threadId", max("receivedAt") AS m FROM "EmailMessage" GROUP BY 1) x
WHERE x."threadId" = t.id
  AND x.m > t."lastMessageAt";
COMMIT;
