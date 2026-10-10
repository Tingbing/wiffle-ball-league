# Settings and gated rollout

Maximum players per team is capacity 1–30, default2; smaller teams are valid. Every active roster name consumes a slot. The explicit substitute model replaces an existing roster seat. Archived players/transfers/reactivation are not supported; scored-season roster edits remain blocked. No placeholders are created.

Games per series supports best-of1/3/5/7/9, default3. Each weekly matchup has one opponent per team. Round-robin cycles rotate opponents, reverse home/away on later cycles, and distribute odd-team byes with at most one difference over partial cycles. All potential fixtures live under that week's matchup. New series clinch as soon as a majority wins; unused fixtures are marked not needed. Older series keep their recorded completion semantics. The postseason stays the supported four-team, first-to2 double-elimination format.

Rules and series snapshots cannot be reinterpreted midgame or after scoring. Settings changes clear only an unplayed schedule; over-capacity reductions fail without deleting players. Use a fresh/reset season with a privately downloaded backup before changing a scored season. No production reset is part of this implementation.

League menu contains Settings, Switch and confirmed Leave/revoke. Frequent Teams, Start/Resume, Schedule and Stats stay visible. Device persistence and server revocation are inherited unchanged; they require new real E2E validation before release.

## Rollout record

The earlier migration request-state blocker was resolved after target verification and removal of an unnecessary trigger deletion. The migration has applied to staging, and real API acceptance has passed. Production rollout is being completed in backend-first order after final browser gates. IMPLEMENTATION_PROGRESS.md holds exact final state and CI/deployment links.

A private pre-rollout backup contains affected league/game snapshots and previous validator/mutation definitions, without credential/session exports. Internal before/after hashes cover league rows, game rows, credentials, sessions and receipts. The SQL migration changes functions and adds a validator trigger; it has no league/game data rewrite or historical backfill.

Recovery: retain the compatible backend if a frontend deployment fails; do not wipe data, regenerate a scored schedule or blindly restore old rules. Inspect current deployed code, migration history, schema and fingerprints first. Fix forward from the tested branch. A prior frontend can only be restored after checking whether new-format leagues/series have been created; older clients may not understand them. Restore a privately backed-up row only for a verified affected identity and with a fresh concurrency check, never wholesale over newer scores. Protected credentials and remembered grants stay in place. Use the previous function definitions for comparison, not an automatic downgrade over new-format data.

## Resume and release checklist

1. Read current GitHub main/PR diff and progress. Inspect current staging and production function definitions and migration history; the application may have changed since this checkpoint. Do not blindly reapply SQL.
2. If resuming after a failure, inspect connector/migration state rather than reapplying blindly. Apply the versioned migration to the existing free isolated project. Run real PostgREST roster below/at/over cap, concurrent mutations, reductions, substitution lineup cap, altered direct payloads, best-of1/3/5 and invalid-even tests. Verify unauthorized/cross-league rejection and unchanged grants/locks/receipt behavior.
3. Run the existing full staging backend and persistent-access suites. Adapt the full browser suite to open League menu before clicking its management actions. Configure its creation settings to the new documented defaults and add real best-of1/3/5 clinch, import/reload/correction and second-device checks. The required patch is documented; no production requests are allowed during staging acceptance.
4. Complete remaining stats outcomes listed in STATS_AUDIT.md, checking lead-change pitcher decisions, close-margin ranks and manual-editor consistency against the now-added fixtures. Real backend/data integrity cannot be inferred from synthetic UI fixtures.
5. Run JavaScript syntax/whitespace, all Node tests, pinned dependency audit, full staging browser acceptance, and Supabase security/performance advisors. Save actual results and screenshots without codes.
6. Reverify targets and drift immediately before production. Save a private affected-data/schema backup; prepare raw-record fingerprint assertions and a fix-forward plan. Do not export credential/session material to GitHub.
7. Apply the tested compatible backend migration before merging frontend. Verify unchanged raw counts/data fingerprints and intended function permissions. No historical correction should run unless reconstructible inputs and a tested dry-run support it.
8. Merge only once all relevant gates pass. Use existing hosting, verify deployed commit and served hashes over HTTPS, run safe smoke checks with precisely labeled synthetic records, and clean up only those generated test records. Record any connector cleanup failure separately.

This app must not be labeled competition-ready until real backend and full E2E gates pass. No paid service, branch or infrastructure is required.
