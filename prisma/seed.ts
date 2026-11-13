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

  await seedDemoOperation(tenant.id);
}

const DEMO_SERVICES = [
  { category: 'Cabelo', name: 'Corte', priceCents: 4500, durationMinutes: 30 },
  { category: 'Cabelo', name: 'Corte degradê', priceCents: 5000, durationMinutes: 40 },
  { category: 'Barba', name: 'Barba', priceCents: 3500, durationMinutes: 30 },
  { category: 'Combos', name: 'Corte + barba', priceCents: 7500, durationMinutes: 60 },
  { category: 'Cabelo', name: 'Sobrancelha', priceCents: 1500, durationMinutes: 10 },
];

const DEMO_BARBERS = ['Rafael', 'Bruno', 'Thiago'];

const DEMO_CUSTOMERS = [
  { name: 'João Pereira', phone: '+5538991110001', tags: ['vip'] },
  { name: 'Lucas Martins', phone: '+5538991110002', tags: [] },
  { name: 'Pedro Alves', phone: '+5538991110003', tags: ['barba'] },
  { name: 'Gabriel Souza', phone: '+5538991110004', tags: [] },
  { name: 'Matheus Rocha', phone: '+5538991110005', tags: ['vip', 'mensal'] },
];

async function seedDemoOperation(tenantId: string) {
  if ((await prisma.service.count({ where: { tenantId } })) > 0) {
    return;
  }
  const unit = await prisma.unit.findFirstOrThrow({ where: { tenantId, slug: 'centro' } });

  const categories = new Map<string, string>();
  for (const [position, name] of ['Cabelo', 'Barba', 'Combos'].entries()) {
    const category = await prisma.serviceCategory.create({ data: { tenantId, name, position } });
    categories.set(name, category.id);
  }

  const services = [];
  for (const [position, item] of DEMO_SERVICES.entries()) {
    services.push(
      await prisma.service.create({
        data: {
          tenantId,
          categoryId: categories.get(item.category),
          name: item.name,
          priceCents: item.priceCents,
          durationMinutes: item.durationMinutes,
          bufferMinutes: 5,
          position,
        },
      }),
    );
  }

  for (const name of DEMO_BARBERS) {
    const staff = await prisma.staff.create({
      data: { tenantId, name, kind: 'BARBER', units: { create: { unitId: unit.id, tenantId } } },
    });
    const days = name === 'Thiago' ? [2, 3, 4, 5, 6] : [1, 2, 3, 4, 5, 6];
    await prisma.workingHours.createMany({
      data: days.flatMap((weekday) => [
        { tenantId, staffId: staff.id, unitId: unit.id, weekday, startMinute: 540, endMinute: 720 },
        {
          tenantId,
          staffId: staff.id,
          unitId: unit.id,
          weekday,
          startMinute: 780,
          endMinute: weekday === 6 ? 960 : 1140,
        },
      ]),
    });
    await prisma.staffService.createMany({
      data: services.map((service) => ({ tenantId, staffId: staff.id, serviceId: service.id })),
    });
  }

  await prisma.customer.createMany({
    data: DEMO_CUSTOMERS.map((customer) => ({ tenantId, ...customer })),
  });

  await seedDemoBookings(tenantId, unit.id);
}

const DEMO_SLOTS = ['09:00', '10:15', '14:00', '15:15', '16:30', '17:45'];

function localDate(offsetDays: number) {
  const now = new Date(Date.now() - 3 * 3600_000 + offsetDays * 86_400_000);
  return now.toISOString().slice(0, 10);
}

async function seedDemoBookings(tenantId: string, unitId: string) {
  const staff = await prisma.staff.findMany({ where: { tenantId }, orderBy: { name: 'asc' } });
  const services = await prisma.service.findMany({
    where: { tenantId },
    orderBy: { position: 'asc' },
  });
  const customers = await prisma.customer.findMany({
    where: { tenantId },
    orderBy: { name: 'asc' },
  });
  let counter = 0;

  for (let offset = -30; offset <= 2; offset += 1) {
    const date = localDate(offset);
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    if (weekday === 0) {
      continue;
    }
    for (const [staffIndex, member] of staff.entries()) {
      for (const [slotIndex, time] of DEMO_SLOTS.entries()) {
        counter += 1;
        if ((counter + staffIndex + Math.abs(offset)) % 3 === 0) {
          continue;
        }
        const service = services[(slotIndex + staffIndex) % services.length];
        const customer =
          customers[
            (((counter + offset * 7) % customers.length) + customers.length) % customers.length
          ];
        const startsAt = new Date(`${date}T${time}:00-03:00`);
        const endsAt = new Date(startsAt.getTime() + service.durationMinutes * 60_000);
        const past = endsAt.getTime() < Date.now();
        const status = past
          ? counter % 11 === 0
            ? 'NO_SHOW'
            : counter % 13 === 0
              ? 'CANCELED'
              : 'COMPLETED'
          : 'CONFIRMED';
        await prisma.booking.create({
          data: {
            tenantId,
            unitId,
            staffId: member.id,
            customerId: customer.id,
            status,
            source: counter % 4 === 0 ? 'WHATSAPP' : counter % 4 === 1 ? 'PUBLIC' : 'PANEL',
            startsAt,
            endsAt,
            blockedUntil: new Date(endsAt.getTime() + service.bufferMinutes * 60_000),
            totalPriceCents: service.priceCents,
            completedAt: status === 'COMPLETED' ? endsAt : null,
            canceledAt: status === 'CANCELED' ? startsAt : null,
            cancelReason: status === 'CANCELED' ? 'Cliente pediu para cancelar' : null,
            items: {
              create: {
                tenantId,
                serviceId: service.id,
                name: service.name,
                priceCents: service.priceCents,
                durationMinutes: service.durationMinutes,
              },
            },
          },
        });
      }
    }
  }
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
