ALTER TABLE "certifications" ADD COLUMN "last_imported_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "certifications" ADD COLUMN "last_import" jsonb;