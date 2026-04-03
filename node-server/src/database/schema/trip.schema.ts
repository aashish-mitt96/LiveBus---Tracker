import { createId } from "@paralleldrive/cuid2";
import { json,  pgTable, text, timestamp } from "drizzle-orm/pg-core";

// Represents a Single Bus Trip.
export const trip = pgTable('trip', {
  tripId:      text('tripId').primaryKey().$defaultFn(() => createId()),
  bus_number:  text('bus_number').notNull(),
  source:      text('source').notNull(),
  destination: text('destination').notNull(),
  route:       json("route").$type<string[]>().notNull().default([]),
  status:      text("status").default("active").notNull(),
  
  createdAt:   timestamp('created_at').defaultNow().notNull(),
  updatedAt:   timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
  endedAt:     timestamp("ended_at"),
})