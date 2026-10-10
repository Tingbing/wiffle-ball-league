# Multi-league implementation checklist

Updated: 2026-10-09. **Implementation released, including permanent device access.** The owner confirmed the app works, and production confirms the existing league code has been configured and its one-time setup token consumed.

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
- [x] Owner configures the existing league code and confirms the live app works
- [x] Upgrade existing device grants without replacing tokens or changing league data
- [x] Keep access until explicit leave or code rotation; restore the last league on startup
- [x] Pass 27 expanded browser checks, 12 Node tests and nine persistence HTTP checks
- [x] Merge PR #4, deploy permanent access and verify the live source/security

## Targets and release

- Repository: https://github.com/Tingbing/wiffle-ball-league
- Working branch: codex/multi-league-2026-10-09
- Live app: https://tingbing.github.io/wiffle-ball-league/
- Latest PR: https://github.com/Tingbing/wiffle-ball-league/pull/4
- Initial multi-league PR: https://github.com/Tingbing/wiffle-ball-league/pull/3
- App release commit: 61b0f215152f24ece1db6add23e18008f1bdce43
- Successful Pages deployment: https://github.com/Tingbing/wiffle-ball-league/actions/runs/37996645790
- Last tested source checkpoint: e90be83ad81a72323aaddca8703d3c3e86681749
- Initial multi-league private preview (historical; live app is current): https://wiffle-multileague-staging-check.warm-ghost-4468.chatgpt.site
- Production Supabase: hunqtklytyorvmztgpqt
- Isolated free staging Supabase: axyywkipikyahayzipbu

The uploaded ZIP matched original main eca58ba3d8ea44982142ea4c0eb02971ddc5a06e. No AGENTS.md or app dependency/build/lint/typecheck configuration existed. App code changes were isolated on the development branch until acceptance passed. Documentation-only final checkpoints do not change the tested application code.

## What changed

The app opens to a public directory with search, cursor pagination, loading/error/empty states and Create/Join/Open controls. Listings expose only ID, name and creation time. Duplicate names remain independent. Creation is transactional and supports idempotent retries.

Each league has one shared code stored as a private bcrypt hash. Server-validated random-token device grants have no time expiry. Previously stored grants are upgraded in place; changing the shared code or deliberately leaving still revokes access. Everyone with a valid code has equal full league permissions. Explicit leave revokes that device's grant; code rotation revokes every grant and releases live recorder ownership. Codes, setup secrets and hashes are excluded from listings and this repository.

Private reads and mutations use gated RPCs. Legacy anonymous RPC, table, view and publication access is closed. Private tables have RLS, no direct API-role table grants, and no public policies. The app uses gated polling; it does not use Realtime or Storage. Security advisers intentionally flag exposed SECURITY DEFINER RPCs and deny-by-default private RLS tables; do not weaken security to silence those informational/design warnings.

The last opened league automatically reopens on a fresh visit using its saved grant, after server validation. Switching to the directory preserves joined-league grants and respects that deliberate navigation. Temporary network failures keep grants and offer a code-free Retry. Clearing browser data removes saved access.

Caches, routes, recorder identities, recovery copies and in-memory state are league scoped. Generation checks discard late responses after switching. Scoring saves require server acknowledgment, revision/epoch/lease ownership and idempotent receipts. One live game is enforced per league; different leagues can record independently. Unconfirmed saves pause scoring and handoff.

Supported customization: 2–8 teams, 1–52 weeks, 1–9 innings and 1–6 outs. Original defaults remain four teams, six weeks, three innings and two outs. Odd-team schedules include byes; partial round-robin cycles can have unequal opponents/byes. Postseason remains explicitly limited to exactly four teams. Game/season rule snapshots preserve completed statistics. Rule/roster changes are blocked during live games and scored seasons. The original scoring rules and statistical normalization remain intact, with pitching-out denominators snapshotted for custom rules.

## Verified tests and evidence

- 12 Node tests: original four/five-team schedules, default overtime/recoverable completion, 2–8 team schedules and 1/1, 5/3, 9/6 custom inning/out boundaries and pitching denominators.
- 30 real staging HTTP checks: codes, minimal directory, creation/retry/throttling, duplicate names, same-code league isolation, forged sessions, private/legacy access denial, ID substitution, recorder concurrency/handoff/expiry, stale writes, receipts, immutable rules, completion, revocation and setup-token consumption. See tests/BACKEND_RESULTS.md.
- Nine additional real staging HTTP checks: previously expired grant migration, permanent creation retry/join/setup, forged and cross-league rejection, device-only leave, revoked creation retry rejection, all-device code rotation and single-use setup. Reproducible staging-only runner: tests/persistent-access.mjs.
- Latest Chromium acceptance: 27 checks passed at https://github.com/Tingbing/wiffle-ball-league/actions/runs/37996482810 on e90be83ad81a72323aaddca8703d3c3e86681749, including all prior cases plus old locally expired grants, automatic reopening, failed-open Retry, same-profile new tabs and deliberate directory switching. Zero production requests and uncaught browser exceptions.
- Representative private restore: every original league/game/receipt field matches after migration; source teams, players, schedule, statistics, live-game snapshots and relationships were preserved.
- 23 Chromium acceptance checks: https://github.com/Tingbing/wiffle-ball-league/actions/runs/37971240292 . Includes full creation/roster/schedule/scoring/finish/stat workflow, phone, substitution/pitcher change, undo/error, box scores/rankings, wrong/correct codes, two-device handoff, same-device tabs, simultaneous Start, lost acknowledgments/offline recovery, back/forward/delayed-response isolation, search/error/Retry states, keyboard controls, and one-out overtime. No production requests or uncaught browser exceptions. See tests/BROWSER_RESULTS.md.
- Production verification: eight non-destructive HTTP checks passed for the minimal directory and denial of legacy/forged private reads, forged edits and private table/view paths. Six deployed app files match the tested source by SHA-256: app.html, app.boot.js, app.leagues.js, core.sync.js, app.recording.js and app.game.play.js.
- All applicable JavaScript syntax and git whitespace checks passed.

The cloud browser rejected the initial local-file preview and the supported local supervisor could not mount proc. These were infrastructure/policy limits, not code failures; they were not bypassed. Browser acceptance subsequently ran successfully in a standard GitHub-hosted runner for this public repository. Native private HTTPS preview login/routing was not exercised by those tests. The earlier live cloud-browser observation remained restricted by credential protection after documented recovery. The owner subsequently confirmed the app works; production confirms setup completed. Automated Chromium covers the updated app in staging, and the live deployment is verified by source hashes and non-destructive HTTP checks. No agent-authenticated production workflow is claimed.

## Production migrations and preservation

Checked-in source:
- supabase/migrations/20261009170646_multi_league_access.sql
- supabase/migrations/20261009173146_directory_indexes.sql
- supabase/migrations/20261009215433_persistent_device_access.sql

Production tool-assigned versions:
- 20261009181500 multi_league_access
- 20261009181523 directory_indexes
- 20261009215839 persistent_device_access

The access transaction locked affected tables, asserted no data drift since the refreshed backup, applied the tested additive access changes and provisioned the private one-time setup hash. Indexing followed. Backend gates were verified before frontend merge. Old clients fail closed; legacy grants were never reopened.

Existing league ID 6767 remains stable. Exact original values were verified unchanged after production migration: one private league, four backend game rows and 106 receipts, plus unchanged legacy teams/players/season snapshots. Before release, four legacy teams, eight legacy players and one legacy season row matched the tested backup. All captured schema functions, constraints, views, columns, indexes, grants, policies, triggers, publication and Storage state matched the representative restore preflight. Post-migration checks confirmed zero API table grants, zero private tables without RLS, no app Realtime publication tables, and legacy read execution denied. No paid resources/upgrades or data resets were used.

Private restorable data and full schema backups were saved outside GitHub. During construction of the isolated representative restore fixture, legacy execution grants were found open and immediately revoked; the fixture now revokes access before loading data. Production was unaffected. A focused staging logs query found zero matching requests in the checked window, which is not proof of complete logging. The representative fixture was then sealed: all its API execution grants revoked and test sessions removed. Do not reopen it to resume work.

## Using the finished app

Open https://tingbing.github.io/wiffle-ball-league/ on the same browser/device. Previously joined leagues retain their grants; open one once to establish its last-league startup preference. Subsequent visits reopen it without entering the code. “Switch league” preserves saved access; “Leave & revoke” removes it. Changing the shared code revokes all device grants. Clearing browser data or using a new browser/device requires the shared code again.

The existing league setup is complete. Its one-time setup file is historical and should not be reused. Everyone using the shared code has full management permissions, including confirmed season reset.

The permanent-access production migration preserved the complete league/game/receipt/credential snapshots and the existing session identity; only expiry changed to NULL. Post-upgrade checks found zero expiring grants, zero API-role private table grants and no private tables without RLS. Security adviser findings were unchanged, including pre-existing legacy-function search-path and unused Supabase Auth configuration warnings. No paid upgrades or data resets were used.

## Recovery and resuming

Keep the new backend access boundary closed. Revert or repair frontend changes through GitHub, preserve post-release records, and fix forward against isolated staging. Do not deploy an old frontend expecting anonymous access, reopen old RPC grants, or blindly replace current data with a pre-release backup. Restores must account for records written after release. Private backup restore uses jsonb_populate_recordset in FK order league → games → receipts. tests/fixtures/baseline.sql is synthetic test-only infrastructure, never a production migration.

For future work, inspect current main, deployed Pages commit and Supabase migration history before making changes. Do not reapply migrations blindly or rerun creation-heavy tests without a reason. No scheduled continuation or paid upgrade was created. The final documentation checkpoint requires no repeat of successful application tests.

# Two-step setup and security update — 2026-10-10

Working branch: `codex/league-setup-security-2026-10-10`. Current main was cloned directly; no new ZIP was attached. No AGENTS.md exists. Production remains unchanged during isolated validation.

Implemented locally: details-only first screen, separate grouped settings screen, in-memory code, Back/Cancel, empty creation, original-token creation recovery after lost responses, team-name edits inside the existing Teams screen, empty dashboard guidance, protected-cache removal on Leave/revocation, backup size/text/field guards, restrictive resource CSP and referrer policy, safe error messages. Audit and rate-limit improvements plus zero/one-team validation are additive.

Staging migrations applied: `league_setup_security` and `setup_text_validation`; the single checked-in migration includes both. The backend supports existing creation payloads and permanent device grants. The sealed representative restore schema was not modified or reopened.

Validation so far: 12 existing Node rule/schedule tests passed; npm audit found zero vulnerabilities in the pinned browser-test dependencies. Real staging HTTPS tests cover empty creation, retries/recovery, exact settings, malformed inputs, unauthorized/cross-league access, one-team save/removal, game prerequisites, second-device persistence, private/audit/legacy API denial, Leave/rotation, old-client payloads and throttling. Full rerun is in progress. Local Chromium download returned invalid archives; use the existing GitHub-hosted Chromium acceptance route. Production deployment is gated on those results.

Design evidence: TeamSnap's official Add a sports organization team article adds teams inside an existing organization/program. LeagueApps' official Getting Started With Program Creation describes staged details setup, defaults, and keeping optional fields simple. The exact two steps, grouped number inputs, summary and empty-dashboard copy are this app's design decisions.

Next: finish staging HTTP and GitHub browser checks, inspect screenshots, record security evidence/limitations, snapshot production and recheck drift, then apply tested additive migration and merge/deploy if all relevant gates pass. Do not report production changes until verified.

## Setup validation gate passed — 2026-10-10

- 12 baseline/custom-rule Node checks passed.
- 16 grouped real staging HTTPS backend security/setup checks passed; `tests/SETUP_SECURITY_RESULTS.md`.
- 30 desktop/390px phone Chromium checks passed on `265bbf993535a3b6265b347d4376817c69e8db3b`: https://github.com/Tingbing/wiffle-ball-league/actions/runs/38070496850 . Includes Cancel/show-hide, Next/Back/no early writes, lost creation response with refresh, zero teams/screens, individual team additions/name edit, remembered devices, odd-team schedule, scoring/substitutions, handoff/offline/lost-save retry, correct stats, synthetic backup restore and dangerous/foreign imports, rotation/Leave/cache clearing, routing isolation and simultaneous Start/overtime. No production requests, uncaught browser exceptions or CSP violations.
- Screenshot artifact reviewed with codes masked: https://github.com/Tingbing/wiffle-ball-league/actions/runs/38070496850/artifacts/11676945809 . Mobile details/settings and empty Teams screens are readable with no horizontal overflow.
- Pinned/locked test dependency audit: zero vulnerabilities. App has no external runtime scripts. Source/reachable Git history scan: no private-key markers or service-role JWTs; two intended public anon JWTs.
- Removed 84 inline event-handler patterns into reviewed external handlers; CSP no longer permits inline/eval scripts. Existing inline styles are retained.
- Existing affected production functions exactly matched the original inspection; main stayed at `f21e9a75ddc3680a3eaef97a34fe4457b61709f1`. All 14 application files match the tested remote source.

Production migration `league_setup_security` applied after isolated gates. It holds table locks and compares aggregate row fingerprints before/after inside its transaction: existing league/game/receipt/credential/session/creation records are unchanged. Automatic approval review rejected a full credential/session backup export, so those records were not exported; an affected-schema snapshot was saved privately and data was verified inside the database. No user data is included in GitHub.

Eight real production smoke groups passed on one labeled synthetic league: minimal directory, private/legacy denial, empty creation/exact rules/permanent grant, retry/recovery, team/player addition, second-device persistence and device revocation. Synthetic cleanup was attempted twice with exact generated ID/name checks, but the Supabase connector returned `Invalid or expired requestState` both times. The labeled synthetic league remains: ID `560c5ddf-04d2-4bf8-8f3c-f82ec846dbdc`; name `SYNTHETIC SETUP SMOKE 6e723fc4-f386-440e-83b5-21908f8f1d86`. Both grants were revoked and its code was never saved/shared. Current counts are two leagues, five game records and 120 receipts; one league and one receipt belong to this synthetic smoke check. Original data was verified unchanged in the migration transaction. Do not delete other data. Cleanup remains blocked on that connector error; no alternative guard-bypassing deletion was attempted. No production throttles were reset. `tests/PRODUCTION_SETUP_RESULTS.md` contains the actual groups.

Production security checks: zero private tables without RLS, zero API-role private table grants, no Storage buckets, no app Realtime publication. Recovery RPC has intended execution access; audit trigger does not. Security advisers remain consistent with the deliberately gated RPC/private-table architecture and unused Auth/legacy warnings.

Release next: merge PR #5, allow existing GitHub Pages deployment, verify deployed source hashes/HTTPS, and record final state. Backend remains compatible with the preceding client while frontend deploys. No paid infrastructure or resets were used. Review `SECURITY_OVERVIEW.md` for implemented protections and the real static-hosting/browser-storage limitations.

## Final setup release state — 2026-10-10

PR #5 merged: https://github.com/Tingbing/wiffle-ball-league/pull/5 . Application release commit: `a5cc9bc09c1188d57d6463497815123fb9be6221`. Successful GitHub Pages build/deployment: https://github.com/Tingbing/wiffle-ball-league/actions/runs/38071575038 . Live app: https://tingbing.github.io/wiffle-ball-league/app.html . All 14 changed application files served over HTTPS match tested local source by SHA-256. Production tool-assigned migration version: `20261010171142 league_setup_security`; repository migration: `20261010164826_league_setup_security.sql`.

Additional cloud-browser smoke observed the deployed directory and the details-only first screen, inline empty-input validation/focus, and Cancel returning to the loaded directory. No league creation was submitted through this browser. Directory showed the real league plus the known synthetic smoke league. Browser-extension metadata errors are outside this app; no application runtime/CSP error was observed in this smoke. The full authenticated/scoring acceptance evidence is the isolated Chromium run, not this brief production UI check.

Delivered flow: name/code → grouped rules/settings → one atomic empty league → add teams/players in Teams. Device grants persist until Leave/rotation; schedule generation stays explicit. Security overview and evidence are checked into the repo. Original data, code hashes and device grants were preserved. No paid resources, resets or production rate-limit changes.

Only remaining operational cleanup: remove the exact revoked synthetic smoke league specified above when the SQL connector's `Invalid or expired requestState` error is resolved. Do not delete real league 6767 or reset production. The test code was never shared/stored; both test-device grants are revoked. Recover/fix forward as described in SECURITY_OVERVIEW.md; keep the backend access boundary closed.
