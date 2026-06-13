---
title: Deployment Guide — Hostinger + GitHub Actions
tags:
  - deployment
  - hostinger
  - github-actions
  - database
date: 2026-06-13
aliases:
  - How to Deploy
  - Hostinger Setup
---

# MDC Deployment Guide

This guide walks you through deploying the app to **Hostinger** and setting up automatic deployments whenever you push to `main`.

---

## What You'll Need

| Item | Notes |
|---|---|
| Hostinger account | Any plan with Node.js + SSH support (Business / Cloud / VPS) |
| Custom domain (optional) | Pointed to Hostinger nameservers |
| GitHub repository | Your code already pushed here |
| SSH key pair | Used to connect GitHub → Hostinger |
| MySQL database | Created via Hostinger's hPanel (phpMyAdmin) |

---

## Part 1: Hostinger Server Setup

### 1.1 Create a MySQL Database

1. Log in to your **Hostinger hPanel**
2. Go to **MySQL Databases**
3. Create a new database (e.g. `u123456789_mdc`)
4. Create a database user and note the **host** (usually `localhost` or `127.0.0.1`)
5. Note down the full connection URL:
   ```
   mysql://username:password@host:3306/database_name
   ```

Keep this URL — you'll need it as `DATABASE_URL` in production.

### 1.2 Enable SSH Access

1. In hPanel, go to **SSH Access**
2. Enable SSH for your account
3. Upload your **public SSH key** or use a password

### 1.3 Upload Your Public Key to Hostinger

If you don't have an SSH key yet, generate one:

```bash
# On your local machine (Git Bash / WSL / macOS / Linux)
ssh-keygen -t ed25519 -C "github-deploy"
cat ~/.ssh/id_ed25519.pub
```

Copy the output and paste it into Hostinger's **SSH Keys** section in hPanel.

### 1.4 Set Up Node.js

SSH into your server to verify and set up:

```bash
ssh username@your-server-ip

# Check Node.js version (Hostinger usually has it pre-installed)
node -v   # should be 18 or higher

# Install pm2 globally for process management
npm install -g pm2
```

If Node.js is not available, use Hostinger's **Node.js** section in hPanel to select a version.

### 1.5 Prepare Directory Structure

```bash
# Create the deployment folder (adjust path as needed)
mkdir -p ~/domains/mydomain.com/public_html
```

---

## Part 2: GitHub Secrets Setup

In your GitHub repository, go to **Settings → Secrets and variables → Actions** and add these:

| Secret Name | What to Put | Example |
|---|---|---|
| `HOSTINGER_HOST` | Your server IP or domain | `185.224.138.71` or `mydomain.com` |
| `HOSTINGER_USER` | Your Hostinger SSH username | `u123456789` |
| `HOSTINGER_SSH_KEY` | Your **private** SSH key (the whole file) | starts with `-----BEGIN OPENSSH PRIVATE KEY-----` |
| `HOSTINGER_PATH` | Deploy target folder on server | `/home/u123456789/domains/mydomain.com/public_html` |
| `PROD_DATABASE_URL` | Production MySQL connection string | `mysql://user:pass@localhost:3306/u123456789_mdc` |

> **SSH Key Tip:** When pasting `HOSTINGER_SSH_KEY`, include the full key including the `-----BEGIN` and `-----END` lines.

---

## Part 3: How Database Migrations Work

We use **Drizzle ORM**. Schema changes are handled like this:

### On Your Dev Machine (Local)

```bash
# 1. Edit the schema file
#    backend/src/db/schema.ts

# 2. Generate migration SQL files
cd backend
npm run db:generate

# 3. Push to your local DB to test
npm run db:push

# 4. Commit the new migration files
git add src/db/migrations/
git commit -m "add column x to sites table"
git push
```

### On Production (Auto via Deploy)

The deploy workflow runs `npm run db:migrate` on the server, which applies any pending migration files safely — no risk of data loss.

> **Never run `npm run db:push` on production.** It can drop columns or data. Always use `db:generate` + `db:migrate`.

---

## Part 4: Automatic Deployment (CI/CD)

### How It Works

Every time you push to the `main` branch:

1. GitHub Actions builds the frontend + backend
2. Files are uploaded to your Hostinger server via SSH
3. Production dependencies are installed
4. Database migrations are applied
5. The backend process is restarted (pm2)

### Trigger a Deploy

```bash
git checkout main
git add .
git commit -m "your changes"
git push
```

That's it. The deploy runs automatically.

### Check Deploy Status

1. Go to your repo on GitHub
2. Click the **Actions** tab
3. You'll see the "Deploy to Hostinger" workflow running
4. ✅ green = success | ❌ red = click into it to see what failed

---

## Part 5: First-Time Deployment (Manual)

Before relying on auto-deploy, do a manual first deploy to set things up:

### 5.1 Build Locally

```bash
# Frontend
npm ci --legacy-peer-deps
npm run build

# Backend
cd backend
npm ci --legacy-peer-deps
npm run build
```

### 5.2 Upload via SFTP

Use **FileZilla** (or any SFTP client):

| Field | Value |
|---|---|
| Host | Your server IP or domain |
| Username | Your Hostinger SSH username |
| Password | (SSH key or password) |
| Port | 22 |

Upload these folders/files to `HOSTINGER_PATH`:

```
dist/                    →  /public_html/dist/
backend/dist/            →  /public_html/backend/dist/
backend/package.json     →  /public_html/backend/package.json
backend/package-lock.json → /public_html/backend/package-lock.json
backend/src/db/migrations/ → /public_html/backend/src/db/migrations/
public/.htaccess         →  /public_html/.htaccess
```

### 5.3 Install & Start on Server

```bash
ssh username@your-server-ip
cd ~/domains/mydomain.com/public_html/backend

# Install production deps only
npm ci --omit=dev --legacy-peer-deps

# Create .env file
cat > .env << EOF
DATABASE_URL=mysql://user:pass@localhost:3306/u123456789_mdc
JWT_SECRET=<generate-a-strong-random-string>
PORT=3001
CORS_ORIGIN=https://mydomain.com
EOF

# Apply migrations
npx drizzle-kit migrate

# Start with pm2
pm2 start dist/index.js --name mdc-backend
pm2 save
```

> Generate a JWT secret: `openssl rand -hex 32`

### 5.4 Set Up Domain (Optional)

In Hostinger hPanel:
1. Go to **Hosted Domain**
2. Click **Manage** on your domain
3. Set **Document Root** to `public_html/dist`
4. Set up a **subdomain** or **Node.js app** pointing to the backend port (3001)

---

## Part 6: Quick Reference

### Commands Summary

| What | Command | Where |
|---|---|---|
| Generate migration files | `npm run db:generate` | `backend/` (your machine) |
| Push schema to local DB | `npm run db:push` | `backend/` (dev only) |
| Apply migrations to prod | `npm run db:migrate` | `backend/` (server) |
| Build frontend | `npm run build` | root (your machine) |
| Build backend | `npm run build` | `backend/` (your machine) |
| Check DB schema drift | `npm run db:check` | `backend/` |
| Deploy to production | `git push` (to main) | anywhere |

### File Locations After Deploy

```
/public_html/
├── dist/                  ← Frontend (served by Apache/Nginx)
├── backend/
│   ├── dist/              ← Compiled backend code
│   ├── node_modules/      ← Production deps
│   ├── package.json
│   ├── .env               ← Production env vars
│   └── src/db/migrations/ ← Migration SQL files
└── .htaccess              ← SPA routing fallback
```

---

## Troubleshooting

| Symptom | Likely Fix |
|---|---|
| Deploy workflow fails at SSH step | Check `HOSTINGER_HOST`, `HOSTINGER_USER`, and `HOSTINGER_SSH_KEY` secrets |
| Backend won't start | SSH into server and run `cd backend && node dist/index.js` to see the error |
| "Cannot connect to database" | Check `DATABASE_URL` and that MySQL host allows remote connections (try `127.0.0.1`) |
| Frontend shows blank page | Check browser console — likely CORS. Verify `CORS_ORIGIN` in backend `.env` |
| 404 on page refresh | Make sure `.htaccess` is in the frontend root with the SPA rewrite rule |
| Migration fails | SSH in and run `cd backend && DATABASE_URL="..." npx drizzle-kit migrate --verbose` |
