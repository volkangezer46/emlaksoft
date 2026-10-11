/**
 * Ortak Supabase istemci sahtesi (server action testleri için).
 *
 * Gerçek ağ yok: her `from(tablo)` çağrısı kaydedilir (işlem, yük, filtre zinciri) ve
 * `resolver` ile istenen `{ data, error, count }` döndürülür. Böylece testler "hangi tabloya hangi
 * filtreyle sorgu gitti" (örn. tenant_id süzgeci) ve "ham hata kullanıcıya sızmadı" gibi
 * davranışları doğrular. Zincir `await` edilebilir (thenable); `maybeSingle()/single()` da çözülür.
 */
export type MockOp = "select" | "insert" | "update" | "delete" | "upsert";

export type RecordedQuery = {
  table: string;
  op: MockOp;
  payload?: unknown;
  selectArgs?: unknown[];
  filters: { method: string; args: unknown[] }[];
};

export type MockResult = { data?: unknown; error?: unknown; count?: number | null };
export type MockResolver = (query: RecordedQuery) => MockResult | undefined;

const WRITE_OPS = new Set<string>(["insert", "update", "delete", "upsert"]);

export function createSupabaseMock(resolver: MockResolver = () => undefined) {
  const queries: RecordedQuery[] = [];
  const rpcCalls: { name: string; args: unknown }[] = [];

  function settle(q: RecordedQuery) {
    const r = resolver(q) ?? {};
    return { data: r.data ?? null, error: r.error ?? null, count: r.count ?? null };
  }

  function from(table: string) {
    const q: RecordedQuery = { table, op: "select", filters: [] };
    queries.push(q);
    const chain: unknown = new Proxy(
      {},
      {
        get(_target, prop: string) {
          if (prop === "then") {
            return (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
              Promise.resolve(settle(q)).then(resolve, reject);
          }
          if (prop === "maybeSingle" || prop === "single") return () => Promise.resolve(settle(q));
          if (WRITE_OPS.has(prop)) {
            return (payload?: unknown) => {
              q.op = prop as MockOp;
              q.payload = payload;
              return chain;
            };
          }
          if (prop === "select") {
            return (...args: unknown[]) => {
              if (q.op === "select") q.selectArgs = args;
              return chain;
            };
          }
          return (...args: unknown[]) => {
            q.filters.push({ method: prop, args });
            return chain;
          };
        },
      },
    );
    return chain;
  }

  function rpc(name: string, args?: unknown) {
    rpcCalls.push({ name, args });
    const q: RecordedQuery = { table: `rpc:${name}`, op: "select", payload: args, filters: [] };
    return Promise.resolve(settle(q));
  }

  return {
    client: { from, rpc },
    queries,
    rpcCalls,
    /** Bir tabloya giden sorgular (isteğe bağlı işleme göre). */
    forTable(table: string, op?: MockOp) {
      return queries.filter((q) => q.table === table && (op ? q.op === op : true));
    },
    reset() {
      queries.length = 0;
      rpcCalls.length = 0;
    },
  };
}

/** Sorguda `method(args...)` filtresi var mı? (args önek eşleşmesi: verilen argümanlar baştan eşleşmeli.) */
export function hasFilter(q: RecordedQuery, method: string, ...args: unknown[]): boolean {
  return q.filters.some(
    (f) => f.method === method && args.every((a, i) => JSON.stringify(f.args[i]) === JSON.stringify(a)),
  );
}
