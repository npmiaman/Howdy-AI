#!/usr/bin/env node
/**
 * Seed the mirror DB with all EXISTING Supabase data (threads + messages).
 *
 * The dual-write only mirrors rows touched after it's enabled. Run this once
 * after pointing MIRROR_DATABASE_URL at a fresh mirror so it holds the full
 * history, then the live dual-write keeps it current.
 *
 * Usage:  node scripts/mirror-backfill.cjs
 * Reads NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, MIRROR_DATABASE_URL
 * from .env.local.
 */
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

function readEnv() {
  const env = {};
  try {
    for (const line of fs
      .readFileSync(path.join(__dirname, "..", ".env.local"), "utf8")
      .split("\n")) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    /* ignore */
  }
  return { ...env, ...process.env };
}

async function fetchAll(url, key, table) {
  const rows = [];
  for (let off = 0; ; off += 1000) {
    const r = await fetch(
      `${url}/rest/v1/${table}?select=*&order=created_at&limit=1000&offset=${off}`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } },
    );
    if (!r.ok) throw new Error(`${table}: HTTP ${r.status}`);
    const batch = await r.json();
    rows.push(...batch);
    if (batch.length < 1000) break;
  }
  return rows;
}

(async () => {
  const env = readEnv();
  const { NEXT_PUBLIC_SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: key } = env;
  const mirrorUrl = env.MIRROR_DATABASE_URL;
  if (!url || !key || !mirrorUrl) {
    console.error("Need NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, MIRROR_DATABASE_URL");
    process.exit(1);
  }
  const isLocal = mirrorUrl.includes("localhost") || mirrorUrl.includes("127.0.0.1");
  const pool = new Pool({
    connectionString: mirrorUrl,
    ssl: isLocal ? undefined : { rejectUnauthorized: false },
  });

  const threads = await fetchAll(url, key, "threads");
  let t = 0;
  for (const r of threads) {
    await pool.query(
      `insert into threads (id, gmail_thread_id, user_email, subject, brief, last_processed_at, created_at, updated_at)
       values ($1,$2,$3,$4,$5,$6,coalesce($7::timestamptz,now()),coalesce($8::timestamptz,now()))
       on conflict (id) do update set subject=excluded.subject, brief=excluded.brief,
         last_processed_at=excluded.last_processed_at, updated_at=excluded.updated_at, mirrored_at=now()`,
      [r.id, r.gmail_thread_id, r.user_email, r.subject, JSON.stringify(r.brief ?? {}),
       r.last_processed_at ?? null, r.created_at ?? null, r.updated_at ?? null],
    );
    t++;
  }

  const messages = await fetchAll(url, key, "messages");
  let m = 0;
  for (const r of messages) {
    await pool.query(
      `insert into messages (id, thread_id, role, content, gmail_message_id, created_at)
       values ($1,$2,$3,$4,$5,coalesce($6::timestamptz,now())) on conflict (id) do nothing`,
      [r.id, r.thread_id, r.role, r.content, r.gmail_message_id ?? null, r.created_at ?? null],
    );
    m++;
  }

  const c = await pool.query("select (select count(*) from threads) t, (select count(*) from messages) m");
  console.log(`✓ Backfilled ${t} threads, ${m} messages.`);
  console.log(`  Mirror now holds ${c.rows[0].t} threads, ${c.rows[0].m} messages.`);
  await pool.end();
})().catch((e) => {
  console.error("BACKFILL FAILED:", e.message);
  process.exit(1);
});
