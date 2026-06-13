import { Router } from "express";
import { and, eq } from "drizzle-orm";
import { randomUUID as uuid } from "node:crypto";
import { getDb } from "../db/connection";
import { authMiddleware } from "../middleware/auth";
import { sites } from "../db/schema";
import { bodyBoolean, bodyString, bodyStringArray } from "../utils/body";
import { queryActiveFilter, queryString } from "../utils/query";

export const sitesRouter = Router();

function normalizeSiteInput(body: unknown) {
  const source = (body ?? {}) as Record<string, unknown>;
  const siteCode = bodyString(source.siteCode, source.site_code)?.trim().toUpperCase();
  const siteName = bodyString(source.siteName, source.site_name)?.trim();
  const isDc = bodyBoolean(source.isDc, source.is_dc);
  const isActive = bodyBoolean(source.isActive, source.is_active);
  const invoicePrefix = bodyString(source.invoicePrefix, source.invoice_prefix)?.trim() || null;
  const address = bodyString(source.address)?.trim() || null;
  const shipToCode = bodyString(source.shipToCode, source.ship_to_code)?.trim() || null;
  const contactEmails = bodyStringArray(source.contactEmails, source.contact_emails);

  return { siteCode, siteName, isDc, isActive, invoicePrefix, address, shipToCode, contactEmails };
}

function buildSiteRecord(
  input: ReturnType<typeof normalizeSiteInput>,
  existing?: {
    siteCode: string;
    siteName: string;
    isDc: boolean;
    isActive: boolean;
    invoicePrefix: string | null;
    address: string | null;
    shipToCode: string | null;
    contactEmails: unknown;
  },
  overrides: { isActive?: boolean } = {},
) {
  return {
    siteCode: input.siteCode ?? existing?.siteCode ?? "",
    siteName: input.siteName ?? existing?.siteName ?? "",
    isDc: input.isDc ?? existing?.isDc ?? false,
    isActive: overrides.isActive ?? input.isActive ?? existing?.isActive ?? true,
    invoicePrefix: input.invoicePrefix !== undefined ? input.invoicePrefix : existing?.invoicePrefix ?? null,
    address: input.address !== undefined ? input.address : existing?.address ?? null,
    shipToCode: input.shipToCode !== undefined ? input.shipToCode : existing?.shipToCode ?? null,
    contactEmails: input.contactEmails !== undefined
      ? input.contactEmails
      : bodyStringArray(existing?.contactEmails) ?? [],
  };
}

async function saveSite(db: Awaited<ReturnType<typeof getDb>>, input: ReturnType<typeof normalizeSiteInput>) {
  if (!input.siteCode || !input.siteName) {
    return { ok: false as const, error: "Site code and site name are required." };
  }

  const existing = await db.query.sites.findFirst({
    where: eq(sites.siteCode, input.siteCode),
    columns: {
      id: true,
      siteCode: true,
      siteName: true,
      isDc: true,
      isActive: true,
      invoicePrefix: true,
      address: true,
      shipToCode: true,
      contactEmails: true,
    },
  });

  const values = {
    ...buildSiteRecord(input, existing, { isActive: true }),
    updatedAt: new Date(),
  };

  if (existing) {
    await db.update(sites).set(values).where(eq(sites.id, existing.id));
    return { ok: true as const, id: existing.id, created: false };
  }

  const id = uuid();
  await db.insert(sites).values({
    id,
    ...buildSiteRecord(input, undefined, { isActive: true }),
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return { ok: true as const, id, created: true };
}

sitesRouter.get("/", authMiddleware, async (req, res) => {
  const db = await getDb();
  const isActive = queryActiveFilter(req.query.is_active, true);
  const isDc = queryString(req.query.is_dc);

  let conditions = isActive === null ? undefined : eq(sites.isActive, isActive);
  if (isDc === "true") conditions = conditions ? and(conditions, eq(sites.isDc, true))! : eq(sites.isDc, true);
  if (isDc === "false") conditions = conditions ? and(conditions, eq(sites.isDc, false))! : eq(sites.isDc, false);

  const rows = await db.query.sites.findMany({
    where: conditions,
    orderBy: [sites.siteName],
  });
  res.json(rows);
});

sitesRouter.get("/dc", authMiddleware, async (req, res) => {
  const db = await getDb();
  const site = await db.query.sites.findFirst({
    where: and(eq(sites.isDc, true), eq(sites.isActive, true)),
  });
  res.json(site ?? null);
});

sitesRouter.get("/by-code/:code", authMiddleware, async (req, res) => {
  const db = await getDb();
  const code = queryString(req.params.code) ?? "";
  const site = await db.query.sites.findFirst({
    where: eq(sites.siteCode, code),
  });
  res.json(site ?? null);
});

sitesRouter.post("/", authMiddleware, async (req, res) => {
  const db = await getDb();
  const input = normalizeSiteInput(req.body);
  const result = await saveSite(db, input);
  if (!result.ok) {
    res.status(400).json({ error: result.error });
    return;
  }
  res.json({ id: result.id, created: result.created });
});

sitesRouter.post("/import", authMiddleware, async (req, res) => {
  const db = await getDb();
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
  const errors: string[] = [];
  let added = 0;
  let updated = 0;

  for (const [index, rawRow] of rows.entries()) {
    const input = normalizeSiteInput(rawRow);
    if (!input.siteCode || !input.siteName) {
      errors.push(`Row ${index + 1}: site code and site name are required.`);
      continue;
    }

    const result = await saveSite(db, input);
    if (!result.ok) {
      errors.push(`Row ${index + 1}: ${result.error}`);
      continue;
    }

    if (result.created) added += 1;
    else updated += 1;
  }

  res.json({
    added,
    updated,
    skipped: Math.max(rows.length - added - updated - errors.length, 0),
    errors,
  });
});

sitesRouter.get("/:id", authMiddleware, async (req, res) => {
  const db = await getDb();
  const id = queryString(req.params.id) ?? "";
  const site = await db.query.sites.findFirst({
    where: eq(sites.id, id),
  });
  if (!site) { res.status(404).json({ error: "Site not found" }); return; }
  res.json(site);
});

sitesRouter.put("/:id", authMiddleware, async (req, res) => {
  const db = await getDb();
  const id = queryString(req.params.id) ?? "";
  const input = normalizeSiteInput(req.body);
  const changes: Record<string, unknown> = { updatedAt: new Date() };

  if (input.siteName !== undefined) changes.siteName = input.siteName;
  if (input.isDc !== undefined) changes.isDc = input.isDc;
  if (input.isActive !== undefined) changes.isActive = input.isActive;
  if (input.invoicePrefix !== undefined) changes.invoicePrefix = input.invoicePrefix;
  if (input.address !== undefined) changes.address = input.address;
  if (input.shipToCode !== undefined) changes.shipToCode = input.shipToCode;
  if (input.contactEmails !== undefined) changes.contactEmails = input.contactEmails;

  await db.update(sites).set(changes).where(eq(sites.id, id));
  res.json({ ok: true });
});
