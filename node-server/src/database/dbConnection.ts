import { Pool } from "pg";
import dotenv from "dotenv";
import * as schema from "./schema";
import { drizzle } from "drizzle-orm/node-postgres";

dotenv.config(); 


if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE URL Missing.");
}

// Enable SSL only for Neon PostgreSQL.
const isNeon = process.env.DATABASE_URL.includes("neon.tech");

// Create a PostgreSQL connection Pool.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isNeon ? { rejectUnauthorized: false } : false,
});

// Initialize Drizzle ORM with PostgreSQL Pool.
export const db = drizzle(pool, { schema });