CREATE TYPE "public"."lab_attempt_status" AS ENUM('in_progress', 'finished');--> statement-breakpoint
CREATE TABLE "lab_attempt_commands" (
	"attempt_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"device" text NOT NULL,
	"input" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lab_attempt_commands_attempt_id_seq_pk" PRIMARY KEY("attempt_id","seq")
);
--> statement-breakpoint
CREATE TABLE "lab_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"lab_id" uuid NOT NULL,
	"status" "lab_attempt_status" DEFAULT 'in_progress' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"solved_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"success" boolean,
	"hints_used" integer DEFAULT 0 NOT NULL,
	"command_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "labs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"certification_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"domain_id" uuid NOT NULL,
	"subtopic_id" uuid NOT NULL,
	"difficulty" text NOT NULL,
	"title" text NOT NULL,
	"definition" jsonb NOT NULL,
	"status" "question_status" DEFAULT 'published' NOT NULL,
	"source" "question_source" DEFAULT 'manual' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "labs_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "lab_attempt_commands" ADD CONSTRAINT "lab_attempt_commands_attempt_id_lab_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."lab_attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_attempts" ADD CONSTRAINT "lab_attempts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_attempts" ADD CONSTRAINT "lab_attempts_lab_id_labs_id_fk" FOREIGN KEY ("lab_id") REFERENCES "public"."labs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "labs" ADD CONSTRAINT "labs_certification_id_certifications_id_fk" FOREIGN KEY ("certification_id") REFERENCES "public"."certifications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "labs" ADD CONSTRAINT "labs_domain_id_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "labs" ADD CONSTRAINT "labs_subtopic_id_subtopics_id_fk" FOREIGN KEY ("subtopic_id") REFERENCES "public"."subtopics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lab_attempts_user_idx" ON "lab_attempts" USING btree ("user_id","started_at");--> statement-breakpoint
CREATE INDEX "lab_attempts_lab_idx" ON "lab_attempts" USING btree ("lab_id","user_id");--> statement-breakpoint
CREATE INDEX "labs_cert_status_idx" ON "labs" USING btree ("certification_id","status");