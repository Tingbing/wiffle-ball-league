# Multi-league implementation progress

Updated: 2026-10-09. Status: implementation and isolated validation in progress; NOT released.

## Target and source

Repository: https://github.com/Tingbing/wiffle-ball-league
Development branch: codex/multi-league-2026-10-09
Inspected main: eca58ba3d8ea44982142ea4c0eb02971ddc5a06e. Uploaded ZIP matches original source. No AGENTS.md or build/lint/typecheck configuration exists.
The intended production Supabase target remains the project referenced in app.boot.js. No production database writes or merges have occurred. Private data and dumps are excluded from this repository.

## Implementation checkpoint

- Public directory with search and cursor pagination; duplicate names are allowed and distinguished by ID.
- Transactional league creation with idempotency receipt. Private bcrypt hashes and server-validated seven-day device sessions. No conventional signup.
- Gated private RPCs with league-scoped grants, shared full permissions, device revocation, code-change revocation, and server throttling.
- Migration closes legacy RPC/table/view/publication access. Private tables use RLS and no API-role table grants.
- League-scoped client persistence, recorder identities and recovery; generation checks reject late private responses after switching.
- Configurable 2–8 teams, 1–52 weeks, 1–9 innings and 1–6 outs. Weekly round-robin cycles support odd-team byes. Postseason remains explicitly limited to four teams.
- Game/season rule snapshots, immutable game rules, and blocked roster/rule changes during scored seasons or live games.
- Existing recorder revision/epoch/lease and receipt protocol retained, with one live game per league enforced atomically.
- One-time existing-league setup requires a separately provisioned private random token. No production code or setup token has been provisioned yet.

## Actual validation

- Baseline: four Node tests pass, including 50 four-team and 50 five-team schedules, default overtime and recoverable completion.
- Isolated free staging project created by the user and verified healthy; baseline fixture and multi_league_access migration applied there only.
- tests/backend.mjs: 24 checks passed via real PostgREST HTTP requests. See tests/BACKEND_RESULTS.md. Includes cross-league reads/writes, minimal directory, code checks, duplicate/retried creation, throttling, one recorder, simultaneous independent leagues, idempotent saves, stale revisions, handoff/stale release, immutable rules, completion, device revocation and code changes.
- Browser executable installation failed: official downloads returned invalid/truncated archive content. Browser validation has not run. Continue investigating a supported browser runtime.
- Custom-rule unit tests, pagination/expiry/lease-expiry checks, representative backup restoration/migration, complete UI workflow and phone/accessibility/concurrency checks remain pending.

## Rollout and recovery

Keep this branch unmerged until all required gates pass. Migration: supabase/migrations/20261009170646_multi_league_access.sql. database/*.sql are its source fragments. tests/fixtures/baseline.sql is a synthetic test-only baseline, NEVER a production migration.
Before production writes: capture schema/deployment state and private affected-data backup, prove isolated restore and preservation, validate migration on that copy, recheck main/schema drift, and provision a verified existing-league code/setup mechanism. Close legacy backend access before frontend deployment; old clients must fail closed.
No paid resources or upgrades authorized. No data was erased despite permission to erase if necessary.

## Next step

Recheck branch and staging migrations (do not reapply blindly), continue custom-rule and browser tests, harden findings, then complete backup/restore and rollout gates. Never claim competition readiness before acceptance passes.
