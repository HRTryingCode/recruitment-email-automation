-- Audit B4: read-only post-deploy checks. Compare against the baseline
-- measured 2026-10-22 before this change:
--   MAILBOX_SYNCED_INCREMENTAL last 24h: 0 (7d: 9) vs WEBHOOK_HANDLER_ERROR 7d: 86
--   ingest latency p50 (14d): 233 min; <5 min: 3.9%
--   rows created at minute :00-:02 (reconcile slot): 79.6%
--   MESSAGE_PROCESSING_FAILED 'not found' 7d: 371; P2002 30d: 92

-- 1. Webhook path alive (target: synced + stale-skipped >= 80% of
--    "[Webhook] received" lines in Vercel logs over 24h).
SELECT event, count(*)
FROM "SystemLog"
WHERE "createdAt" > now() - interval '24 hours'
  AND event IN ('MAILBOX_SYNCED_INCREMENTAL', 'WEBHOOK_STALE_SKIPPED', 'WEBHOOK_HANDLER_ERROR')
GROUP BY 1;

-- 2. Ingest latency since deploy (target p50 < 5 min) and share created in
--    the reconcile slot (should collapse from ~80%).
SELECT
  count(*) AS n,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM ("createdAt" - "receivedAt")) / 60) AS p50_min,
  round(100.0 * avg((extract(epoch FROM ("createdAt" - "receivedAt")) < 300)::int), 1) AS pct_under_5min,
  round(100.0 * avg((extract(minute FROM "createdAt") <= 2)::int), 1) AS pct_reconcile_slot
FROM "EmailMessage"
WHERE "createdAt" > now() - interval '24 hours'
  AND "receivedAt" > now() - interval '24 hours';

-- 3. Gap distribution: max time since each active mailbox's last reconcile
--    attempt (target: none > 2h).
SELECT "emailAddress", "authStatus", now() - "lastReconciledAt" AS since_last_reconcile
FROM "Mailbox"
WHERE "isActive" AND provider = 'GMAIL'
ORDER BY "lastReconciledAt" NULLS FIRST;

-- 4. 404 churn and P2002 noise gone.
SELECT
  count(*) FILTER (WHERE details LIKE '%not found%') AS not_found_failures,
  count(*) FILTER (WHERE details LIKE '%Unique constraint%') AS p2002_failures
FROM "SystemLog"
WHERE event = 'MESSAGE_PROCESSING_FAILED' AND "createdAt" > now() - interval '24 hours';

-- 5. Stuck pipeline rows (sweeper should keep STORED/FAILED near zero).
SELECT "processingState", count(*), max(attempts)
FROM "EmailMessage"
WHERE "createdAt" > now() - interval '7 days'
GROUP BY 1;

-- 6. Live-draft uniqueness (must be empty; the index enforces it).
SELECT "threadId", count(*)
FROM "EmailDraft"
WHERE status IN ('PENDING', 'APPROVED')
GROUP BY 1 HAVING count(*) > 1;

-- 7. Retention dry-run result (until SYSTEMLOG_RETENTION_ENABLED=true).
SELECT "createdAt", details FROM "SystemLog"
WHERE event = 'SYSTEMLOG_RETENTION_RUN' ORDER BY "createdAt" DESC LIMIT 3;
