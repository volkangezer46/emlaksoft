import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadPglite, type Db } from "@/lib/test-support/pglite";

/**
 * İŞLEVSEL SQL TESTİ (pglite):
 *  - 20261018060000_campaign_report_rpc: durum sayıları 500 sınırı olmadan, hata grupları, 7 gün atıf (yanıt/randevu/ret),
 *    sunucu sayfalaması ve kiracı sınırı.
 *  - 20261018060100_inbox_conversation_state: kişi bazlı konuşma, "yanıt bekliyor" (giden yanıt ya da tamamlandı kapatır),
 *    eşleşmemiş numara, arama (ad / numara / mesaj), danışman süzgeci, kiracı sınırı.
 */
const mod = await loadPglite();
const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");

const STUB = `
create role authenticated; create role anon;
create function public.current_tenant_id() returns uuid language sql stable as $$ select nullif(current_setting('test.tenant', true), '')::uuid $$;
create type public.campaign_channel as enum ('sms', 'whatsapp', 'email');
create type public.recipient_status as enum ('pending', 'sent', 'delivered', 'failed', 'opted_out');
create type public.comm_channel as enum ('call', 'whatsapp', 'sms', 'email', 'note', 'meeting');
create type public.comm_direction as enum ('inbound', 'outbound', 'internal');
create table public.tenants(id uuid primary key default gen_random_uuid());
create table public.profiles(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, full_name text);
create table public.customers(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, full_name text not null,
  phone text, assigned_to uuid);
create table public.campaigns(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, channel public.campaign_channel not null default 'sms');
create table public.campaign_recipients(id uuid primary key default gen_random_uuid(), campaign_id uuid not null, customer_id uuid,
  phone text not null default '05320000000', full_name text, status public.recipient_status not null default 'pending', error_msg text, sent_at timestamptz);
create table public.communications(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, customer_id uuid,
  channel public.comm_channel not null default 'sms', direction public.comm_direction not null default 'inbound', subject text, body text,
  contact_address text, created_at timestamptz not null default now());
create table public.calls(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, customer_id uuid, direction text not null,
  phone text not null, notes text, started_at timestamptz not null default now());
create table public.appointments(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, customer_id uuid,
  created_at timestamptz not null default now());
create table public.iys_consents(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, customer_id uuid,
  channel text not null, status text not null, revoked_at timestamptz);
`;

describe.skipIf(!mod)("kampanya raporu ve gelen kutusu konuşmaları (pglite)", () => {
  let db: Db;
  let T: string, T2: string, ADV: string, CAMP: string;
  const c: Record<string, string> = {};
  const q = async (sql: string, params?: unknown[]) => (await db.query(sql, params)).rows;
  const asTenant = (t: string) => db.exec(`set test.tenant = '${t}'`);

  beforeAll(async () => {
    db = new mod!.PGlite();
    await db.exec(STUB);
    await db.exec(read("supabase/migrations/20261018060000_campaign_report_rpc.sql"));
    await db.exec(read("supabase/migrations/20261018060100_inbox_conversation_state.sql"));
    T = (await q(`insert into public.tenants default values returning id`))[0]!.id as string;
    T2 = (await q(`insert into public.tenants default values returning id`))[0]!.id as string;
    ADV = (await q(`insert into public.profiles(tenant_id, full_name) values ($1, 'Danışman') returning id`, [T]))[0]!.id as string;
    for (const [name, phone, adv] of [["Ayşe", "05321112233", ADV], ["Mehmet", "05324445566", null], ["Zeynep", "05327778899", null]] as const) {
      c[name] = (await q(`insert into public.customers(tenant_id, full_name, phone, assigned_to) values ($1, $2, $3, $4) returning id`, [T, name, phone, adv]))[0]!.id as string;
    }
    CAMP = (await q(`insert into public.campaigns(tenant_id) values ($1) returning id`, [T]))[0]!.id as string;
    // 600 alıcı: 500 sınırını aşan gerçek sayım
    await q(`insert into public.campaign_recipients(campaign_id, status, error_msg)
      select $1, (case when g % 3 = 0 then 'failed' else 'pending' end)::public.recipient_status,
             case when g % 3 = 0 then 'Geçersiz numara' end
      from generate_series(1, 600) g`, [CAMP]);
    const sent = "now() - interval '3 days'";
    for (const name of ["Ayşe", "Mehmet", "Zeynep"]) {
      await q(`insert into public.campaign_recipients(campaign_id, customer_id, full_name, status, sent_at) values ($1, $2, $3, 'delivered', ${sent})`, [CAMP, c[name], name]);
    }
    // Ayşe yanıt verdi (SMS), Mehmet randevuya döndü, Zeynep reddetti; pencere dışı (10 gün sonra) sayılmaz
    await q(`insert into public.communications(tenant_id, customer_id, direction, body, created_at) values ($1, $2, 'inbound', 'Fiyat nedir?', now() - interval '2 days')`, [T, c.Ayşe]);
    await q(`insert into public.appointments(tenant_id, customer_id, created_at) values ($1, $2, now() - interval '1 day')`, [T, c.Mehmet]);
    await q(`insert into public.iys_consents(tenant_id, customer_id, channel, status, revoked_at) values ($1, $2, 'sms', 'denied', now() - interval '1 day')`, [T, c.Zeynep]);
    await q(`insert into public.appointments(tenant_id, customer_id, created_at) values ($1, $2, now() + interval '8 days')`, [T, c.Zeynep]);
  });

  it("kampanya raporu: gerçek sayılar, hata grubu ve 7 gün atıf", async () => {
    await asTenant(T);
    const r = (await q(`select public.campaign_report($1) as r`, [CAMP]))[0]!.r as Record<string, unknown>;
    expect(r.total).toBe(603);
    expect(r.failed).toBe(200);
    expect(r.pending).toBe(400);
    expect(r.delivered).toBe(3);
    expect(r.errors).toEqual([{ msg: "Geçersiz numara", count: 200 }]);
    expect(r.replied).toBe(1);
    expect(r.booked).toBe(1);
    expect(r.unsubscribed).toBe(1);
  });

  it("alıcı sayfası sunucuda süzülür ve sayfalanır", async () => {
    await asTenant(T);
    const page2 = await q(`select * from public.campaign_recipient_page($1, 'failed', 7, 50, 50)`, [CAMP]);
    expect(page2).toHaveLength(50);
    expect(Number(page2[0]!.total_count)).toBe(200);
    const yanit = await q(`select full_name from public.campaign_recipient_page($1, 'yanit')`, [CAMP]);
    expect(yanit.map((x) => x.full_name)).toEqual(["Ayşe"]);
    const ret = await q(`select full_name from public.campaign_recipient_page($1, 'ret')`, [CAMP]);
    expect(ret.map((x) => x.full_name)).toEqual(["Zeynep"]);
    expect(await q(`select * from public.campaign_recipient_page($1, 'uydurma')`, [CAMP])).toHaveLength(0);
  });

  it("başka kiracı kampanyayı göremez", async () => {
    await asTenant(T2);
    expect((await q(`select public.campaign_report($1) as r`, [CAMP]))[0]!.r).toBeNull();
    expect(await q(`select * from public.campaign_recipient_page($1)`, [CAMP])).toHaveLength(0);
  });

  it("konuşmalar: yanıt bekleyen, eşleşmemiş numara, giden yanıt ve tamamlandı kapatır", async () => {
    await asTenant(T);
    // Mehmet: gelen WA, sonra giden yanıt → beklemiyor
    await q(`insert into public.communications(tenant_id, customer_id, channel, direction, body, created_at) values ($1, $2, 'whatsapp', 'inbound', 'Kadıköy 3+1 var mı', now() - interval '5 hours')`, [T, c.Mehmet]);
    await q(`insert into public.communications(tenant_id, customer_id, channel, direction, body, created_at) values ($1, $2, 'whatsapp', 'outbound', 'Var, gönderiyorum', now() - interval '4 hours')`, [T, c.Mehmet]);
    // eşleşmemiş numaradan cevapsız arama
    await q(`insert into public.calls(tenant_id, direction, phone, started_at) values ($1, 'missed', '+90 532 999 88 77', now() - interval '1 hour')`, [T]);

    const waiting = await q(`select * from public.inbox_conversations('bekliyor')`);
    const keys = waiting.map((w) => w.contact_key);
    expect(keys).toContain(`c:${c.Ayşe}`);
    expect(keys).toContain("t:5329998877");
    expect(keys).not.toContain(`c:${c.Mehmet}`);
    expect(Number(waiting[0]!.total_count)).toBe(2);

    const closed = await q(`select contact_key from public.inbox_conversations('kapanan')`);
    expect(closed.map((x) => x.contact_key)).toContain(`c:${c.Mehmet}`);

    // tamamlandı: Ayşe'nin gelen mesajı kapanır
    await q(`update public.communications set resolved_at = now() where customer_id = $1 and direction = 'inbound'`, [c.Ayşe]);
    const after = await q(`select contact_key from public.inbox_conversations('bekliyor')`);
    expect(after.map((x) => x.contact_key)).toEqual(["t:5329998877"]);
  });

  it("konuşma araması: ad, numara ve mesaj içeriği; danışman süzgeci", async () => {
    await asTenant(T);
    const byName = await q(`select contact_key from public.inbox_conversations('tumu', null, 'ayş')`);
    expect(byName.map((x) => x.contact_key)).toEqual([`c:${c.Ayşe}`]);
    const byPhone = await q(`select contact_key from public.inbox_conversations('tumu', null, '0532 999')`);
    expect(byPhone.map((x) => x.contact_key)).toEqual(["t:5329998877"]);
    const byBody = await q(`select contact_key from public.inbox_conversations('tumu', null, 'kadıköy')`);
    expect(byBody.map((x) => x.contact_key)).toEqual([`c:${c.Mehmet}`]);
    const mine = await q(`select contact_key from public.inbox_conversations('tumu', $1)`, [ADV]);
    expect(mine.map((x) => x.contact_key)).toEqual([`c:${c.Ayşe}`]);
    await asTenant(T2);
    expect(await q(`select * from public.inbox_conversations('tumu')`)).toHaveLength(0);
  });

  it("geri alma dosyaları uygulanır", async () => {
    await db.exec(read("supabase/rollbacks/20261018060100_inbox_conversation_state.rollback.sql"));
    await db.exec(read("supabase/rollbacks/20261018060000_campaign_report_rpc.rollback.sql"));
    const left = await q(`select proname from pg_proc where proname in ('inbox_conversations', 'campaign_report', 'campaign_recipient_page')`);
    expect(left).toHaveLength(0);
  });
});
