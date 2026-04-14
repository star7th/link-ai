import { PrismaClient } from '@prisma/client';

declare global {
  var prisma: PrismaClient | undefined;
}

export const prisma = global.prisma || new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
  global.prisma = prisma;
}

export async function initPrisma() {
  try {
    await prisma.$queryRaw`PRAGMA journal_mode=WAL`;
  } catch (error: any) {
    console.warn('WAL mode warning:', error.message);
  }
  try {
    await prisma.$queryRaw`PRAGMA synchronous=NORMAL`;
  } catch (error: any) {
    console.warn('Synchronous warning:', error.message);
  }
  try {
    await prisma.$queryRaw`PRAGMA cache_size=-64000`;
  } catch (error: any) {
    console.warn('Cache size warning:', error.message);
  }
  try {
    await prisma.$queryRaw`PRAGMA busy_timeout=5000`;
  } catch (error: any) {
    console.warn('Busy timeout warning:', error.message);
  }
}

export default prisma;
