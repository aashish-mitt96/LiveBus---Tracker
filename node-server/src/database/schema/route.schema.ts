import { sql } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { pgTable, text, timestamp, integer, doublePrecision, boolean, uniqueIndex, index } from "drizzle-orm/pg-core";



// Stores unique Bus Routes.
export const route = pgTable("route", {

  routeId: text("routeId").primaryKey().$defaultFn(() => createId()),

  bus_number:  text("bus_number").notNull(),
  source:      text("source").notNull(),
  destination: text("destination").notNull(),

  // Timestamps.
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().$onUpdate(() => new Date()).notNull(),

}, (t) => ({
  // Prevents Duplicate Routes for Same Bus
  uniqRoute: uniqueIndex("uniq_bus_source_dest").on(t.bus_number, t.source, t.destination)
}));



// Stores all Stops Belonging to a Route.
export const routeStop = pgTable("route_stop", {

  id:      text("id").primaryKey().$defaultFn(() => createId()),
  routeId: text("route_id").notNull().references(() => route.routeId, { onDelete: "cascade" }),

  seq:      doublePrecision("seq").notNull(),
  stopName: text("stop_name").notNull(),
  lat:      doublePrecision("lat").notNull(),
  lng:      doublePrecision("lng").notNull(),

  isTerminal:  boolean("is_terminal").notNull().default(false),
  sampleCount: integer("sample_count").notNull().default(1),

  // False only for a destination stop that was seeded with a placeholder
  // position at trip start (we only get one lat/lng from the client when a
  // trip begins, so a brand-new route's destination is provisionally set to
  // the same coordinates as the source until the trip ends and its real
  // position is learned — see refineDestinationCoords). Every other stop is
  // resolved=true from the moment it's created. Callers that build route
  // geometry (ETA, map rendering) should treat an unresolved destination as
  // "route not fully known yet" rather than trusting its coordinates.
  resolved: boolean("resolved").notNull().default(true),

  createdAt:   timestamp("created_at").defaultNow().notNull(),
  
}, (t) => ({
  uniqSeq:  uniqueIndex("uniq_route_seq").on(t.routeId, t.seq),
  routeIdx: index("route_stop_route_idx").on(t.routeId),
  nameTrgm: index("route_stop_name_trgm_idx").using("gin", sql`${t.stopName} gin_trgm_ops`)
}));



// Stores a running-average speed (m/s) between every consecutive stop pair
// on a route. Written by the Python predictor service (/model/train) after
// each trip ends; Node only reads this (e.g. as an ETA fallback, or to
// surface "typical segment speed" in the UI). One unique row per
// (routeId, fromStopId, toStopId) — running average is merged in-place as
// more trips complete, rather than overwritten.
export const routeSegmentSpeed = pgTable("route_segment_speed", {

  id:      text("id").primaryKey().$defaultFn(() => createId()),
  routeId: text("route_id").notNull().references(() => route.routeId, { onDelete: "cascade" }),

  fromStopId: text("from_stop_id").notNull().references(() => routeStop.id, { onDelete: "cascade" }),
  toStopId:   text("to_stop_id").notNull().references(() => routeStop.id, { onDelete: "cascade" }),

  avgSpeedMps: doublePrecision("avg_speed_mps").notNull(),
  sampleCount: integer("sample_count").notNull().default(0),

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().$onUpdate(() => new Date()).notNull(),

}, (t) => ({
  uniqSegment: uniqueIndex("uniq_route_segment").on(t.routeId, t.fromStopId, t.toStopId),
  routeIdx:    index("route_segment_speed_route_idx").on(t.routeId),
}));