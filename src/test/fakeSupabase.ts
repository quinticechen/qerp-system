// In-memory stand-in for the Supabase client, used to test components at the network boundary.

export interface RecordedUpdate {
  table: string;
  payload: Record<string, unknown>;
  filter: [string, unknown];
}

export interface RecordedRpc {
  fn: string;
  args: Record<string, unknown>;
}

type Row = Record<string, unknown>;

interface FakeOptions {
  // Error message returned by every rpc call, to exercise failure paths
  rpcError?: string;
}

export const createFakeSupabase = (tables: Record<string, Row[]>, options: FakeOptions = {}) => {
  const updates: RecordedUpdate[] = [];
  const rpcCalls: RecordedRpc[] = [];

  const select = (table: string) => {
    let rows = [...(tables[table] ?? [])];
    const builder = {
      select: () => builder,
      order: () => builder,
      eq: (column: string, value: unknown) => {
        rows = rows.filter((row) => row[column] === value);
        return builder;
      },
      in: (column: string, values: unknown[]) => {
        rows = rows.filter((row) => values.includes(row[column]));
        return builder;
      },
      // Supports the PostgREST form used in the app: "col.eq.value,col.eq.value"
      or: (filters: string) => {
        const conditions = filters.split(",").map((part) => {
          const [column, , value] = part.split(".");
          return { column, value };
        });
        rows = rows.filter((row) => conditions.some(({ column, value }) => String(row[column]) === value));
        return builder;
      },
      gt: (column: string, value: number) => {
        rows = rows.filter((row) => Number(row[column]) > value);
        return builder;
      },
      then: (resolve: (result: { data: Row[]; error: null }) => unknown) =>
        Promise.resolve({ data: rows, error: null }).then(resolve),
    };
    return builder;
  };

  const client = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      return { data: null, error: options.rpcError ? { message: options.rpcError } : null };
    },
    from: (table: string) => ({
      select: () => select(table),
      update: (payload: Record<string, unknown>) => ({
        eq: async (column: string, value: unknown) => {
          updates.push({ table, payload, filter: [column, value] });
          return { error: null };
        },
      }),
    }),
  };

  return { client, updates, rpcCalls };
};
