/**
 * pglite (bellek içi Postgres) yükleyicisi — para/kontör SQL'inin gerçek PL/pgSQL testleri için tek yer.
 * `@electric-sql/pglite` devDependency'dir; CI'da `npm ci` ile kurulur ve testler KOŞAR.
 * `PGLITE_MODULE=<mutlak yol>/dist/index.js` verilirse (yerel deney) önce o denenir.
 * Modül yüklenemezse null döner ve çağıran `describe.skipIf(!mod)` ile atlar.
 */
export type Db = {
  exec: (sql: string) => Promise<unknown>;
  query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
};
export type PgliteModule = { PGlite: new () => Db };

export async function loadPglite(): Promise<PgliteModule | null> {
  const override = process.env.PGLITE_MODULE;
  try {
    const m = override ? await import(/* @vite-ignore */ override) : await import("@electric-sql/pglite");
    return m as unknown as PgliteModule;
  } catch {
    return null;
  }
}
