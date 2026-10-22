-- Audit M16 triage report (READ-ONLY). Run against prod to decide what to do
-- with the stale queue before/after deploying the 21-day expiry bucket.
-- Prints ids/statuses/ages only — no subjects or bodies.

-- 1. APPROVED drafts that were never sent (prod 2026-10-22: 24).
SELECT d.id, d."createdAt", d."updatedAt", d."externalDraftId" IS NOT NULL AS has_gmail_draft,
       t."mailboxId", c.status AS candidate_status, c."repliedAt"
FROM "EmailDraft" d
JOIN "EmailThread" t ON t.id = d."threadId"
LEFT JOIN "Candidate" c ON c.id = t."candidateId"
WHERE d.status = 'APPROVED'
ORDER BY d."updatedAt";

-- 2. PENDING drafts by age bucket (21+ days move to "Expired" in the UI).
SELECT CASE
         WHEN d."createdAt" >= now() - interval '7 days'  THEN '0-7d'
         WHEN d."createdAt" >= now() - interval '21 days' THEN '8-21d'
         WHEN d."createdAt" >= now() - interval '60 days' THEN '22-60d'
         ELSE '60d+'
       END AS age_bucket,
       count(*)
FROM "EmailDraft" d
WHERE d.status = 'PENDING'
GROUP BY 1
ORDER BY 1;
