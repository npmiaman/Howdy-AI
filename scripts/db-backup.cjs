#!/usr/bin/env node
/**
 * Local SQL backup of the Supabase database.
 *
 * Pulls every table over the REST API (service key) and writes a self-contained
 * .sql file: the schema (concatenated migrations) followed by idempotent
 * `INSERT ... ON CONFLICT (id) DO NOTHING` statements for all current rows.
 * Restore onto a fresh Postgres with:  psql "$DB_URL" -f backups/<file>.sql
 *
 * Usage:  node scripts/db-backup.cjs
 * Reads NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from .env.local.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");

// --- read .env.local -------------------------------------------------------
function readEnv() {
  const env = {};
  try {
    const raw = fs.readFileSync(path.join(ROOT, ".env.local"), "utf8");
    for (const line of raw.split("\n")) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    /* fall through to process.env */
  }
  return { ...env, ...process.env };
}

// FK-safe order so a straight replay satisfies foreign keys.
const TABLES = [
  "freelancers",
  "threads",
  "leads",
  "memories",
  "aura_campaigns",
  "aura_vectors",
  "messages",
  "pending_matches",
  "match_candidates",
  "post_match_checkins",
  "aura_campaign_recipients",
];

function sqlVal(col, v) {
  if (v === null || v === undefined) return "NULL";
  if (col === "embedding") return `'${String(v).replace(/'/g, "''")}'::vector`;
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "NULL";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (Array.isArray(v)) {
    const inner = v
      .map((e) => '"' + String(e).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"')
      .join(",");
    return `'{${inner.replace(/'/g, "''")}}'`;
  }
  if (typeof v === "object")
    return `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`;
  return `'${String(v).replace(/'/g, "''")}'`;
}

async function fetchAll(url, key, table) {
  const rows = [];
  const PAGE = 1000;
  for (let offset = 0; ; offset += PAGE) {
    const res = await fetch(
      `${url}/rest/v1/${table}?select=*&order=id&limit=${PAGE}&offset=${offset}`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } },
    );
    if (res.status === 404) return null; // table doesn't exist
    if (!res.ok) throw new Error(`${table}: HTTP ${res.status} ${await res.text()}`);
    const batch = await res.json();
    rows.push(...batch);
    if (batch.length < PAGE) break;
  }
  return rows;
}

(async () => {
  const env = readEnv();
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const outDir = path.join(ROOT, "backups");
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `howdy-db-${stamp}.sql`);

  const parts = [];
  parts.push(`-- Howdy/Momo database backup`);
  parts.push(`-- generated: ${new Date().toISOString()}`);
  parts.push(`-- source:    ${url}`);
  parts.push(`-- restore:   psql "$DB_URL" -f ${path.basename(outFile)}\n`);

  // 1) schema — this DB is shared by Howdy and Momo, so concatenate BOTH
  // repos' migrations (Howdy tables + the aura_* automation tables).
  const migDirs = [
    path.join(ROOT, "supabase", "migrations"),
    path.join(ROOT, "..", "Aura", "supabase", "migrations"),
  ];
  parts.push(`-- ============ SCHEMA (Howdy + Momo migrations) ============`);
  for (const migDir of migDirs) {
    try {
      const files = fs
        .readdirSync(migDir)
        .filter((f) => f.endsWith(".sql"))
        .sort();
      parts.push(`\n-- ### from ${path.relative(ROOT, migDir)}`);
      for (const f of files) {
        parts.push(`\n-- >>> ${f}`);
        parts.push(fs.readFileSync(path.join(migDir, f), "utf8").trim());
      }
    } catch (e) {
      parts.push(`-- (could not read ${migDir}: ${e.message})`);
    }
  }

  // 2) data — one INSERT per row, idempotent.
  parts.push(`\n-- ============ DATA ============`);
  const summary = [];
  for (const table of TABLES) {
    const rows = await fetchAll(url, key, table);
    if (rows === null) {
      summary.push(`${table}: (absent, skipped)`);
      continue;
    }
    parts.push(`\n-- ${table} (${rows.length} rows)`);
    for (const row of rows) {
      const cols = Object.keys(row);
      const vals = cols.map((c) => sqlVal(c, row[c]));
      parts.push(
        `INSERT INTO ${table} (${cols.map((c) => `"${c}"`).join(", ")}) ` +
          `VALUES (${vals.join(", ")}) ON CONFLICT (id) DO NOTHING;`,
      );
    }
    summary.push(`${table}: ${rows.length} rows`);
  }

  fs.writeFileSync(outFile, parts.join("\n") + "\n");
  const kb = (fs.statSync(outFile).size / 1024).toFixed(1);
  console.log(`\n✓ Backup written: ${path.relative(ROOT, outFile)} (${kb} KB)`);
  console.log(summary.map((s) => "  " + s).join("\n"));
})().catch((e) => {
  console.error("BACKUP FAILED:", e.message);
  process.exit(1);
});
