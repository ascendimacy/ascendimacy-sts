#!/usr/bin/env node
/**
 * apply-parent-seed — aplica SQL seed em motor-state.db ANTES do scenario rodar.
 *
 * Razão: kids_parent_decisions schema requer session_id+content_id UNIQUE.
 * Pra family-wide preferences, usamos sentinel session_id "family:<persona>".
 * Motor-execucao DDL é idempotente (CREATE IF NOT EXISTS) — seed pode rodar
 * antes do motor mesmo, criando o DB do zero com as tabelas necessárias.
 *
 * Usage:
 *   node scripts/apply-parent-seed.mjs <sql_path> <db_path>
 */

import Database from "better-sqlite3";
import { readFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";

const sqlPath = process.argv[2];
const dbPath = process.argv[3];

if (!sqlPath || !dbPath) {
  console.error("Usage: apply-parent-seed.mjs <sql_path> <db_path>");
  process.exit(1);
}
if (!existsSync(sqlPath)) {
  console.error(`SQL seed not found: ${sqlPath}`);
  process.exit(1);
}

mkdirSync(dirname(dbPath), { recursive: true });
const db = new Database(dbPath);
const sql = readFileSync(sqlPath, "utf-8");
db.exec(sql);

const counts = db
  .prepare(
    "SELECT session_id, COUNT(*) as n FROM kids_parent_decisions GROUP BY session_id ORDER BY session_id",
  )
  .all();
const total = db.prepare("SELECT COUNT(*) as n FROM kids_parent_decisions").get();

console.log(`✓ Seed applied to ${dbPath}`);
console.log(`  Total kids_parent_decisions rows: ${total.n}`);
for (const c of counts) {
  console.log(`  ${c.session_id}: ${c.n} decisions`);
}
db.close();
