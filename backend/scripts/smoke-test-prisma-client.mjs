import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const workspaceCountBefore = await prisma.workspace.count();
console.log('[smoke-test] Prisma Client (via @prisma/adapter-pg) connected. Existing workspace count:', workspaceCountBefore);

const user = await prisma.user.create({
  data: { email: `smoke-${Date.now()}@example.com`, fullName: 'Smoke Test User', passwordHash: 'x' },
});
console.log('[smoke-test] Created real user row:', user.id);

const fetched = await prisma.user.findUnique({ where: { id: user.id } });
console.log('[smoke-test] Re-fetched by id, matches:', fetched?.email === user.email);

await prisma.user.delete({ where: { id: user.id } });
console.log('[smoke-test] Cleanup delete OK. Prisma Client fully functional against PGlite via the pg driver adapter.');

await prisma.$disconnect();
