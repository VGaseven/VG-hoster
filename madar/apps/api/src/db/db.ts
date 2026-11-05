import { Pool, PoolClient, QueryResultRow, types } from 'pg';

// نُبقي DATE وTIME كنصوص لتجنّب تحويلات المنطقة الزمنية الضمنية
types.setTypeParser(1082, (v) => v);
types.setTypeParser(1083, (v) => v);
// numeric -> number
types.setTypeParser(1700, (v) => Number(v));

export type Queryable = Pick<PoolClient, 'query'>;

export class Db {
  readonly pool: Pool;
  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString, max: 10 });
  }

  async query<T extends QueryResultRow = any>(sql: string, params: unknown[] = []): Promise<T[]> {
    const res = await this.pool.query<T>(sql, params as any[]);
    return res.rows;
  }

  async one<T extends QueryResultRow = any>(sql: string, params: unknown[] = []): Promise<T | undefined> {
    return (await this.query<T>(sql, params))[0];
  }

  /** ينفّذ الدالة داخل معاملة واحدة؛ أي خطأ يلغي كل التغييرات */
  async tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const out = await fn(client);
      await client.query('COMMIT');
      return out;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  close() {
    return this.pool.end();
  }
}

export const DB = Symbol('DB');
