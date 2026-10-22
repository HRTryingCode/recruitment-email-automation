-- =====================================================================
-- Audit B3 (H2): seed the admin-maintained expected-senders list.
-- NOT RUN. Requires explicit authorization; run ONLY after migration
-- 10_sender_coverage has been applied. Idempotent (ON CONFLICT DO NOTHING).
-- Alternative with no SQL: add each address in Dashboard → Sender coverage
-- (admin), or POST /api/coverage/expected-senders.
--
-- Volumes are from the 2026-10-22 audit (Gem, Sep–Oct); NULL = unknown.
-- =====================================================================
BEGIN;

INSERT INTO "ExpectedSender"
  ("id", "emailAddress", "displayName", "source", "externalId", "expectedSends30d", "notes", "isActive", "createdAt", "updatedAt")
VALUES
  ('es_seed_ethan',      'ethan@archive.com',       'Ethan (Gem send-alias)', 'ADMIN', 'gem-user:766298', 478,  'Audit H2: 478 sends / 51 replies Sep–Oct; not connected', true, now(), now()),
  ('es_seed_pbenigeri1', 'p.benigeri@archive.com',  'Paul (Gem send-alias)',  'ADMIN', NULL,              NULL, 'Audit H2: 0 rows in app',                                  true, now(), now()),
  ('es_seed_pbenigeri2', 'pbenigeri@archive.com',   'Paul (Gem send-alias)',  'ADMIN', NULL,              NULL, 'Audit H2: 0 rows in app',                                  true, now(), now()),
  ('es_seed_michael',    'michael@archive.com',     'Michael (Gem sender)',   'ADMIN', NULL,              1700, 'Audit H2: ~1,700 Gem sends in Sep vs 582 seen in app; verify', true, now(), now()),
  -- Connected mailboxes we expect sends from, so the "quiet mailbox" check
  -- (0 outbound in 30d while sends are expected) covers them too.
  ('es_seed_emaenza',    'emaenza@archive.com',     'Ethan Maenza',           'ADMIN', NULL,              NULL, 'Audit H2: 0 outbound since July', true, now(), now()),
  ('es_seed_ethanmaenza','ethanmaenza@archive.com', 'Ethan Maenza',           'ADMIN', NULL,              NULL, 'Audit H2: 0 outbound since July', true, now(), now())
ON CONFLICT ("emailAddress") DO NOTHING;

-- Verify (expect the four unconnected aliases to show as unmonitored):
SELECT es."emailAddress",
       EXISTS (
         SELECT 1 FROM "Mailbox" m
         WHERE m."isActive"
           AND (lower(m."emailAddress") = es."emailAddress" OR es."emailAddress" = ANY(m."sendAsAddresses"))
       ) AS monitored
FROM "ExpectedSender" es
ORDER BY 2, 1;

COMMIT;
