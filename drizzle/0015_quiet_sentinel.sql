-- Hand-written (the 0013/0014 pattern): webhook delivery columns for
-- watch_subscriptions. DuckDB ALTER ADD COLUMN cannot carry constraints,
-- so all three arrive nullable; the service layer owns the value
-- contract (webhook_url: URL string | null; webhook_status:
-- 'ok' | 'failed: <short reason>' | null; webhook_last_at: last
-- delivery attempt timestamp | null).
ALTER TABLE "watch_subscriptions" ADD COLUMN "webhook_url" text;--> statement-breakpoint
ALTER TABLE "watch_subscriptions" ADD COLUMN "webhook_status" text;--> statement-breakpoint
ALTER TABLE "watch_subscriptions" ADD COLUMN "webhook_last_at" "TIMESTAMP_MS";
