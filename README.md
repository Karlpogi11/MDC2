# MDC Inventory System

Warehouse inventory management system for MobileCare Services Phils. Inc. — tracks serialized parts across DC and branch sites.

## Stack

- **Frontend:** React + Vite + TypeScript
- **Backend:** Express + Drizzle ORM + MySQL2
- **Database:** MySQL (Hostinger)
- **Auth:** JWT-based (email/password)

## Features

- **Stock In** — Upload CSV/XLSX or manually add serialized parts to inventory
- **Transfers** — Create, pack, dispatch, and receive transfers between DC and branch sites
- **Serial Tracking** — Full lifecycle per serial: stock-in → dispatch → receive → audit log
- **Inventory Dashboard** — Real-time counts by part: In Stock, Reserved, Stocked Out, Available
- **Packing Lists** — Generate PDF packing lists per transfer
- **Email Dispatch** — SMTP-based dispatch notifications with packing list attachment
- **Sites & Parts** — Manage DC/branch sites, parts catalog, categories
- **Audit Logs** — SHA-256 chained audit trail for all mutations
- **Reports** — Stock-in batches, analytics uploads, batch serials
- **Roles** — System Admin, DC Admin, DC Viewer

## Getting Started

### Backend

```bash
cd backend
cp .env.example .env
# edit .env with your DB credentials + SMTP settings
npm install
npm run dev
```

### Frontend

```bash
cp .env.example .env.local
# edit VITE_API_URL if needed (default: http://localhost:3001/api)
npm install
npm run dev
```

## Migration Workflow

See `docs/migration-workflow.md`.

## DB Sync (offline work)

See `docs/sync-db.md`.

## Environment Variables

See `backend/.env.example` and `.env.example` for all required variables.
