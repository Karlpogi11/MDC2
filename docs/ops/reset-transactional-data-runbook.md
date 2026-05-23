# Reset Transactional Data Runbook

This operation intentionally deletes transactional inventory records and must not live as a ready-to-run SQL script in the app tree.

Use it only for a pre-go-live staging reset after all of these are true:

- The target Supabase project has been confirmed as non-production.
- A database backup has been taken.
- The reset has written approval from the system owner.
- The operator has pasted the target project ref into the change ticket.

Keep the actual SQL in the approved change ticket or password manager note for the reset window, then remove it after the operation. Do not commit executable reset SQL to `main`.
