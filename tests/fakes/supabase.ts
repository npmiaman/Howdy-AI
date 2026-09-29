/**
 * In-memory stand-in for the Supabase (PostgREST) client. Implements only the
 * query-builder surface Howdy actually uses, with the same semantics that
 * matter for correctness: filters, `or()` expressions, ordering, limits,
 * single/maybeSingle, unique constraints (23505), upsert + ignoreDuplicates,
 * cascade deletes, and the `match_freelancers` vector RPC.
 */
import { randomUUID } from "node:crypto";

type Row = Record<string, unknown>;
type Filter = (r: Row) => boolean;
type PgError = { code: string; message: string };
type Result = {
  data: unknown;
  error: PgError | null;
  count?: number | null;
};

const UNIQUE: Record<string, string[][]> = {
  threads: [["gmail_thread_id"]],
  match_candidates: [["request_id", "freelancer_id"]],
  post_match_checkins: [["request_id", "candidate_id", "party", "round"]],
  freelancers: [["id"]],
  billable_intros: [["candidate_id"]],
  email_suppressions: [["email"]],
};

const DEFAULTS: Record<string, () => Row> = {
  pending_matches: () => ({
    phase: "matching",
    processed_at: null,
    matched_freelancer_id: null,
    reply_message_id: null,
    shortlist_sent_at: null,
    connect_after: null,
    subject: null,
  }),
  match_candidates: () => ({
    status: "queued",
    thread_id: null,
    rationale: null,
    confidence: null,
    outreach_thread_id: null,
    outreach_message_id: null,
    invited_at: null,
    responded_at: null,
    shown_to_client_at: null,
  }),
  post_match_checkins: () => ({
    status: "scheduled",
    candidate_id: null,
    round: 1,
    sentiment: null,
    feedback: null,
    checkin_thread_id: null,
    checkin_message_id: null,
    turns: 0,
    sent_at: null,
  }),
  threads: () => ({
    gmail_thread_id: null,
    subject: null,
    brief: {},
    last_processed_at: null,
    ai_paused: false,
    ai_mode_changed_at: null,
  }),
  messages: () => ({ gmail_message_id: null }),
  freelancers: () => ({ embedding: null }),
  freelancer_applications: () => ({ status: "pending", reviewed_at: null }),
  billable_intros: () => ({ invoiced_at: null, fee_usd: 50 }),
};

const CASCADE: Record<string, Array<{ table: string; fk: string }>> = {
  pending_matches: [
    { table: "match_candidates", fk: "request_id" },
    { table: "post_match_checkins", fk: "request_id" },
  ],
};

let seq = 0;
const clone = <T>(v: T): T => structuredClone(v);

function isIsoDate(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v);
}

function cmp(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a === null || a === undefined) return 1; // nulls last
  if (b === null || b === undefined) return -1;
  if (isIsoDate(a) && isIsoDate(b))
    return new Date(a).getTime() - new Date(b).getTime();
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a) < String(b) ? -1 : 1;
}

function eqv(a: unknown, b: unknown): boolean {
  if (isIsoDate(a) && isIsoDate(b))
    return new Date(a).getTime() === new Date(b).getTime();
  return String(a) === String(b);
}

function likeToRegex(pattern: string): RegExp {
  const esc = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*");
  return new RegExp(`^${esc}$`, "i");
}

function parseList(v: string): string[] {
  return v
    .replace(/^\(|\)$/g, "")
    .split(",")
    .map((s) => s.trim().replace(/^"|"$/g, ""));
}

function opFilter(col: string, op: string, value: unknown): Filter {
  switch (op) {
    case "eq":
      return (r) => eqv(r[col], value);
    case "neq":
      return (r) => !eqv(r[col], value);
    case "lt":
      return (r) => r[col] != null && cmp(r[col], value) < 0;
    case "lte":
      return (r) => r[col] != null && cmp(r[col], value) <= 0;
    case "gt":
      return (r) => r[col] != null && cmp(r[col], value) > 0;
    case "gte":
      return (r) => r[col] != null && cmp(r[col], value) >= 0;
    case "is":
      if (value === null || value === "null") return (r) => r[col] == null;
      return (r) => r[col] === (value === true || value === "true");
    case "ilike":
      return (r) => likeToRegex(String(value)).test(String(r[col] ?? ""));
    case "in": {
      const list = Array.isArray(value) ? value : parseList(String(value));
      return (r) => list.some((v) => eqv(r[col], v));
    }
    default:
      throw new Error(`fake supabase: unsupported op "${op}"`);
  }
}

function splitTopLevel(expr: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of expr) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (cur) parts.push(cur);
  return parts.map((p) => p.trim());
}

/** Parse a PostgREST logic expression, e.g. `a.eq.1,and(b.eq.2,c.is.null)`. */
function parseLogic(expr: string, mode: "or" | "and"): Filter {
  const terms = splitTopLevel(expr).map((t): Filter => {
    const group = t.match(/^(and|or)\((.*)\)$/);
    if (group) return parseLogic(group[2], group[1] as "or" | "and");
    const m = t.match(/^([a-z_]+)\.(not\.)?([a-z]+)\.(.*)$/);
    if (!m) throw new Error(`fake supabase: can't parse "${t}"`);
    const f = opFilter(m[1], m[3], m[4]);
    return m[2] ? (r) => !f(r) : f;
  });
  return mode === "or"
    ? (r) => terms.some((f) => f(r))
    : (r) => terms.every((f) => f(r));
}

function parseVector(v: unknown): number[] | null {
  if (Array.isArray(v)) return v as number[];
  if (typeof v === "string") return JSON.parse(v) as number[];
  return null;
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

class Query implements PromiseLike<Result> {
  private op: "select" | "insert" | "update" | "upsert" | "delete" = "select";
  private filters: Filter[] = [];
  private orders: Array<{ col: string; asc: boolean }> = [];
  private limitN: number | null = null;
  private singleMode: "single" | "maybe" | null = null;
  private payload: Row[] = [];
  private patch: Row = {};
  private upsertOpts: { onConflict?: string; ignoreDuplicates?: boolean } = {};
  private returning = false;
  private countMode: string | null = null;
  private head = false;

  constructor(
    private db: FakeSupabase,
    private table: string,
  ) {}

  select(_cols?: string, opts?: { count?: string; head?: boolean }) {
    if (this.op === "select") {
      this.countMode = opts?.count ?? null;
      this.head = opts?.head ?? false;
    } else {
      this.returning = true;
    }
    return this;
  }
  insert(rows: Row | Row[]) {
    this.op = "insert";
    this.payload = clone(Array.isArray(rows) ? rows : [rows]);
    return this;
  }
  update(patch: Row) {
    this.op = "update";
    this.patch = clone(patch);
    return this;
  }
  upsert(
    rows: Row | Row[],
    opts: { onConflict?: string; ignoreDuplicates?: boolean } = {},
  ) {
    this.op = "upsert";
    this.payload = clone(Array.isArray(rows) ? rows : [rows]);
    this.upsertOpts = opts;
    return this;
  }
  delete() {
    this.op = "delete";
    return this;
  }
  eq(col: string, v: unknown) {
    this.filters.push(opFilter(col, "eq", v));
    return this;
  }
  neq(col: string, v: unknown) {
    this.filters.push(opFilter(col, "neq", v));
    return this;
  }
  lt(col: string, v: unknown) {
    this.filters.push(opFilter(col, "lt", v));
    return this;
  }
  lte(col: string, v: unknown) {
    this.filters.push(opFilter(col, "lte", v));
    return this;
  }
  gt(col: string, v: unknown) {
    this.filters.push(opFilter(col, "gt", v));
    return this;
  }
  gte(col: string, v: unknown) {
    this.filters.push(opFilter(col, "gte", v));
    return this;
  }
  is(col: string, v: unknown) {
    this.filters.push(opFilter(col, "is", v));
    return this;
  }
  in(col: string, v: unknown[]) {
    this.filters.push(opFilter(col, "in", v));
    return this;
  }
  ilike(col: string, v: string) {
    this.filters.push(opFilter(col, "ilike", v));
    return this;
  }
  not(col: string, op: string, v: unknown) {
    const f = opFilter(col, op, v);
    this.filters.push((r) => !f(r));
    return this;
  }
  or(expr: string) {
    this.filters.push(parseLogic(expr, "or"));
    return this;
  }
  order(col: string, opts: { ascending?: boolean } = {}) {
    this.orders.push({ col, asc: opts.ascending ?? true });
    return this;
  }
  limit(n: number) {
    this.limitN = n;
    return this;
  }
  single() {
    this.singleMode = "single";
    return this;
  }
  maybeSingle() {
    this.singleMode = "maybe";
    return this;
  }

  then<A = Result, B = never>(
    onFulfilled?: ((v: Result) => A | PromiseLike<A>) | null,
    onRejected?: ((e: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return Promise.resolve()
      .then(() => this.db.maybeFail(this.table, this.op))
      .then(() => this.exec())
      .then(onFulfilled, onRejected);
  }

  private matches(): Row[] {
    return this.db.rows(this.table).filter((r) => this.filters.every((f) => f(r)));
  }

  private shape(rows: Row[], count?: number): Result {
    let out = rows.map(clone);
    if (this.singleMode) {
      if (out.length > 1)
        return {
          data: null,
          error: { code: "PGRST116", message: "multiple rows returned" },
        };
      if (out.length === 0)
        return this.singleMode === "maybe"
          ? { data: null, error: null }
          : { data: null, error: { code: "PGRST116", message: "no rows returned" } };
      return { data: out[0], error: null };
    }
    if (this.head) out = [];
    return { data: this.head ? null : out, error: null, count: count ?? null };
  }

  private exec(): Result {
    const table = this.db.rows(this.table);
    switch (this.op) {
      case "select": {
        let rows = this.matches();
        const count = rows.length;
        rows = [...rows].sort((a, b) => {
          for (const o of this.orders) {
            const c = cmp(a[o.col], b[o.col]);
            if (c !== 0) return o.asc ? c : -c;
          }
          return (a._seq as number) - (b._seq as number);
        });
        if (this.limitN !== null) rows = rows.slice(0, this.limitN);
        return this.shape(rows, this.countMode ? count : undefined);
      }
      case "insert": {
        const prepared = this.payload.map((r) => this.db.prepare(this.table, r));
        const dup = this.db.findUniqueViolation(this.table, prepared);
        if (dup) return { data: null, error: dup };
        table.push(...prepared);
        return this.returning ? this.shape(prepared) : { data: null, error: null };
      }
      case "update": {
        const rows = this.matches();
        for (const r of rows) Object.assign(r, this.patch, { id: r.id });
        return this.returning ? this.shape(rows) : { data: null, error: null };
      }
      case "upsert": {
        const cols = (this.upsertOpts.onConflict ?? "id").split(",").map((c) => c.trim());
        const written: Row[] = [];
        for (const incoming of this.payload) {
          const existing = table.find((r) => cols.every((c) => eqv(r[c], incoming[c])));
          if (existing) {
            if (this.upsertOpts.ignoreDuplicates) continue;
            Object.assign(existing, incoming, { id: existing.id });
            written.push(existing);
          } else {
            const row = this.db.prepare(this.table, incoming);
            table.push(row);
            written.push(row);
          }
        }
        return this.returning ? this.shape(written) : { data: null, error: null };
      }
      case "delete": {
        const rows = this.matches();
        this.db.remove(this.table, rows);
        return this.returning ? this.shape(rows) : { data: null, error: null };
      }
    }
  }
}

export class FakeSupabase {
  tables: Record<string, Row[]> = {};
  private failures: Array<{ table: string; op: string; times: number }> = [];

  rows(table: string): Row[] {
    this.tables[table] ??= [];
    return this.tables[table];
  }

  from(table: string) {
    return new Query(this, table);
  }

  /** Make the next `times` operations of `op` on `table` reject (network-style). */
  failNext(table: string, op: string, times = 1) {
    this.failures.push({ table, op, times });
  }

  maybeFail(table: string, op: string) {
    const f = this.failures.find((x) => x.table === table && x.op === op && x.times > 0);
    if (f) {
      f.times -= 1;
      throw new Error(`fake supabase: injected failure on ${op} ${table}`);
    }
  }

  prepare(table: string, row: Row): Row {
    const now = new Date().toISOString();
    return {
      ...(DEFAULTS[table]?.() ?? {}),
      id: randomUUID(),
      created_at: now,
      ...(table === "post_match_checkins" || table === "threads" ? { updated_at: now } : {}),
      ...row,
      _seq: ++seq,
    };
  }

  findUniqueViolation(table: string, incoming: Row[]): PgError | null {
    const existing = this.rows(table);
    for (const cols of UNIQUE[table] ?? []) {
      const seen = new Set(
        existing.map((r) => cols.map((c) => String(r[c])).join("|")),
      );
      for (const r of incoming) {
        if (cols.some((c) => r[c] == null)) continue;
        const key = cols.map((c) => String(r[c])).join("|");
        if (seen.has(key))
          return { code: "23505", message: `duplicate key on ${table}(${cols})` };
        seen.add(key);
      }
    }
    return null;
  }

  remove(table: string, rows: Row[]) {
    const ids = new Set(rows.map((r) => r.id));
    this.tables[table] = this.rows(table).filter((r) => !ids.has(r.id));
    for (const child of CASCADE[table] ?? []) {
      this.tables[child.table] = this.rows(child.table).filter(
        (r) => !ids.has(r[child.fk]),
      );
    }
  }

  async rpc(fn: string, args: Record<string, unknown>): Promise<Result> {
    if (fn === "hit_rate_limit") {
      const key = String(args.p_key);
      const windowMs = Number(args.p_window_seconds) * 1000;
      const now = Date.now();
      const rows = this.rows("rate_limits");
      let row = rows.find((r) => r.key === key);
      if (!row || new Date(String(row.window_start)).getTime() < now - windowMs) {
        if (!row) {
          row = { key, window_start: new Date(now).toISOString(), count: 0, _seq: ++seq };
          rows.push(row);
        }
        row.window_start = new Date(now).toISOString();
        row.count = 0;
      }
      row.count = Number(row.count) + 1;
      return { data: Number(row.count) <= Number(args.p_max), error: null };
    }
    if (fn !== "match_freelancers")
      return { data: null, error: { code: "42883", message: `no fn ${fn}` } };
    const q = args.query_embedding as number[];
    const budget = args.budget_max as number | null;
    const tz = (args.tz_filter as string | null)?.toLowerCase() ?? null;
    const rows = this.rows("freelancers")
      .filter((f) => budget == null || (f.rate_usd_per_hour as number) <= budget)
      .filter(
        (f) =>
          tz == null ||
          String(f.timezone).toLowerCase().includes(tz) ||
          ((f.timezone_overlap_hours as string[]) ?? []).some((t) =>
            t.toLowerCase().includes(tz),
          ),
      )
      .map((f) => {
        const vec = parseVector(f.embedding);
        const rest = { ...f };
        delete rest.embedding;
        delete rest._seq;
        delete rest.created_at;
        return { ...rest, similarity: vec ? cosine(q, vec) : null };
      })
      // Rows without an embedding sort last, like `order by embedding <=> q`.
      .sort((a, b) => (b.similarity ?? -Infinity) - (a.similarity ?? -Infinity))
      .slice(0, (args.match_count as number) ?? 5);
    return { data: clone(rows), error: null };
  }

  reset() {
    this.tables = {};
    this.failures = [];
  }
}

export const fakeDb = new FakeSupabase();
