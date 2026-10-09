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
