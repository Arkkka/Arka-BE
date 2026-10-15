import 'dotenv/config';
import { createPrisma } from '../src/db/prisma.js';
import { GAME_RULES, ensureAllInstitutionGameRules } from '../src/game/rules.js';

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) throw new Error('DATABASE_URL is required to seed game rules.');

const prisma = createPrisma(databaseUrl);
try {
  const institutionCount = await ensureAllInstitutionGameRules(prisma);
  console.log(
    `Seeded ${GAME_RULES.length} active game rules for ${institutionCount} active institutions.`,
  );
} finally {
  await prisma.$disconnect();
}
