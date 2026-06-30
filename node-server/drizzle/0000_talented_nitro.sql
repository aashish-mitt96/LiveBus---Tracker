CREATE TABLE "trip" (
	"tripId" text PRIMARY KEY NOT NULL,
	"bus_number" text NOT NULL,
	"source" text NOT NULL,
	"destination" text NOT NULL,
	"route" json DEFAULT '[]'::json NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"current" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"ended_at" timestamp
);
