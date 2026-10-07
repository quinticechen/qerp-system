/**
 * Fake Supabase client for evals — an in-memory table store that implements the subset of
 * the PostgREST query builder our tools use. Nothing touches the real database: writes are
 * applied to this run's copy of the fixtures and recorded in `writes` for assertions.
 */

import { randomUUID } from "node:crypto";

type Row = Record<string, unknown>;
export type Tables = Record<string, Row[]>;

export interface RecordedWrite {
  op: "insert" | "update" | "delete";
  table: string;
  values: unknown;
}

// Inserted rows get these relations embedded so `.select("*, customers(name)")` style reads
// of the returned row behave like PostgREST.
const FOREIGN_KEYS: Record<string, string> = {
  customer_id: "customers",
  factory_id: "factories",
  product_id: "products_new",
  order_id: "orders",
};

type Filter = (row: Row) => boolean;

function likeToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*").replace(/_/g, ".");
  return new RegExp(`^${escaped}$`, "i");
}

function stringify(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

// Parses PostgREST `or` syntax such as `name.ilike.%chen%,contact_person.ilike.%chen%`.
function parseOr(expr: string): Filter {
  const terms = expr.split(",").map((term) => {
    const [column, op, ...rest] = term.split(".");
    const value = rest.join(".");
    if (op === "ilike" || op === "like") {
      const re = likeToRegExp(value);
      return (row: Row) => re.test(stringify(row[column]));
    }
    if (op === "eq") return (row: Row) => stringify(row[column]) === value;
    throw new Error(`fake-supabase: unsupported or() operator "${op}"`);
  });
  return (row) => terms.some((test) => test(row));
}

class FakeQuery implements PromiseLike<{ data: unknown; error: { message: string } | null }> {
  private filters: Filter[] = [];
  private sortBy: { column: string; ascending: boolean } | null = null;
  private max: number | null = null;
  private mode: "many" | "single" | "maybeSingle" = "many";
  private mutation: { op: "insert" | "update" | "delete"; values?: unknown } | null = null;

  constructor(private table: string, private tables: Tables, private writes: RecordedWrite[]) {}

  select(_columns?: string) { return this; }
  eq(column: string, value: unknown) { this.filters.push((r) => r[column] === value); return this; }
  neq(column: string, value: unknown) { this.filters.push((r) => r[column] !== value); return this; }
  in(column: string, values: unknown[]) { this.filters.push((r) => values.includes(r[column])); return this; }
  ilike(column: string, pattern: string) { const re = likeToRegExp(pattern); this.filters.push((r) => re.test(stringify(r[column]))); return this; }
  or(expr: string) { this.filters.push(parseOr(expr)); return this; }
  not(column: string, op: string, value: unknown) {
    if (op !== "is" || value !== null) throw new Error(`fake-supabase: unsupported not(${op}, ${value})`);
    this.filters.push((r) => r[column] !== null && r[column] !== undefined);
    return this;
  }
  order(column: string, opts?: { ascending?: boolean }) { this.sortBy = { column, ascending: opts?.ascending ?? true }; return this; }
  limit(n: number) { this.max = n; return this; }
  single() { this.mode = "single"; return this; }
  maybeSingle() { this.mode = "maybeSingle"; return this; }
  insert(values: unknown) { this.mutation = { op: "insert", values }; return this; }
  update(values: unknown) { this.mutation = { op: "update", values }; return this; }
  delete() { this.mutation = { op: "delete" }; return this; }

  then<R1, R2>(
    onFulfilled?: ((value: { data: unknown; error: { message: string } | null }) => R1 | PromiseLike<R1>) | null,
    onRejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null
  ): PromiseLike<R1 | R2> {
    return Promise.resolve().then(() => this.execute()).then(onFulfilled, onRejected);
  }

  private embedRelations(row: Row): Row {
    const embedded: Row = { ...row };
    for (const [fk, table] of Object.entries(FOREIGN_KEYS)) {
      const id = row[fk];
      if (!id) continue;
      const related = (this.tables[table] ?? []).find((r) => r.id === id);
      if (related) embedded[table] = related;
    }
    return embedded;
  }

  private execute(): { data: unknown; error: { message: string } | null } {
    const rows = (this.tables[this.table] ??= []);
    let result: Row[];

    if (this.mutation?.op === "insert") {
      const values = Array.isArray(this.mutation.values) ? this.mutation.values : [this.mutation.values];
      this.writes.push({ op: "insert", table: this.table, values: this.mutation.values });
      result = (values as Row[]).map((v) => {
        const row: Row = { id: randomUUID(), created_at: new Date().toISOString(), ...v };
        if (this.table === "orders" && !row.order_number) row.order_number = `ORD-EVAL-${rows.length + 1}`;
        if (this.table === "purchase_orders" && !row.po_number) row.po_number = `PO-EVAL-${rows.length + 1}`;
        rows.push(row);
        return this.embedRelations(row);
      });
    } else {
      result = rows.filter((r) => this.filters.every((f) => f(r)));
      if (this.mutation?.op === "update") {
        this.writes.push({ op: "update", table: this.table, values: this.mutation.values });
        result.forEach((r) => Object.assign(r, this.mutation!.values as Row));
      } else if (this.mutation?.op === "delete") {
        this.writes.push({ op: "delete", table: this.table, values: result.map((r) => r.id) });
        this.tables[this.table] = rows.filter((r) => !result.includes(r));
      }
      if (this.sortBy) {
        const { column, ascending } = this.sortBy;
        result = [...result].sort((a, b) => {
          const cmp = stringify(a[column]).localeCompare(stringify(b[column]));
          return ascending ? cmp : -cmp;
        });
      }
      if (this.max !== null) result = result.slice(0, this.max);
    }

    if (this.mode === "many") return { data: result, error: null };
    if (result.length === 0) {
      return this.mode === "maybeSingle"
        ? { data: null, error: null }
        : { data: null, error: { message: "JSON object requested, multiple (or no) rows returned" } };
    }
    return { data: result[0], error: null };
  }
}

export interface FakeSupabase {
  client: any;
  writes: RecordedWrite[];
}

/** Stand-in for the permission functions in the database (see src/agent/auth-guard.ts). */
export interface FakeAccess {
  isOwner: boolean;
  /** Permission keys granted through the user's roles. */
  grants: readonly string[];
}

export function createFakeSupabase(fixtures: Tables, userId: string, access: FakeAccess = { isOwner: true, grants: [] }): FakeSupabase {
  const tables: Tables = structuredClone(fixtures);
  const writes: RecordedWrite[] = [];
  const rpc = async (fn: string, args: Record<string, unknown>) => {
    if (args._user_id !== userId) return { data: false, error: null };
    if (fn === "is_organization_owner") return { data: access.isOwner, error: null };
    if (fn === "user_has_organization_permission") {
      return { data: access.isOwner || access.grants.includes(String(args._permission)), error: null };
    }
    return { data: null, error: { message: `fake-supabase: unknown rpc ${fn}` } };
  };
  const client = {
    from: (table: string) => new FakeQuery(table, tables, writes),
    rpc,
    auth: {
      getUser: async () => ({ data: { user: { id: userId } }, error: null }),
    },
  };
  return { client, writes };
}
