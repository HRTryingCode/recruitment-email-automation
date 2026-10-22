-- B7 / M12 — NOT RUN. Lowercase Candidate.email and enforce uniqueness on
-- lower(email). Requires write authorization for prod.

-- ---- Preview (read-only) ---------------------------------------------------
-- Rows that are not already lowercase/trimmed.
SELECT count(*) AS mixed_case_rows
FROM "Candidate" WHERE email <> lower(trim(email));

-- Case-only collision groups (expected: 1 group on 2026-10-22).
SELECT lower(trim(email)) AS email_lc, count(*) AS n,
       array_agg(id ORDER BY "createdAt") AS ids,
       array_agg(status ORDER BY "createdAt") AS statuses
FROM "Candidate"
GROUP BY lower(trim(email))
HAVING count(*) > 1;

-- ---- Write -----------------------------------------------------------------
BEGIN;

-- Survivor = oldest row in each collision group.
CREATE TEMP TABLE b7_merge ON COMMIT DROP AS
SELECT c.id AS loser_id, s.survivor_id
FROM "Candidate" c
JOIN (
  SELECT DISTINCT ON (lower(trim(email))) lower(trim(email)) AS email_lc, id AS survivor_id
  FROM "Candidate"
  ORDER BY lower(trim(email)), "createdAt" ASC
) s ON s.email_lc = lower(trim(c.email))
WHERE c.id <> s.survivor_id;

-- Carry the newer reply timestamp and any missing role onto the survivor.
UPDATE "Candidate" sv SET
  "repliedAt" = GREATEST(sv."repliedAt", agg.replied_at),
  role = COALESCE(sv.role, agg.role)
FROM (
  SELECT m.survivor_id, max(l."repliedAt") AS replied_at, max(l.role) AS role
  FROM b7_merge m JOIN "Candidate" l ON l.id = m.loser_id
  GROUP BY m.survivor_id
) agg
WHERE sv.id = agg.survivor_id;

UPDATE "EmailThread" t SET "candidateId" = m.survivor_id
FROM b7_merge m WHERE t."candidateId" = m.loser_id;

DELETE FROM "Candidate" c USING b7_merge m WHERE c.id = m.loser_id;

UPDATE "Candidate" SET email = lower(trim(email)) WHERE email <> lower(trim(email));

CREATE UNIQUE INDEX IF NOT EXISTS "Candidate_email_lower_key" ON "Candidate" (lower(email));

COMMIT;

-- ---- Verify ----------------------------------------------------------------
SELECT count(*) AS mixed_case_rows_left FROM "Candidate" WHERE email <> lower(trim(email));
SELECT indexname FROM pg_indexes WHERE tablename = 'Candidate' AND indexname = 'Candidate_email_lower_key';
