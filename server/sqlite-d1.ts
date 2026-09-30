import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

type Row = Record<string, unknown>;
type BatchResult = {
  success: true;
  results: Row[];
  meta: { changes: number; last_row_id: number };
};

let database: DatabaseSync | undefined;

function connection(): DatabaseSync {
  if (database) return database;
  const dbPath = process.env.SITE_DB_PATH;
  if (!dbPath || !existsSync(dbPath)) {
    throw new Error('SITE_DB_PATH must point to the imported SQLite database');
  }
  database = new DatabaseSync(dbPath);
  database.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  return database;
}

class PreparedStatement {
  constructor(private readonly sql: string, private readonly parameters: unknown[] = []) {}

  bind(...parameters: unknown[]): PreparedStatement {
    return new PreparedStatement(this.sql, parameters);
  }

  async all(): Promise<BatchResult> {
    const results = connection().prepare(this.sql).all(...this.parameters) as Row[];
    return { success: true, results, meta: { changes: 0, last_row_id: 0 } };
  }

  async first(columnName?: string): Promise<unknown> {
    const row = connection().prepare(this.sql).get(...this.parameters) as Row | undefined;
    return columnName ? row?.[columnName] ?? null : row ?? null;
  }

  async raw(): Promise<unknown[][]> {
    const statement = connection().prepare(this.sql);
    statement.setReturnArrays(true);
    return statement.all(...this.parameters) as unknown[][];
  }

  async run(): Promise<BatchResult> {
    return this.executeBatch();
  }

  executeBatch(): BatchResult {
    const statement = connection().prepare(this.sql);
    if (statement.columns().length) {
      return {
        success: true,
        results: statement.all(...this.parameters) as Row[],
        meta: { changes: 0, last_row_id: 0 },
      };
    }
    const info = statement.run(...this.parameters);
    return {
      success: true,
      results: [],
      meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) },
    };
  }
}

class SQLiteD1 {
  prepare(sql: string): PreparedStatement {
    return new PreparedStatement(sql);
  }

  async batch(statements: PreparedStatement[]): Promise<BatchResult[]> {
    const db = connection();
    db.exec('BEGIN IMMEDIATE');
    try {
      const results = statements.map((statement) => statement.executeBatch());
      db.exec('COMMIT');
      return results;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
}

export const env = { DB: new SQLiteD1() as unknown as D1Database };
