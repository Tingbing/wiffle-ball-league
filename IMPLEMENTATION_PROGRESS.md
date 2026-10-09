# Multi-league implementation checklist

Updated: 2026-10-09. **Released. The owner must choose the existing league's shared code using the private one-time setup file.** Final live visual inspection remains blocked by the cloud browser's credential protection; do not claim competition readiness yet.

## Current checklist

- [x] Inspect uploaded ZIP, current GitHub source, backend schema and permissions
- [x] Implement independent leagues, code-based sessions and configurable rules
- [x] Pass 12 baseline/custom-rule Node tests
- [x] Pass 30 real isolated backend HTTP checks
- [x] Restore private production backup in isolation and prove migration preservation
- [x] Publish private HTTPS staging preview
- [x] Pass 23 Chromium desktop/mobile/two-device/tab browser checks
- [x] Recheck production data/schema and main for drift
- [x] Deliver private one-time existing-league setup mechanism
- [x] Apply production migrations and verify preserved records/security
- [x] Merge PR #3 and deploy using existing GitHub Pages workflow
- [x] Verify deployed source hashes and non-destructive production API checks
- [ ] Owner enters the private setup token, chooses a shared code and reviews the live app

## Targets and release

- Repository: https://github.com/Tingbing/wiffle-ball-league
- Working branch: codex/multi-league-2026-10-09
- Live app: https://tingbing.github.io/wiffle-ball-league/
- PR: https://github.com/Tingbing/wiffle-ball-league/pull/3
- App release commit: fb7107559b5f4a5408dec90b451bf2ffaf49f02b
- Successful Pages deployment: https://github.com/Tingbing/wiffle-ball-league/actions/runs/37972202632
- Last tested source checkpoint: b03c5694f35792b41146769f59caded836994e71
- Private preview: https://wiffle-multileague-staging-check.warm-ghost-4468.chatgpt.site
- Production Supabase: hunqtklytyorvmztgpqt
- Isolated free staging Supabase: axyywkipikyahayzipbu

The uploaded ZIP matched original main eca58ba3d8ea44982142ea4c0eb02971ddc5a06e. No AGENTS.md or app dependency/build/lint/typecheck configuration existed. App code changes were isolated on the development branch until acceptance passed. Documentation-only final checkpoints do not change the tested application code.

## What changed

The app opens to a public directory with search, cursor pagination, loading/error/empty states and Create/Join/Open controls. Listings expose only ID, name and creation time. Duplicate names remain independent. Creation is transactional and supports idempotent retries.

Each league has one shared code stored as a private bcrypt hash. Server-validated random-token sessions last seven days. Everyone with a valid code has equal full league permissions. Explicit leave revokes that device's grant; code rotation revokes every grant and releases live recorder ownership. Codes, setup secrets and hashes are excluded from listings and this repository.

Private reads and mutations use gated RPCs. Legacy anonymous RPC, table, view and publication access is closed. Private tables have RLS, no direct API-role table grants, and no public policies. The app uses gated polling; it does not use Realtime or Storage. Security advisers intentionally flag exposed SECURITY DEFINER RPCs and deny-by-default private RLS tables; do not weaken security to silence those informational/design warnings.

Caches, routes, recorder identities, recovery copies and in-memory state are league scoped. Generation checks discard late responses after switching. Scoring saves require server acknowledgment, revision/epoch/lease ownership and idempotent receipts. One live game is enforced per league; different leagues can record independently. Unconfirmed saves pause scoring and handoff.

Supported customization: 2–8 teams, 1–52 weeks, 1–9 innings and 1–6 outs. Original defaults remain four teams, six weeks, three innings and two outs. Odd-team schedules include byes; partial round-robin cycles can have unequal opponents/byes. Postseason remains explicitly limited to exactly four teams. Game/season rule snapshots preserve completed statistics. Rule/roster changes are blocked during live games and scored seasons. The original scoring rules and statistical normalization remain intact, with pitching-out denominators snapshotted for custom rules.

## Verified tests and evidence

- 12 Node tests: original four/five-team schedules, default overtime/recoverable completion, 2–8 team schedules and 1/1, 5/3, 9/6 custom inning/out boundaries and pitching denominators.
- 30 real staging HTTP checks: codes, minimal directory, creation/retry/throttling, duplicate names, same-code league isolation, forged sessions, private/legacy access denial, ID substitution, recorder concurrency/handoff/expiry, stale writes, receipts, immutable rules, completion, revocation and setup-token consumption. See tests/BACKEND_RESULTS.md.
- Representative private restore: every original league/game/receipt field matches after migration; source teams, players, schedule, statistics, live-game snapshots and relationships were preserved.
- 23 Chromium acceptance checks: https://github.com/Tingbing/wiffle-ball-league/actions/runs/37971240292 . Includes full creation/roster/schedule/scoring/finish/stat workflow, phone, substitution/pitcher change, undo/error, box scores/rankings, wrong/correct codes, two-device handoff, same-device tabs, simultaneous Start, lost acknowledgments/offline recovery, back/forward/delayed-response isolation, search/error/Retry states, keyboard controls, and one-out overtime. No production requests or uncaught browser exceptions. See tests/BROWSER_RESULTS.md.
- Production verification: eight non-destructive HTTP checks passed for the minimal directory and denial of legacy/forged private reads, forged edits and private table/view paths. Six deployed app files match the tested source by SHA-256: app.html, app.boot.js, app.leagues.js, core.sync.js, app.recording.js and app.game.play.js.
- All applicable JavaScript syntax and git whitespace checks passed.

The cloud browser rejected the initial local-file preview and the supported local supervisor could not mount proc. These were infrastructure/policy limits, not code failures; they were not bypassed. Browser acceptance subsequently ran successfully in a standard GitHub-hosted runner for this public repository. Native private HTTPS preview login/routing was not exercised by those tests. A final live cloud-browser observation remained restricted by credential protection after documented recovery; no successful live visual or owner-authenticated workflow is claimed.

## Production migrations and preservation

Checked-in source:
- supabase/migrations/20261009170646_multi_league_access.sql
- supabase/migrations/20261009173146_directory_indexes.sql

Production tool-assigned versions:
- 20261009181500 multi_league_access
- 20261009181523 directory_indexes

The access transaction locked affected tables, asserted no data drift since the refreshed backup, applied the tested additive access changes and provisioned the private one-time setup hash. Indexing followed. Backend gates were verified before frontend merge. Old clients fail closed; legacy grants were never reopened.

Existing league ID 6767 remains stable. Exact original values were verified unchanged after production migration: one private league, four backend game rows and 106 receipts, plus unchanged legacy teams/players/season snapshots. Before release, four legacy teams, eight legacy players and one legacy season row matched the tested backup. All captured schema functions, constraints, views, columns, indexes, grants, policies, triggers, publication and Storage state matched the representative restore preflight. Post-migration checks confirmed zero API table grants, zero private tables without RLS, no app Realtime publication tables, and legacy read execution denied. No paid resources/upgrades or data resets were used.

Private restorable data and full schema backups were saved outside GitHub. During construction of the isolated representative restore fixture, legacy execution grants were found open and immediately revoked; the fixture now revokes access before loading data. Production was unaffected. A focused staging logs query found zero matching requests in the checked window, which is not proof of complete logging. The representative fixture was then sealed: all its API execution grants revoked and test sessions removed. Do not reopen it to resume work.

## Owner's next step

Use the privately supplied wiffle-existing-league-setup.txt file. It is active and the frontend is live. Open the existing league, expand one-time setup, enter that private token, choose an 8–64 byte shared code with a letter and number/symbol, and submit. The token is consumed once. Share only the chosen code with league members. Never put the setup token in URLs, chat, GitHub or a stats backup. No existing-league shared code was invented.

Owner code entry and live visual review are the only outstanding handoff items. Device access is remembered for seven days. Everyone using the shared code has full management permissions, including confirmed season reset. Code changes revoke all device sessions. The existing data remains protected and intact while setup is pending.

## Recovery and resuming

Keep the new backend access boundary closed. Revert or repair frontend changes through GitHub, preserve post-release records, and fix forward against isolated staging. Do not deploy an old frontend expecting anonymous access, reopen old RPC grants, or blindly replace current data with a pre-release backup. Restores must account for records written after release. Private backup restore uses jsonb_populate_recordset in FK order league → games → receipts. tests/fixtures/baseline.sql is synthetic test-only infrastructure, never a production migration.

For future work, inspect current main, deployed Pages commit and Supabase migration history before making changes. Do not reapply migrations blindly or rerun creation-heavy tests without a reason. No scheduled continuation or paid upgrade was created. The final documentation checkpoint requires no repeat of successful application tests.
