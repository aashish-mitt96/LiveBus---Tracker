import { createId } from "@paralleldrive/cuid2";
import { boolean, json, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export type Stop = { lat: number; lng: number; stop_name: string };

export const trip = pgTable('trip', {

  tripId:      text('tripId').primaryKey().$defaultFn(() => createId()),

  bus_number:  text('bus_number').notNull(),
  source:      text('source').notNull(),
  destination: text('destination').notNull(),

  route:       json("route").$type<Stop[]>().notNull().default([]), // ✅ fixed

  status:      text("status").default("active").notNull(),
  current:     boolean("current").notNull().default(false),

  createdAt:   timestamp('created_at').defaultNow().notNull(),
  updatedAt:   timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
  endedAt:     timestamp("ended_at"),
});