import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * İŞLEVSEL SQL TESTİ: referans/ortak motoru (20260826000600) gerçek PL/pgSQL ile (pglite, bellek içi Postgres).
 * `@electric-sql/pglite` bağımlılık DEĞİLDİR: kuruluysa koşar, yoksa ATLANIR.
 *   npm i --no-save @electric-sql/pglite && npx vitest run src/lib/growth/growth-engine-sql-exec
 *   (ya da PGLITE_MODULE=<mutlak yol>/node_modules/@electric-sql/pglite/dist/index.js)
 * Gerçek dosyalar yüklenir: 20260825000800, 20260825000900, 20260826000400, 20260826000500, 20260826000600.
 * tenants/profiles/invoices/abonelik/fulfill_v2 canlı tabloların SADELEŞTİRİLMİŞ taklididir.
 */
type Db = {
  exec: (sql: string) => Promise<unknown>;
  query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
};
const spec = process.env.PGLITE_MODULE ?? "@electric-sql/pglite";
const mod: { PGlite: new () => Db } | null = await import(/* @vite-ignore */ spec).catch(() => null);
const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");

const STUB = `
create role service_role; create role authenticated; create role anon;
create schema auth;
create table auth.users(id uuid primary key default gen_random_uuid(), email text);
create function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.role', true),''),'anon') $$;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
create function public.current_tenant_id() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.tenant', true),'')::uuid $$;
create function auth.jwt() returns jsonb language sql stable as $$ select jsonb_build_object('aal', nullif(current_setting('request.jwt.claim.aal', true),'')) $$;
create function public.current_profile_role() returns text language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.prole', true),''),'owner') $$;
create table public.tenants(id uuid primary key default gen_random_uuid(), name text default 'Ofis', tax_number text, phone text);
create table public.profiles(id uuid primary key references auth.users(id), tenant_id uuid references public.tenants(id), phone text);
create table public.platform_staff(id uuid primary key, role text not null default 'super_admin', is_active boolean not null default true);
create table public.platform_settings(key text primary key, value text, updated_by uuid, updated_at timestamptz default now());
create table public.subscriptions(id uuid primary key default gen_random_uuid(), tenant_id uuid not null unique references public.tenants(id), status text not null default 'trialing');
create table public.invoices(id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id), status text not null default 'draft', checkout_status text, amount_try numeric not null default 0, total_try numeric not null default 0, currency text default 'TRY', paid_at timestamptz, iyzico_payment_id text, meta jsonb not null default '{}', created_at timestamptz default now());
create table public.billing_payment_captures(id uuid primary key default gen_random_uuid(), conversation_id text, status text);
create table public.billing_fulfillment_events(id uuid primary key default gen_random_uuid(), provider text, conversation_id text, result jsonb);
create function public.fulfill_billing_payment_v2(p_provider text,p_conversation_id text,p_payment_id text,p_source text,p_target_type text,p_expected_tenant_id uuid,p_expected_plan text,p_expected_cycle text,p_expected_amount_try numeric,p_expected_currency text) returns jsonb language plpgsql security definer set search_path='' as $$
begin return jsonb_build_object('ok',true,'already',false,'targetType','subscription'); end $$;
create function public.fulfill_billing_payment(p_provider text,p_conversation_id text,p_payment_id text,p_source text,p_target_type text,p_expected_tenant_id uuid,p_expected_plan text,p_expected_cycle text,p_expected_amount_try numeric,p_expected_currency text) returns jsonb language sql as $$ select '{}'::jsonb $$;
`;

/** 000800 defter tablosunu 000400'ün beklediği biçime getirir (ef/ai migration'larının etkisi). */
const LEDGER_PATCH = `
alter table public.account_credit_ledger add column feature text, add column model text, add column tokens_in int, add column tokens_out int;
alter table public.account_credit_ledger drop constraint account_credit_ledger_unit_check;
alter table public.account_credit_ledger drop constraint account_credit_ledger_source_check;
alter table public.account_credit_ledger add constraint account_credit_ledger_unit_check check (unit in ('try','ai','valuation','ef'));
alter table public.account_credit_ledger add constraint account_credit_ledger_source_check check (source in ('referral','partner','campaign','manual','usage','plan','purchase','bonus','refund'));
`;

describe.skipIf(!mod)("Referans/ortak motoru SQL — gerçek PL/pgSQL (pglite)", () => {
  let db: Db;
  let seq = 0;
  const q = async (sql: string, params?: unknown[]) => (await db.query(sql, params)).rows;
  type Res = Record<string, unknown> & { err?: string; code?: string };
  const call = async (sql: string, params?: unknown[]): Promise<Res> => {
    try {
      const row = (await q(sql, params))[0];
      return (row ? Object.values(row)[0] : undefined) as Res;
    } catch (e) {
      const err = e as { message: string; code?: string };
      return { err: err.message, code: err.code };
    }
  };
  const asService = () => db.exec(`select set_config('request.jwt.claim.role','service_role',false)`);
  // Varsayılan AAL2 (MFA'lı personel oturumu); aal=null ile MFA'sız oturum simüle edilir.
  const asUser = (sub: string | null, tenant: string | null, aal: string | null = "aal2") =>
    db.exec(
      `select set_config('request.jwt.claim.role','authenticated',false), set_config('request.jwt.claim.sub','${sub ?? ""}',false), set_config('request.jwt.claim.tenant','${tenant ?? ""}',false), set_config('request.jwt.claim.aal','${aal ?? ""}',false)`,
    );
  const setFlag = (key: string, on: boolean) =>
    q(`insert into public.platform_settings(key,value) values ($1,$2) on conflict (key) do update set value = excluded.value`, [key, on ? "on" : "off"]);

  async function tenant(opts: { tax?: string; phone?: string; email?: string; active?: boolean } = {}) {
    const t = (await q(`insert into public.tenants(tax_number, phone) values ($1,$2) returning id`, [opts.tax ?? null, opts.phone ?? null]))[0]!.id as string;
    seq += 1;
    const email = opts.email ?? `kisi${seq}@gmail.com`;
    const u = (await q(`insert into auth.users(email) values ($1) returning id`, [email]))[0]!.id as string;
    await q(`insert into public.profiles(id, tenant_id) values ($1,$2)`, [u, t]);
    await q(`insert into public.subscriptions(tenant_id, status) values ($1,$2)`, [t, opts.active === false ? "trialing" : "active"]);
    return t;
  }
  async function refer(referrer: string, referred: string) {
    await q(`insert into public.signup_attributions(tenant_id, ref_kind, referrer_tenant_id) values ($1,'referral',$2)`, [referred, referrer]);
  }
  async function pay(tenantId: string, amount = 1000, extra: Record<string, unknown> = {}, paidAt = "now()") {
    seq += 1;
    const meta = { conversationId: `conv-${seq}`, plan: "office", cycle: "monthly", provider: "iyzico", source: "callback", ...extra };
    return (
      await q(
        `insert into public.invoices(tenant_id,status,amount_try,total_try,paid_at,iyzico_payment_id,meta) values ($1,'paid',$2,$3,${paidAt},$4,$5) returning id`,
        [tenantId, amount, amount * 1.2, `pay-${seq}`, JSON.stringify(meta)],
      )
    )[0]!.id as string;
  }
  const claim = async (referred: string, component = "base") =>
    (await q(`select * from public.growth_reward_claims where referred_tenant_id=$1 and component=$2`, [referred, component]))[0];
  const register = (inv: string) => call(`select public.growth_claim_register($1)`, [inv]);
  const process_ = () => call(`select public.growth_claims_process(200)`);
  const makeDue = () => q(`update public.growth_reward_claims set eligible_at = now() - interval '1 day' where status='held'`);
  const balance = async (t: string) => Number((await call(`select public.try_credit_balance($1)`, [t])).balance);

  beforeAll(async () => {
    db = new mod!.PGlite();
    await db.exec(STUB);
    await db.exec(read("supabase/migrations/20260825000800_growth_referral_partner_attribution.sql"));
    await db.exec(LEDGER_PATCH);
    for (const f of [
      "20260825000900_growth_click_counters.sql",
      "20260826000400_try_credit_wallet.sql",
      "20260826000500_try_credit_invoice_payment.sql",
      "20260826000600_growth_referral_engine.sql",
    ]) {
      await db.exec(read(`supabase/migrations/${f}`));
    }
    await asService();
    // Mevcut senaryolar otomatik akışı sınar: ilk-N manuel inceleme varsayılanı burada kapatılır (ayrı testte açılır).
    await q(`update public.growth_referral_settings set manual_review_first_n = 0`);
    await q(
      `insert into public.growth_reward_rules(kind,name,reward_type,reward_value,hold_days,credit_expires_days) values ('referral','Standart','monthly_multiple',1,30,365)`,
    );
  }, 90_000);

  it("hazırlık: motor hazır; bayrak KAPALI iken talep üretilmez", async () => {
    expect(await call(`select public.growth_engine_ready()`)).toBe(true);
    const a = await tenant();
    const b = await tenant();
    await refer(a, b);
    const inv = await pay(b);
    expect(await register(inv)).toMatchObject({ ok: true, skipped: "program_off" });
    expect(await claim(b)).toBeUndefined();
  });

  it("ilk gerçek ödeme: talep 'held' + hold; idempotent; demo/kredi/iade faturası sayılmaz", async () => {
    await setFlag("growth_referral_enabled", true);
    const a = await tenant();
    const b = await tenant();
    await refer(a, b);
    const demo = await pay(b, 500, { provider: "demo", source: "demo" });
    expect(await register(demo)).toMatchObject({ skipped: "not_real_payment" });
    const walletOnly = await pay(b, 500, { walletCashTry: 0 });
    expect(await register(walletOnly)).toMatchObject({ skipped: "not_real_payment" });
    const kind = await pay(b, 500, { kind: "extra_seats" });
    expect(await register(kind)).toMatchObject({ skipped: "not_real_payment" });
    expect(await claim(b)).toBeUndefined();

    const inv = await pay(b, 1000);
    const r1 = await register(inv);
    expect(r1).toMatchObject({ ok: true, status: "held" });
    expect(await register(inv)).toMatchObject({ already: true });
    const c = (await claim(b))!;
    expect(Number(c.amount_try)).toBe(1000);
    expect(c.status).toBe("held");
    // ikinci ödeme yeni talep üretmez
    const inv2 = await pay(b, 1000);
    expect(await register(inv2)).toMatchObject({ already: true });
    expect((await q(`select count(*)::int as n from public.growth_reward_claims where referred_tenant_id=$1`, [b]))[0]!.n).toBe(1);
  });

  it("bekleme dolmadan kredi YOK; dolunca TEK sefer verilir (idempotent); meta.claim_id", async () => {
    const a = await tenant();
    const b = await tenant();
    await refer(a, b);
    await register(await pay(b, 800));
    expect(await process_()).toMatchObject({ ok: true, paid: 0 });
    expect(await balance(a)).toBe(0);
    await makeDue();
    const r = await process_();
    expect(r).toMatchObject({ ok: true, wallet_ready: true });
    expect(await balance(a)).toBe(800);
    await process_();
    await process_();
    expect(await balance(a)).toBe(800);
    const c = (await claim(b))!;
    expect(c.status).toBe("paid");
    const led = (await q(`select meta from public.account_credit_ledger where tenant_id=$1 and unit='try'`, [a]))[0]!;
    expect((led.meta as Record<string, string>).claim_id).toBe(c.id);
  });

  it("yıllık fatura: aylık karşılık = tutar/12", async () => {
    const a = await tenant();
    const b = await tenant();
    await refer(a, b);
    await register(await pay(b, 12000, { cycle: "yearly" }));
    expect(Number((await claim(b))!.amount_try)).toBe(1000);
  });

  it("iade: bekleme sırasında geri alınır; ödüllendirilmişse clawback (eksi bakiye mümkün, idempotent)", async () => {
    const a = await tenant();
    const b = await tenant();
    await refer(a, b);
    const inv = await pay(b, 600);
    await register(inv);
    await q(`update public.invoices set meta = meta || '{"refund":{"amount_try":600}}' where id=$1`, [inv]);
    expect(await process_()).toMatchObject({ reversed: 1 });
    expect((await claim(b))!.status).toBe("reversed");
    expect(await balance(a)).toBe(0);

    // ödüllendirildikten SONRA iade
    const c2 = await tenant();
    const d2 = await tenant();
    await refer(c2, d2);
    const inv2 = await pay(d2, 900);
    await register(inv2);
    await makeDue();
    await process_();
    expect(await balance(c2)).toBe(900);
    await q(`update public.invoices set status='void' where id=$1`, [inv2]);
    const r = await process_();
    expect(r).toMatchObject({ reversed: 1, clawback: 1 });
    expect(await balance(c2)).toBe(0);
    await process_();
    expect(await balance(c2)).toBe(0);
    const row = (await claim(d2))!;
    expect(row.status).toBe("reversed");
    expect(row.clawed_back_at).not.toBeNull();
    // yakalama iadesi (chargeback) de geri alır
    const e = await tenant();
    const f = await tenant();
    await refer(e, f);
    const inv3 = await pay(f, 300);
    await register(inv3);
    const conv = (await q(`select meta->>'conversationId' as c from public.invoices where id=$1`, [inv3]))[0]!.c;
    await q(`insert into public.billing_payment_captures(conversation_id,status) values ($1,'refunded')`, [conv]);
    expect(await process_()).toMatchObject({ reversed: 1 });
  });

  it("kötüye kullanım: aynı tenant reddedilir; vergi no / telefon / kurumsal e-posta alan adı = inceleme; gmail serbest", async () => {
    const x = await tenant();
    // atıf tablosu kendi kendine davete CHECK ile izin vermez; bayrak ikinci savunma hattıdır
    expect(await call(`select public.growth_pair_flags($1,$1)`, [x])).toEqual(["same_tenant"]);

    const a1 = await tenant({ tax: "1234567890" });
    const b1 = await tenant({ tax: "123 456 7890" });
    await refer(a1, b1);
    expect(await register(await pay(b1))).toMatchObject({ status: "pending", flags: ["same_tax_no"] });

    const a2 = await tenant({ phone: "0532 111 22 33" });
    const b2 = await tenant({ phone: "05321112233" });
    await refer(a2, b2);
    expect(await register(await pay(b2))).toMatchObject({ status: "pending", flags: ["same_phone"] });

    const a3 = await tenant({ email: "ali@sirket.com.tr" });
    const b3 = await tenant({ email: "veli@sirket.com.tr" });
    await refer(a3, b3);
    expect(await register(await pay(b3))).toMatchObject({ status: "pending", flags: ["same_email_domain"] });

    const a4 = await tenant({ email: "ali@gmail.com" });
    const b4 = await tenant({ email: "veli@gmail.com" });
    await refer(a4, b4);
    expect(await register(await pay(b4))).toMatchObject({ status: "held", flags: [] });

    // bayraklı talep süre dolsa da KREDİ ALMAZ
    await makeDue();
    await q(`update public.growth_reward_claims set eligible_at = now() - interval '1 day' where status='pending'`);
    await process_();
    expect(await balance(a1)).toBe(0);
    expect((await claim(b1))!.status).toBe("pending");
  });

  it("hız sınırı: davetçi başına 24 saatte velocity_max_per_day üstü 'velocity' bayrağı", async () => {
    await q(`update public.growth_referral_settings set velocity_max_per_day = 2`);
    const a = await tenant();
    const statuses: string[] = [];
    for (let k = 0; k < 3; k++) {
      const b = await tenant();
      await refer(a, b);
      statuses.push(((await register(await pay(b))) as { status: string }).status);
    }
    expect(statuses).toEqual(["held", "held", "pending"]);
    await q(`update public.growth_referral_settings set velocity_max_per_day = 5`);
  });

  it("davetçi aboneliği aktif değilse bekler; aktifleşince ödenir", async () => {
    const a = await tenant({ active: false });
    const b = await tenant();
    await refer(a, b);
    await register(await pay(b, 400));
    await makeDue();
    await process_();
    expect(await balance(a)).toBe(0);
    expect((await claim(b))!.flags).toContain("referrer_inactive");
    await q(`update public.subscriptions set status='active' where tenant_id=$1`, [a]);
    await process_();
    expect(await balance(a)).toBe(400);
    expect((await claim(b))!.flags).not.toContain("referrer_inactive");
  });

  it("davet edilen abonelik iptal olursa (bekleme sırasında) geri alınır", async () => {
    const a = await tenant();
    const b = await tenant();
    await refer(a, b);
    await register(await pay(b, 400));
    await q(`update public.subscriptions set status='cancelled' where tenant_id=$1`, [b]);
    expect(await process_()).toMatchObject({ reversed: 1 });
    expect(await balance(a)).toBe(0);
  });

  it("yıllık tavan: aylık bedel cinsinden kırpılır, dolunca reddedilir", async () => {
    await q(`update public.growth_referral_settings set annual_cap_months = 1.5, tier1_at = 50, tier2_at = 60`);
    const a = await tenant();
    const kids: string[] = [];
    for (let k = 0; k < 3; k++) {
      const b = await tenant();
      kids.push(b);
      await refer(a, b);
      await register(await pay(b, 1000));
    }
    await makeDue();
    await process_();
    const rows = await q(`select status, amount_try from public.growth_reward_claims where beneficiary_tenant_id=$1 order by granted_at nulls last`, [a]);
    const paid = rows.filter((r) => r.status === "paid").map((r) => Number(r.amount_try));
    expect(paid.sort((x, y) => y - x)).toEqual([1000, 500]);
    expect(rows.filter((r) => r.status === "rejected")).toHaveLength(1);
    expect(await balance(a)).toBe(1500);
    await q(`update public.growth_referral_settings set annual_cap_months = 12, tier1_at = 3, tier2_at = 10`);
  });

  it("aylık TL tavanı (kural): dolunca ertesi aya bekler", async () => {
    await q(`update public.growth_reward_rules set monthly_cap_try = 1500 where kind='referral'`);
    const a = await tenant();
    for (let k = 0; k < 2; k++) {
      const b = await tenant();
      await refer(a, b);
      await register(await pay(b, 1000));
    }
    await makeDue();
    await process_();
    expect(await balance(a)).toBe(1500);
    expect((await q(`select count(*)::int as n from public.growth_reward_claims where beneficiary_tenant_id=$1 and status='held'`, [a]))[0]!.n).toBe(0 + 0);
    await q(`update public.growth_reward_rules set monthly_cap_try = null where kind='referral'`);
  });

  it("kademe: 3. başarılı referansta +0,5 ay, 10.'da +2 ay (tek sefer)", async () => {
    await q(`update public.growth_referral_settings set velocity_max_per_day = 1000`);
    const a = await tenant();
    for (let k = 0; k < 3; k++) {
      const b = await tenant();
      await refer(a, b);
      await register(await pay(b, 1000));
    }
    await makeDue();
    const r = await process_();
    expect(r).toMatchObject({ paid: 3, bonus: 1 });
    expect(await balance(a)).toBe(3500);
    await process_();
    expect(await balance(a)).toBe(3500);
    expect((await q(`select count(*)::int as n from public.growth_reward_claims where beneficiary_tenant_id=$1 and component='tier1'`, [a]))[0]!.n).toBe(1);
    for (let k = 0; k < 7; k++) {
      const b = await tenant();
      await refer(a, b);
      await register(await pay(b, 1000));
    }
    await makeDue();
    await process_();
    // 10 taban (10000) + 0,5 + 2 ay bonus = 12,5 ay; yıllık tavan 12 ay -> 12000
    expect(await balance(a)).toBe(12000);
    const t2 = await q(`select status from public.growth_reward_claims where beneficiary_tenant_id=$1 and component='tier2'`, [a]);
    expect(t2).toHaveLength(1);
    await q(`update public.growth_referral_settings set velocity_max_per_day = 5`);
  });

  it("kademe bonusu, tetikleyen referans iade olunca geri alınır", async () => {
    const a = await tenant();
    const invs: string[] = [];
    for (let k = 0; k < 3; k++) {
      const b = await tenant();
      await refer(a, b);
      const inv = await pay(b, 1000);
      invs.push(inv);
      await register(inv);
    }
    await makeDue();
    await process_();
    expect(await balance(a)).toBe(3500);
    await q(`update public.invoices set status='void' where id=$1`, [invs[2]]);
    await process_();
    expect(await balance(a)).toBe(2000);
  });

  it("hoş geldin kredisi: ayarlı değilse yok; ayarlıysa idempotent; bayraklı çiftte verilmez", async () => {
    const a = await tenant();
    const b = await tenant();
    await refer(a, b);
    expect(await call(`select public.growth_grant_welcome($1)`, [b])).toMatchObject({ skipped: "not_configured" });
    await q(`update public.growth_referral_settings set welcome_credit_try = 250`);
    expect(await call(`select public.growth_grant_welcome($1)`, [b])).toMatchObject({ ok: true, already: false, amount: 250 });
    expect(await call(`select public.growth_grant_welcome($1)`, [b])).toMatchObject({ ok: true, already: true });
    expect(await balance(b)).toBe(250);
    const c = await tenant({ tax: "9999999999" });
    const d = await tenant({ tax: "9999999999" });
    await refer(c, d);
    expect(await call(`select public.growth_grant_welcome($1)`, [d])).toMatchObject({ skipped: "flagged" });
    await q(`update public.growth_referral_settings set welcome_credit_try = 0`);
  });

  it("yetki: ofis/anon işleyiciyi ve kayıt RPC'sini ÇAĞIRAMAZ; ofis panosu yalnız kendi tenant'ı", async () => {
    const a = await tenant();
    const b = await tenant();
    await refer(a, b);
    await register(await pay(b, 700));
    await asUser(null, a);
    expect((await call(`select public.growth_claims_process(10)`)).code).toBe("42501");
    expect((await call(`select public.growth_claim_register($1)`, [a])).code).toBe("42501");
    expect((await call(`select public.growth_admin_metrics()`)).code).toBe("42501");
    const dash = await call(`select public.growth_my_dashboard()`);
    expect(dash).toMatchObject({ enabled: true, signups: 1, waiting: 1, paid: 0, pending_try: 700 });
    await asUser(null, b);
    expect(await call(`select public.growth_my_dashboard()`)).toMatchObject({ signups: 0, pending_try: 0 });
    await asService();
  });

  it("yönetici kararı: yalnız super_admin; onay yalnız 'pending'; ret/geri alma neden ister; kredi YAZMAZ", async () => {
    const staff = (await q(`insert into public.platform_staff(id, role) values (gen_random_uuid(),'super_admin') returning id`))[0]!.id as string;
    const support = (await q(`insert into public.platform_staff(id, role) values (gen_random_uuid(),'support') returning id`))[0]!.id as string;
    const a = await tenant({ tax: "5555555555" });
    const b = await tenant({ tax: "5555555555" });
    await refer(a, b);
    await register(await pay(b, 500));
    const c = (await claim(b))!;
    await asUser(support, null);
    expect((await call(`select public.growth_admin_decide($1,'approve','neden var')`, [c.id])).code).toBe("42501");
    await asUser(staff, null);
    expect(await call(`select public.growth_admin_decide($1,'approve','')`, [c.id])).toMatchObject({ ok: false, code: "reason_required" });
    expect(await call(`select public.growth_admin_decide($1,'approve','vergi no farkı doğrulandı')`, [c.id])).toMatchObject({ ok: true, status: "approved" });
    await asService();
    expect(await balance(a)).toBe(0);
    await process_();
    expect(await balance(a)).toBe(500);
    expect((await claim(b))!.status).toBe("paid");
    // geri alma -> clawback
    await asUser(staff, null);
    expect(await call(`select public.growth_admin_decide($1,'reverse','dolandırıcılık tespit edildi')`, [c.id])).toMatchObject({ ok: true, status: "reversed" });
    await asService();
    await process_();
    expect(await balance(a)).toBe(0);
    // aynı-ofis talebi ONAYLANAMAZ
    const x = await tenant();
    const cx = (
      await q(
        `insert into public.growth_reward_claims(rule_id, beneficiary_tenant_id, referred_tenant_id, amount_try, status, flags)
         select id, $1, $1, 10, 'pending', array['same_tenant'] from public.growth_reward_rules where kind='referral' limit 1 returning id`,
        [x],
      )
    )[0]!;
    await asUser(staff, null);
    expect(await call(`select public.growth_admin_decide($1,'approve','deneme')`, [cx.id])).toMatchObject({ ok: false, code: "not_approvable" });
    await asService();
    const ev = await q(`select event from public.growth_claim_events where claim_id=$1 order by id`, [c.id]);
    expect(ev.map((e) => e.event)).toEqual(expect.arrayContaining(["registered", "flagged", "approved", "granted", "reversed", "clawback"]));
    // olay izi değiştirilemez
    expect((await call(`update public.growth_claim_events set event='note'`)).code).toBe("42501");
  });

  it("metrikler ve kuyruk (service_role)", async () => {
    const m = await call(`select public.growth_admin_metrics()`);
    expect(Number(m.signups)).toBeGreaterThan(0);
    expect(typeof m.status_counts).toBe("object");
    const rows = (await call(`select public.growth_admin_queue('flagged', 50)`)) as unknown as unknown[];
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBeGreaterThan(0);
  });

  describe("FAZ 2: ortak", () => {
    let partner: string;
    let owner: string;
    const partnerCustomer = async (amount = 1000) => {
      const t = await tenant();
      await q(`insert into public.signup_attributions(tenant_id, ref_kind, partner_id) values ($1,'partner',$2)`, [t, partner]);
      const inv = await pay(t, amount);
      return { t, inv };
    };

    beforeAll(async () => {
      owner = await tenant();
      const rule = (
        await q(
          `insert into public.growth_reward_rules(kind,name,reward_type,reward_value,hold_days) values ('partner','Ortak','percent_of_payment',0,30) returning id`,
        )
      )[0]!.id as string;
      partner = (
        await q(`insert into public.growth_partners(name,partner_type,code,status,rule_id,owner_tenant_id) values ('Mali Müşavir','accountant','ortak-1','active',$1,$2) returning id`, [rule, owner])
      )[0]!.id as string;
    });

    it("bayrak KAPALI iken komisyon ÜRETİLMEZ", async () => {
      await setFlag("growth_partner_enabled", false);
      const { inv } = await partnerCustomer();
      expect(await register(inv)).toMatchObject({ skipped: "partner_program_off" });
      expect((await q(`select count(*)::int as n from public.growth_reward_claims where partner_id=$1`, [partner]))[0]!.n).toBe(0);
    });

    it("açıkken: %20 kademe, fatura başına tek komisyon, 12 ay penceresi, vadesi gelince 'approved'", async () => {
      await setFlag("growth_partner_enabled", true);
      const { t, inv } = await partnerCustomer(1000);
      const r = await register(inv);
      expect(r).toMatchObject({ ok: true, pct: 20 });
      expect(await register(inv)).toMatchObject({ already: true });
      const c = (await claim(t, "commission"))!;
      expect(Number(c.amount_try)).toBe(200);
      // yineleyen ödeme: yeni komisyon
      const inv2 = await pay(t, 1000, {}, "now() + interval '1 month'");
      expect(await register(inv2)).toMatchObject({ ok: true, pct: 20 });
      // 13. ay: pencere dışı
      const inv13 = await pay(t, 1000, {}, "now() + interval '13 months'");
      expect(await register(inv13)).toMatchObject({ skipped: "out_of_window" });
      await makeDue();
      expect(await process_()).toMatchObject({ partner_approved: 2 });
      expect((await claim(t, "commission"))!.status).toBe("approved");
    });

    it("kademe %25 / %30 (aktif ücretli müşteri sayısı) ", async () => {
      for (let k = 0; k < 4; k++) await partnerCustomer(); // toplam aktif: 5+ (önceki test dahil)
      const { inv } = await partnerCustomer(1000);
      expect(await register(inv)).toMatchObject({ pct: 25 });
      for (let k = 0; k < 10; k++) await partnerCustomer();
      const last = await partnerCustomer(1000);
      expect(await register(last.inv)).toMatchObject({ pct: 30 });
    });

    it("ödeme: nakit bayrağı kapalıyken YOK; vergi mükellefi + belge + min eşik; iade sonrası mahsup", async () => {
      const staff = (await q(`insert into public.platform_staff(id, role) values (gen_random_uuid(),'super_admin') returning id`))[0]!.id as string;
      await makeDue();
      await process_();
      await asUser(staff, null);
      const pay_ = (m: string, doc: string | null, date: string | null) =>
        call(`select public.growth_admin_payout_create($1,$2,$3,$4::date,null)`, [partner, m, doc, date]);
      await asService();
      await setFlag("growth_cash_payout_enabled", false);
      await asUser(staff, null);
      expect(await pay_("bank_transfer_external", "FT-1", "2026-10-01")).toMatchObject({ ok: false, code: "cash_payout_off" });
      await asService();
      await setFlag("growth_cash_payout_enabled", true);
      await asUser(staff, null);
      expect(await pay_("bank_transfer_external", "FT-1", "2026-10-01")).toMatchObject({ ok: false, code: "not_tax_payer" });
      await asService();
      await q(`update public.growth_partners set is_tax_payer = true, tax_no = '1234567890' where id=$1`, [partner]);
      await asUser(staff, null);
      expect(await pay_("bank_transfer_external", null, "2026-10-01")).toMatchObject({ ok: false, code: "document_required" });
      await asService();
      await q(`update public.growth_referral_settings set partner_min_payout_try = 100000`);
      await asUser(staff, null);
      expect(await pay_("bank_transfer_external", "FT-1", "2026-10-01")).toMatchObject({ ok: false, code: "below_min" });
      await asService();
      await q(`update public.growth_referral_settings set partner_min_payout_try = 100`);
      await asUser(staff, null);
      const ok = await pay_("bank_transfer_external", "FT-1", "2026-10-01");
      expect(ok).toMatchObject({ ok: true });
      await asService();
      const po = (await q(`select * from public.growth_partner_payouts where id=$1`, [ok.payout_id]))[0]!;
      expect(po.status).toBe("paid");
      expect(po.document_no).toBe("FT-1");
      expect((await q(`select count(*)::int as n from public.growth_reward_claims where payout_id=$1 and status='paid'`, [po.id]))[0]!.n).toBeGreaterThan(0);
      // tekrar: ödenecek bakiye kalmadı
      await asUser(staff, null);
      expect(await pay_("bank_transfer_external", "FT-2", "2026-10-02")).toMatchObject({ ok: false, code: "below_min" });
      await asService();
    });

    it("hesap kredisi ödemesi: talep -> işleyici cüzdana yazar; bayrak kapalıyken ödeme oluşmaz", async () => {
      const staff = (await q(`insert into public.platform_staff(id, role) values (gen_random_uuid(),'super_admin') returning id`))[0]!.id as string;
      const { inv } = await partnerCustomer(5000);
      await register(inv);
      await makeDue();
      await process_();
      await q(`update public.growth_referral_settings set partner_min_payout_try = 100`);
      await asUser(staff, null);
      const r = await call(`select public.growth_admin_payout_create($1,'account_credit',null,null,null)`, [partner]);
      expect(r).toMatchObject({ ok: true });
      await asService();
      expect(await balance(owner)).toBe(0);
      await process_();
      expect(await balance(owner)).toBe(Number(r.amount));
      await process_();
      expect(await balance(owner)).toBe(Number(r.amount));
      await setFlag("growth_partner_enabled", false);
      await asUser(staff, null);
      expect(await call(`select public.growth_admin_payout_create($1,'account_credit',null,null,null)`, [partner])).toMatchObject({ ok: false, code: "partner_program_off" });
      await asService();
      await setFlag("growth_partner_enabled", true);
    });

    it("ortak panosu: yalnız sahibi tenant görür", async () => {
      await asUser(null, owner);
      const d = await call(`select public.growth_my_partner_dashboard()`);
      expect(d).toMatchObject({ code: "ortak-1", name: "Mali Müşavir" });
      expect(Number(d.signups)).toBeGreaterThan(0);
      await asUser(null, await (async () => { await asService(); return tenant(); })());
      expect(await call(`select public.growth_my_partner_dashboard()`)).toBeNull();
      await asService();
    });
  });

  it("davet önizlemesi (anon): yalnız program açık + aktif kod; ofis adı ve hoş geldin kredisi", async () => {
    const a = await tenant();
    await q(`update public.tenants set name = 'Yılmaz Gayrimenkul' where id=$1`, [a]);
    await q(`insert into public.growth_referral_codes(tenant_id, code) values ($1,'xyzabc23')`, [a]);
    await q(`update public.growth_referral_settings set welcome_credit_try = 300`);
    await db.exec(`select set_config('request.jwt.claim.role','anon',false)`);
    expect(await call(`select public.growth_invite_preview('xyzabc23')`)).toEqual({ office_name: "Yılmaz Gayrimenkul", welcome_credit_try: 300 });
    expect(await call(`select public.growth_invite_preview('yokyok99')`)).toBeNull();
    expect(await call(`select public.growth_invite_preview('x; drop')`)).toBeNull();
    await asService();
    await setFlag("growth_referral_enabled", false);
    expect(await call(`select public.growth_invite_preview('xyzabc23')`)).toBeNull();
    await setFlag("growth_referral_enabled", true);
    await q(`update public.growth_referral_settings set welcome_credit_try = 0`);
  });

  it("ortak güncelleme RPC'si: yalnız super_admin, doğrulamalı; vergi no yalnız rakam", async () => {
    const staff = (await q(`insert into public.platform_staff(id, role) values (gen_random_uuid(),'super_admin') returning id`))[0]!.id as string;
    const support = (await q(`insert into public.platform_staff(id, role) values (gen_random_uuid(),'support') returning id`))[0]!.id as string;
    const owner = await tenant();
    const rule = (await q(`select id from public.growth_reward_rules where kind='partner' limit 1`))[0]?.id as string | undefined;
    const rid = rule ?? (await q(`insert into public.growth_reward_rules(kind,name,reward_type,reward_value,hold_days) values ('partner','K','percent_of_payment',0,30) returning id`))[0]!.id as string;
    const partner = (await q(`insert into public.growth_partners(name,partner_type,code) values ('P','agency','ortak-up') returning id`))[0]!.id as string;
    await asUser(support, null);
    expect((await call(`select public.growth_admin_partner_update($1,$2::jsonb)`, [partner, JSON.stringify({ is_tax_payer: true })])).code).toBe("42501");
    await asUser(staff, null);
    expect(await call(`select public.growth_admin_partner_update($1,$2::jsonb)`, [partner, JSON.stringify({ is_tax_payer: true, tax_no: "123 456 78 90", owner_tenant_id: owner, rule_id: rid })])).toMatchObject({ ok: true });
    expect(await call(`select public.growth_admin_partner_update($1,$2::jsonb)`, [partner, JSON.stringify({ owner_tenant_id: "00000000-0000-4000-8000-000000000000" })])).toMatchObject({ ok: false, code: "owner_not_found" });
    expect(await call(`select public.growth_admin_partner_update($1,$2::jsonb)`, [partner, JSON.stringify({ tax_no: "12" })])).toMatchObject({ ok: false, code: "invalid_value" });
    await asService();
    const row = (await q(`select is_tax_payer, tax_no, owner_tenant_id, rule_id from public.growth_partners where id=$1`, [partner]))[0]!;
    expect(row).toMatchObject({ is_tax_payer: true, tax_no: "1234567890", owner_tenant_id: owner, rule_id: rid });
  });

  it("ödül tabanı NAKİT net tutardır (walletCashTry/1,2); nakit oranı asgarinin altındaysa inceleme", async () => {
    await asService();
    const a = await tenant();
    const b = await tenant();
    await refer(a, b);
    // Brüt 1200 TL faturanın 720 TL'si nakit, 480 TL'si kredi: nakit net = 600 / 1.2... walletCashTry brüt kabul edilir (720/1.2 = 600).
    expect(await register(await pay(b, 1000, { walletCashTry: 720 }))).toMatchObject({ ok: true, status: "held" });
    expect(Number((await claim(b))!.amount_try)).toBe(600);
    expect(Number((await claim(b))!.base_monthly_try)).toBe(600);
    // Nakit net 200 TL = %20 < asgari %50: ödül 200 TL tabanında ve 'low_cash_ratio' ile pending.
    const c = await tenant();
    const d = await tenant();
    await refer(c, d);
    const r = await register(await pay(d, 1000, { walletCashTry: 240 }));
    expect(r).toMatchObject({ ok: true, status: "pending" });
    const cd = (await claim(d))!;
    expect(Number(cd.amount_try)).toBe(200);
    expect(cd.flags).toContain("low_cash_ratio");
    // Hiç walletCashTry yoksa fatura tamamen nakit sayılır.
    expect(Number((await call(`select public.growth_cash_net($1)`, [await pay(await tenant(), 1000)])))).toBe(1000);
  });

  it("çoklu hesap: ilk N davetçi talebi ve hoş geldin kredisini kullanan çift manuel onaya düşer (otomatik ödenmez)", async () => {
    await asService();
    await q(`update public.growth_referral_settings set manual_review_first_n = 2, velocity_max_per_day = 1000`);
    const a = await tenant();
    const statuses: string[] = [];
    for (let k = 0; k < 3; k++) {
      const b = await tenant();
      await refer(a, b);
      await register(await pay(b, 1000));
      statuses.push((await claim(b))!.status as string);
    }
    expect(statuses).toEqual(["pending", "pending", "held"]);
    const first = (await q(`select flags from public.growth_reward_claims where beneficiary_tenant_id=$1 order by created_at limit 1`, [a]))[0]!;
    expect(first.flags).toContain("first_claims_review");
    await makeDue();
    const r = await process_();
    expect(r).toMatchObject({ ok: true });
    expect(await balance(a)).toBe(1000); // yalnız 3. talep ödenir; ilk ikisi pending kalır
    expect((await q(`select count(*)::int as n from public.growth_reward_claims where beneficiary_tenant_id=$1 and status='pending'`, [a]))[0]!.n).toBe(2);
    await q(`update public.growth_referral_settings set manual_review_first_n = 0`);

    // Hoş geldin kredisini kullanan çift
    await q(`update public.growth_referral_settings set welcome_credit_try = 250`);
    const c = await tenant();
    const d = await tenant();
    await refer(c, d);
    expect(await call(`select public.growth_grant_welcome($1)`, [d])).toMatchObject({ ok: true, amount: 250 });
    await q(`insert into public.try_credit_reservations(tenant_id, amount, idempotency_key, state, settled_at) values ($1, 100, 'welcome-use-key-1', 'committed', now())`, [d]);
    expect(await register(await pay(d, 1000))).toMatchObject({ ok: true, status: "pending" });
    expect((await claim(d))!.flags).toContain("welcome_credit_used");
    await q(`update public.growth_referral_settings set welcome_credit_try = 0`);
  });

  it("kademe bonusu program bayrağı KAPALIYKEN üretilmez; açılınca verilir", async () => {
    await asService();
    await q(`update public.growth_referral_settings set velocity_max_per_day = 1000, manual_review_first_n = 0`);
    const a = await tenant();
    for (let k = 0; k < 3; k++) {
      const b = await tenant();
      await refer(a, b);
      await register(await pay(b, 1000));
    }
    await makeDue();
    await setFlag("growth_referral_enabled", false);
    expect(await process_()).toMatchObject({ paid: 3, bonus: 0 });
    expect((await q(`select count(*)::int as n from public.growth_reward_claims where beneficiary_tenant_id=$1 and component='tier1'`, [a]))[0]!.n).toBe(0);
    await setFlag("growth_referral_enabled", true);
    expect(await process_()).toMatchObject({ bonus: 1 });
  });

  it("personel RPC'leri DB içinde AAL2 ister; ayar ve ortak değişiklikleri denetim satırı yazar", async () => {
    await asService();
    const staff = (await q(`insert into public.platform_staff(id, role) values (gen_random_uuid(),'super_admin') returning id`))[0]!.id as string;
    const owner = await tenant();
    const partner = (await q(`insert into public.growth_partners(name,partner_type,code) values ('PA','agency','ortak-aal') returning id`))[0]!.id as string;
    const before = Number((await q(`select count(*)::int as n from public.growth_admin_audit`))[0]!.n);
    // MFA'sız (aal1 / claim yok) oturum: tüm personel RPC'leri 42501
    for (const aal of ["aal1", null]) {
      await asUser(staff, null, aal);
      expect((await call(`select public.growth_admin_save_settings($1::jsonb)`, [JSON.stringify({ min_cash_ratio: 0.4 })])).code).toBe("42501");
      expect((await call(`select public.growth_admin_partner_update($1,$2::jsonb)`, [partner, JSON.stringify({ is_tax_payer: true })])).code).toBe("42501");
      expect((await call(`select public.growth_admin_payout_create($1,'account_credit',null,null,null)`, [partner])).code).toBe("42501");
      expect((await call(`select public.growth_admin_decide($1,'reject','sebep var')`, ["00000000-0000-4000-8000-000000000000"])).code).toBe("42501");
    }
    await asService();
    expect(Number((await q(`select count(*)::int as n from public.growth_admin_audit`))[0]!.n)).toBe(before);
    // AAL2: yazılır + denetim
    await asUser(staff, null, "aal2");
    expect(await call(`select public.growth_admin_save_settings($1::jsonb)`, [JSON.stringify({ min_cash_ratio: 0.4, manual_review_first_n: 0 })])).toMatchObject({ ok: true });
    expect(await call(`select public.growth_admin_partner_update($1,$2::jsonb)`, [partner, JSON.stringify({ is_tax_payer: true, tax_no: "1234567890", owner_tenant_id: owner })])).toMatchObject({ ok: true });
    await asService();
    const rows = await q(`select action, actor_id, meta from public.growth_admin_audit order by id desc limit 2`);
    expect(rows.map((r) => r.action).sort()).toEqual(["partner_update", "settings_save"]);
    expect(rows.every((r) => r.actor_id === staff)).toBe(true);
    // vergi no değeri denetim izine YAZILMAZ
    expect(JSON.stringify(rows)).not.toContain("1234567890");
    expect(Number((await q(`select min_cash_ratio from public.growth_referral_settings`))[0]!.min_cash_ratio)).toBe(0.4);
    await q(`update public.growth_referral_settings set min_cash_ratio = 0.5`);
    // denetim tablosu append-only
    expect(await call(`update public.growth_admin_audit set action = 'settings_save'`)).toMatchObject({ code: "42501" });
  });

  it("geri alma dosyası temiz çalışır (zorlamasız dolu tabloda DURUR, zorlamayla düşer)", async () => {
    const rb = read("supabase/rollbacks/20260826000600_growth_referral_engine.rollback.sql");
    const blocked = await db.exec(rb).then(() => null, (e: Error) => e.message);
    expect(blocked).toMatch(/dolu/);
    await db.exec(`set emlaksoft.rollback_force = 'on'`);
    await db.exec(rb);
    expect(await call(`select to_regprocedure('public.growth_claims_process(integer)') is null`)).toBe(true);
    expect(await call(`select to_regclass('public.growth_referral_settings') is null`)).toBe(true);
  });
});
