/**
 * Süzgeçleri KAYDEDEN ve satırlara UYGULAYAN sahte Supabase istemcisi (SK6/B180; yalnız testler).
 *
 * Eski sahte zincirler `eq()` / `not()` çağrılarını yok sayıp `then()`'de tüm satırları döndürüyordu: eylemdeki çift tahsilat
 * süzgeci (`.not("status","in","(paid,collected)")`) ya da kiracı süzgeci (`.eq("tenant_id", …)`) silinse de testler geçiyordu.
 * Bu sahte istemci PostgREST oluşturucusunun kullanılan alt kümesini bellekteki tablolara uygular:
 *   select(cols, { count, head }) · update(payload) · insert(rows) · delete()
 *   eq · neq · in · not(col, "in" | "is" | "eq", val) · is · gte · gt · lt · lte · contains (dizi/nesne) · order · limit · range
 *   maybeSingle · single · then (await)
 * Her sorgu `log`'a yazılır; `hasFilter(table, op, col, val?)` testte süzgecin gerçekten uygulandığını doğrular.
 * `rpc` isteğe bağlı işleyiciye gider (yoksa PGRST202).
 */
export type MockRow = Record<string, unknown>;
export type MockFilter = { op: string; col: string; val?: unknown };
export type MockQuery = { table: string; kind: "select" | "update" | "insert" | "delete"; filters: MockFilter[]; payload?: unknown };
type RpcHandler = (fn: string, args: Record<string, unknown>) => { data: unknown; error: unknown } | Promise<{ data: unknown; error: unknown }>;

function parseList(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  const s = String(v ?? "").trim();
  const inner = s.startsWith("(") && s.endsWith(")") ? s.slice(1, -1) : s;
  return inner === "" ? [] : inner.split(",").map((x) => x.trim().replace(/^"(.*)"$/, "$1"));
}

const same = (a: unknown, b: unknown) => String(a) === String(b);

function contains(haystack: unknown, needle: unknown): boolean {
  if (Array.isArray(needle)) {
    const arr = Array.isArray(haystack) ? haystack : [];
    return needle.every((n) => arr.some((h) => contains(h, n)));
  }
  if (needle && typeof needle === "object") {
    if (!haystack || typeof haystack !== "object") return false;
    return Object.entries(needle as MockRow).every(([k, v]) => contains((haystack as MockRow)[k], v));
  }
  return same(haystack, needle);
}

function matches(row: MockRow, f: MockFilter): boolean {
  const v = row[f.col];
  switch (f.op) {
    case "eq":
      return same(v, f.val);
    case "neq":
      return !same(v, f.val);
    case "in":
      return parseList(f.val).some((x) => same(v, x));
    case "is":
      return f.val === null ? v === null || v === undefined : v === f.val;
    case "gte":
      return String(v) >= String(f.val);
    case "gt":
      return String(v) > String(f.val);
    case "lt":
      return String(v) < String(f.val);
    case "lte":
      return String(v) <= String(f.val);
    case "contains":
      return contains(v, f.val);
    case "not.in":
      return !parseList(f.val).some((x) => same(v, x));
    case "not.is":
      return f.val === null ? !(v === null || v === undefined) : v !== f.val;
    case "not.eq":
      return !same(v, f.val);
    default:
      throw new Error(`supabase-table-mock: desteklenmeyen süzgeç ${f.op}`);
  }
}

export function createTableMock(tables: Record<string, MockRow[]>, opts: { rpc?: RpcHandler; errors?: Record<string, { code?: string; message: string }> } = {}) {
  const log: MockQuery[] = [];
  let seq = 0;

  function from(table: string) {
    const q: MockQuery = { table, kind: "select", filters: [] };
    let selectAfter = false;
    let head = false;
    let count: string | undefined;
    let limit: number | null = null;
    let single: "maybe" | "one" | null = null;
    const builder: Record<string, unknown> = {};
    const add = (op: string) => (col: string, val?: unknown) => {
      q.filters.push({ op, col, val });
      return builder;
    };
    for (const op of ["eq", "neq", "in", "is", "gte", "gt", "lt", "lte", "contains"]) builder[op] = add(op);
    builder.not = (col: string, op: string, val: unknown) => {
      q.filters.push({ op: `not.${op}`, col, val });
      return builder;
    };
    builder.select = (_cols?: string, o?: { count?: string; head?: boolean }) => {
      if (q.kind !== "select") selectAfter = true;
      head = Boolean(o?.head);
      count = o?.count;
      return builder;
    };
    builder.update = (payload: MockRow) => {
      q.kind = "update";
      q.payload = payload;
      return builder;
    };
    builder.insert = (payload: MockRow | MockRow[]) => {
      q.kind = "insert";
      q.payload = payload;
      return builder;
    };
    builder.delete = () => {
      q.kind = "delete";
      return builder;
    };
    builder.order = () => builder;
    builder.limit = (n: number) => {
      limit = n;
      return builder;
    };
    builder.range = (a: number, b: number) => {
      limit = b - a + 1;
      return builder;
    };
    builder.maybeSingle = () => {
      single = "maybe";
      return builder;
    };
    builder.single = () => {
      single = "one";
      return builder;
    };
    const run = () => {
      log.push(q);
      const err = opts.errors?.[table];
      if (err) return { data: null, error: err, count: null };
      const rows = (tables[table] ??= []);
      let out: MockRow[];
      if (q.kind === "insert") {
        const list = (Array.isArray(q.payload) ? q.payload : [q.payload]) as MockRow[];
        out = list.map((r) => ({ id: `mock-${++seq}`, ...r }));
        rows.push(...out);
        if (!selectAfter) out = [];
      } else {
        const hit = rows.filter((r) => q.filters.every((f) => matches(r, f)));
        if (q.kind === "update") {
          for (const r of hit) Object.assign(r, q.payload as MockRow);
          out = selectAfter ? hit.map((r) => ({ ...r })) : [];
        } else if (q.kind === "delete") {
          for (const r of hit) rows.splice(rows.indexOf(r), 1);
          out = selectAfter ? hit : [];
        } else {
          out = hit.map((r) => ({ ...r }));
        }
      }
      const total = out.length;
      if (limit !== null) out = out.slice(0, limit);
      if (head) return { data: null, error: null, count: count ? total : null };
      if (single) {
        if (single === "one" && out.length !== 1) return { data: null, error: { code: "PGRST116", message: "single row expected" }, count: null };
        return { data: out[0] ?? null, error: null, count: null };
      }
      return { data: out, error: null, count: count ? total : null };
    };
    builder.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
      try {
        return Promise.resolve(resolve(run()));
      } catch (e) {
        return reject ? Promise.resolve(reject(e)) : Promise.reject(e);
      }
    };
    return builder;
  }

  const client = {
    from,
    rpc: async (fn: string, args: Record<string, unknown>) =>
      opts.rpc ? opts.rpc(fn, args) : { data: null, error: { code: "PGRST202", message: "Could not find the function" } },
  };

  /** Bu tabloya `kind` türünde bir sorguda verilen süzgeç uygulandı mı (val verilmezse yalnız op + sütun). */
  function hasFilter(table: string, op: string, col: string, val?: unknown, kind?: MockQuery["kind"]): boolean {
    return log.some(
      (q) =>
        q.table === table &&
        (!kind || q.kind === kind) &&
        q.filters.some((f) => f.op === op && f.col === col && (val === undefined || JSON.stringify(f.val) === JSON.stringify(val))),
    );
  }

  return { client, tables, log, hasFilter };
}
