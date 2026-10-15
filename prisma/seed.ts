import 'dotenv/config';
import { hash } from '@node-rs/argon2';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { SYSTEM_ROLES } from '../src/modules/access/permissions';

const connectionString = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('MIGRATION_DATABASE_URL or DATABASE_URL must be set to run the seed');
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

const plans = [
  {
    code: 'ESSENCIAL',
    name: 'Essencial',
    setupFeeCents: 69000,
    monthlyPriceCents: 14900,
    maxUnits: 1,
    maxBarbers: 3,
    maxReceptionists: 1,
    aiConversationsPerMonth: 0,
    features: ['public_booking', 'whatsapp_reminders', 'basic_dashboard'],
  },
  {
    code: 'PROFISSIONAL',
    name: 'Profissional',
    setupFeeCents: 99000,
    monthlyPriceCents: 22900,
    maxUnits: 1,
    maxBarbers: 8,
    maxReceptionists: 2,
    aiConversationsPerMonth: 300,
    features: [
      'public_booking',
      'whatsapp_reminders',
      'whatsapp_agent',
      'deposits',
      'waitlist',
      'custom_domain',
      'full_dashboard',
    ],
  },
  {
    code: 'REDE',
    name: 'Rede',
    setupFeeCents: 99000,
    monthlyPriceCents: 22900,
    extraUnitPriceCents: 9900,
    extraUnitSetupFeeCents: 29000,
    maxUnits: null,
    maxBarbers: null,
    maxReceptionists: null,
    aiConversationsPerMonth: 300,
    features: [
      'public_booking',
      'whatsapp_reminders',
      'whatsapp_agent',
      'deposits',
      'waitlist',
      'custom_domain',
      'full_dashboard',
      'unit_comparison',
      'hide_powered_by',
    ],
  },
];

async function seedPlans() {
  for (const plan of plans) {
    await prisma.plan.upsert({
      where: { code: plan.code },
      update: plan,
      create: plan,
    });
  }
}

async function seedPlatformAdmin() {
  const email = process.env.SEED_ADMIN_EMAIL ?? 'admin@chegai.local';
  const password = process.env.SEED_ADMIN_PASSWORD ?? 'chegai-admin-123';

  await prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      email,
      name: 'Super Admin',
      passwordHash: await hash(password),
      isPlatformAdmin: true,
    },
  });
}

async function seedDemoTenant() {
  const plan = await prisma.plan.findUniqueOrThrow({ where: { code: 'PROFISSIONAL' } });

  const tenant = await prisma.tenant.upsert({
    where: { slug: 'barbearia-demo' },
    update: {},
    create: {
      slug: 'barbearia-demo',
      legalName: 'Barbearia Demo LTDA',
      displayName: 'Barbearia Demo',
      email: 'contato@barbeariademo.com.br',
      phone: '+5538999990000',
      status: 'ACTIVE',
      planId: plan.id,
      branding: {
        create: {
          primaryColor: '#D62839',
          secondaryColor: '#1E4FD8',
        },
      },
      units: {
        create: {
          name: 'Centro',
          slug: 'centro',
          city: 'Montes Claros',
          state: 'MG',
        },
      },
    },
  });

  for (const role of SYSTEM_ROLES) {
    await prisma.role.upsert({
      where: { tenantId_key: { tenantId: tenant.id, key: role.key } },
      update: { name: role.name, permissions: [...role.permissions] },
      create: {
        tenantId: tenant.id,
        key: role.key,
        name: role.name,
        isSystem: true,
        permissions: [...role.permissions],
      },
    });
  }

  const ownerRole = await prisma.role.findUniqueOrThrow({
    where: { tenantId_key: { tenantId: tenant.id, key: 'OWNER' } },
  });

  const owner = await prisma.user.upsert({
    where: { email: 'dono@barbeariademo.com.br' },
    update: {},
    create: {
      email: 'dono@barbeariademo.com.br',
      name: 'Dono da Barbearia Demo',
      passwordHash: await hash('chegai-dono-123'),
    },
  });

  await prisma.membership.upsert({
    where: { tenantId_userId: { tenantId: tenant.id, userId: owner.id } },
    update: {},
    create: { tenantId: tenant.id, userId: owner.id, roleId: ownerRole.id },
  });
}

async function main() {
  await seedPlans();
  await seedPlatformAdmin();
  await seedDemoTenant();
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error: unknown) => {
    process.stderr.write(`${String(error)}\n`);
    await prisma.$disconnect();
    process.exit(1);
  });
