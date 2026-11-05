import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { Db } from './db';

export async function migrate(db: Db, log = console.log) {
  await db.query(`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
  const dir = join(__dirname, 'migrations');
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const done = new Set((await db.query<{ name: string }>('SELECT name FROM schema_migrations')).map((r) => r.name));
  for (const f of files) {
    if (done.has(f)) continue;
    const sql = readFileSync(join(dir, f), 'utf8');
    await db.tx(async (c) => {
      await c.query(sql);
      await c.query('INSERT INTO schema_migrations(name) VALUES ($1)', [f]);
    });
    log(`applied ${f}`);
  }
}

if (require.main === module) {
  const db = new Db(process.env.DATABASE_URL ?? 'postgres://madar:madar@localhost:5432/madar');
  migrate(db)
    .then(() => db.close())
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
