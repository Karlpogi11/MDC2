# How to Run

## Prerequisites

- XAMPP with MariaDB (port 3307, no password)
- Node.js 18+
- npm

## 1. Database

Start XAMPP MariaDB and create the database:

```bash
mysql -u root -h 127.0.0.1 -P 3307 -e "CREATE DATABASE IF NOT EXISTS mdc"
```

Then push the Drizzle schema:

```bash
cd backend
npx drizzle-kit push
```

Seed the admin user via the register API. First start the backend (step 2), then run:

```bash
curl -X POST http://localhost:3001/api/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin123","email":"admin@mdc.local","fullName":"Administrator","role":"dc_admin"}'
```

Default credentials: `admin` / `admin123`

## 2. Backend (port 3001)

```bash
cd backend
npx tsx --env-file=.env src/index.ts
```

## 3. Frontend (port 5173)

In a separate terminal, from the project root:

```bash
npm install
npx vite
```

## 4. Login

Open `http://localhost:5173` and log in with `admin` / `admin123`.
