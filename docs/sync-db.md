## Sync Remote Hostinger DB → Local MySQL

Only needed if you want to work offline without internet access.
Skip this if your .env already points to the Hostinger remote DB.

---

## Full Sync (Schema + Data)

```bash
# Pull from Hostinger
mysqldump -h srv1986.hstgr.io -P 3306 -u u774697221_mdc -p u774697221_mdc > ~/Downloads/remote_dump.sql

# Push to local MySQL
mysql -u root -p mdc < ~/Downloads/remote_dump.sql
```

---

## Schema Only

```bash
mysqldump -h srv1986.hstgr.io -P 3306 -u u774697221_mdc -p --no-data u774697221_mdc > ~/Downloads/remote_schema.sql
mysql -u root -p mdc < ~/Downloads/remote_schema.sql
```

---

## Data Only

```bash
mysqldump -h srv1986.hstgr.io -P 3306 -u u774697221_mdc -p --no-create-info u774697221_mdc > ~/Downloads/remote_data.sql
mysql -u root -p mdc < ~/Downloads/remote_data.sql
```

---

## Switch Back to Remote After Offline Work

Update `backend/.env`:
