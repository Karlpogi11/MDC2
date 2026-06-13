import {
  mysqlTable,
  varchar,
  text,
  timestamp,
  boolean,
  decimal,
  int,
  json,
  unique,
  index,
  primaryKey,
  customType,
} from "drizzle-orm/mysql-core";

const uuid = (name: string) => varchar(name, { length: 36 });

export const profiles = mysqlTable("profiles", {
  id: uuid("id").primaryKey(),
  fullName: text("full_name"),
  email: text("email"),
  username: varchar("username", { length: 100 }),
  role: varchar("role", { length: 20 }).notNull().default("dc_viewer"),
  isActive: boolean("is_active").notNull().default(true),
  forcePasswordChange: boolean("force_password_change").notNull().default(false),
  passwordHash: text("password_hash"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  emailIdx: index("idx_profiles_email").on(table.email),
  usernameIdx: index("idx_profiles_username").on(table.username),
}));

export const sites = mysqlTable("sites", {
  id: uuid("id").primaryKey(),
  siteCode: varchar("site_code", { length: 20 }).notNull(),
  siteName: varchar("site_name", { length: 255 }).notNull(),
  isDc: boolean("is_dc").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  address: text("address"),
  shipToCode: varchar("ship_to_code", { length: 50 }),
  invoicePrefix: varchar("invoice_prefix", { length: 20 }),
  contactEmails: json("contact_emails"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  siteCodeIdx: unique("uq_sites_site_code").on(table.siteCode),
}));

export const parts = mysqlTable("parts", {
  id: uuid("id").primaryKey(),
  partNumber: varchar("part_number", { length: 100 }).notNull(),
  partName: varchar("part_name", { length: 255 }).notNull(),
  category: varchar("category", { length: 100 }),
  partType: varchar("part_type", { length: 20 }),
  averageCost: decimal("average_cost", { precision: 12, scale: 2 }).default("0.00"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  partNumberIdx: unique("uq_parts_part_number").on(table.partNumber),
  categoryIdx: index("idx_parts_category").on(table.category),
}));

export const stockInBatches = mysqlTable("stock_in_batches", {
  id: uuid("id").primaryKey(),
  sourceType: varchar("source_type", { length: 10 }).notNull().default("manual"),
  sourceFileName: text("source_file_name"),
  fileHash: text("file_hash"),
  importedBy: uuid("imported_by").notNull(),
  importedAt: timestamp("imported_at").notNull().defaultNow(),
  totalRows: int("total_rows").notNull().default(0),
  successRows: int("success_rows").notNull().default(0),
  failedRows: int("failed_rows").notNull().default(0),
}, (table) => ({
  fileHashIdx: unique("uq_stock_in_batches_file_hash").on(table.fileHash),
}));

export const serialNumbers = mysqlTable("serial_numbers", {
  id: uuid("id").primaryKey(),
  serialNumber: varchar("serial_number", { length: 255 }).notNull(),
  partId: uuid("part_id").notNull(),
  currentSiteId: uuid("current_site_id").notNull(),
  status: varchar("status", { length: 20 }).notNull().default("in_stock"),
  stockInBatchId: uuid("stock_in_batch_id"),
  stockInAt: timestamp("stock_in_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  serialNumberIdx: unique("uq_serial_numbers_serial").on(table.serialNumber),
  partIdIdx: index("idx_serial_numbers_part_id").on(table.partId),
  siteIdIdx: index("idx_serial_numbers_site_id").on(table.currentSiteId),
  statusIdx: index("idx_serial_numbers_status").on(table.status),
}));

export const stockInItems = mysqlTable("stock_in_items", {
  id: uuid("id").primaryKey(),
  batchId: uuid("batch_id").notNull(),
  partId: uuid("part_id").notNull(),
  serialId: uuid("serial_id"),
  quantity: int("quantity").notNull().default(1),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const transfers = mysqlTable("transfers", {
  id: uuid("id").primaryKey(),
  transferNo: varchar("transfer_no", { length: 50 }).notNull(),
  invoiceRef: varchar("invoice_ref", { length: 50 }),
  fixablySeries: varchar("fixably_series", { length: 50 }),
  sourceSiteId: uuid("source_site_id").notNull(),
  destinationSiteId: uuid("destination_site_id").notNull(),
  status: varchar("status", { length: 20 }).notNull().default("draft"),
  requestedBy: uuid("requested_by").notNull(),
  packedBy: uuid("packed_by"),
  packedAt: timestamp("packed_at"),
  receiptToken: varchar("receipt_token", { length: 255 }),
  tokenExpiresAt: timestamp("token_expires_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  transferNoIdx: unique("uq_transfers_transfer_no").on(table.transferNo),
  invoiceRefIdx: index("idx_transfers_invoice_ref").on(table.invoiceRef),
  statusIdx: index("idx_transfers_status").on(table.status),
}));

export const transferItems = mysqlTable("transfer_items", {
  id: uuid("id").primaryKey(),
  transferId: uuid("transfer_id").notNull(),
  partId: uuid("part_id").notNull(),
  serialId: uuid("serial_id"),
  qty: int("qty").notNull().default(1),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  transferIdIdx: index("idx_transfer_items_transfer_id").on(table.transferId),
  partIdIdx: index("idx_transfer_items_part_id").on(table.partId),
}));

export const packingLists = mysqlTable("packing_lists", {
  id: uuid("id").primaryKey(),
  transferId: uuid("transfer_id").notNull(),
  filePath: text("file_path").notNull(),
  generatedBy: uuid("generated_by").notNull(),
  generatedAt: timestamp("generated_at").notNull().defaultNow(),
}, (table) => ({
  transferIdIdx: unique("uq_packing_lists_transfer_id").on(table.transferId),
}));

export const serialCorrections = mysqlTable("serial_corrections", {
  id: uuid("id").primaryKey(),
  transferId: uuid("transfer_id"),
  serialId: uuid("serial_id"),
  oldSerialNumber: text("old_serial_number").notNull(),
  newSerialNumber: text("new_serial_number").notNull(),
  reason: text("reason").notNull(),
  correctedBy: uuid("corrected_by").notNull(),
  correctedAt: timestamp("corrected_at").notNull().defaultNow(),
}, (table) => ({
  newSerialIdx: unique("uq_serial_corrections_new_serial").on(table.newSerialNumber),
}));

export const analyticsUploads = mysqlTable("analytics_uploads", {
  id: uuid("id").primaryKey(),
  sourceType: varchar("source_type", { length: 10 }).notNull(),
  fileName: text("file_name").notNull(),
  filePath: text("file_path").notNull(),
  uploadedBy: uuid("uploaded_by").notNull(),
  uploadedAt: timestamp("uploaded_at").notNull().defaultNow(),
  rowCount: int("row_count").notNull().default(0),
  status: varchar("status", { length: 20 }).default("completed"),
});

export const analyticsRows = mysqlTable("analytics_rows", {
  id: uuid("id").primaryKey(),
  uploadId: uuid("upload_id").notNull(),
  sourceType: varchar("source_type", { length: 10 }).notNull(),
  partNumber: varchar("part_number", { length: 100 }).notNull(),
  serialNumber: varchar("serial_number", { length: 255 }),
  siteCode: varchar("site_code", { length: 20 }),
  usedAt: timestamp("used_at"),
  qty: int("qty").notNull().default(1),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  partSiteDateIdx: index("idx_analytics_rows_part_site_date").on(table.partNumber, table.siteCode, table.usedAt),
  uploadIdIdx: index("idx_analytics_rows_upload_id").on(table.uploadId),
}));

export const auditLogs = mysqlTable("audit_logs", {
  id: uuid("id").primaryKey(),
  actorId: uuid("actor_id"),
  action: varchar("action", { length: 100 }).notNull(),
  entityType: varchar("entity_type", { length: 100 }).notNull(),
  entityId: uuid("entity_id"),
  oldValue: json("old_value"),
  newValue: json("new_value"),
  note: text("note"),
  previousHash: varchar("previous_hash", { length: 64 }),
  hash: varchar("hash", { length: 64 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  createdAtIdx: index("idx_audit_logs_created_at").on(table.createdAt),
  entityIdx: index("idx_audit_logs_entity").on(table.entityType, table.entityId),
}));

export const appConfig = mysqlTable("app_config", {
  key: varchar("key", { length: 100 }).primaryKey(),
  value: text("value"),
  updatedBy: uuid("updated_by"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const featureFlags = mysqlTable("feature_flags", {
  key: varchar("key", { length: 100 }).primaryKey(),
  enabled: boolean("enabled").notNull().default(false),
  roles: json("roles"),
  description: text("description"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  updatedBy: uuid("updated_by"),
});

export const notifications = mysqlTable("notifications", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id").notNull(),
  type: varchar("type", { length: 50 }).notNull(),
  title: text("title").notNull(),
  body: text("body"),
  entityType: varchar("entity_type", { length: 50 }),
  entityId: uuid("entity_id"),
  readAt: timestamp("read_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  userUnreadIdx: index("idx_notifications_user_unread").on(table.userId, table.createdAt),
}));

export const workflowRequests = mysqlTable("workflow_requests", {
  id: uuid("id").primaryKey(),
  type: varchar("type", { length: 50 }).notNull(),
  status: varchar("status", { length: 20 }).notNull().default("pending"),
  entityType: varchar("entity_type", { length: 50 }).notNull(),
  entityId: uuid("entity_id"),
  payload: json("payload").notNull(),
  requestedBy: uuid("requested_by").notNull(),
  reviewedBy: uuid("reviewed_by"),
  reviewNote: text("review_note"),
  requestedAt: timestamp("requested_at").notNull().defaultNow(),
  reviewedAt: timestamp("reviewed_at"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  pendingIdx: index("idx_workflow_pending").on(table.status, table.requestedAt),
}));

export const physicalCounts = mysqlTable("physical_counts", {
  id: uuid("id").primaryKey(),
  status: varchar("status", { length: 20 }).notNull().default("open"),
  notes: text("notes"),
  createdBy: uuid("created_by").notNull(),
  reviewedBy: uuid("reviewed_by"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  submittedAt: timestamp("submitted_at"),
  reviewedAt: timestamp("reviewed_at"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const physicalCountItems = mysqlTable("physical_count_items", {
  id: uuid("id").primaryKey(),
  countId: uuid("count_id").notNull(),
  serialId: uuid("serial_id"),
  partId: uuid("part_id").notNull(),
  expectedStatus: varchar("expected_status", { length: 20 }),
  actualStatus: varchar("actual_status", { length: 20 }),
  serialNumber: text("serial_number"),
  variance: varchar("variance", { length: 20 }),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  countIdIdx: index("idx_physical_count_items_count").on(table.countId),
}));

export const webhooks = mysqlTable("webhooks", {
  id: uuid("id").primaryKey(),
  url: text("url").notNull(),
  secret: text("secret").notNull(),
  events: json("events").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  description: text("description"),
  createdBy: uuid("created_by").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const reportJobs = mysqlTable("report_jobs", {
  id: uuid("id").primaryKey(),
  type: varchar("type", { length: 50 }).notNull().default("weekly_digest"),
  schedule: varchar("schedule", { length: 100 }).notNull().default("0 8 * * 1"),
  recipients: json("recipients").notNull(),
  isActive: boolean("is_active").notNull().default(false),
  lastRunAt: timestamp("last_run_at"),
  createdBy: uuid("created_by").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const transferTemplates = mysqlTable("transfer_templates", {
  id: uuid("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  destinationSiteId: uuid("destination_site_id").notNull(),
  schedule: varchar("schedule", { length: 100 }).notNull().default("0 8 * * 1"),
  isActive: boolean("is_active").notNull().default(true),
  createdBy: uuid("created_by").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const transferTemplateItems = mysqlTable("transfer_template_items", {
  id: uuid("id").primaryKey(),
  templateId: uuid("template_id").notNull(),
  partId: uuid("part_id").notNull(),
  qty: int("qty").notNull().default(1),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  templateIdIdx: index("idx_transfer_template_items_template").on(table.templateId),
}));

export const transferEmails = mysqlTable("transfer_emails", {
  id: uuid("id").primaryKey(),
  transferId: uuid("transfer_id").notNull(),
  recipientEmail: text("recipient_email").notNull(),
  status: varchar("status", { length: 20 }).notNull().default("pending"),
  attemptCount: int("attempt_count").notNull().default(0),
  lastAttemptedAt: timestamp("last_attempted_at"),
  nextAttemptAt: timestamp("next_attempt_at").notNull().defaultNow(),
  errorDetail: text("error_detail"),
  sentAt: timestamp("sent_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  pendingIdx: index("idx_transfer_emails_pending").on(table.nextAttemptAt),
  transferIdx: index("idx_transfer_emails_transfer").on(table.transferId),
}));

export const idempotencyKeys = mysqlTable("idempotency_keys", {
  key: varchar("key", { length: 255 }).primaryKey(),
  userId: uuid("user_id").notNull(),
  response: json("response"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  expiresAt: timestamp("expires_at").notNull(),
}, (table) => ({
  expiresIdx: index("idx_idempotency_keys_expires").on(table.expiresAt),
}));

export const rateLimitLog = mysqlTable("rate_limit_log", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id").notNull(),
  endpoint: varchar("endpoint", { length: 100 }).notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  userEndpointIdx: index("idx_rate_limit_log_user_endpoint").on(table.userId, table.endpoint, table.createdAt),
}));

// ── Relations ──────────────────────────────────────────────────────
import { relations } from "drizzle-orm";

export const profilesRelations = relations(profiles, ({ many }) => ({
  stockInBatches: many(stockInBatches),
  transfersRequested: many(transfers, { relationName: "requested_by" }),
  transfersPacked: many(transfers, { relationName: "packed_by" }),
}));

export const serialNumbersRelations = relations(serialNumbers, ({ one }) => ({
  part: one(parts, { fields: [serialNumbers.partId], references: [parts.id] }),
  site: one(sites, { fields: [serialNumbers.currentSiteId], references: [sites.id] }),
  batch: one(stockInBatches, { fields: [serialNumbers.stockInBatchId], references: [stockInBatches.id] }),
}));

export const transferItemsRelations = relations(transferItems, ({ one }) => ({
  transfer: one(transfers, { fields: [transferItems.transferId], references: [transfers.id] }),
  part: one(parts, { fields: [transferItems.partId], references: [parts.id] }),
  serial: one(serialNumbers, { fields: [transferItems.serialId], references: [serialNumbers.id] }),
}));

export const transfersRelations = relations(transfers, ({ one, many }) => ({
  sourceSite: one(sites, { fields: [transfers.sourceSiteId], references: [sites.id] }),
  destinationSite: one(sites, { fields: [transfers.destinationSiteId], references: [sites.id] }),
  requestedByProfile: one(profiles, { fields: [transfers.requestedBy], references: [profiles.id], relationName: "requested_by" }),
  packedByProfile: one(profiles, { fields: [transfers.packedBy], references: [profiles.id], relationName: "packed_by" }),
  items: many(transferItems),
  packingList: one(packingLists),
}));

export const stockInBatchesRelations = relations(stockInBatches, ({ one }) => ({
  operator: one(profiles, { fields: [stockInBatches.importedBy], references: [profiles.id] }),
}));

export const physicalCountsRelations = relations(physicalCounts, ({ many }) => ({
  items: many(physicalCountItems),
}));

export const physicalCountItemsRelations = relations(physicalCountItems, ({ one }) => ({
  count: one(physicalCounts, { fields: [physicalCountItems.countId], references: [physicalCounts.id] }),
}));

export const transferTemplatesRelations = relations(transferTemplates, ({ many, one }) => ({
  destinationSite: one(sites, { fields: [transferTemplates.destinationSiteId], references: [sites.id] }),
  items: many(transferTemplateItems),
}));

export const transferTemplateItemsRelations = relations(transferTemplateItems, ({ one }) => ({
  template: one(transferTemplates, { fields: [transferTemplateItems.templateId], references: [transferTemplates.id] }),
  part: one(parts, { fields: [transferTemplateItems.partId], references: [parts.id] }),
}));

export const auditLogsRelations = relations(auditLogs, ({ one }) => ({
  actor: one(profiles, { fields: [auditLogs.actorId], references: [profiles.id] }),
}));

export const analyticsUploadsRelations = relations(analyticsUploads, ({ one }) => ({
  uploader: one(profiles, { fields: [analyticsUploads.uploadedBy], references: [profiles.id] }),
}));

export const notificationsRelations = relations(notifications, ({ one }) => ({
  user: one(profiles, { fields: [notifications.userId], references: [profiles.id] }),
}));

export const workflowRequestsRelations = relations(workflowRequests, ({ one }) => ({
  requester: one(profiles, { fields: [workflowRequests.requestedBy], references: [profiles.id] }),
  reviewer: one(profiles, { fields: [workflowRequests.reviewedBy], references: [profiles.id] }),
}));
