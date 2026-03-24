import { Pool } from "pg";
import dotenv from "dotenv";
import * as schema from "./schema";
import { drizzle } from "drizzle-orm/node-postgres";

dotenv.config();

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE URL missing...");
}

const isNeon = process.env.DATABASE_URL.includes("neon.tech");
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isNeon ? { rejectUnauthorized: false } : false,
});

export const db = drizzle(pool, { schema });