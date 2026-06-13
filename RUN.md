# How to Run

## Prerequisites

- XAMPP with MariaDB (port 3307, no password)
- Node.js 18+
- npm

---

## First Time Setup

### 1. Create database

```bash
mysql -u root -h 127.0.0.1 -P 3307 -e "CREATE DATABASE IF NOT EXISTS mdc"
```

### 2. Install dependencies

```bash
cd backend && npm install
cd .. && npm install
```

### 3. Push schema

```bash
cd backend && npx drizzle-kit push
```

### 4. Seed admin user

Start the backend first, then:

```bash
curl -X POST http://localhost:3001/api/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin123","email":"admin@mdc.local","fullName":"Administrator","role":"dc_admin"}'
```

Default login: `admin` / `admin123`

---

## Daily Dev Commands

Run in two separate terminals:

Run both backend (3001) and frontend (5173) together:

```bash
npm run dev:all
```

Or in two separate terminals:

```bash
# Terminal 1 — Backend
cd backend && npx tsx --env-file=.env src/index.ts
```

```bash
# Terminal 2 — Frontend
npx vite
```

Open `http://localhost:5173` and log in.
