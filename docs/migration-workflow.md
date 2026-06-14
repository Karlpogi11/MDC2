## First Time on a New Machine

```bash
cd backend
npm run db:migrate
```

## Schema Changes (after editing schema.ts)

### On the machine where you changed schema.ts:
```bash
cd backend
npm run db:generate
git add src/db/migrations/
git commit -m "migration: describe the change"
git push
```

### On your other machine:
```bash
git pull
cd backend
npm run db:migrate
```

## Restore Data to Hostinger (if needed)

```bash
mysql -h srv1986.hstgr.io -P 3306 -u u774697221_mdc -p u774697221_mdc --force < /path/to/dump.sql
```

## Quick Reference

| Situation | Command |
|---|---|
| First time setup | `npm run db:migrate` |
| After editing schema.ts | `npm run db:generate` → commit → push |
| Apply schema on other machine | `git pull` → `npm run db:migrate` |
| Restore data | `mysql ... --force < dump.sql` |

## Notes
- Never run `db:push` — always use `db:generate` + `db:migrate`
- Always commit `src/db/migrations/` to git
- Remote DB: `srv1986.hstgr.io` — data syncs automatically across machines
