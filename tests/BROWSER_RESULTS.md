# Browser acceptance — 2026-10-10

Real isolated staging backend; desktop and 390px phone Chromium.

Run: https://github.com/Tingbing/wiffle-ball-league/actions/runs/38070496850
Tested commit: 265bbf993535a3b6265b347d4376817c69e8db3b
Screenshots: https://github.com/Tingbing/wiffle-ball-league/actions/runs/38070496850/artifacts/11676945809

- PASS: Phone wizard fits viewport; show/hide and Cancel discard draft without creation
- PASS: Public directory, cursor pagination and private screen gate
- PASS: Directory no-results and network-error states recover with Retry
- PASS: Two creation views, inline validation, Back preservation, no teams/code persistence or early writes
- PASS: Lost creation response recovers on refresh exactly once; empty league screens remain usable
- PASS: Teams added inside league one at a time; editing names persists safely
- PASS: Last league automatically reopens without a code, including old locally expired grants
- PASS: Failed reopening keeps saved access and Retry opens without asking for a code
- PASS: A new tab in the same device profile reopens the saved league
- PASS: Switch league keeps access and respects a deliberate return to the directory
- PASS: Roster edits and seven-week odd-team schedule persist
- PASS: Reload restores league-scoped roster, rules and schedule
- PASS: Phone code gate, successful join and main-menu width
- PASS: Game-only substitution survives server save and enters active roster
- PASS: Two devices show one recorder and a read-only phone viewer
- PASS: Two tabs sharing a remembered grant retain distinct recorder identities
- PASS: Pitcher change persists through scoring controls
- PASS: Lost acknowledgment pauses scoring/handoff; retry saves exactly once
- PASS: Offline browser pauses scoring and reconnect verifies ownership
- PASS: Browser scoring, error/undo and three-out half-inning progression
- PASS: Recorder handoff preserves game and disables former recorder
- PASS: Phone finishes game and persists immutable rules and season stats
- PASS: Phone box score and rankings render saved substitute and pitching lines
- PASS: Scored-season rules lock and persisted stats render after reload
- PASS: Synthetic backup restores through server; foreign-league, credential and markup imports rejected
- PASS: Code rotation revokes both sessions and device leave survives reload
- PASS: Directory search and keyboard Open restore a distinct second league
- PASS: Delayed former-league read is discarded; back/forward keeps caches isolated
- PASS: Simultaneous browser Start creates one game and one active recorder
- PASS: One-inning/one-out browser overtime and natural completion use snapshot rules

30 grouped checks passed. No production requests, uncaught browser exceptions or CSP violations.
