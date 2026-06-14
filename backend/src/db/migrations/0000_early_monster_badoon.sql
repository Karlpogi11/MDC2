CREATE TABLE `analytics_rows` (
	`id` varchar(36) NOT NULL,
	`upload_id` varchar(36) NOT NULL,
	`source_type` varchar(10) NOT NULL,
	`part_number` varchar(100) NOT NULL,
	`serial_number` varchar(255),
	`site_code` varchar(20),
	`used_at` timestamp,
	`qty` int NOT NULL DEFAULT 1,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `analytics_rows_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `analytics_uploads` (
	`id` varchar(36) NOT NULL,
	`source_type` varchar(10) NOT NULL,
	`file_name` text NOT NULL,
	`file_path` text NOT NULL,
	`uploaded_by` varchar(36) NOT NULL,
	`uploaded_at` timestamp NOT NULL DEFAULT (now()),
	`row_count` int NOT NULL DEFAULT 0,
	`status` varchar(20) DEFAULT 'completed',
	CONSTRAINT `analytics_uploads_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `app_config` (
	`key` varchar(100) NOT NULL,
	`value` text,
	`updated_by` varchar(36),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `app_config_key` PRIMARY KEY(`key`)
);
--> statement-breakpoint
CREATE TABLE `audit_logs` (
	`id` varchar(36) NOT NULL,
	`actor_id` varchar(36),
	`action` varchar(100) NOT NULL,
	`entity_type` varchar(100) NOT NULL,
	`entity_id` varchar(36),
	`old_value` json,
	`new_value` json,
	`note` text,
	`previous_hash` varchar(64),
	`hash` varchar(64),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `audit_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `feature_flags` (
	`key` varchar(100) NOT NULL,
	`enabled` boolean NOT NULL DEFAULT false,
	`roles` json,
	`description` text,
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	`updated_by` varchar(36),
	CONSTRAINT `feature_flags_key` PRIMARY KEY(`key`)
);
--> statement-breakpoint
CREATE TABLE `idempotency_keys` (
	`key` varchar(255) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`response` json,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`expires_at` timestamp NOT NULL,
	CONSTRAINT `idempotency_keys_key` PRIMARY KEY(`key`)
);
--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` varchar(36) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`type` varchar(50) NOT NULL,
	`title` text NOT NULL,
	`body` text,
	`entity_type` varchar(50),
	`entity_id` varchar(36),
	`read_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `notifications_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `packing_lists` (
	`id` varchar(36) NOT NULL,
	`transfer_id` varchar(36) NOT NULL,
	`file_path` text NOT NULL,
	`generated_by` varchar(36) NOT NULL,
	`generated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `packing_lists_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_packing_lists_transfer_id` UNIQUE(`transfer_id`)
);
--> statement-breakpoint
CREATE TABLE `parts` (
	`id` varchar(36) NOT NULL,
	`part_number` varchar(100) NOT NULL,
	`part_name` varchar(255) NOT NULL,
	`category` varchar(100),
	`part_type` varchar(20),
	`average_cost` decimal(12,2) DEFAULT '0.00',
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `parts_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_parts_part_number` UNIQUE(`part_number`)
);
--> statement-breakpoint
CREATE TABLE `physical_count_items` (
	`id` varchar(36) NOT NULL,
	`count_id` varchar(36) NOT NULL,
	`serial_id` varchar(36),
	`part_id` varchar(36) NOT NULL,
	`expected_status` varchar(20),
	`actual_status` varchar(20),
	`serial_number` text,
	`variance` varchar(20),
	`notes` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `physical_count_items_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `physical_counts` (
	`id` varchar(36) NOT NULL,
	`status` varchar(20) NOT NULL DEFAULT 'open',
	`notes` text,
	`created_by` varchar(36) NOT NULL,
	`reviewed_by` varchar(36),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`submitted_at` timestamp,
	`reviewed_at` timestamp,
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `physical_counts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `profiles` (
	`id` varchar(36) NOT NULL,
	`full_name` text,
	`email` varchar(255),
	`username` varchar(100),
	`role` varchar(20) NOT NULL DEFAULT 'dc_viewer',
	`is_active` boolean NOT NULL DEFAULT true,
	`force_password_change` boolean NOT NULL DEFAULT false,
	`password_hash` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `profiles_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `rate_limit_log` (
	`id` varchar(36) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`endpoint` varchar(100) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `rate_limit_log_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `report_jobs` (
	`id` varchar(36) NOT NULL,
	`type` varchar(50) NOT NULL DEFAULT 'weekly_digest',
	`schedule` varchar(100) NOT NULL DEFAULT '0 8 * * 1',
	`recipients` json NOT NULL,
	`is_active` boolean NOT NULL DEFAULT false,
	`last_run_at` timestamp,
	`created_by` varchar(36) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `report_jobs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `serial_corrections` (
	`id` varchar(36) NOT NULL,
	`transfer_id` varchar(36),
	`serial_id` varchar(36),
	`old_serial_number` text NOT NULL,
	`new_serial_number` varchar(255) NOT NULL,
	`reason` text NOT NULL,
	`corrected_by` varchar(36) NOT NULL,
	`corrected_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `serial_corrections_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_serial_corrections_new_serial` UNIQUE(`new_serial_number`)
);
--> statement-breakpoint
CREATE TABLE `serial_numbers` (
	`id` varchar(36) NOT NULL,
	`serial_number` varchar(255) NOT NULL,
	`part_id` varchar(36) NOT NULL,
	`current_site_id` varchar(36) NOT NULL,
	`status` varchar(20) NOT NULL DEFAULT 'in_stock',
	`stock_in_batch_id` varchar(36),
	`stock_in_at` timestamp NOT NULL DEFAULT (now()),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `serial_numbers_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_serial_numbers_serial` UNIQUE(`serial_number`)
);
--> statement-breakpoint
CREATE TABLE `sites` (
	`id` varchar(36) NOT NULL,
	`site_code` varchar(20) NOT NULL,
	`site_name` varchar(255) NOT NULL,
	`is_dc` boolean NOT NULL DEFAULT false,
	`is_active` boolean NOT NULL DEFAULT true,
	`address` text,
	`ship_to_code` varchar(50),
	`invoice_prefix` varchar(20),
	`contact_emails` json,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `sites_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_sites_site_code` UNIQUE(`site_code`)
);
--> statement-breakpoint
CREATE TABLE `stock_in_batches` (
	`id` varchar(36) NOT NULL,
	`source_type` varchar(10) NOT NULL DEFAULT 'manual',
	`source_file_name` text,
	`file_hash` varchar(255),
	`imported_by` varchar(36) NOT NULL,
	`imported_at` timestamp NOT NULL DEFAULT (now()),
	`total_rows` int NOT NULL DEFAULT 0,
	`success_rows` int NOT NULL DEFAULT 0,
	`failed_rows` int NOT NULL DEFAULT 0,
	CONSTRAINT `stock_in_batches_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_stock_in_batches_file_hash` UNIQUE(`file_hash`)
);
--> statement-breakpoint
CREATE TABLE `stock_in_items` (
	`id` varchar(36) NOT NULL,
	`batch_id` varchar(36) NOT NULL,
	`part_id` varchar(36) NOT NULL,
	`serial_id` varchar(36),
	`quantity` int NOT NULL DEFAULT 1,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `stock_in_items_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `transfer_emails` (
	`id` varchar(36) NOT NULL,
	`transfer_id` varchar(36) NOT NULL,
	`recipient_email` text NOT NULL,
	`status` varchar(20) NOT NULL DEFAULT 'pending',
	`attempt_count` int NOT NULL DEFAULT 0,
	`last_attempted_at` timestamp,
	`next_attempt_at` timestamp NOT NULL DEFAULT (now()),
	`error_detail` text,
	`sent_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `transfer_emails_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `transfer_items` (
	`id` varchar(36) NOT NULL,
	`transfer_id` varchar(36) NOT NULL,
	`part_id` varchar(36) NOT NULL,
	`serial_id` varchar(36),
	`qty` int NOT NULL DEFAULT 1,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `transfer_items_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `transfer_template_items` (
	`id` varchar(36) NOT NULL,
	`template_id` varchar(36) NOT NULL,
	`part_id` varchar(36) NOT NULL,
	`qty` int NOT NULL DEFAULT 1,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `transfer_template_items_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `transfer_templates` (
	`id` varchar(36) NOT NULL,
	`name` varchar(255) NOT NULL,
	`destination_site_id` varchar(36) NOT NULL,
	`schedule` varchar(100) NOT NULL DEFAULT '0 8 * * 1',
	`is_active` boolean NOT NULL DEFAULT true,
	`created_by` varchar(36) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `transfer_templates_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `transfers` (
	`id` varchar(36) NOT NULL,
	`transfer_no` varchar(50) NOT NULL,
	`invoice_ref` varchar(50),
	`fixably_series` varchar(50),
	`source_site_id` varchar(36) NOT NULL,
	`destination_site_id` varchar(36) NOT NULL,
	`status` varchar(20) NOT NULL DEFAULT 'draft',
	`requested_by` varchar(36) NOT NULL,
	`packed_by` varchar(36),
	`packed_at` timestamp,
	`receipt_token` varchar(255),
	`token_expires_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `transfers_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_transfers_transfer_no` UNIQUE(`transfer_no`)
);
--> statement-breakpoint
CREATE TABLE `webhooks` (
	`id` varchar(36) NOT NULL,
	`url` text NOT NULL,
	`secret` text NOT NULL,
	`events` json NOT NULL,
	`is_active` boolean NOT NULL DEFAULT true,
	`description` text,
	`created_by` varchar(36) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `webhooks_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `workflow_requests` (
	`id` varchar(36) NOT NULL,
	`type` varchar(50) NOT NULL,
	`status` varchar(20) NOT NULL DEFAULT 'pending',
	`entity_type` varchar(50) NOT NULL,
	`entity_id` varchar(36),
	`payload` json NOT NULL,
	`requested_by` varchar(36) NOT NULL,
	`reviewed_by` varchar(36),
	`review_note` text,
	`requested_at` timestamp NOT NULL DEFAULT (now()),
	`reviewed_at` timestamp,
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `workflow_requests_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_analytics_rows_part_site_date` ON `analytics_rows` (`part_number`,`site_code`,`used_at`);--> statement-breakpoint
CREATE INDEX `idx_analytics_rows_upload_id` ON `analytics_rows` (`upload_id`);--> statement-breakpoint
CREATE INDEX `idx_audit_logs_created_at` ON `audit_logs` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_audit_logs_entity` ON `audit_logs` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `idx_idempotency_keys_expires` ON `idempotency_keys` (`expires_at`);--> statement-breakpoint
CREATE INDEX `idx_notifications_user_unread` ON `notifications` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_parts_category` ON `parts` (`category`);--> statement-breakpoint
CREATE INDEX `idx_physical_count_items_count` ON `physical_count_items` (`count_id`);--> statement-breakpoint
CREATE INDEX `idx_profiles_email` ON `profiles` (`email`);--> statement-breakpoint
CREATE INDEX `idx_profiles_username` ON `profiles` (`username`);--> statement-breakpoint
CREATE INDEX `idx_rate_limit_log_user_endpoint` ON `rate_limit_log` (`user_id`,`endpoint`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_serial_numbers_part_id` ON `serial_numbers` (`part_id`);--> statement-breakpoint
CREATE INDEX `idx_serial_numbers_site_id` ON `serial_numbers` (`current_site_id`);--> statement-breakpoint
CREATE INDEX `idx_serial_numbers_status` ON `serial_numbers` (`status`);--> statement-breakpoint
CREATE INDEX `idx_transfer_emails_pending` ON `transfer_emails` (`next_attempt_at`);--> statement-breakpoint
CREATE INDEX `idx_transfer_emails_transfer` ON `transfer_emails` (`transfer_id`);--> statement-breakpoint
CREATE INDEX `idx_transfer_items_transfer_id` ON `transfer_items` (`transfer_id`);--> statement-breakpoint
CREATE INDEX `idx_transfer_items_part_id` ON `transfer_items` (`part_id`);--> statement-breakpoint
CREATE INDEX `idx_transfer_template_items_template` ON `transfer_template_items` (`template_id`);--> statement-breakpoint
CREATE INDEX `idx_transfers_invoice_ref` ON `transfers` (`invoice_ref`);--> statement-breakpoint
CREATE INDEX `idx_transfers_status` ON `transfers` (`status`);--> statement-breakpoint
CREATE INDEX `idx_workflow_pending` ON `workflow_requests` (`status`,`requested_at`);