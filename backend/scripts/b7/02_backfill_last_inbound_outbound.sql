-- B7 / H6 — NOT RUN. Backfill conversation state from message history.
-- Requires write authorization for prod. Run after 01.
--
-- lastInboundAt  = latest message on the candidate's threads sent by the
--                  candidate's own address (what classifyAndDraft records).
-- lastOutboundAt = latest message on those threads sent by the thread's
--                  mailbox, or an app send (EmailDraft.sentAt), whichever is later.
-- firstMailboxId = mailbox of the candidate's oldest thread (else mailboxId).

-- ---- Preview (read-only) ---------------------------------------------------
WITH st AS (
  SELECT c.id, c.status, c.role, c."repliedAt",
    (SELECT max(m."receivedAt") FROM "EmailThread" t JOIN "EmailMessage" m ON m."threadId" = t.id
      WHERE t."candidateId" = c.id AND lower(m."fromAddress") = lower(c.email)) AS li,
    GREATEST(
      (SELECT max(m."receivedAt") FROM "EmailThread" t JOIN "Mailbox" mb ON mb.id = t."mailboxId"
        JOIN "EmailMessage" m ON m."threadId" = t.id
        WHERE t."candidateId" = c.id AND lower(m."fromAddress") = lower(mb."emailAddress")),
      (SELECT max(d."sentAt") FROM "EmailThread" t JOIN "EmailDraft" d ON d."threadId" = t.id
        WHERE t."candidateId" = c.id AND d.status = 'SENT')
    ) AS lo
  FROM "Candidate" c
)
SELECT
  count(*) FILTER (WHERE status <> 'IGNORED' AND role IS NOT NULL
                     AND li IS NOT NULL AND (lo IS NULL OR li > lo)) AS awaiting_after_backfill,
  count(*) FILTER (WHERE "repliedAt" IS NOT NULL AND li IS NOT NULL AND (lo IS NULL OR li > lo)) AS shown_replied_but_awaiting,
  count(*) FILTER (WHERE li IS NULL) AS no_inbound_found
FROM st;

-- ---- Write -----------------------------------------------------------------
BEGIN;

UPDATE "Candidate" c SET "lastInboundAt" = x.li
FROM (
  SELECT t."candidateId" AS id, max(m."receivedAt") AS li
  FROM "EmailThread" t
  JOIN "Candidate" c2 ON c2.id = t."candidateId"
  JOIN "EmailMessage" m ON m."threadId" = t.id
  WHERE lower(m."fromAddress") = lower(c2.email)
  GROUP BY t."candidateId"
) x
WHERE c.id = x.id AND (c."lastInboundAt" IS NULL OR c."lastInboundAt" < x.li);

UPDATE "Candidate" c SET "lastOutboundAt" = x.lo
FROM (
  SELECT id, max(at) AS lo FROM (
    SELECT t."candidateId" AS id, m."receivedAt" AS at
    FROM "EmailThread" t
    JOIN "Mailbox" mb ON mb.id = t."mailboxId"
    JOIN "EmailMessage" m ON m."threadId" = t.id
    WHERE t."candidateId" IS NOT NULL AND lower(m."fromAddress") = lower(mb."emailAddress")
    UNION ALL
    SELECT t."candidateId", d."sentAt"
    FROM "EmailThread" t JOIN "EmailDraft" d ON d."threadId" = t.id
    WHERE t."candidateId" IS NOT NULL AND d.status = 'SENT' AND d."sentAt" IS NOT NULL
  ) u GROUP BY id
) x
WHERE c.id = x.id AND (c."lastOutboundAt" IS NULL OR c."lastOutboundAt" < x.lo);

UPDATE "Candidate" c SET "firstMailboxId" = COALESCE(
  (SELECT t."mailboxId" FROM "EmailThread" t WHERE t."candidateId" = c.id ORDER BY t."createdAt" ASC LIMIT 1),
  c."mailboxId")
WHERE c."firstMailboxId" IS NULL;

COMMIT;

-- ---- Verify (should match /api/candidates/counts awaitingReply) ------------
SELECT count(*) AS awaiting
FROM "Candidate" c
WHERE c.status <> 'IGNORED' AND c.role IS NOT NULL AND (
  (c."lastInboundAt" IS NOT NULL AND (c."lastOutboundAt" IS NULL OR c."lastInboundAt" > c."lastOutboundAt"))
  OR (c."lastInboundAt" IS NULL AND c."repliedAt" IS NULL
      AND EXISTS (SELECT 1 FROM "EmailThread" t WHERE t."candidateId" = c.id)));
