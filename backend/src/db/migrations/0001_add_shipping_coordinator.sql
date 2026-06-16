ALTER TABLE transfers
  ADD COLUMN courier_name    VARCHAR(100) NULL AFTER fixably_series,
  ADD COLUMN tracking_number VARCHAR(100) NULL AFTER courier_name,
  ADD COLUMN booked_by       VARCHAR(36)  NULL AFTER tracking_number,
  ADD COLUMN booked_at       DATETIME     NULL AFTER booked_by,
  ADD COLUMN shipped_by      VARCHAR(36)  NULL AFTER booked_at,
  ADD COLUMN shipped_at      DATETIME     NULL AFTER shipped_by;

CREATE INDEX idx_transfers_tracking ON transfers(tracking_number);
