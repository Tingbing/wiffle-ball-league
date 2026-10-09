# Multi-league implementation progress

Updated: 2026-10-09. Status: implementation released; owner one-time code setup remains.

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

- Baseline: 12 Node tests pass, including 50 four-team and 50 five-team schedules, default overtime and recoverable completion.
- Isolated free staging project created by the user and verified healthy; baseline fixture and multi_league_access migration applied there only.
- tests/backend.mjs: 24 checks passed via real PostgREST HTTP requests. See tests/BACKEND_RESULTS.md. Includes cross-league reads/writes, minimal directory, code checks, duplicate/retried creation, throttling, one recorder, simultaneous independent leagues, idempotent saves, stale revisions, handoff/stale release, immutable rules, completion, device revocation and code changes.
- Browser gate is BLOCKED: Playwright downloads failed; official Chrome downloaded but cannot launch because runtime socket operations are prohibited. Cloud Browser rejected the local file preview under its URL security policy, with explicit instruction not to work around that blocked action. No browser acceptance checks ran. A supported HTTPS staging preview/browser environment is needed; do not bypass the policy.
- Custom-rule, pagination/expiry/lease-expiry, setup-token and representative backup/migration checks now pass. Full browser scoring/substitution/undo/stat workflow, phone/accessibility and client concurrency checks remain untested.

## Rollout and recovery

Keep this branch unmerged until all required gates pass. Migration: supabase/migrations/20261009170646_multi_league_access.sql. database/*.sql are its source fragments. tests/fixtures/baseline.sql is a synthetic test-only baseline, NEVER a production migration.
Before production writes: capture schema/deployment state and private affected-data backup, prove isolated restore and preservation, validate migration on that copy, recheck main/schema drift, and provision a verified existing-league code/setup mechanism. Close legacy backend access before frontend deployment; old clients must fail closed.
No paid resources or upgrades authorized. No data was erased despite permission to erase if necessary.

## Next step

Recheck branch and staging migrations (do not reapply blindly), continue custom-rule and browser tests, harden findings, then complete backup/restore and rollout gates. Never claim competition readiness before acceptance passes.

## Additional verification and private backup

Six additional real HTTP checks passed: cursor pagination without duplicates; expired grant rejection; expired recorder takeover; invalid/reused setup-token rejection; authenticated restored league snapshot equality; legacy restored-copy RPC denial. These were executed with synthetic grants and a private representative copy, without production writes. Total: 30 HTTP checks plus 12 Node tests.
Private data/schema backup captured and saved outside GitHub. Its affected private league, backend game rows, and receipts restored in a separate staging namespace. Exact equality of every original column passed after the migration. Existing league settings remain the original defaults. Source team/player/stat/schedule/game snapshots were preserved, not reconstructed.
During restore-fixture construction, legacy function grants were found open and immediately revoked; fixture now includes revocations BEFORE data loading. Production was unaffected. A focused staging logs query returned zero matching restore API log entries in the checked window; this is not proof that logging captures every request.
A second migration adds directory name trigram search and relationship indexes. Both migrations were applied to staging and the representative copy. Search pagination and literal wildcard escaping passed. No production migration has been applied.
Final staging catalog check: zero API table grants, zero private tables without RLS, zero app Realtime publication tables, zero storage buckets. App uses gated polling, not Realtime or Storage. Security advisors flag the intentionally exposed SECURITY DEFINER RPCs and private deny-by-default RLS tables. These are deliberate consequences of code-based server-validated sessions; do not open direct table access to silence advisories. References:
- https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable
- https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy
Search and FK indexing migration: supabase/migrations/20261009173146_directory_indexes.sql.

## Remaining release gate and recovery

Browser acceptance and a verified production setup-code mechanism must complete before rollout. No production code/setup token was invented. One-time setup token provision/consumption was verified on the representative staging copy only. Do not expose that token in URLs, logs or GitHub.
Keep main unchanged. Recovery at this checkpoint: abandon/revert only the development branch if needed; production requires no recovery because it was not modified. Private JSON data restore uses jsonb_populate_recordset into the baseline-shaped tables, in FK order league → games → receipts; tests/fixtures/baseline.sql is test-only and must remain inaccessible to API roles before data loading. For a future release failure, keep the access boundary closed, preserve post-release records, and repair forward from a tested branch. Never replace current data blindly with a pre-release snapshot or re-enable legacy anonymous RPCs.

Representative restore fixture sealed after verification: all of its RPC execution grants were revoked and its test sessions removed. Catalog check confirmed zero API-executable restore functions. This copy is now admin-only; do not reopen it just to resume tests.

## HTTPS preview retry

Private staging preview published successfully: https://wiffle-multileague-staging-check.warm-ghost-4468.chatgpt.site/app.html . Source app checkpoint: a87a4a6348e741c2ee3f02a2d6be7a39156e1057. It targets staging only; production configuration remains unchanged in this repository.
The supported local preview supervisor also failed with a prohibited proc mount. This requires a different supported test runtime, not additional user approval. Prepared a Chromium acceptance workflow on the development branch using a standard GitHub-hosted Ubuntu runner for this public repository. It has read-only repository permissions, no deployment steps, no production access or secrets, no uploaded artifacts or caches, and a 15-minute timeout. Browser acceptance is pending an actual workflow result; test preparation is not a passing result.

- [x] Code, baseline and custom-rule checks
- [x] Real isolated backend authorization/concurrency checks
- [x] Private backup restore and migration preservation proof
- [x] Private HTTPS staging preview
- [ ] Desktop, mobile and two-device browser acceptance
- [ ] Existing-league secure setup and refreshed production drift/backup checks
- [ ] Production migration, main merge/deployment and live verification

First actual browser run passed: https://github.com/Tingbing/wiffle-ball-league/actions/runs/37970006788 at a4c08d7b5943fed25b5985f814e0fd99494dec59. Eleven checks covered creation, scheduling, scoring/undo/error, handoff, phone completion, persisted stats and code/session revocation. See tests/BROWSER_RESULTS.md. No production requests or uncaught browser exceptions. Extended substitutions, pitcher change, interrupted-acknowledgment recovery, offline reconnect, box scores/rankings, search/keyboard, delayed response/back-forward isolation, simultaneous Start and one-out overtime checks are prepared but not yet verified.

Extended browser run passed 20 checks at 6ed77aadbe1b2cbc3a1caf4b9205ae7a497451cf: https://github.com/Tingbing/wiffle-ball-league/actions/runs/37970694022 . Results include substitutions, pitcher change, interrupted acknowledgments, offline reconnection, saved box scores/rankings, keyboard directory access, delayed response/back-forward isolation, simultaneous Start and one-out overtime. Remaining tab and directory/form cases are prepared for the final run. Main and the production league revision were rechecked and remain unchanged. The private one-time existing-league setup handoff is prepared and saved outside GitHub; its hash will be provisioned atomically with the gated migration only after acceptance passes. It is not active yet.

## Release preflight — 2026-10-09

Final browser acceptance SUCCESS: 23 checks at b03c5694f35792b41146769f59caded836994e71, https://github.com/Tingbing/wiffle-ball-league/actions/runs/37971240292 . Includes same-device multiple tabs, no-results/error/Retry states and keyboard form/server code validation in addition to the 20 extended checks. Twelve Node tests and 30 real staging HTTP checks also pass. No production requests or uncaught browser exceptions occurred in browser tests. Native private preview login/routing was not tested from the Actions browser; its deployment succeeded separately.

Refreshed production read exactly matches the tested backup: one private league, four backend game rows, 106 receipts, four legacy teams, eight legacy players and one legacy season row. Every original value matches, and all captured schema functions, constraints, views, columns, indexes, grants, policies, triggers, publication and Storage state match. Main remains eca58ba3d8ea44982142ea4c0eb02971ddc5a06e. No active production game exists. Existing GitHub Pages uses the built-in pages build and deployment workflow.

Private owner setup file is saved outside GitHub and linked to the owner before activation. Its random one-time token will be provisioned atomically with the code gate; owner chooses the shared code in the setup form. Token verification and consumption were tested in the isolated representative restore. Neither token nor hash is committed here.

Release order: apply additive access migration plus private one-time setup hash in one transaction, apply tested indexes, verify API gate and preservation, merge the tested frontend through a PR, wait for existing Pages deployment, and perform non-destructive live checks. Old frontend/backend callers fail closed after migration. If frontend release fails, keep the new access boundary closed and repair forward; never restore insecure legacy RPC grants.

- [x] Private HTTPS staging preview published
- [x] Code, backend, migration preservation and 23 browser acceptance checks
- [x] Private existing-league setup mechanism prepared and delivered
- [x] Refreshed production data/schema and main drift checks
- [ ] Production migrations and preserved-record verification
- [ ] PR merge, Pages deploy and non-destructive live verification

This is the preflight checkpoint. Production migration and main merge have NOT happened yet.

## Production backend activated — 2026-10-09

Applied multi_league_access transaction with preflight data-drift assertions and the privately provisioned owner setup hash. Applied directory_indexes. Verified exact hashes of every original private league/game/receipt field: all preserved. Owner one-time setup is ready, no shared code is invented. Catalog verifies zero API table grants, all private tables have RLS, legacy wbl_read execution denied, and no app tables in Realtime publications. Current frontend main remains the old commit pending PR merge/Pages deployment; old callers fail closed.

- [x] Production backend migrations and private-data preservation verification
- [ ] Merge PR #3 at the tested source state, wait for GitHub Pages deployment and verify live gate

Migration recovery: keep this security boundary closed; repair frontend forward if its deployment fails. Never reopen legacy anonymous RPCs. The owner setup file is private and active; use it only after the frontend deployment is confirmed.

## Released — 2026-10-09

PR #3 merged: https://github.com/Tingbing/wiffle-ball-league/pull/3
App merge commit: fb7107559b5f4a5408dec90b451bf2ffaf49f02b
Successful existing GitHub Pages deployment: https://github.com/Tingbing/wiffle-ball-league/actions/runs/37972202632
Live app: https://tingbing.github.io/wiffle-ball-league/
Private staging preview: https://wiffle-multileague-staging-check.warm-ghost-4468.chatgpt.site

Production Supabase migration versions: 20261009181500 multi_league_access and 20261009181523 directory_indexes (tool assigned versions; checked-in source migrations keep their original staging timestamps). Private setup hash was provisioned in the access transaction; no secret/token/hash exists in GitHub.

Verified after release: original private league/game/receipt fields preserved exactly; minimal public directory; rejected legacy reads, forged private read/write, and legacy table/view paths (eight real non-destructive HTTP checks). Six deployed source files match the tested code by SHA-256, including HTML, backend config, code gate, sync, recorder and gameplay. Production remains the original project and keeps its data. No paid resources/upgrades or data resets.

- [x] Implementation and private HTTPS preview
- [x] 12 code tests, 30 isolated HTTP checks and representative restore/migration proof
- [x] 23 Chromium desktop/mobile/device/tab browser checks
- [x] Production migrations, preserved records and live API security checks
- [x] PR merge and successful GitHub Pages deployment/source verification
- [ ] Owner enters the privately supplied one-time setup token and chooses the existing league's shared code

The one-time owner file is private and active. Open the existing league, expand one-time setup, paste that token, choose an 8–64 byte code with a letter and number/symbol, and submit. The setup token is consumed once. Never paste it into GitHub, URLs, or chat. Device access lasts seven days; explicit leave revokes that device; code rotation revokes all devices.

Remaining limitation: final cloud-browser observation of the live page was restricted by credential protection even after the documented new-document recovery. Do not bypass that guard. Native HTTPS preview login/routing and live owner-authenticated visual inspection were not claimed. Isolated browser acceptance and live deployment/API/source checks passed. Do not assert competition readiness until the owner setup and live visual review are complete.

Recovery: keep the new backend access boundary closed. Revert or repair the frontend through GitHub, preserve post-release records, and fix forward against the tested staging environment. Do not roll back to an old frontend expecting anonymous access or replace current records with the backup. Private restorable pre-release data/schema backups remain outside GitHub. This final checkpoint/documentation does not change application code and needs no repeat of passed browser tests.
