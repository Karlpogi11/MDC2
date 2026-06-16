ALTER TABLE `transfers` ADD `courier_name` varchar(100);--> statement-breakpoint
ALTER TABLE `transfers` ADD `tracking_number` varchar(100);--> statement-breakpoint
ALTER TABLE `transfers` ADD `booked_by` varchar(36);--> statement-breakpoint
ALTER TABLE `transfers` ADD `booked_at` timestamp;--> statement-breakpoint
ALTER TABLE `transfers` ADD `shipped_by` varchar(36);--> statement-breakpoint
ALTER TABLE `transfers` ADD `shipped_at` timestamp;--> statement-breakpoint
CREATE INDEX `idx_transfers_tracking` ON `transfers` (`tracking_number`);