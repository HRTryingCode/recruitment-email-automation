-- B7 / H6 — NOT RUN. Re-apply the new status rules to classification history
-- (SystemLog CANDIDATE_CLASSIFIED). Requires write authorization for prod.
-- Uses the latest CANDIDATE_CLASSIFIED event per candidate.

-- ---- Preview (read-only) ---------------------------------------------------
WITH latest AS (
  SELECT DISTINCT ON (details::jsonb->>'candidateId')
    details::jsonb->>'candidateId' AS candidate_id,
    details::jsonb->>'classification' AS classification,
    (details::jsonb->>'confidence')::float AS confidence,
    (details::jsonb->>'needsReview')::boolean AS needs_review,
    "createdAt"
  FROM "SystemLog"
  WHERE event = 'CANDIDATE_CLASSIFIED'
  ORDER BY details::jsonb->>'candidateId', "createdAt" DESC
)
SELECT
  -- (a) latest message was a confident decline, but status kept INTERESTED/NEUTRAL.
  count(*) FILTER (WHERE c.status IN ('INTERESTED', 'NEUTRAL')
                     AND l.classification = 'NOT_INTERESTED' AND l.confidence >= 0.85) AS swallowed_declines,
  -- (b) NEEDS_REVIEW whose latest classification was confident and unflagged.
  count(*) FILTER (WHERE c.status = 'NEEDS_REVIEW'
                     AND l.needs_review = false AND l.confidence >= 0.7) AS clearable_needs_review,
  count(*) FILTER (WHERE c.status = 'NEEDS_REVIEW') AS needs_review_total,
  -- (c) legacy REPLIED with a usable last classification.
  count(*) FILTER (WHERE c.status = 'REPLIED' AND l.classification IS NOT NULL) AS legacy_replied_restorable
FROM "Candidate" c
LEFT JOIN latest l ON l.candidate_id = c.id;

-- ---- Write -----------------------------------------------------------------
BEGIN;

CREATE TEMP TABLE b7_latest ON COMMIT DROP AS
SELECT DISTINCT ON (details::jsonb->>'candidateId')
  details::jsonb->>'candidateId' AS candidate_id,
  details::jsonb->>'classification' AS classification,
  (details::jsonb->>'confidence')::float AS confidence,
  (details::jsonb->>'needsReview')::boolean AS needs_review
FROM "SystemLog"
WHERE event = 'CANDIDATE_CLASSIFIED'
ORDER BY details::jsonb->>'candidateId', "createdAt" DESC;

-- (a) Confident declines win.
UPDATE "Candidate" c SET status = 'NOT_INTERESTED'
FROM b7_latest l
WHERE l.candidate_id = c.id AND c.status IN ('INTERESTED', 'NEUTRAL')
  AND l.classification = 'NOT_INTERESTED' AND l.confidence >= 0.85;

-- (b) NEEDS_REVIEW clears on a later confident classification. Rows whose
-- latest message is still ambiguous stay NEEDS_REVIEW for the triage UI.
UPDATE "Candidate" c SET status = l.classification
FROM b7_latest l
WHERE l.candidate_id = c.id AND c.status = 'NEEDS_REVIEW'
  AND l.needs_review = false AND l.confidence >= 0.7
  AND l.classification IN ('INTERESTED', 'NOT_INTERESTED', 'NEUTRAL');

-- (c) OPTIONAL — legacy REPLIED back to the last classification. REPLIED
-- is no longer written; reply state comes from lastInbound/OutboundAt.
-- Uncomment to run.
-- UPDATE "Candidate" c SET status = l.classification
-- FROM b7_latest l
-- WHERE l.candidate_id = c.id AND c.status = 'REPLIED'
--   AND l.classification IN ('INTERESTED', 'NOT_INTERESTED', 'NEUTRAL');

COMMIT;

-- ---- Verify ----------------------------------------------------------------
SELECT status, count(*) FROM "Candidate" GROUP BY status ORDER BY status;
