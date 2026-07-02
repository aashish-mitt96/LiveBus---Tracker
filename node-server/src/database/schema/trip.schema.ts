import { route } from "./route.schema";
import { createId } from "@paralleldrive/cuid2";
import { pgTable, text, timestamp, boolean } from "drizzle-orm/pg-core";


// Stores details of each Bus Trip.
export const trip = pgTable("trip", {

  tripId:  text("tripId").primaryKey().$defaultFn(() => createId()),
  routeId: text("route_id").notNull().references(() => route.routeId),

  status:  text("status").default("active").notNull(),
  current: boolean("current").notNull().default(false),

  // Timestamps.
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().$onUpdate(() => new Date()).notNull(),
  endedAt:   timestamp("ended_at"),
  
});