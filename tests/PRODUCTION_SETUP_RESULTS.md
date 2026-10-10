# Production smoke checks

A single clearly named synthetic league only; original data checked inside the migration transaction.

- PASS: Minimal live directory
- PASS: Forged and legacy production access denied
- PASS: Private production tables and views inaccessible
- PASS: Empty live league, exact settings and permanent creator access
- PASS: Live idempotency and original-token recovery
- PASS: Team/player addition inside live league
- PASS: Second live device sees saved team
- PASS: Live device revocation
