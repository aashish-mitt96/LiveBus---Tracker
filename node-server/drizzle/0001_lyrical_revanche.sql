CREATE TABLE "route" (
	"routeId" text PRIMARY KEY NOT NULL,
	"bus_number" text NOT NULL,
	"source" text NOT NULL,
	"destination" text NOT NULL,
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
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "trip" ADD COLUMN "route_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "route_stop" ADD CONSTRAINT "route_stop_route_id_route_routeId_fk" FOREIGN KEY ("route_id") REFERENCES "public"."route"("routeId") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_bus_source_dest" ON "route" USING btree ("bus_number","source","destination");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_route_seq" ON "route_stop" USING btree ("route_id","seq");--> statement-breakpoint
CREATE INDEX "route_stop_route_idx" ON "route_stop" USING btree ("route_id");--> statement-breakpoint
CREATE INDEX "route_stop_name_trgm_idx" ON "route_stop" USING gin ("stop_name" gin_trgm_ops);--> statement-breakpoint
ALTER TABLE "trip" ADD CONSTRAINT "trip_route_id_route_routeId_fk" FOREIGN KEY ("route_id") REFERENCES "public"."route"("routeId") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip" DROP COLUMN "bus_number";--> statement-breakpoint
ALTER TABLE "trip" DROP COLUMN "source";--> statement-breakpoint
ALTER TABLE "trip" DROP COLUMN "destination";--> statement-breakpoint
ALTER TABLE "trip" DROP COLUMN "route";