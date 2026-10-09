# Browser acceptance evidence

First run: https://github.com/Tingbing/wiffle-ball-league/actions/runs/37970006788
Commit: a4c08d7b5943fed25b5985f814e0fd99494dec59
Result: SUCCESS, 11 browser acceptance checks and 12 Node tests.
Runtime: standard GitHub-hosted Ubuntu 24.04; Node 24; Playwright 1.64.0; Chromium 156.
Synthetic staging backend only. No production HTTP requests, no uncaught browser exceptions.
Desktop 1280×900; separate mobile context 390×844 with touch enabled.

- Public directory, pagination and private screen gate
- Custom three-team creation and validated access
- Roster and seven-week odd-team schedule persistence
- Reload restores scoped state
- Phone wrong/correct code and main-menu width
- Two devices have one recorder and read-only viewing
- Scoring, error/undo and three-out progression
- Handoff disables former recorder
- Phone completion persists game settings and stats
- Scored-season settings lock and reloaded statistics
- Code rotation revokes both sessions and explicit leave survives reload

The private HTTPS preview deployment succeeded separately. Browser checks served the exact development source through an isolated test server on the Actions runner; they do not establish the native private hosting login flow or remote HTTPS preview routing. No screenshots were captured in this first run. Additional required browser cases are being added; this first successful run alone is not the full release gate.

Extended run: https://github.com/Tingbing/wiffle-ball-league/actions/runs/37970694022
Commit: 6ed77aadbe1b2cbc3a1caf4b9205ae7a497451cf
Result: SUCCESS, 20 browser acceptance checks and 12 Node tests. Added verified game-only substitutions, pitcher changes, server-accepted/lost-acknowledgment recovery without duplicate scoring, offline/reconnect, saved box scores and rankings, keyboard directory opening, delayed former-league responses, back/forward navigation, simultaneous browser Start, and natural one-inning/one-out overtime completion. Zero production requests and uncaught browser exceptions. Remaining directory error/no-results, keyboard form validation and same-device multiple-tab checks prepared for a final run.

Final run: https://github.com/Tingbing/wiffle-ball-league/actions/runs/37971240292
Commit: b03c5694f35792b41146769f59caded836994e71
Result: SUCCESS, 23 browser checks and 12 Node tests. Additional checks passed for directory no-results/network error/Retry, keyboard form navigation with server-side code validation, and distinct recorder identities in multiple tabs sharing the same remembered grant. All previously extended cases passed again. No production requests or uncaught browser exceptions.

Production release: PR #3 merged as fb7107559b5f4a5408dec90b451bf2ffaf49f02b. GitHub Pages deployment https://github.com/Tingbing/wiffle-ball-league/actions/runs/37972202632 succeeded. Six deployed app files match the tested source by SHA-256. Eight non-destructive production HTTP checks passed: minimal directory plus rejection of legacy/forged reads, forged edits and legacy private table/view paths. Exact original-value preservation was verified after production migration. The cloud browser's final live observation was restricted by credential protection; no successful live visual inspection or authenticated owner workflow is claimed. The owner completes the one-time setup outside the agent browser.

Permanent-access release: https://github.com/Tingbing/wiffle-ball-league/actions/runs/37996482810
Commit: e90be83ad81a72323aaddca8703d3c3e86681749
Result: SUCCESS, 27 browser checks and 12 Node tests. All prior acceptance cases passed again. New checks cover automatic last-league reopening with an old locally expired grant, failure retaining access with code-free Retry, new tabs in the same browser profile, and deliberate directory switching preserving access. Explicit leave removes the grant and last-league preference, survives reload, and a direct league link then requires the code again. Code rotation still revokes both devices. Zero production requests or uncaught exceptions.

PR #4 merged as 61b0f215152f24ece1db6add23e18008f1bdce43. The owner reported the live app works and production confirms the one-time setup was consumed. Automated staging acceptance and live source/security checks are distinct from an agent-authenticated production UI session.
