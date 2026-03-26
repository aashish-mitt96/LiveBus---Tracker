import dotenv from "dotenv";
import { db } from "./dbConnection";
import { trip } from "./schema";

dotenv.config();

// Seed Data for Trips table.
const tripsData = [
  {
    bus_number: "OD-01-AB-1234",
    source: "Bhubaneswar",
    destination: "Puri",
    route: ["Bhubaneswar", "Pipili", "Puri"],
    status: "active",
  },
  {
    bus_number: "OD-02-CD-5678",
    source: "Cuttack",
    destination: "Sambalpur",
    route: ["Cuttack", "Angul", "Deogarh", "Sambalpur"],
    status: "active",
  },
  {
    bus_number: "OD-03-EF-9012",
    source: "Rourkela",
    destination: "Bhubaneswar",
    route: ["Rourkela", "Jharsuguda", "Angul", "Bhubaneswar"],
    status: "completed",
    endedAt: new Date(),
  },
];


// Seed Function.
async function seed() {
  try {
    console.log("Seeding database... ");
    await db.delete(trip);
    await db.insert(trip).values(tripsData);
    console.log("Seeding completed successfully... ");
  } catch (error) {
    console.error("Seeding failed... ", error);
  } finally {
    process.exit(0);
  }
}

seed();