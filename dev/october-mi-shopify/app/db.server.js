import { PrismaClient } from "@prisma/client";

// Reuse a single PrismaClient across hot reloads in dev to avoid exhausting
// the connection pool. In production a fresh client is created per process.
const globalForPrisma = globalThis;

const prisma = globalForPrisma.prismaGlobal ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prismaGlobal = prisma;
}

export default prisma;
