import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadPglite, type Db } from "@/lib/test-support/pglite";
import { seedRuleSet } from "./seed-rules";
import { restamp, stampFor } from "./rule-apply";

/**
 * İŞLEVSEL SQL TESTİ (pglite): 20261013002000/002010/002020 — öğrenen kurallar. Gerçek tablo/RPC gövdeleri çalışır;
 * bağımlı çekirdek (oturum tablosu 20261012002700 gerçek, bind/kapsam yardımcıları sadeleştirilmiş taklit).
 */
const mod = await loadPglite();
const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");

const STUB = `
create role service_role; create role authenticated; create role anon;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('t.uid', true), '')::uuid $$;
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('t.jwt', true), ''), '{}')::jsonb $$;
create function auth.role() returns text language sql stable as $$ select 'authenticated'::text $$;
create function public.current_tenant_id() returns uuid language sql stable as $$ select nullif(current_setting('t.tenant', true), '')::uuid $$;
create function public.current_profile_role() returns text language sql stable as $$ select current_setting('t.role', true) $$;
create function public.has_effective_permission(m text, a text) returns boolean language sql stable as $$ select coalesce(current_setting('t.deny', true), '') <> m || ':' || a $$;
create function public.lc_row_visible(b uuid, t uuid, a uuid) returns boolean language sql stable as $$ select true $$;
create function public.lc_mark_state_stale(t uuid, p uuid) returns void language sql as $$ select 1 $$;
create function public.block_readonly_identity_writes() returns trigger language plpgsql as $$
begin
  if current_setting('t.role', true) = 'readonly' then raise exception 'readonly' using errcode = '42501'; end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
create table public.tenants(id uuid primary key default gen_random_uuid(), name text, status text default 'active',
  created_at timestamptz default now() - interval '100 days', sample_pack text);
create table public.profiles(id uuid primary key default gen_random_uuid(), tenant_id uuid, team_id uuid);
create table public.properties(id uuid primary key default gen_random_uuid(), tenant_id uuid, branch_id uuid, assigned_to uuid, status text default 'live', deleted_at timestamptz);
create table public.portal_listings(id uuid primary key default gen_random_uuid(), tenant_id uuid, property_id uuid, portal_name text, portal_listing_id text,
  portal_url text, status text default 'live', source_kind text, created_via text, last_confirmed_at timestamptz);
create function public.lc_bind_portal_listing(t uuid, a uuid, p uuid, portal text, ext text, url text, sk text, cv text) returns jsonb language sql as $$
  select jsonb_build_object('outcome', 'applied', 'listing_id', gen_random_uuid()) $$;
create table public.listing_verifications(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, portal_listing_id uuid not null,
  checked_at timestamptz not null default now(), result text not null, source_kind text not null, client_id uuid, job_id uuid);
create table public.platform_staff(id uuid primary key, role text not null, is_active boolean not null default true);
create table public.platform_audit_logs(id uuid primary key default gen_random_uuid(), actor_id uuid, action text not null, entity_type text, entity_id uuid, meta jsonb, created_at timestamptz not null default now());
create table public.platform_settings(key text primary key, value text);
create table public.platform_notifications(id uuid primary key default gen_random_uuid(), staff_id uuid not null, title text not null, body text, href text, kind text not null default 'info', meta jsonb not null default '{}', created_at timestamptz default now());
`;

const hex = (c: string, n = 64) => c.repeat(n).slice(0, n);
const SIG = "A".repeat(86);

describe.skipIf(!mod)("öğrenen portal kuralları (pglite)", () => {
  let db: Db;
  const q = async (sql: string, params?: unknown[]) => (await db.query(sql, params)).rows;
  const as = async (tenant: string, uid: string, opts: { role?: string; deny?: string; jwt?: string } = {}) => {
    await db.query(
      `select set_config('t.tenant',$1,false), set_config('t.uid',$2,false), set_config('t.role',$3,false), set_config('t.deny',$4,false), set_config('t.jwt',$5,false)`,
      [tenant, uid, opts.role ?? "advisor", opts.deny ?? "", opts.jwt ?? ""],
    );
  };
  const call = async (fn: string, args: unknown[]) => {
    const marks = args.map((_, i) => `$${i + 1}`).join(", ");
    return (await q(`select public.${fn}(${marks}) as r`, args))[0]!.r as Record<string, unknown>;
  };
  const tenant = async (name: string) => (await q(`insert into public.tenants(name) values ($1) returning id`, [name]))[0]!.id as string;
  const user = async (t: string) => (await q(`insert into public.profiles(tenant_id) values ($1) returning id`, [t]))[0]!.id as string;
  const property = async (t: string, u: string) => (await q(`insert into public.properties(tenant_id, assigned_to) values ($1,$2) returning id`, [t, u]))[0]!.id as string;

  /**
   * Yayın oturumu. 'worker': eklentiyle bağlanmış, ilan kontrol İŞÇİSİ (kuyruk işi) bağdan 2 saat sonra görmüş (doğrulanmış).
   * 'manual': ofis yalnız "Teyit et"e basmış (last_confirmed_at + elle 'present'); doğrulanmış SAYILMAZ.
   */
  const publishedSession = async (t: string, u: string, completedAgo: string, portal = "sahibinden", verify: "worker" | "manual" = "worker") => {
    const p = await property(t, u);
    const pl = (await q(
      `insert into public.portal_listings(tenant_id, property_id, portal_name, status, source_kind, last_confirmed_at)
       values ($1,$2,'Sahibinden','live','assisted', now() - $3::interval + interval '2 hours') returning id`,
      [t, p, completedAgo],
    ))[0]!.id as string;
    await q(
      `insert into public.listing_verifications(tenant_id, portal_listing_id, checked_at, result, source_kind, client_id, job_id)
       values ($1,$2, now() - $3::interval + interval '2 hours', 'present', $4, $5, $5)`,
      [t, pl, completedAgo, verify === "worker" ? "assisted" : "manual", verify === "worker" ? crypto.randomUUID() : null],
    );
    return (await q(
      `insert into public.portal_transfer_sessions(tenant_id, property_id, portal, state, actor_id, expires_at, created_at, completed_at, portal_listing_id)
       values ($1,$2,$3,'published',$4, now(), now() - $5::interval, now() - $5::interval, $6) returning id`,
      [t, p, portal, u, completedAgo, pl],
    ))[0]!.id as string;
  };
  const event = async (t: string, sid: string, sig: string, outcome: string, at: string, key = "heating") => {
    await q(
      `insert into public.portal_fill_events(tenant_id, session_id, portal, field_key, field_sig, outcome, phase, created_at, updated_at)
       values ($1,$2,'sahibinden',$3,$4,$5,'published', now() - $6::interval, now() - $6::interval)`,
      [t, sid, key, sig, outcome, at],
    );
  };
  const payload = (sid: string, fields: unknown[], over: Record<string, unknown> = {}) => ({
    v: 1, sessionId: sid, portal: "sahibinden", engine: "f1", ruleVersion: 0, ruleSha: hex("a", 16), phase: "filled",
    formFp: hex("f"), rulesRegressed: false, consentTextVersion: 1, counts: { controls: fields.length, droppedPii: 0 }, fields, ...over,
  });
  const field = (sig: string, label = "isitma", extra: Record<string, unknown> = {}) => ({
    sig, key: "heating", control: "choice", label, labelSource: "label_for", options: ["kombi dogalgaz", "merkezi"], required: true, outcome: "filled", ...extra,
  });
  const content = (version: number, portal = "sahibinden") => restamp(seedRuleSet(portal as "sahibinden"), stampFor(version, Date.now(), 14));

  let TA: string, TB: string, UA: string, UB: string, STAFF: string, SUPPORT: string;

  beforeAll(async () => {
    db = new mod!.PGlite();
    await db.exec(STUB);
    await db.exec(read("supabase/migrations/20261012002700_portal_transfer_sessions.sql"));
    await db.exec(read("supabase/migrations/20261013002000_portal_rules_core.sql"));
    await db.exec(read("supabase/migrations/20261013002010_portal_rules_rpcs.sql"));
    await db.exec(read("supabase/migrations/20261013002020_portal_rules_learn.sql"));
    TA = await tenant("Ofis A");
    TB = await tenant("Ofis B");
    UA = await user(TA);
    UB = await user(TB);
    STAFF = (await q(`insert into public.platform_staff(id, role) values (gen_random_uuid(), 'super_admin') returning id`))[0]!.id as string;
    SUPPORT = (await q(`insert into public.platform_staff(id, role) values (gen_random_uuid(), 'support') returning id`))[0]!.id as string;
  });

  const filledSession = async (t: string, u: string, createdAgo = "1 hour") => {
    const p = await property(t, u);
    return (await q(
      `insert into public.portal_transfer_sessions(tenant_id, property_id, portal, state, actor_id, expires_at, created_at)
       values ($1,$2,'sahibinden','filled',$3, now(), now() - $4::interval) returning id`,
      [t, p, u, createdAgo],
    ))[0]!.id as string;
  };

  it("geri bildirim: kiracı A, B'nin oturumuna yazamaz; sahibi yazar; rızasız yük reddedilir", async () => {
    const sidB = await filledSession(TB, UB);
    await as(TA, UA);
    expect(await call("pt_report_form_feedback", [sidB, payload(sidB, [field(hex("1"))])])).toMatchObject({ outcome: "invalid" });
    await as(TB, UB);
    expect(await call("pt_report_form_feedback", [sidB, payload(sidB, [field(hex("1"))], { consentTextVersion: 0 })])).toMatchObject({ outcome: "consent_required" });
    expect(await call("pt_report_form_feedback", [sidB, payload(sidB, [field(hex("1"))])])).toMatchObject({ outcome: "ok", accepted: 1, dropped: 0 });
    expect((await q(`select count(*)::int n from public.portal_fill_events where session_id = $1`, [sidB]))[0]!.n).toBe(1);
    await as(TB, UB, { deny: "portals:edit" });
    expect(await call("pt_report_form_feedback", [sidB, payload(sidB, [field(hex("1"))])])).toMatchObject({ outcome: "forbidden" });
  });

  it("geri bildirim: 24 saatten eski oturum reddedilir; kişisel desenli etiket/seçenek atılır; yalnız ileri faz günceller", async () => {
    await as(TA, UA);
    const old = await filledSession(TA, UA, "25 hours");
    expect(await call("pt_report_form_feedback", [old, payload(old, [field(hex("2"))])])).toMatchObject({ outcome: "expired" });
    const sid = await filledSession(TA, UA);
    const r = await call("pt_report_form_feedback", [
      sid,
      payload(sid, [
        field(hex("3")),
        field(hex("4"), "cep telefonu"),
        field(hex("5"), "fiyat 5321234567"),
        field(hex("6"), "kat", { options: ["532 123 45 67", "1", "2"] }),
      ]),
    ]);
    expect(r).toMatchObject({ outcome: "ok", accepted: 2 });
    expect(Number(r.dropped)).toBeGreaterThanOrEqual(3);
    // %30 kuralı: 3 seçenekten 1'i atıldı (%33) → liste tümden boş
    expect((await q(`select options_folded from public.portal_form_reports where field_sig = $1`, [hex("6")]))[0]!.options_folded).toEqual([]);
    // checked fazı ileri; ardından gelen filled geri almaz
    await call("pt_report_form_feedback", [sid, payload(sid, [field(hex("3"), "isitma", { outcome: "accepted" })], { phase: "checked" })]);
    await call("pt_report_form_feedback", [sid, payload(sid, [field(hex("3"), "isitma", { outcome: "filled" })])]);
    expect((await q(`select phase, outcome from public.portal_fill_events where session_id = $1 and field_sig = $2`, [sid, hex("3")]))[0]).toEqual({ phase: "checked", outcome: "accepted" });
  });

  it("geri bildirim: kiracı başına günde 300 rapor satırı sınırı", async () => {
    const T = await tenant("Kota");
    const U = await user(T);
    await as(T, U);
    let limited = 0;
    for (let s = 0; s < 3; s++) {
      const sid = await filledSession(T, U);
      const fields = Array.from({ length: 120 }, (_, i) => field((s * 1000 + i).toString(16).padStart(64, "0")));
      const r = await call("pt_report_form_feedback", [sid, payload(sid, fields)]);
      limited += Number(r.limited);
    }
    expect((await q(`select count(*)::int n from public.portal_form_reports where tenant_id = $1`, [T]))[0]!.n).toBe(300);
    expect(limited).toBe(60);
  });

  it("öğrenme: aynı ofisin 10 oturumu tek oy; 3 uygun ofis + 6 oturum + 2 hafta → ready; uygun olmayan ofisin oyu sayılmaz", async () => {
    const sig = hex("c");
    const offices: string[] = [];
    for (const name of ["U1", "U2", "U3"]) {
      const t = await tenant(name);
      const u = await user(t);
      offices.push(t);
      await q(`insert into public.portal_rule_tenant_trust(tenant_id, eligible, reason) values ($1, true, 'test')`, [t]);
      // ofis başına 2 oturum, iki farklı haftada
      for (const ago of ["10 days", "2 days"]) {
        const sid = await publishedSession(t, u, ago);
        await event(t, sid, sig, "accepted", ago);
      }
    }
    // tek ofisin 10 oturumu (uygun) → tek oy satırı
    const big = await tenant("Buyuk");
    const bigU = await user(big);
    await q(`insert into public.portal_rule_tenant_trust(tenant_id, eligible, reason) values ($1, true, 'test')`, [big]);
    for (let i = 0; i < 10; i++) {
      const sid = await publishedSession(big, bigU, `${3 + i} days`);
      await event(big, sid, sig, "accepted", `${3 + i} days`);
    }
    // uygun OLMAYAN ofis karşı oy verir
    const bad = await tenant("Deneme");
    const badU = await user(bad);
    await q(`insert into public.portal_rule_tenant_trust(tenant_id, eligible, reason) values ($1, false, 'test ofisi')`, [bad]);
    for (const ago of ["1 day", "2 days", "3 days"]) {
      const sid = await publishedSession(bad, badU, ago);
      await event(bad, sid, sig, "cleared", ago);
    }

    const summary = await call("pt_rules_learn", [new Date().toISOString()]);
    expect(summary).toMatchObject({ outcome: "ok" });
    const key = (await q(`select proposal_key from public.portal_rule_proposals where kind = 'label_map' and field_sig = $1`, [sig]))[0]!.proposal_key as string;
    const votes = await q(`select tenant_id, stance, sessions_n, eligible from public.portal_rule_votes where proposal_key = $1`, [key]);
    expect(votes.filter((v) => v.tenant_id === big)).toEqual([{ tenant_id: big, stance: 1, sessions_n: 10, eligible: true }]);
    expect(votes.find((v) => v.tenant_id === bad)).toMatchObject({ stance: -1, eligible: false });
    const p = (await q(`select state, support_tenants, contradict_tenants, support_sessions, weeks_n, confidence from public.portal_rule_proposals where proposal_key = $1`, [key]))[0]!;
    expect(p).toMatchObject({ state: "ready", support_tenants: 4, contradict_tenants: 0 });
    // Olaylar now()'a göre 2–12 gün önce: takvim haftası sayısı haftanın gününe göre 2 ya da 3 olur (10 ve 2 gün önce her
    // zaman ayrı haftalardır). Kural yalnız ≥2 hafta ister; sabit 2 beklemek testi güne bağımlı yapıyordu.
    expect(Number(p.weeks_n)).toBeGreaterThanOrEqual(2);
    expect(Number(p.weeks_n)).toBeLessThanOrEqual(3);
    expect(Number(p.support_sessions)).toBe(16);
    expect(Number(p.confidence)).toBeCloseTo(0.596, 3);
    expect((summary.ready as { field_key: string }[]).some((r) => r.field_key === "heating")).toBe(true);
    // eşik yükselirse (platform ayarı) ready → collecting
    await q(`insert into public.platform_settings(key, value) values ('portal_rules.min_tenants', '5')`);
    await call("pt_rules_learn", [new Date().toISOString()]);
    expect((await q(`select state from public.portal_rule_proposals where proposal_key = $1`, [key]))[0]!.state).toBe("collecting");
    await q(`delete from public.platform_settings where key = 'portal_rules.min_tenants'`);
  });

  /** n uygun ofis; her biri verilen zamanlarda birer oturum ve 'accepted' olay üretir. */
  const eligibleOffices = async (n: number, sig: string, agos: string[], opts: { key?: string; verify?: "worker" | "manual" } = {}) => {
    const out: string[] = [];
    for (let i = 0; i < n; i++) {
      const t = await tenant(`E${sig.slice(0, 4)}${i}`);
      const u = await user(t);
      out.push(t);
      await q(`insert into public.portal_rule_tenant_trust(tenant_id, eligible, reason) values ($1, true, 'test')`, [t]);
      for (const ago of agos) {
        const sid = await publishedSession(t, u, ago, "sahibinden", opts.verify ?? "worker");
        await event(t, sid, sig, "accepted", ago, opts.key ?? "heating");
      }
    }
    return out;
  };
  const proposalOf = async (sig: string) =>
    (await q(`select proposal_key, state, support_tenants, support_sessions, weeks_n, confidence from public.portal_rule_proposals where kind = 'label_map' and field_sig = $1`, [sig]))[0];

  it("öğrenme eşiği: tam 3 uygun ofis × 2 oturum × 2 hafta → ready (0,526); 2 ofis ya da tek hafta → collecting", async () => {
    const exact = hex("1a");
    await eligibleOffices(3, exact, ["10 days", "2 days"]);
    const twoOffices = hex("2b");
    await eligibleOffices(2, twoOffices, ["10 days", "2 days"]);
    const oneWeek = hex("3c");
    await eligibleOffices(3, oneWeek, ["1 hour", "90 minutes"]);
    await call("pt_rules_learn", [new Date().toISOString()]);
    const a = (await proposalOf(exact))!;
    expect(a).toMatchObject({ state: "ready", support_tenants: 3, weeks_n: 2 });
    expect(Number(a.support_sessions)).toBe(6);
    expect(Number(a.confidence)).toBeCloseTo(0.526, 3);
    expect(await proposalOf(twoOffices)).toMatchObject({ state: "collecting", support_tenants: 2 });
    expect(await proposalOf(oneWeek)).toMatchObject({ state: "collecting", support_tenants: 3, weeks_n: 1 });
  });

  it("Y3: yalnız elle 'Teyit et' (last_confirmed_at / manual) ile doğrulanan oturum oy ve uygunluk üretmez", async () => {
    const sig = hex("4d");
    const t = await tenant("ElleTeyit");
    const u = await user(t);
    for (const ago of ["10 days", "5 days", "2 days"]) {
      const sid = await publishedSession(t, u, ago, "sahibinden", "manual");
      await event(t, sid, sig, "accepted", ago);
    }
    // Uygunluk: 3 "teyitli" yayın olsa da varsayılan uygunluk yok (14 gün eski aktif ofis).
    const eligible = (await q(`select public.pt_rules_eligible_tenants(now()) as r`))[0]!.r as string[];
    expect(eligible).not.toContain(t);
    await call("pt_rules_learn", [new Date().toISOString()]);
    expect(await proposalOf(sig)).toBeUndefined();
    expect((await q(`select count(*)::int n from public.portal_rule_votes where tenant_id = $1`, [t]))[0]!.n).toBe(0);
    // Aynı ofis işçi doğrulamalı 3 yayın yapınca varsayılan uygun olur.
    for (const ago of ["9 days", "4 days", "1 day"]) await publishedSession(t, u, ago);
    expect((await q(`select public.pt_rules_eligible_tenants(now()) as r`))[0]!.r as string[]).toContain(t);
    // Personel paneli aynı kuralı sayar: 6 yayından yalnız işçinin gördüğü 3'ü.
    await as("", STAFF);
    const list = await call("pt_rules_admin_trust_list", []);
    expect((list.tenants as { tenant_id: string; verified_sessions_60d: number; default_eligible: boolean }[]).find((x) => x.tenant_id === t))
      .toMatchObject({ verified_sessions_60d: 3, default_eligible: true });
  });

  it("riskli anahtar (price) için etiket önerisi üretilmez; eski haftanın geriletme adayı yenisiyle değiştirilir", async () => {
    const sig = hex("5e");
    await eligibleOffices(3, sig, ["10 days", "2 days"], { key: "price" });
    const old = (await q(
      `insert into public.portal_rule_proposals(portal, proposal_key, kind, field_key, proposal, source, state, first_seen, last_evaluated)
       values ('emlakjet', $1, 'field_demote', 'rooms', '{}', 'corrections', 'ready', now() - interval '8 days', now() - interval '1 day') returning id`,
      [hex("6f")],
    ))[0]!.id as string;
    const cur = (await q(
      `insert into public.portal_rule_proposals(portal, proposal_key, kind, field_key, proposal, source, state, first_seen, last_evaluated)
       values ('emlakjet', $1, 'field_demote', 'rooms', '{}', 'corrections', 'ready', now() - interval '1 day', now() - interval '1 day') returning id`,
      [hex("7a")],
    ))[0]!.id as string;
    const stale = (await q(
      `insert into public.portal_rule_proposals(portal, proposal_key, kind, field_key, proposal, source, state, first_seen, last_evaluated)
       values ('emlakjet', $1, 'field_demote', 'floor', '{}', 'corrections', 'ready', now() - interval '20 days', now() - interval '20 days') returning id`,
      [hex("8b")],
    ))[0]!.id as string;
    const summary = await call("pt_rules_learn", [new Date().toISOString()]);
    expect(await proposalOf(sig)).toBeUndefined();
    expect((summary.ready as { field_key: string }[]).some((r) => r.field_key === "price")).toBe(false);
    const states = Object.fromEntries((await q(`select id, state from public.portal_rule_proposals where id = any ($1::uuid[])`, [[old, cur, stale]])).map((r) => [r.id, r.state]));
    expect(states).toEqual({ [old]: "superseded", [cur]: "ready", [stale]: "expired" });
    // otomatik yayında uygulanamayan öneri işaretlenir (yalnız service_role)
    expect(await call("pt_rules_mark_invalid", [[cur], "label_shared:x"])).toBe(1);
    expect((await q(`select state, decision_reason from public.portal_rule_proposals where id = $1`, [cur]))[0]).toEqual({
      state: "rejected",
      decision_reason: "Otomatik yayında uygulanamadı: label_shared:x",
    });
    const grants = await q(`select grantee from information_schema.routine_privileges where routine_name = 'pt_rules_mark_invalid' and grantee in ('authenticated','anon','service_role')`);
    expect(grants.map((g) => g.grantee)).toEqual(["service_role"]);
  });

  it("yayın: personel olmayan ve destek rolü yönetim RPC'lerini çağıramaz; super_admin yayınlar; ops yayınlayamaz", async () => {
    const c1 = content(1);
    const args = ["sahibinden", c1, "seed", null, { count: 0 }, hex("d"), SIG, "k1"];
    await as(TA, UA);
    for (const [fn, a] of [
      ["pt_rules_admin_publish", args],
      ["pt_rules_admin_overview", ["sahibinden"]],
      ["pt_rules_admin_set_trust", [TA, true, "deneme"]],
      ["pt_rules_admin_decide", ["00000000-0000-0000-0000-000000000000", "approve", null]],
      ["pt_rules_admin_rollback", ["sahibinden", 1, c1, hex("d"), SIG, "k1"]],
    ] as const) {
      expect(await call(fn, [...a]), fn).toMatchObject({ outcome: "forbidden" });
    }
    await as("", SUPPORT);
    expect(await call("pt_rules_admin_overview", ["sahibinden"])).toMatchObject({ outcome: "forbidden" });
    expect(await call("pt_rules_admin_publish", args)).toMatchObject({ outcome: "forbidden" });
    expect(await call("pt_rules_admin_trust_list", [])).toMatchObject({ outcome: "forbidden" });
    // kimliğe bürünen super_admin de kapıdan geçemez
    await as("", STAFF, { jwt: JSON.stringify({ app_metadata: { impersonating: "true" } }) });
    expect(await call("pt_rules_admin_publish", args)).toMatchObject({ outcome: "forbidden" });
    await as("", STAFF);
    expect(await call("pt_rules_admin_publish", ["sahibinden", content(2), "seed", null, {}, hex("d"), SIG, "k1"])).toMatchObject({ outcome: "version_conflict", expected: 1 });
    const bad = { ...c1, fields: [{ ...c1.fields[0]!, labels: ["5321234567"] }] };
    expect(await call("pt_rules_admin_publish", ["sahibinden", bad, "seed", null, {}, hex("d"), SIG, "k1"])).toMatchObject({ outcome: "invalid_content" });
    expect(await call("pt_rules_admin_publish", ["sahibinden", c1, "seed", null, {}, hex("d"), "kisa", "k1"])).toMatchObject({ outcome: "invalid_signature" });
    expect(await call("pt_rules_admin_publish", args)).toMatchObject({ outcome: "ok", version: 1 });
    expect((await q(`select count(*)::int n from public.platform_audit_logs where action = 'portal_rules.publish' and actor_id = $1`, [STAFF]))[0]!.n).toBeGreaterThan(0);
    const ops = (await q(`insert into public.platform_staff(id, role) values (gen_random_uuid(), 'ops') returning id`))[0]!.id as string;
    await as("", ops);
    expect(await call("pt_rules_admin_overview", ["sahibinden"])).toMatchObject({ outcome: "ok", current: { version: 1 } });
    expect(await call("pt_rules_admin_publish", ["sahibinden", content(2), "staff", null, {}, hex("e"), SIG, "k1"])).toMatchObject({ outcome: "forbidden" });
  });

  it("kural ucu: portals/view ile yayındaki set; yayınlanan içerik UPDATE → hata; geri alma max+1 sürüm üretir", async () => {
    await as(TA, UA);
    const cur = await call("pt_rules_current", ["f1"]);
    expect(cur).toMatchObject({ outcome: "ok" });
    expect((cur.sets as { portal: string; version: number }[]).map((s) => [s.portal, s.version])).toEqual([["sahibinden", 1]]);
    expect(await call("pt_rules_current", ["f2"])).toMatchObject({ outcome: "unsupported_engine" });
    await as(TA, UA, { deny: "portals:view" });
    expect(await call("pt_rules_current", ["f1"])).toMatchObject({ outcome: "forbidden" });

    await expect(q(`update public.portal_rule_sets set content = content || '{"version": 9}'::jsonb where portal = 'sahibinden' and version = 1`)).rejects.toThrow(/degistirilemez/);
    await expect(q(`delete from public.portal_rule_sets where portal = 'sahibinden' and version = 1`)).rejects.toThrow(/silinemez/);

    await as("", STAFF);
    const v2 = content(2);
    v2.fields[0]!.labels.push("ilan adi");
    expect(await call("pt_rules_admin_publish", ["sahibinden", v2, "staff", null, { count: 1 }, hex("e"), SIG, "k1"])).toMatchObject({ outcome: "ok", version: 2 });
    // eski içerikten farklı içerikle geri alma reddedilir
    expect(await call("pt_rules_admin_rollback", ["sahibinden", 1, content(3), hex("f"), SIG, "k1"])).toMatchObject({ outcome: "ok", version: 3 });
    expect(await call("pt_rules_admin_rollback", ["sahibinden", 2, content(4), hex("f"), SIG, "k1"])).toMatchObject({ outcome: "content_mismatch" });
    const rows = await q(`select version, status, kind from public.portal_rule_sets where portal = 'sahibinden' order by version`);
    expect(rows).toEqual([
      { version: 1, status: "superseded", kind: "seed" },
      { version: 2, status: "superseded", kind: "staff" },
      { version: 3, status: "published", kind: "rollback" },
    ]);
  });

  it("AI kaydı: etiket ve destek katalogdan (k>=2, eşlenmemiş); çağıranın etiketi/sahte desteği etkisiz", async () => {
    const cat = (sig: string, label: string | null, k: number, mapped: string | null = null) =>
      q(`insert into public.portal_form_fields(portal, field_sig, control, label_folded, distinct_tenants, mapped_key) values ('hepsiemlak', $1, 'choice', $2, $3, $4)`, [sig, label, k, mapped]);
    await cat(hex("9"), "yakit tipi", 2);
    await cat(hex("8"), "satis bedeli", 3);
    await cat(hex("6"), null, 1); // tek ofis: açık metin yok
    await cat(hex("5"), "cephe", 4, "facade"); // zaten eşlenmiş
    await as("", STAFF);
    const r = await call("pt_rules_admin_record_ai", ["hepsiemlak", "gpt-test", [
      { field_key: "heating", field_sig: hex("9"), label: "tek ofis metni", support_tenants: 9, confidence: 0.4 },
      { field_key: "price", field_sig: hex("8"), label: "satis bedeli" },
      { field_key: "heating", field_sig: hex("6"), label: "yakit", support_tenants: 9 },
      { field_key: "facade", field_sig: hex("5"), label: "cephe" },
      { field_key: "heating", field_sig: hex("7"), label: "katalogda yok", support_tenants: 9 },
    ]]);
    expect(r).toMatchObject({ outcome: "ok", created: 1, skipped: 4 });
    const rows = await q(`select support_tenants, proposal->>'label' label from public.portal_rule_proposals where portal = 'hepsiemlak' and source = 'ai'`);
    expect(rows).toEqual([{ support_tenants: 2, label: "yakit tipi" }]);
  });

  it("karar: Y2 tek ofisli metin önerisi açık onaysız onaylanamaz; red gerekçe ister", async () => {
    await as("", STAFF);
    const made = await call("pt_rules_admin_propose", ["hepsiemlak", "label_map", "heating", { label: "yakit cinsi" }, "personel önerisi"]);
    expect(made).toMatchObject({ outcome: "ok" });
    const id = made.id as string;
    expect(await call("pt_rules_admin_decide", [id, "approve", null])).toMatchObject({ outcome: "pii_confirmation_required" });
    expect(await call("pt_rules_admin_decide", [id, "reject", ""])).toMatchObject({ outcome: "invalid_input" });
    expect(await call("pt_rules_admin_decide", [id, "approve", "kontrol edildi", true])).toMatchObject({ outcome: "ok", state: "approved" });
    expect(await call("pt_rules_admin_decide", [id, "reject", "geri"])).toMatchObject({ outcome: "already_decided" });
  });

  it("otomatik yayın yalnız service_role fonksiyonu; personele bildirim yazılır; saklama çalışır", async () => {
    const grants = await q(`select grantee from information_schema.routine_privileges where routine_name = 'pt_rules_publish_system' and grantee in ('authenticated','anon','service_role')`);
    expect(grants.map((g) => g.grantee)).toEqual(["service_role"]);
    const res = await call("pt_rules_publish_system", ["emlakjet", content(1, "emlakjet"), "auto", null, { count: 2 }, hex("a"), SIG, "k1", null]);
    expect(res).toMatchObject({ outcome: "ok", version: 1 });
    expect((await q(`select count(*)::int n from public.platform_notifications where meta->>'portal' = 'emlakjet'`))[0]!.n).toBeGreaterThan(0);
    expect((await q(`select actor_id, meta->>'system' s from public.platform_audit_logs where action = 'portal_rules.publish_auto'`))[0]).toEqual({ actor_id: null, s: "learner" });
    expect(await call("pt_learning_retention", [new Date(Date.now() + 400 * 86_400_000).toISOString()])).toMatchObject({ outcome: "ok" });
    expect((await q(`select count(*)::int n from public.portal_fill_events`))[0]!.n).toBe(0);
  });

  it("tablolar: doğrudan yazma politikası yok (yalnız select); authenticated yalnız SELECT", async () => {
    const pol = await q(`select tablename, cmd from pg_policies where tablename like 'portal_rule%' or tablename like 'portal_form%' or tablename = 'portal_fill_events'`);
    expect(pol.length).toBe(8);
    expect(pol.every((p) => p.cmd === "SELECT")).toBe(true);
    const auth = await q(`select distinct privilege_type from information_schema.role_table_grants where grantee = 'authenticated' and table_name in ('portal_rule_sets','portal_fill_events','portal_rule_votes')`);
    expect(auth).toEqual([{ privilege_type: "SELECT" }]);
  });

  it("yetki: yeni fonksiyonların hiçbiri anon'a açık değil; iç yardımcılar authenticated'a da kapalı", async () => {
    const fns = `p.pronamespace = 'public'::regnamespace and p.prorettype <> 'trigger'::regtype
      and (p.proname like 'pt\\_rule%' or p.proname like 'pt\\_feedback%' or p.proname in ('pt_report_form_feedback', 'pt_learning_retention', 'pt_wilson_lb'))`;
    expect(await q(`select p.proname from pg_proc p where ${fns} and has_function_privilege('anon', p.oid, 'EXECUTE')`)).toEqual([]);
    const authOpen = (await q(`select p.proname from pg_proc p where ${fns} and has_function_privilege('authenticated', p.oid, 'EXECUTE') order by 1`)).map((r) => r.proname);
    for (const internal of ["pt_rules_insert_set", "pt_rules_audit", "pt_rules_validate_content", "pt_rules_learn", "pt_rules_publish_system", "pt_rules_learn_evidence"]) {
      expect(authOpen, internal).not.toContain(internal);
    }
    expect(authOpen).toContain("pt_rules_admin_publish");
    expect(authOpen).toContain("pt_report_form_feedback");
  });
});
