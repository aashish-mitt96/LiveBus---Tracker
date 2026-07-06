CREATE TABLE "route" (
	"routeId" text PRIMARY KEY NOT NULL,
	"bus_number" text NOT NULL,
	"source" text NOT NULL,
	"destination" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "route_segment_speed" (
	"id" text PRIMARY KEY NOT NULL,
	"route_id" text NOT NULL,
	"from_stop_id" text NOT NULL,
	"to_stop_id" text NOT NULL,
	"avg_speed_mps" double precision NOT NULL,
	"sample_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "route_stop" (
	"id" text PRIMARY KEY NOT NULL,
	"route_id" text NOT NULL,
	"seq" double precision NOT NULL,
	"stop_name" text NOT NULL,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"is_terminal" boolean DEFAULT false NOT NULL,
	"sample_count" integer DEFAULT 1 NOT NULL,
	"resolved" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trip" (
	"tripId" text PRIMARY KEY NOT NULL,
	"route_id" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"current" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"ended_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "route_segment_speed" ADD CONSTRAINT "route_segment_speed_route_id_route_routeId_fk" FOREIGN KEY ("route_id") REFERENCES "public"."route"("routeId") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "route_segment_speed" ADD CONSTRAINT "route_segment_speed_from_stop_id_route_stop_id_fk" FOREIGN KEY ("from_stop_id") REFERENCES "public"."route_stop"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "route_segment_speed" ADD CONSTRAINT "route_segment_speed_to_stop_id_route_stop_id_fk" FOREIGN KEY ("to_stop_id") REFERENCES "public"."route_stop"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "route_stop" ADD CONSTRAINT "route_stop_route_id_route_routeId_fk" FOREIGN KEY ("route_id") REFERENCES "public"."route"("routeId") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip" ADD CONSTRAINT "trip_route_id_route_routeId_fk" FOREIGN KEY ("route_id") REFERENCES "public"."route"("routeId") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_bus_source_dest" ON "route" USING btree ("bus_number","source","destination");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_route_segment" ON "route_segment_speed" USING btree ("route_id","from_stop_id","to_stop_id");--> statement-breakpoint
CREATE INDEX "route_segment_speed_route_idx" ON "route_segment_speed" USING btree ("route_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_route_seq" ON "route_stop" USING btree ("route_id","seq");--> statement-breakpoint
CREATE INDEX "route_stop_route_idx" ON "route_stop" USING btree ("route_id");--> statement-breakpoint
CREATE INDEX "route_stop_name_trgm_idx" ON "route_stop" USING gin ("stop_name" gin_trgm_ops);