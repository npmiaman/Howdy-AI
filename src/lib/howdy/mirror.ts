/**
 * Dual-write mirror — "our own SQL DB".
 *
 * Every thread / message / brief written to Supabase is also written to a
 * second, independent Postgres (set MIRROR_DATABASE_URL). This is pure
 * redundancy: if Supabase is ever lost, the mirror holds the same rows with
 * the same UUIDs. All writes here are BEST-EFFORT — a mirror failure logs but
 * never breaks the primary path or the user's request.
 *
 * Works in production: point MIRROR_DATABASE_URL at any network-reachable
 * Postgres (Neon, a second Supabase, RDS, …). Locally it points at the
 * brew Postgres `howdy_mirror` database.
 */
import { Pool } from "pg";

let pool: Pool | null = null;
let initialized = false;

function getPool(): Pool | null {
  if (initialized) return pool;
  initialized = true;
  const url = process.env.MIRROR_DATABASE_URL;
  if (!url) return null;
  const isLocal = url.includes("localhost") || url.includes("127.0.0.1");
  pool = new Pool({
    connectionString: url,
    max: 3,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 5_000,
    // Hosted Postgres (Supabase/Neon/etc.) needs SSL; local doesn't.
    ssl: isLocal ? undefined : { rejectUnauthorized: false },
  });
  pool.on("error", (e) => console.error("[mirror] pool error:", e.message));
  return pool;
}

export function isMirrorConfigured(): boolean {
  return !!process.env.MIRROR_DATABASE_URL;
}

type ThreadLike = {
  id: string;
  gmail_thread_id: string | null;
  user_email: string;
  subject: string | null;
  brief?: unknown;
  last_processed_at?: string | null;
  created_at?: string;
  updated_at?: string;
};

export async function mirrorThread(row: ThreadLike): Promise<void> {
  const p = getPool();
  if (!p) return;
  try {
    await p.query(
      `insert into threads
         (id, gmail_thread_id, user_email, subject, brief, last_processed_at, created_at, updated_at)
       values ($1,$2,$3,$4,$5,$6, coalesce($7::timestamptz, now()), coalesce($8::timestamptz, now()))
       on conflict (id) do update set
         subject = excluded.subject,
         brief = excluded.brief,
         last_processed_at = excluded.last_processed_at,
         updated_at = excluded.updated_at,
         mirrored_at = now()`,
      [
        row.id,
        row.gmail_thread_id,
        row.user_email,
        row.subject,
        JSON.stringify(row.brief ?? {}),
        row.last_processed_at ?? null,
        row.created_at ?? null,
        row.updated_at ?? null,
      ],
    );
  } catch (e) {
    console.error("[mirror] thread write failed:", (e as Error).message);
  }
}

export async function mirrorMessage(row: {
  id: string;
  thread_id: string;
  role: string;
  content: string;
  gmail_message_id?: string | null;
  created_at?: string;
}): Promise<void> {
  const p = getPool();
  if (!p) return;
  try {
    await p.query(
      `insert into messages (id, thread_id, role, content, gmail_message_id, created_at)
       values ($1,$2,$3,$4,$5, coalesce($6::timestamptz, now()))
       on conflict (id) do nothing`,
      [
        row.id,
        row.thread_id,
        row.role,
        row.content,
        row.gmail_message_id ?? null,
        row.created_at ?? null,
      ],
    );
  } catch (e) {
    console.error("[mirror] message write failed:", (e as Error).message);
  }
}

export async function mirrorBrief(threadId: string, brief: unknown): Promise<void> {
  const p = getPool();
  if (!p) return;
  try {
    await p.query(
      `update threads set brief = $2, updated_at = now(), mirrored_at = now() where id = $1`,
      [threadId, JSON.stringify(brief ?? {})],
    );
  } catch (e) {
    console.error("[mirror] brief write failed:", (e as Error).message);
  }
}
