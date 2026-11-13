import { PrismaClient } from '@prisma/client';

// One shared Prisma client for the process.
export const prisma = new PrismaClient();
export default prisma;
