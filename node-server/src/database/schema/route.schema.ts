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
  createdAt:   timestamp("created_at").defaultNow().notNull(),
  
}, (t) => ({
  uniqSeq:  uniqueIndex("uniq_route_seq").on(t.routeId, t.seq),
  routeIdx: index("route_stop_route_idx").on(t.routeId),
  nameTrgm: index("route_stop_name_trgm_idx").using("gin", sql`${t.stopName} gin_trgm_ops`)
}));