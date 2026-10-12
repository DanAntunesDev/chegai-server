import { randomUUID } from 'node:crypto';
import { Client } from 'pg';

const appUrl = process.env.DATABASE_URL ?? '';

async function withTenant<T>(client: Client, tenantId: string | null, run: () => Promise<T>) {
  await client.query('BEGIN');
  try {
    if (tenantId) {
      await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
    }
    const result = await run();
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

describe('tenant isolation (row level security)', () => {
  const client = new Client({ connectionString: appUrl });
  const tenantA = randomUUID();
  const tenantB = randomUUID();

  beforeAll(async () => {
    await client.connect();
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.bypass_rls', 'on', true)`);
    const plan = await client.query<{ id: string }>(`SELECT id FROM plans LIMIT 1`);
    for (const [id, slug] of [
      [tenantA, `rls-a-${tenantA.slice(0, 8)}`],
      [tenantB, `rls-b-${tenantB.slice(0, 8)}`],
    ]) {
      await client.query(
        `INSERT INTO tenants (id, slug, legal_name, display_name, email, plan_id, updated_at)
         VALUES ($1, $2::text, $2::text, $2::text, $2::text || '@test.local', $3, now())`,
        [id, slug, plan.rows[0].id],
      );
      await client.query(
        `INSERT INTO units (id, tenant_id, name, slug, updated_at) VALUES ($1, $2, 'Centro', 'centro', now())`,
        [randomUUID(), id],
      );
    }
    await client.query('COMMIT');
  });

  afterAll(async () => {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.bypass_rls', 'on', true)`);
    await client.query(`DELETE FROM tenants WHERE id = ANY($1::uuid[])`, [[tenantA, tenantB]]);
    await client.query('COMMIT');
    await client.end();
  });

  it('returns nothing when no tenant is set', async () => {
    const units = await withTenant(client, null, () => client.query(`SELECT id FROM units`));
    expect(units.rowCount).toBe(0);
  });

  it('only returns rows from the current tenant', async () => {
    const units = await withTenant(client, tenantA, () =>
      client.query<{ tenant_id: string }>(`SELECT tenant_id FROM units`),
    );
    expect(units.rows.map((row) => row.tenant_id)).toEqual([tenantA]);
  });

  it('blocks writes into another tenant', async () => {
    await expect(
      withTenant(client, tenantA, () =>
        client.query(
          `INSERT INTO units (id, tenant_id, name, slug, updated_at) VALUES ($1, $2, 'Invasão', 'invasao', now())`,
          [randomUUID(), tenantB],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
  });
});
