# B7 data backfills (NOT RUN)

Run these by hand, in order, after `9c_candidate_state` is applied, and only
with explicit per-session authorization for writes to prod Supabase.
Each file opens with read-only preview SELECTs, and its writes sit inside one
`BEGIN … COMMIT`. Run the preview, check the numbers, then run the
transaction.

| File | What it does |
|---|---|
| `01_lowercase_candidate_emails.sql` | Merges the case-only duplicate Candidate groups (keeps the oldest row and repoints threads), lowercases every `Candidate.email`, then adds the unique index on `lower(email)` (M12). |
| `02_backfill_last_inbound_outbound.sql` | Sets `lastInboundAt`, `lastOutboundAt` and `firstMailboxId` from message history (H6). Until this runs, rows fall back to the legacy `repliedAt` rule. |
| `03_restatus_candidates.sql` | Applies the new transition rules to history: the swallowed confident declines, the stale NEEDS_REVIEW rows a later confident classification should have cleared, and (optional) legacy `REPLIED` rows restored to their last classification (H6). |

After running, re-check with the verification SELECTs at the end of each file.
