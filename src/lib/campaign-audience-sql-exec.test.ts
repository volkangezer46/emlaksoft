import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadPglite, type Db } from "@/lib/test-support/pglite";
import { isValidCampaignFilter, parseCampaignFilter } from "@/lib/campaign-audience";

/**
 * İŞLEVSEL SQL TESTİ (pglite): 20261016100100_campaign_audience_filters — create_campaign_with_recipients yeni hedef kitle
 * filtreleri (tag / district / advisor) doğru müşteri kümesini kuyruğa alır; kara listedeki, silinmiş ve telefonsuz müşteri
 * HİÇBİR filtrede kuyruğa girmez; biçimi bozuk filtre 22023; rollback eski izin listesine döner.
 * İYS/izin kapısı teslimat anındadır (verify_campaign_recipient_consent) ve bu migration ona dokunmaz (sözleşme testi aşağıda).
 */
const mod = await loadPglite();
const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");
const MIGRATION = "supabase/migrations/20261016100100_campaign_audience_filters.sql";
const ROLLBACK = "supabase/rollbacks/20261016100100_campaign_audience_filters.rollback.sql";

const STUB = `
create role service_role; create role authenticated; create role anon;
create schema auth;
create function auth.role() returns text language sql stable as $$ select nullif(current_setting('test.role', true), '') $$;
create type public.campaign_channel as enum ('sms', 'whatsapp', 'email');
create table public.tenants(id uuid primary key default gen_random_uuid(), status text not null default 'active');
create table public.profiles(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, is_active boolean not null default true);
create table public.customers(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, assigned_to uuid,
  full_name text not null, phone text, customer_types text[] not null default '{}', tags text[] not null default '{}',
  blacklist boolean not null default false, deleted_at timestamptz);
create table public.customer_demands(id uuid primary key default gen_random_uuid(), tenant_id uuid not null,
  customer_id uuid not null references public.customers(id), district_id uuid, status text not null default 'new');
create table public.campaigns(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, created_by uuid,
  title text, channel public.campaign_channel, message text, whatsapp_template_name text, whatsapp_template_language text,
  status text, total_count integer);
create table public.campaign_recipients(id uuid primary key default gen_random_uuid(), campaign_id uuid not null,
  customer_id uuid, phone text, full_name text, status text, delivery_state text);
`;

const D1 = "11111111-1111-4111-8111-111111111111";
const D2 = "22222222-2222-4222-8222-222222222222";

describe.skipIf(!mod)("kampanya hedef kitle filtreleri (pglite)", () => {
  let db: Db;
  let T: string, T2: string, ACTOR: string, ADV: string, ADV2: string;
  const c: Record<string, string> = {};
  const q = async (sql: string, params?: unknown[]) => (await db.query(sql, params)).rows;

  const create = async (filter: string, tenant = T) => {
    await db.exec(`set test.role = 'service_role'`);
    const r = await q(
      `select public.create_campaign_with_recipients($1, $2, 'Test', 'sms', 'Merhaba', $3) as res`,
      [tenant, ACTOR, filter],
    );
    const id = (r[0]!.res as { id: string }).id;
    const rows = await q(`select customer_id from public.campaign_recipients where campaign_id = $1 order by customer_id`, [id]);
    return rows.map((x) => x.customer_id as string).sort();
  };
  const ids = (...names: string[]) => names.map((n) => c[n]!).sort();

  const customer = async (name: string, opts: { tenant?: string; tags?: string[]; advisor?: string | null; blacklist?: boolean; phone?: string | null; deleted?: boolean; types?: string[] } = {}) => {
    c[name] = (await q(
      `insert into public.customers(tenant_id, full_name, phone, tags, assigned_to, blacklist, deleted_at, customer_types)
       values ($1, $2, $3, $4::text[], $5, $6, $7, $8::text[]) returning id`,
      [opts.tenant ?? T, name, opts.phone === undefined ? "05321234567" : opts.phone, opts.tags ?? [], opts.advisor ?? null,
        opts.blacklist ?? false, opts.deleted ? "2026-01-01T00:00:00Z" : null, opts.types ?? []],
    ))[0]!.id as string;
  };
  const demand = async (cust: string, district: string, status = "new", tenant = T) =>
    q(`insert into public.customer_demands(tenant_id, customer_id, district_id, status) values ($1, $2, $3, $4)`, [tenant, c[cust], district, status]);

  beforeAll(async () => {
    db = new mod!.PGlite();
    await db.exec(STUB);
    T = (await q(`insert into public.tenants default values returning id`))[0]!.id as string;
    T2 = (await q(`insert into public.tenants default values returning id`))[0]!.id as string;
    ACTOR = (await q(`insert into public.profiles(tenant_id) values ($1) returning id`, [T]))[0]!.id as string;
    ADV = (await q(`insert into public.profiles(tenant_id) values ($1) returning id`, [T]))[0]!.id as string;
    ADV2 = (await q(`insert into public.profiles(tenant_id) values ($1) returning id`, [T]))[0]!.id as string;

    await customer("vip_adv", { tags: ["VIP", "Yatırımcı"], advisor: ADV, types: ["alici"] });
    await customer("vip_only", { tags: ["VIP"], advisor: ADV2 });
    await customer("vip_lower", { tags: ["vip"], advisor: ADV });
    await customer("vip_black", { tags: ["VIP"], advisor: ADV, blacklist: true });
    await customer("vip_deleted", { tags: ["VIP"], advisor: ADV, deleted: true });
    await customer("vip_nophone", { tags: ["VIP"], advisor: ADV, phone: "  " });
    await customer("plain", {});
    await customer("other_tenant", { tenant: T2, tags: ["VIP"], advisor: ADV });

    await demand("vip_adv", D1, "active");
    await demand("plain", D1, "matched");
    await demand("vip_only", D1, "closed"); // kapalı talep sayılmaz
    await demand("vip_lower", D2, "new");
    await demand("vip_black", D1, "new");
    await demand("vip_deleted", D1, "new");
    await demand("other_tenant", D1, "new", T2);

    await db.exec(read(MIGRATION));
  });

  it("tag: tam eşleşme; kara liste, silinmiş, telefonsuz ve başka kiracı dışarıda", async () => {
    expect(await create("tag:VIP")).toEqual(ids("vip_adv", "vip_only"));
    expect(await create("tag:Yatırımcı")).toEqual(ids("vip_adv"));
    expect(await create("tag:vip")).toEqual(ids("vip_lower"));
  });

  it("district: yalnız o ilçede AÇIK talebi olan müşteriler", async () => {
    expect(await create(`district:${D1}`)).toEqual(ids("vip_adv", "plain"));
    expect(await create(`district:${D2}`)).toEqual(ids("vip_lower"));
  });

  it("advisor: atanmış danışman; kara listedeki müşteri yine dışarıda", async () => {
    expect(await create(`advisor:${ADV}`)).toEqual(ids("vip_adv", "vip_lower"));
    expect(await create(`advisor:${ADV2}`)).toEqual(ids("vip_only"));
  });

  it("mevcut all / type:* davranışı aynı", async () => {
    expect(await create("all")).toEqual(ids("vip_adv", "vip_only", "vip_lower", "plain"));
    expect(await create("type:alici")).toEqual(ids("vip_adv"));
  });

  it("eşleşen alıcı yoksa kampanya oluşmaz", async () => {
    await expect(create("tag:Yok")).rejects.toThrow(/No eligible campaign recipients/);
    await expect(create(`district:${"33333333-3333-4333-8333-333333333333"}`)).rejects.toThrow(/No eligible campaign recipients/);
  });

  it("bozuk biçimler 22023 ile reddedilir (TS ayrıştırıcısıyla aynı karar)", async () => {
    const bad = [
      "tag:", "tag: VIP", "tag:a  b", "tag:x\u0001", `tag:${"a".repeat(31)}`,
      "district:not-a-uuid", "district:AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA", `advisor:${ADV}x`,
      "advisor:", "branch:" + D1, "type:yatirimci", "tags:VIP", `DISTRICT:${D1}`,
    ];
    for (const f of bad) {
      expect(isValidCampaignFilter(f), f).toBe(false);
      await expect(create(f), f).rejects.toMatchObject({ code: "22023" });
    }
    for (const f of ["tag:VIP", "tag:a b", `tag:${"a".repeat(30)}`, `district:${D1}`, `advisor:${ADV}`]) {
      expect(isValidCampaignFilter(f), f).toBe(true);
    }
  });

  it("service_role dışında çağrı reddedilir", async () => {
    await db.exec(`set test.role = 'authenticated'`);
    await expect(q(`select public.create_campaign_with_recipients($1, $2, 'T', 'sms', 'M', 'tag:VIP')`, [T, ACTOR]))
      .rejects.toMatchObject({ code: "42501" });
  });

  it("rollback eski izin listesine döner (tag: reddedilir, all çalışır)", async () => {
    await db.exec(read(ROLLBACK));
    await expect(create("tag:VIP")).rejects.toMatchObject({ code: "22023" });
    expect(await create("all")).toEqual(ids("vip_adv", "vip_only", "vip_lower", "plain"));
    await db.exec(read(MIGRATION));
  });
});

describe("kampanya hedef kitle sözleşmesi", () => {
  const sql = read(MIGRATION).replace(/--[^\n]*/g, "");
  const action = read("src/app/actions/campaigns.ts");

  it("migration yalnız oluşturma RPC'sini değiştirir; teslimat/izin fonksiyonlarına dokunmaz", () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.create_campaign_with_recipients\(/);
    expect(sql).not.toMatch(/verify_campaign_recipient_consent|claim_campaign_delivery|enqueue_campaign_delivery/);
    expect(sql).not.toMatch(/\bgrant\b|\brevoke\b/i);
    expect(sql).toContain("and c.blacklist = false");
    expect(sql).toContain("and c.deleted_at is null");
    expect(sql).toContain("and nullif(btrim(coalesce(c.phone, '')), '') is not null");
    expect(sql).toContain("if auth.role() is distinct from 'service_role' then");
  });

  it("önizleme her filtrede kara listeyi dışlar ve İYS kapısından geçirir", () => {
    const preview = action.slice(action.indexOf("export async function previewCampaignAudience"), action.indexOf("export async function createCampaign"));
    expect(preview).toContain('.eq("blacklist", false)');
    expect(preview).toContain("gateIysRecipients(");
    expect(preview).toContain("parseCampaignFilter(");
    expect(action).toContain("isValidCampaignFilter(filter)");
  });

  it("ayrıştırıcı türleri doğru çıkarır", () => {
    expect(parseCampaignFilter("all")).toEqual({ kind: "all" });
    expect(parseCampaignFilter("type:kira")).toEqual({ kind: "type", value: "kira" });
    expect(parseCampaignFilter("tag:Sıcak müşteri")).toEqual({ kind: "tag", value: "Sıcak müşteri" });
    expect(parseCampaignFilter(`district:${D1}`)).toEqual({ kind: "district", value: D1 });
    expect(parseCampaignFilter(`advisor:${D2}`)).toEqual({ kind: "advisor", value: D2 });
  });
});
