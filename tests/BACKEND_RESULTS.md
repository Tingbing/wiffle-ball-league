# Isolated backend results

Run against the free staging project, using real PostgREST HTTP requests with its publishable key. Production was not used.

- PASS: atomic creation of two independent custom leagues
- PASS: idempotent creation retry
- PASS: duplicate names remain independent
- PASS: server-side creation throttling
- PASS: directory search exposes minimal listing only
- PASS: missing and forged access denied
- PASS: incorrect code denied
- PASS: correct code grants another device access
- PASS: same code in two leagues does not authorize ID substitution
- PASS: cross-league write denied
- PASS: legacy RPC, table and view routes cannot bypass access
- PASS: one active game and one recorder per league
- PASS: independent leagues record simultaneously
- PASS: game IDs cannot cross league boundaries
- PASS: save receipt deduplicates interrupted request retries
- PASS: stale game revision rejected
- PASS: game rule snapshots are immutable
- PASS: league edits blocked during live games
- PASS: atomic handoff and stale release protection
- PASS: completed game retains custom rules across another device read
- PASS: scored season prevents rule reinterpretation
- PASS: explicit revocation affects only that device grant
- PASS: code change revokes all sessions and creation retry cannot restore them
- PASS: old code denied and new code works

Additional checks (real HTTP):

- PASS: cursor pagination without duplicates
- PASS: expired session rejected
- PASS: expired recorder lease can be claimed
- PASS: secure setup token rejects invalid/repeated use
- PASS: authenticated representative-copy API retains all original fields and snapshots
- PASS: legacy representative-copy read route closed

SQL verification: exact original-column equality for restored league, games and receipts after migration; zero API table grants; RLS enabled on every private table; no application Realtime publication tables or Storage buckets. Indexed search pagination and literal percent/underscore handling pass.
Browser acceptance has now passed 23 checks on GitHub Actions. See BROWSER_RESULTS.md. Production deployment succeeded after the acceptance gates. See IMPLEMENTATION_PROGRESS.md for preservation, live API checks and recovery.

## Permanent device access upgrade

Nine real HTTP checks passed against free staging using tests/persistent-access.mjs. A synthetic pre-upgrade grant was deliberately dated in 2000 before applying the additive migration. Its token was accepted afterward. Creation retry, join and one-time setup return expires_at: null. Forged/cross-league tokens remain denied; Leave removes only one device; a creation retry cannot resurrect a revoked grant; code rotation revokes all devices; setup tokens remain single use.

Production upgraded existing grants in place. Full league/game/receipt/credential hashes and session identities matched immediately before and after; the existing session count remained one. Private RLS/grants stayed closed and security adviser findings did not increase. Eight non-destructive live API smoke checks passed. No valid production mutation or synthetic production fixture was used.
