-- =====================================================================
-- Audit B3 (M11/M12 part): remove Candidate rows created for internal
-- @archive.com senders before shouldSkipClassification excluded them.
-- NOT RUN. Requires explicit authorization. 5 rows as of 2026-10-22.
-- Step 1 is read-only; review its output before running step 2.
-- EmailThread.candidateId is ON DELETE SET NULL, so threads/messages/drafts
-- are kept (drafts on those threads are discarded explicitly in step 2).
-- =====================================================================

-- Step 1 (read-only preview)
SELECT c.id, c.email, c.status, c."createdAt",
       (SELECT count(*) FROM "EmailThread" t WHERE t."candidateId" = c.id) AS threads,
       (SELECT count(*) FROM "EmailDraft" d JOIN "EmailThread" t ON t.id = d."threadId"
         WHERE t."candidateId" = c.id AND d.status IN ('PENDING','APPROVED')) AS open_drafts
FROM "Candidate" c
WHERE lower(c.email) LIKE '%@archive.com';

-- Step 2 (destructive) — uncomment to run, in one transaction
-- BEGIN;
-- UPDATE "EmailDraft" d SET status = 'DISCARDED', "updatedAt" = now()
--   FROM "EmailThread" t, "Candidate" c
--  WHERE d."threadId" = t.id AND t."candidateId" = c.id
--    AND lower(c.email) LIKE '%@archive.com'
--    AND d.status IN ('PENDING','APPROVED');
-- DELETE FROM "Candidate" WHERE lower(email) LIKE '%@archive.com';
-- COMMIT;
