"use strict";

let sqlClient;

async function getSql() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL must be set to use the Neon database.");
  }
  if (!sqlClient) {
    const { neon } = await import("@neondatabase/serverless");
    sqlClient = neon(process.env.DATABASE_URL);
  }
  return sqlClient;
}

async function initializeDatabase(emptyStore) {
  const sql = await getSql();
  await sql`
    CREATE TABLE IF NOT EXISTS steamsite_store (
      id smallint PRIMARY KEY CHECK (id = 1),
      version integer NOT NULL,
      data jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `;
  await sql`
    INSERT INTO steamsite_store (id, version, data)
    VALUES (1, 1, ${JSON.stringify(emptyStore)}::jsonb)
    ON CONFLICT (id) DO NOTHING
  `;
}

async function readDatabaseStore() {
  const sql = await getSql();
  const rows = await sql`
    SELECT data FROM steamsite_store WHERE id = 1
  `;
  if (rows.length !== 1) {
    throw new Error("The Neon JSON store has not been initialized.");
  }
  return rows[0].data;
}

async function updateDatabaseStore(update, clone) {
  const sql = await getSql();
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const rows = await sql`
      SELECT version, data FROM steamsite_store WHERE id = 1
    `;
    if (rows.length !== 1) {
      throw new Error("The Neon JSON store has not been initialized.");
    }

    const draft = clone(rows[0].data);
    const result = await update(draft);
    const saved = await sql`
      UPDATE steamsite_store
      SET data = ${JSON.stringify(draft)}::jsonb,
          version = version + 1,
          updated_at = now()
      WHERE id = 1 AND version = ${rows[0].version}
      RETURNING version
    `;
    if (saved.length === 1) {
      return result;
    }
  }
  throw new Error("The Neon store changed too frequently; please retry.");
}

module.exports = {
  initializeDatabase,
  readDatabaseStore,
  updateDatabaseStore
};
