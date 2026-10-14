import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadPglite, type Db } from "@/lib/test-support/pglite";

/**
 * İŞLEVSEL SQL TESTİ (pglite): 20261013007300 — EİDS aksiyon motoru şeması.
 * Gerçek migration gövdesi çalışır; bağımlı tablolar (tasks, properties, portal_listings, sağlık) sadeleştirilmiş taklittir.
 * Kabul: kalemler işaretlenmeden kaldırma görevi kapanmaz; eklenti 'kalktı' sonucu kalemi kendiliğinden işaretler;
 * aynı olay için ikinci görev açılmaz (dedupe_key).
 */
const mod = await loadPglite();
const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");

const STUB = `
create role service_role; create role authenticated; create role anon;
create function public.current_active_tenant_id() returns uuid language sql stable as $$ select nullif(current_setting('t.tenant', true), '')::uuid $$;
create function public.has_effective_permission(m text, a text) returns boolean language sql stable as $$ select true $$;
create table public.tenants(id uuid primary key default gen_random_uuid());
create table public.profiles(id uuid primary key default gen_random_uuid(), tenant_id uuid);
create table public.properties(id uuid primary key default gen_random_uuid(), tenant_id uuid, authority_reminder_channel text,
  constraint properties_authority_reminder_channel_check check (authority_reminder_channel is null or authority_reminder_channel in ('sms', 'whatsapp')));
create table public.tasks(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, kind text not null default 'other',
  priority text not null default 'normal', status text not null default 'open', title text, created_at timestamptz default now(),
  constraint tasks_kind_check check (kind = any (array['followup', 'call', 'visit', 'document', 'other'])),
  constraint tasks_priority_check check (priority = any (array['low', 'normal', 'high'])),
  unique (id, tenant_id));
create table public.portal_listings(id uuid primary key default gen_random_uuid(), tenant_id uuid, property_id uuid, portal_name text);
create table public.portal_listing_health(portal_listing_id uuid primary key, tenant_id uuid, check_state text default 'unknown');
`;

describe.skipIf(!mod)("EİDS aksiyon motoru şeması (pglite)", () => {
  let db: Db;
  let T: string;
  const q = async (sql: string, params?: unknown[]) => (await db.query(sql, params)).rows;

  const mkTakedown = async () => {
    const task = (await q(`insert into public.tasks(tenant_id, kind, priority, title) values ($1,'eids_takedown','urgent','Kaldır') returning id`, [T]))[0]!.id as string;
    const pl = (await q(`insert into public.portal_listings(tenant_id, portal_name) values ($1,'sahibinden') returning id`, [T]))[0]!.id as string;
    await q(`insert into public.eids_takedown_items(tenant_id, task_id, target, portal_listing_id) values ($1,$2,'sahibinden',$3)`, [T, task, pl]);
    await q(`insert into public.eids_takedown_items(tenant_id, task_id, target) values ($1,$2,'vitrin')`, [T, task]);
    return { task, pl };
  };
  const pending = async (task: string) =>
    (await q(`select count(*)::int n from public.eids_takedown_items where task_id = $1 and status = 'pending'`, [task]))[0]!.n as number;

  beforeAll(async () => {
    db = new mod!.PGlite();
    await db.exec(STUB);
    T = (await q(`insert into public.tenants default values returning id`))[0]!.id as string;
    await db.exec(read("supabase/migrations/20261013007300_eids_actions.sql"));
  });

  it("yeni görev türleri, 'urgent' önceliği ve e-posta hatırlatma kanalı kabul edilir", async () => {
    await q(`insert into public.tasks(tenant_id, kind, priority) values ($1,'eids_publish','normal')`, [T]);
    await q(`insert into public.properties(tenant_id, authority_reminder_channel) values ($1,'email')`, [T]);
    await expect(q(`insert into public.tasks(tenant_id, kind) values ($1,'bilinmeyen')`, [T])).rejects.toThrow();
  });

  it("aynı dedupe_key ile ikinci görev açılamaz (ofis bazında)", async () => {
    await q(`insert into public.tasks(tenant_id, kind, dedupe_key) values ($1,'eids_takedown','eids:revoke:ev-1')`, [T]);
    await expect(q(`insert into public.tasks(tenant_id, kind, dedupe_key) values ($1,'eids_takedown','eids:revoke:ev-1')`, [T])).rejects.toThrow();
    const T2 = (await q(`insert into public.tenants default values returning id`))[0]!.id as string;
    await q(`insert into public.tasks(tenant_id, kind, dedupe_key) values ($1,'eids_takedown','eids:revoke:ev-1')`, [T2]);
  });

  it("bekleyen kalem varken kaldırma görevi tamamlanamaz; tüm kalemler işaretlenince kapanır", async () => {
    const { task } = await mkTakedown();
    await expect(q(`update public.tasks set status = 'done' where id = $1`, [task])).rejects.toThrow(/eids_takedown_pending_items/);
    await q(`update public.eids_takedown_items set status = 'removed', verified_by = 'manual', done_at = now() where task_id = $1`, [task]);
    await q(`update public.tasks set status = 'done' where id = $1`, [task]);
    expect((await q(`select status from public.tasks where id = $1`, [task]))[0]!.status).toBe("done");
  });

  it("tür değiştirerek kapatma engellenir (kind='other' + done tek UPDATE'te; normal görev de kaldırma türüne çevrilemez)", async () => {
    const { task } = await mkTakedown();
    await expect(q(`update public.tasks set kind = 'other', status = 'done' where id = $1`, [task])).rejects.toThrow(/eids_takedown_kind_locked/);
    await expect(q(`update public.tasks set kind = 'other' where id = $1`, [task])).rejects.toThrow(/eids_takedown_kind_locked/);
    expect((await q(`select kind, status from public.tasks where id = $1`, [task]))[0]).toEqual({ kind: "eids_takedown", status: "open" });
    const plain = (await q(`insert into public.tasks(tenant_id, kind) values ($1,'other') returning id`, [T]))[0]!.id as string;
    await expect(q(`update public.tasks set kind = 'eids_takedown' where id = $1`, [plain])).rejects.toThrow(/eids_takedown_kind_locked/);
  });

  it("görev iptal edilebilir (kalem beklese de)", async () => {
    const { task } = await mkTakedown();
    await q(`update public.tasks set status = 'cancelled' where id = $1`, [task]);
    expect(await pending(task)).toBe(2);
  });

  it("eklenti 'confirmed_missing' sonucu portal kalemini kendiliğinden işaretler (güncelleme ve ilk kayıt)", async () => {
    const a = await mkTakedown();
    await q(`insert into public.portal_listing_health(portal_listing_id, tenant_id, check_state) values ($1,$2,'suspect')`, [a.pl, T]);
    await q(`update public.portal_listing_health set check_state = 'confirmed_missing' where portal_listing_id = $1`, [a.pl]);
    const row = (await q(`select status, verified_by from public.eids_takedown_items where portal_listing_id = $1`, [a.pl]))[0]!;
    expect(row).toEqual({ status: "removed", verified_by: "extension" });
    expect(await pending(a.task)).toBe(1); // vitrin kalemi elle/sistemle kapanır

    const b = await mkTakedown();
    await q(`insert into public.portal_listing_health(portal_listing_id, tenant_id, check_state) values ($1,$2,'confirmed_missing')`, [b.pl, T]);
    expect((await q(`select status from public.eids_takedown_items where portal_listing_id = $1`, [b.pl]))[0]!.status).toBe("removed");
  });

  it("kalem 'pending' iken done_at taşıyamaz (tutarlılık kısıtı)", async () => {
    const { task } = await mkTakedown();
    await expect(q(`update public.eids_takedown_items set done_at = now() where task_id = $1 and target = 'vitrin'`, [task])).rejects.toThrow();
  });
});
