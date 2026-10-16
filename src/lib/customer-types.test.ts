import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadPglite, type Db } from "@/lib/test-support/pglite";
import { DEFAULT_DEFINITIONS } from "@/lib/definition-defaults";
import { CAMPAIGN_TYPE_VALUES } from "@/lib/campaign-audience";
import { CANONICAL_CUSTOMER_TYPES, CUSTOMER_TYPE_ALIASES, canonicalCustomerType, normalizeCustomerTypes } from "./customer-types";

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");
const MIGRATION = "supabase/migrations/20261023030000_normalize_customer_types.sql";
const PREV = "supabase/migrations/20261016110100_campaign_audience_filters.sql";

describe("müşteri türü kanonik yazım (saf)", () => {
  it("kanonik liste tanım varsayılanlarıyla birebir", () => {
    expect([...CANONICAL_CUSTOMER_TYPES]).toEqual(DEFAULT_DEFINITIONS.customer_type.map((d) => d.value));
    for (const v of Object.values(CUSTOMER_TYPE_ALIASES)) expect(CANONICAL_CUSTOMER_TYPES).toContain(v);
  });
  it("büyük/küçük harf ve Türkçe karakter farkı tek türe iner; özel tür korunur", () => {
    expect(canonicalCustomerType("alici")).toBe("Alıcı");
    expect(canonicalCustomerType("ALICI")).toBe("Alıcı");
    expect(canonicalCustomerType(" Alıcı ")).toBe("Alıcı");
    expect(canonicalCustomerType("mulk_sahibi")).toBe("Mülk sahibi");
    expect(canonicalCustomerType("Malik")).toBe("Mülk sahibi");
    expect(canonicalCustomerType("Arsa sahibi")).toBe("Arsa sahibi");
    expect(canonicalCustomerType("  ")).toBeNull();
    expect(normalizeCustomerTypes(["alici", "Alıcı", "", null, "kiraci"])).toEqual(["Alıcı", "Kiracı"]);
  });
  it("SQL göçündeki eşleme TS eşlemesiyle birebir", () => {
    const sql = read(MIGRATION);
    for (const [k, v] of Object.entries(CUSTOMER_TYPE_ALIASES)) expect(sql).toContain(`('${k}', '${v}')`);
    // Kampanya önizlemesi (TS) ile kuyruğa alma (SQL) aynı tür değerlerini eşler.
    for (const [k, vals] of Object.entries(CAMPAIGN_TYPE_VALUES)) {
      expect(sql).toContain(`when '${k}' then array[${vals.map((v) => `'${v}'`).join(", ")}]`);
      expect(canonicalCustomerType(vals[0])).toBe(vals[0]);
    }
  });
});

const mod = await loadPglite();

describe.skipIf(!mod)("müşteri türü göçü + kampanya tür süzgeci (pglite)", () => {
  let db: Db;
  let T: string, ACTOR: string;
  const q = async (sql: string, params?: unknown[]) => (await db.query(sql, params)).rows;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    db = new mod!.PGlite();
    await db.exec(`
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
    `);
    await db.exec(read(PREV));
    T = (await q(`insert into public.tenants default values returning id`))[0]!.id as string;
    ACTOR = (await q(`insert into public.profiles(tenant_id) values ($1) returning id`, [T]))[0]!.id as string;
    const add = async (name: string, types: string[]) => {
      ids[name] = (await q(`insert into public.customers(tenant_id, full_name, phone, customer_types) values ($1, $2, '05321234567', $3::text[]) returning id`, [T, name, types]))[0]!.id as string;
    };
    await add("ascii", ["alici"]);
    await add("kanonik", ["Alıcı"]);
    await add("karisik", ["ALICI", "Alıcı", "mulk_sahibi", "Arsa sahibi"]);
    await add("kiraci", ["kiraci"]);
    await add("bos", []);
    await db.exec(read(MIGRATION));
  });

  const typesOf = async (name: string) => (await q(`select customer_types from public.customers where id = $1`, [ids[name]]))[0]!.customer_types;
  const campaign = async (filter: string) => {
    await db.exec(`set test.role = 'service_role'`);
    const r = await q(`select public.create_campaign_with_recipients($1, $2, 'Test', 'sms', 'Merhaba', $3) as res`, [T, ACTOR, filter]);
    const id = (r[0]!.res as { id: string }).id;
    return (await q(`select customer_id from public.campaign_recipients where campaign_id = $1`, [id])).map((x) => x.customer_id as string).sort();
  };

  it("eş anlamlı/ASCII yazım kanoniğe iner; sıra korunur, tekrar atılır, özel tür kalır", async () => {
    expect(await typesOf("ascii")).toEqual(["Alıcı"]);
    expect(await typesOf("kanonik")).toEqual(["Alıcı"]);
    expect(await typesOf("karisik")).toEqual(["Alıcı", "Mülk sahibi", "Arsa sahibi"]);
    expect(await typesOf("kiraci")).toEqual(["Kiracı"]);
    expect(await typesOf("bos")).toEqual([]);
  });

  it("kampanya tür süzgeci kanonik değerle eşleşir (eskiden 'type:alici' kanonik Alıcı'yı kapsamıyordu)", async () => {
    expect(await campaign("type:alici")).toEqual([ids.ascii, ids.kanonik, ids.karisik].sort());
    expect(await campaign("type:kira")).toEqual([ids.kiraci]);
    await expect(campaign("type:satici")).rejects.toThrow(/No eligible campaign recipients/);
  });

  it("göç tekrar çalıştırılabilir (değişmeyen satıra dokunmaz)", async () => {
    await db.exec(read(MIGRATION));
    expect(await typesOf("karisik")).toEqual(["Alıcı", "Mülk sahibi", "Arsa sahibi"]);
  });
});
