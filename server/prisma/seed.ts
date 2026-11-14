// DB-15 — Idempotent local dev seed.
//
// Creates a demo tenant you can log into immediately: one Org + owner User
// (phone 9000000000) + Subscription + a 'website' Agent with a TrainingProfile
// and a couple of TrainingSource facts. Safe to run repeatedly — every write is
// a find-or-create / upsert keyed on a stable value, so re-running is a no-op.
//
// Run with:  npm run db:seed   (see package.json — "db:seed":"tsx prisma/seed.ts")
import bcrypt from 'bcryptjs';
import prisma from '../src/lib/prisma';

// Hard guard: this seed only ever touches a LOCAL dev DB. server/.env's
// DATABASE_URL points at the live Railway Postgres, so refuse the moment the URL
// looks like a managed/remote database rather than a local SQLite file.
const url = process.env.DATABASE_URL || '';
if (/postgres|railway|rlwy\.net|\.proxy\.|supabase|neon\.tech/i.test(url)) {
  throw new Error('[seed] refusing to seed a non-local database (DATABASE_URL looks like prod)');
}

// Stable demo identity — reused across runs so the seed stays idempotent.
const DEMO_PHONE = '9000000000';
const DEMO_PASSWORD = 'password123'; // dev-only credential; never used in prod
const DEMO_TOKEN = 'dev-demo-token-9000000000'; // fixed so re-seeding keeps one row
const AGENT_NAME = 'Demo Website Agent';

async function main() {
  // 1) Owner User (unique by phone) — carries the Org it belongs to.
  let user = await prisma.user.findUnique({ where: { phone: DEMO_PHONE } });
  if (!user) {
    const org = await prisma.org.create({ data: { name: 'Demo Workspace' } });
    user = await prisma.user.create({
      data: {
        orgId: org.id,
        phone: DEMO_PHONE,
        passwordHash: await bcrypt.hash(DEMO_PASSWORD, 10),
        token: DEMO_TOKEN,
        role: 'owner',
      },
    });
  }
  const orgId = user.orgId;

  // 2) Subscription (unique by orgId) — free plan, matches PLANS['free'].maxAgents.
  await prisma.subscription.upsert({
    where: { orgId },
    update: {},
    create: { orgId, plan: 'free', status: 'active', maxAgents: 10 },
  });

  // 3) Agent (no natural unique key → find-or-create by org + name).
  let agent = await prisma.agent.findFirst({ where: { orgId, name: AGENT_NAME } });
  if (!agent) {
    agent = await prisma.agent.create({
      data: { orgId, name: AGENT_NAME, channelType: 'website', status: 'draft' },
    });
  }

  // 4) TrainingProfile (unique by agentId).
  await prisma.trainingProfile.upsert({
    where: { agentId: agent.id },
    update: {},
    create: {
      agentId: agent.id,
      orgId,
      instructions: 'Answer questions about Secure Studio coworking in Warangal. Be warm and concise.',
    },
  });

  // 5) A couple of TrainingSource facts (find-or-create by agent + content).
  const facts = [
    'Secure Studio is a coworking and training space in Warangal, open 9am to 9pm.',
    'Day pass is ₹299; dedicated desks start at ₹4999/month. Fast Wi-Fi and meeting rooms included.',
  ];
  for (const content of facts) {
    const dataJson = JSON.stringify({ content });
    const existing = await prisma.trainingSource.findFirst({
      where: { agentId: agent.id, type: 'fact', dataJson },
    });
    if (!existing) {
      await prisma.trainingSource.create({ data: { agentId: agent.id, orgId, type: 'fact', dataJson } });
    }
  }

  // eslint-disable-next-line no-console
  console.log(`[seed] ok — org ${orgId}, user ${DEMO_PHONE}, agent "${AGENT_NAME}". Login token: ${DEMO_TOKEN}`);
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error('[seed] failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
