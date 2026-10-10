# Setup and security backend checks

Real HTTPS PostgREST requests to isolated free staging only.

- PASS: Invalid settings, names, codes, markup and disallowed fields rejected through direct requests
- PASS: Empty atomic creation and simultaneous idempotent retries
- PASS: Saved empty roster and schedule with exact custom rules
- PASS: Creation recovery requires original device grant and cannot create records
- PASS: Forged, missing and substituted league access denied
- PASS: Team/player types, limits, duplicates, disallowed fields and cross-league writes rejected
- PASS: Save one team then remove last team without placeholders or schedule generation
- PASS: Backend blocks fabricated-team game start in empty league
- PASS: Second device sees persisted empty league
- PASS: Private tables, audit entries and old anonymous RPC routes are unavailable
- PASS: Leave revokes old token and recovery without affecting another device
- PASS: Code rotation revokes remembered devices and rejects old code
- PASS: Previous client creation payload remains compatible
- PASS: Creation limit enforced through direct API
- PASS: Client-supplied forwarded headers cannot bypass creation throttle
- PASS: Code-attempt throttle persists across direct requests and fresh tokens
