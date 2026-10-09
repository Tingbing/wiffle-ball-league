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
