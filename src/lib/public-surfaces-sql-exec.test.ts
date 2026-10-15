import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadPglite, type Db } from "@/lib/test-support/pglite";

/**
 * İŞLEVSEL SQL TESTİ (pglite): 20261016080000_public_surfaces — offers.owner_visible_note (uzunluk kısıtı) ve atomik
 * increment_share_view (yeni değer, süresi dolmuş link null, yalnız service_role), idempotent yeniden uygulama ve
 * rollback. Şema sadeleştirilmiş taklit.
 */
const mod = await loadPglite();
const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");
const MIGRATION = read("supabase/migrations/20261016080000_public_surfaces.sql");
const ROLLBACK = read("supabase/rollbacks/20261016080000_public_surfaces.rollback.sql");

const STUB = `
create role service_role; create role authenticated; create role anon;
create table public.offers(id uuid primary key default gen_random_uuid(), tenant_id uuid, amount numeric not null, notes text);
create table public.share_links(id uuid primary key default gen_random_uuid(), tenant_id uuid, token text not null unique,
  view_count integer not null default 0, expires_at timestamptz);
insert into public.share_links(token, expires_at) values ('acik', now() + interval '1 day'), ('suresiz', null), ('dolmus', now() - interval '1 day');
insert into public.offers(amount, notes) values (100, 'iç not');
`;

let db: Db;

beforeAll(async () => {
  if (!mod) return;
  db = new mod.PGlite();
  await db.exec(STUB);
  await db.exec(MIGRATION);
});

const views = async (token: string) =>
  (await db.query("select view_count from public.share_links where token = $1", [token])).rows[0].view_count;
const bump = async (token: string) => (await db.query("select public.increment_share_view($1) as v", [token])).rows[0].v;

describe.skipIf(!mod)("20261016080000 public_surfaces", () => {
  it("increment_share_view: atomik +1 ve YENİ değeri döndürür (ilk açılış = 1)", async () => {
    expect(await bump("acik")).toBe(1);
    expect(await bump("acik")).toBe(2);
    expect(await views("acik")).toBe(2);
    expect(await bump("suresiz")).toBe(1);
  });

  it("süresi dolmuş ya da olmayan link sayılmaz (null)", async () => {
    expect(await bump("dolmus")).toBeNull();
    expect(await views("dolmus")).toBe(0);
    expect(await bump("yok")).toBeNull();
  });

  it("yalnız service_role çalıştırabilir", async () => {
    const r = await db.query(
      `select has_function_privilege('anon', 'public.increment_share_view(text)', 'execute') as anon,
              has_function_privilege('authenticated', 'public.increment_share_view(text)', 'execute') as auth,
              has_function_privilege('service_role', 'public.increment_share_view(text)', 'execute') as svc`,
    );
    expect(r.rows[0]).toEqual({ anon: false, auth: false, svc: true });
  });

  it("owner_visible_note: boş başlar (iç not taşınmaz), ≤2000 karakter", async () => {
    const row = (await db.query("select notes, owner_visible_note from public.offers")).rows[0];
    expect(row).toEqual({ notes: "iç not", owner_visible_note: null });
    await db.exec("update public.offers set owner_visible_note = 'Peşin ödeme'");
    await expect(db.exec(`update public.offers set owner_visible_note = repeat('x', 2001)`)).rejects.toThrow();
  });

  it("idempotent: ikinci uygulama hata vermez; rollback temiz kaldırır", async () => {
    await db.exec(MIGRATION);
    await db.exec(ROLLBACK);
    const col = await db.query("select 1 from information_schema.columns where table_name = 'offers' and column_name = 'owner_visible_note'");
    expect(col.rows).toHaveLength(0);
    const fn = await db.query("select 1 from pg_proc where proname = 'increment_share_view'");
    expect(fn.rows).toHaveLength(0);
    await db.exec(ROLLBACK);
  });
});
