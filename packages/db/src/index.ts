import { PrismaClient, Prisma } from '@prisma/client';

declare global {
  // eslint-disable-next-line no-var
  var __afrohit_prisma: PrismaClient | undefined;
}

export const prisma =
  global.__afrohit_prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === 'production'
        ? ['error', 'warn']
        : ['query', 'error', 'warn'],
  });

if (process.env.NODE_ENV !== 'production') {
  global.__afrohit_prisma = prisma;
}

export { Prisma };
export * from '@prisma/client';
