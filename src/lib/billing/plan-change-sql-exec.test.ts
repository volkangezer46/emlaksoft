import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadPglite, type Db } from "@/lib/test-support/pglite";

/**
 * İŞLEVSEL SQL TESTİ: 20261007001000 (duraklatma + planlı düşürme RPC'leri) ve 20261007001010 (plan_upgrade faturası,
 * fulfill/v2 TAM gövdeleri) gerçek PL/pgSQL ile (pglite, bellek içi Postgres) çalıştırılır; modül yoksa ATLANIR.
 * Şema canlının SADELEŞTİRİLMİŞ taklididir; fulfill gövdeleri dosyadan OLDUĞU GİBİ yüklenir (ön koşul `do` bloğu hariç:
 * o canlı gövde md5'ini arar, sözleşme testi ayrıdır).
 */
const mod = await loadPglite();
const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");

const STUB = `
create role service_role; create role authenticated; create role anon;
create schema auth;
create function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.role', true),''),'anon') $$;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true),''),'{}')::jsonb $$;
create function public.current_tenant_id() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.tenant', true),'')::uuid $$;
create table public.tenants(id uuid primary key default gen_random_uuid(), plan text not null default 'office', status text not null default 'active', updated_at timestamptz);
create table public.profiles(id uuid primary key default gen_random_uuid(), tenant_id uuid references public.tenants(id), role text not null default 'advisor', is_active boolean not null default true);
create table public.subscriptions(
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null unique references public.tenants(id),
  plan text not null, status text not null default 'active', billing_cycle text not null default 'monthly',
  amount_try numeric, price_lock_try numeric, price_lock_campaign text, trial_ends_at timestamptz, cancelled_at timestamptz,
  iyzico_subscription_ref text, current_period_start timestamptz, current_period_end timestamptz,
  cancel_at_period_end boolean not null default false, updated_at timestamptz);
create table public.audit_logs(id bigserial primary key, tenant_id uuid, actor_id uuid, action text, entity_type text, entity_id uuid, old_value jsonb, new_value jsonb);
create table public.platform_settings(key text primary key, value text);
create table public.invoices(
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id), subscription_id uuid,
  status text not null default 'draft', checkout_status text, amount_try numeric, tax_try numeric, total_try numeric, currency text default 'TRY',
  period_start timestamptz, period_end timestamptz, due_at timestamptz, paid_at timestamptz, iyzico_payment_id text,
  meta jsonb not null default '{}', created_at timestamptz not null default now());
create table public.billing_fulfillment_events(
  id uuid primary key default gen_random_uuid(), provider text not null, conversation_id text not null, payment_id text,
  source text, target_type text, status text, tenant_id uuid, invoice_id uuid, payment_link_id uuid, result jsonb, completed_at timestamptz,
  unique (provider, conversation_id), unique (provider, payment_id));
create function public.plan_monthly_amount(p text) returns numeric language sql immutable as $$
  select case p when 'advisor' then 749 when 'office' then 2490 when 'professional' then 4990 when 'business' then 8990 when 'enterprise' then 12900 end $$;
create function public.plan_catalog_document() returns jsonb language sql stable as $$
  select nullif(value,'')::jsonb from public.platform_settings where key = 'billing.plan_definitions' $$;
create table public.plan_entitlements(plan text primary key, seat_limit int, customer_limit int, active_property_limit int, branch_limit int);
insert into public.plan_entitlements values ('advisor',1,null,null,null),('office',10,null,null,null),('professional',20,null,null,null),('business',40,null,null,null),('enterprise',50,null,null,null);
create function public.plan_period_amount(p text, c text) returns numeric language sql immutable as $$
  select public.plan_monthly_amount(p) * case when c = 'yearly' then 10 else 1 end $$;
create function public.plan_campaign_lock_amount(p text) returns numeric language sql immutable as $$ select null::numeric $$;
`;

/** 001010 dosyasında ön koşul `do` bloğu atlanır; fonksiyon + hazırlık yoklaması + yetkiler yüklenir. */
function upgradeFunctionsSql(): string {
  const sql = read("supabase/migrations/20261007001010_plan_upgrade_fulfillment.sql");
  const start = sql.indexOf("create or replace function public.fulfill_billing_payment(");
  return sql.slice(start);
}

describe.skipIf(!mod)("duraklatma / planlı düşürme / plan_upgrade fulfill — gerçek PL/pgSQL (pglite)", () => {
  let db: Db;
  const q = async (sql: string, params?: unknown[]) => (await db.query(sql, params)).rows;
  const as = async (role: "service_role" | "authenticated", userId: string | null = null, tenantId: string | null = null, impersonating = false) => {
    await db.exec(`select set_config('request.jwt.claim.role','${role}',false)`);
    await db.exec(`select set_config('request.jwt.claim.sub','${userId ?? ""}',false)`);
    await db.exec(`select set_config('request.jwt.claim.tenant','${tenantId ?? ""}',false)`);
    await db.exec(`select set_config('request.jwt.claims','${JSON.stringify({ app_metadata: { impersonating } })}',false)`);
  };
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
  const setFlag = (key: string, value: string | null) =>
    value === null
      ? q(`delete from public.platform_settings where key = $1`, [key])
      : q(`insert into public.platform_settings(key, value) values ($1,$2) on conflict (key) do update set value = excluded.value`, [key, value]);

  async function office(opts: { plan?: string; status?: string; startDays?: number; endDays?: number; cycle?: string } = {}) {
    const t = (await q(`insert into public.tenants(plan) values ($1) returning id`, [opts.plan ?? "office"]))[0]!.id as string;
    const owner = (await q(`insert into public.profiles(tenant_id, role) values ($1,'owner') returning id`, [t]))[0]!.id as string;
    const gm = (await q(`insert into public.profiles(tenant_id, role) values ($1,'gm') returning id`, [t]))[0]!.id as string;
    const advisor = (await q(`insert into public.profiles(tenant_id, role) values ($1,'advisor') returning id`, [t]))[0]!.id as string;
    const sub = (
      await q(
        `insert into public.subscriptions(tenant_id, plan, status, billing_cycle, amount_try, current_period_start, current_period_end)
         values ($1,$2,$3,$4,2490, now() - ($5 || ' days')::interval, now() + ($6 || ' days')::interval) returning id`,
        [t, opts.plan ?? "office", opts.status ?? "active", opts.cycle ?? "monthly", String(opts.startDays ?? 15), String(opts.endDays ?? 15)],
      )
    )[0]!.id as string;
    return { t, owner, gm, advisor, sub };
  }
  const subRow = async (t: string) => (await q(`select * from public.subscriptions where tenant_id = $1`, [t]))[0]!;
  const audit = async (t: string) => (await q(`select action from public.audit_logs where tenant_id = $1 order by id`, [t])).map((r) => r.action as string);

  beforeAll(async () => {
    db = new mod!.PGlite();
    await db.exec(STUB);
    await db.exec(read("supabase/migrations/20261007001000_subscription_pause_and_plan_change.sql"));
    await db.exec(upgradeFunctionsSql());
  }, 90_000);

  describe("duraklatma", () => {
    it("bayrak KAPALI (varsayılan): sahip bile duraklatamaz", async () => {
      const o = await office();
      await as("authenticated", o.owner, o.t);
      expect(await call(`select public.subscription_pause(10)`)).toMatchObject({ ok: false, code: "disabled" });
      expect((await subRow(o.t)).pause_started_at).toBeNull();
    });

    it("açıkken yalnız ofis sahibi; süre ayardan (varsayılan 30) sınırlı; denetim kaydı yazılır", async () => {
      await setFlag("billing.pause_enabled", "on");
      const o = await office();
      await as("authenticated", o.gm, o.t);
      expect(await call(`select public.subscription_pause(10)`)).toMatchObject({ ok: false, code: "not_owner" });
      await as("authenticated", o.owner, o.t);
      expect(await call(`select public.subscription_pause(0)`)).toMatchObject({ ok: false, code: "invalid_days" });
      expect(await call(`select public.subscription_pause(31)`)).toMatchObject({ ok: false, code: "too_long", maxDays: 30 });
      expect(await call(`select public.subscription_pause(30)`)).toMatchObject({ ok: true, days: 30 });
      const s = await subRow(o.t);
      expect(s.pause_started_at).not.toBeNull();
      expect(s.status).toBe("active"); // platform askısı anlamındaki 'paused' kullanılmaz
      expect(await audit(o.t)).toEqual(["billing.subscription_paused"]);
      expect(await call(`select public.subscription_pause(5)`)).toMatchObject({ ok: false, code: "already_paused" });
    });

    it("ayar azami süreyi değiştirir (1..90 dışı varsayılana düşer)", async () => {
      await setFlag("billing.pause_max_days", "45");
      const o = await office();
      await as("authenticated", o.owner, o.t);
      expect(await call(`select public.subscription_pause(46)`)).toMatchObject({ ok: false, code: "too_long", maxDays: 45 });
      await setFlag("billing.pause_max_days", "999");
      expect(await call(`select public.subscription_pause(31)`)).toMatchObject({ ok: false, code: "too_long", maxDays: 30 });
      await setFlag("billing.pause_max_days", null);
    });

    it("yılda 1 kez: devamdan sonra bile 365 gün dolmadan yeniden duraklatılamaz", async () => {
      const o = await office();
      await as("authenticated", o.owner, o.t);
      expect(await call(`select public.subscription_pause(7)`)).toMatchObject({ ok: true });
      expect(await call(`select public.subscription_resume()`)).toMatchObject({ ok: true });
      expect(await call(`select public.subscription_pause(7)`)).toMatchObject({ ok: false, code: "yearly_limit" });
      await q(`update public.subscriptions set pause_last_started_at = now() - interval '366 days' where tenant_id = $1`, [o.t]);
      expect(await call(`select public.subscription_pause(7)`)).toMatchObject({ ok: true });
    });

    it("yalnız aktif ve dönemi süren abonelik; iptal talebi olan duraklatılamaz", async () => {
      await as("authenticated");
      const trial = await office({ status: "trialing" });
      await as("authenticated", trial.owner, trial.t);
      expect(await call(`select public.subscription_pause(5)`)).toMatchObject({ ok: false, code: "not_active" });
      const over = await office({ endDays: -1 });
      await as("authenticated", over.owner, over.t);
      expect(await call(`select public.subscription_pause(5)`)).toMatchObject({ ok: false, code: "period_over" });
      const cancelling = await office();
      await q(`update public.subscriptions set cancel_at_period_end = true where tenant_id = $1`, [cancelling.t]);
      await as("authenticated", cancelling.owner, cancelling.t);
      expect(await call(`select public.subscription_pause(5)`)).toMatchObject({ ok: false, code: "cancel_pending" });
    });

    it("destek oturumunda ve başka ofisin kimliğiyle yazılamaz", async () => {
      const o = await office();
      await as("authenticated", o.owner, o.t, true);
      expect((await call(`select public.subscription_pause(5)`)).err).toMatch(/Destek oturumunda/);
      const other = await office();
      await as("authenticated", other.owner, o.t); // başka ofisin sahibi, bu ofisin JWT'si
      expect(await call(`select public.subscription_pause(5)`)).toMatchObject({ ok: false, code: "not_owner" });
    });

    it("devam: dönem sonu gerçek duraklatma süresi kadar uzar; sahip veya genel müdür devam ettirir", async () => {
      const o = await office();
      await as("authenticated", o.owner, o.t);
      await call(`select public.subscription_pause(20)`);
      // 4 gün geçmiş gibi
      const before = (await subRow(o.t)).current_period_end as Date;
      await q(`update public.subscriptions set pause_started_at = now() - interval '4 days', pause_ends_at = now() + interval '16 days' where tenant_id = $1`, [o.t]);
      await as("authenticated", o.advisor, o.t);
      expect(await call(`select public.subscription_resume()`)).toMatchObject({ ok: false, code: "not_owner" });
      await as("authenticated", o.gm, o.t);
      const r = await call(`select public.subscription_resume()`);
      expect(r).toMatchObject({ ok: true });
      const after = await subRow(o.t);
      expect(after.pause_started_at).toBeNull();
      expect(after.pause_ends_at).toBeNull();
      const extendedDays = ((after.current_period_end as Date).getTime() - before.getTime()) / 86_400_000;
      expect(extendedDays).toBeGreaterThan(3.99);
      expect(extendedDays).toBeLessThan(4.01);
      expect(await audit(o.t)).toContain("billing.subscription_resumed");
      expect(await call(`select public.subscription_resume()`)).toMatchObject({ ok: false, code: "not_paused" });
    });

    it("cron: süresi dolanlar otomatik devam eder (planlı süreyi aşmaz), bayraktan bağımsız; çalışan duraklatma dokunulmaz", async () => {
      const due = await office();
      const running = await office();
      await q(`update public.subscriptions set pause_started_at = now() - interval '35 days', pause_ends_at = now() - interval '5 days', pause_last_started_at = now() - interval '35 days' where tenant_id = $1`, [due.t]);
      await q(`update public.subscriptions set pause_started_at = now() - interval '1 days', pause_ends_at = now() + interval '9 days' where tenant_id = $1`, [running.t]);
      const dueBefore = (await subRow(due.t)).current_period_end as Date;
      await setFlag("billing.pause_enabled", "off"); // bayrak kapalı olsa da süresi dolan devam eder
      await as("service_role");
      const res = await call(`select public.subscription_resume_due()`);
      expect(res).toMatchObject({ ok: true, resumed: 1, tenantIds: [due.t] });
      const extended = (((await subRow(due.t)).current_period_end as Date).getTime() - dueBefore.getTime()) / 86_400_000;
      expect(extended).toBeGreaterThan(29.99); // 30 gün planlandı; 35 gün geçmiş olsa da 30 gün
      expect(extended).toBeLessThan(30.01);
      expect((await subRow(running.t)).pause_started_at).not.toBeNull();
      expect(await audit(due.t)).toContain("billing.subscription_auto_resumed");
      await as("authenticated", due.owner, due.t);
      expect((await call(`select public.subscription_resume_due()`)).err).toMatch(/Service role required/);
      await setFlag("billing.pause_enabled", "on");
    });
  });

  describe("planlı düşürme (dönem sonunda, iade yok)", () => {
    it("bayrak KAPALI: planlanamaz", async () => {
      const o = await office({ plan: "professional" });
      await as("authenticated", o.owner, o.t);
      expect(await call(`select public.subscription_schedule_downgrade('office')`)).toMatchObject({ ok: false, code: "disabled" });
    });

    it("yalnız daha ucuz plana; kayıt dönem sonu için yazılır, geri alınabilir, denetlenir", async () => {
      await setFlag("billing.plan_change_proration_enabled", "on");
      const o = await office({ plan: "professional" });
      await as("authenticated", o.advisor, o.t);
      expect(await call(`select public.subscription_schedule_downgrade('office')`)).toMatchObject({ ok: false, code: "not_owner" });
      await as("authenticated", o.owner, o.t);
      expect(await call(`select public.subscription_schedule_downgrade('enterprise')`)).toMatchObject({ ok: false, code: "not_downgrade" });
      expect(await call(`select public.subscription_schedule_downgrade('professional')`)).toMatchObject({ ok: false, code: "same_plan" });
      expect(await call(`select public.subscription_schedule_downgrade('bogus')`)).toMatchObject({ ok: false, code: "invalid_plan" });
      expect(await call(`select public.subscription_schedule_downgrade('office')`)).toMatchObject({ ok: true, plan: "office" });
      const s = await subRow(o.t);
      expect(s.plan).toBe("professional"); // hemen DEĞİŞMEZ
      expect(s.pending_plan).toBe("office");
      expect(s.pending_plan_effective_at).toEqual(s.current_period_end);
      expect(await call(`select public.subscription_cancel_scheduled_downgrade()`)).toMatchObject({ ok: true });
      expect((await subRow(o.t)).pending_plan).toBeNull();
      expect(await call(`select public.subscription_cancel_scheduled_downgrade()`)).toMatchObject({ ok: false, code: "nothing_scheduled" });
      expect(await audit(o.t)).toEqual(["billing.plan_downgrade_scheduled", "billing.plan_downgrade_cancelled"]);
    });

    it("gizli plana (business) ve kapasiteyi aşan plana planlı düşürme reddedilir; katalogda gizli kapatılırsa izin verilir", async () => {
      await setFlag("billing.plan_change_proration_enabled", "on");
      const o = await office({ plan: "enterprise" });
      await as("authenticated", o.owner, o.t);
      expect(await call(`select public.subscription_schedule_downgrade('business')`)).toMatchObject({ ok: false, code: "not_sold" });
      // 3 aktif kullanıcı > advisor koltuk sınırı (1)
      const p = await office({ plan: "professional" });
      await as("authenticated", p.owner, p.t);
      expect(await call(`select public.subscription_schedule_downgrade('advisor')`)).toMatchObject({ ok: false, code: "over_capacity", metric: "seats", usage: 3, limit: 1 });
      expect((await subRow(p.t)).pending_plan).toBeNull();
      await setFlag("billing.plan_definitions", JSON.stringify({ v: 2, plans: { business: { hidden: false } } }));
      await as("authenticated", o.owner, o.t);
      expect(await call(`select public.subscription_schedule_downgrade('business')`)).toMatchObject({ ok: true, plan: "business" });
      await setFlag("billing.plan_definitions", null);
    });

    it("cron: dönemi bitince uygulanır (plan + tenants.plan + aylık tutar); bayraktan bağımsız", async () => {
      const o = await office({ plan: "professional", startDays: 31, endDays: -1 });
      await q(`update public.subscriptions set pending_plan = 'office', pending_plan_effective_at = current_period_end where tenant_id = $1`, [o.t]);
      await q(`update public.tenants set plan = 'professional' where id = $1`, [o.t]);
      await setFlag("billing.plan_change_proration_enabled", "off");
      await as("service_role");
      const res = await call(`select public.subscription_apply_scheduled_plan_changes()`);
      expect(res).toMatchObject({ ok: true, applied: 1, failed: 0 });
      const s = await subRow(o.t);
      expect(s.plan).toBe("office");
      expect(Number(s.amount_try)).toBe(2490);
      expect(s.pending_plan).toBeNull();
      expect((await q(`select plan from public.tenants where id = $1`, [o.t]))[0]!.plan).toBe("office");
      expect(await audit(o.t)).toContain("billing.plan_downgrade_applied");
      await setFlag("billing.plan_change_proration_enabled", "on");
    });

    it("dönemi sürenler ve duraklatılmışlar uygulanmaz", async () => {
      const running = await office({ plan: "professional" });
      await q(`update public.subscriptions set pending_plan = 'office', pending_plan_effective_at = current_period_end where tenant_id = $1`, [running.t]);
      const paused = await office({ plan: "professional", startDays: 31, endDays: -1 });
      await q(`update public.subscriptions set pending_plan = 'office', pause_started_at = now() - interval '2 days', pause_ends_at = now() + interval '5 days' where tenant_id = $1`, [paused.t]);
      await as("service_role");
      await call(`select public.subscription_apply_scheduled_plan_changes()`);
      expect((await subRow(running.t)).plan).toBe("professional");
      expect((await subRow(paused.t)).plan).toBe("professional");
    });

    it("kapasite tetikleyicisi reddederse planlı kayıt iptal edilir, plan değişmez, nedeni denetlenir", async () => {
      await db.exec(`
        create function public.t_block_office() returns trigger language plpgsql as $$ begin
          if new.plan = 'office' then raise exception 'plan capacity exceeded' using errcode = '23514'; end if; return new; end $$;
        create trigger trg_block_office before update of plan on public.tenants for each row execute function public.t_block_office();`);
      const o = await office({ plan: "professional", startDays: 31, endDays: -1 });
      await q(`update public.subscriptions set pending_plan = 'office' where tenant_id = $1`, [o.t]);
      await as("service_role");
      const res = await call(`select public.subscription_apply_scheduled_plan_changes()`);
      expect(res).toMatchObject({ ok: true, applied: 0, failed: 1, failedTenantIds: [o.t] });
      const s = await subRow(o.t);
      expect(s.plan).toBe("professional");
      expect(s.pending_plan).toBeNull();
      expect(await audit(o.t)).toContain("billing.plan_downgrade_failed");
      await db.exec(`drop trigger trg_block_office on public.tenants`);
    });
  });

  describe("fulfill: plan_upgrade faturası (oransal yükseltme)", () => {
    let seq = 0;
    async function upgradeInvoice(o: { t: string; sub: string }, over: Record<string, unknown> = {}, amount = 1250) {
      seq += 1;
      const conv = `es-up-${seq}`;
      const meta = {
        conversationId: conv,
        plan: "professional",
        cycle: "monthly",
        source: "checkout",
        kind: "plan_upgrade",
        fromPlan: "office",
        chargeNetTry: amount,
        newPeriodTry: 4990,
        ...over,
      };
      const tax = Math.round(amount * 0.2 * 100) / 100;
      await q(
        `insert into public.invoices(tenant_id, subscription_id, status, checkout_status, amount_try, tax_try, total_try, meta)
         values ($1,$2,'draft','pending_checkout',$3,$4,$5,$6)`,
        [o.t, o.sub, amount, tax, Math.round((amount + tax) * 100) / 100, JSON.stringify(meta)],
      );
      return { conv, total: Math.round((amount + tax) * 100) / 100 };
    }
    const fulfill = (o: { t: string }, conv: string, total: number, plan = "professional") =>
      call(`select public.fulfill_billing_payment_v2('demo',$1,null,'demo','subscription',$2,$3,'monthly',$4,'TRY')`, [conv, o.t, plan, total]);

    it("plan, kanonik aylık tutar ve tenants.plan değişir; DÖNEM ve döngü değişmez; fatura ödenir; denetlenir", async () => {
      await as("service_role");
      const o = await office();
      const before = await subRow(o.t);
      const inv = await upgradeInvoice(o);
      const res = await fulfill(o, inv.conv, inv.total);
      expect(res).toMatchObject({ ok: true, already: false, kind: "plan_upgrade", plan: "professional", fromPlan: "office" });
      const s = await subRow(o.t);
      expect(s.plan).toBe("professional");
      expect(Number(s.amount_try)).toBe(4990);
      expect(s.current_period_end).toEqual(before.current_period_end);
      expect(s.current_period_start).toEqual(before.current_period_start);
      expect(s.billing_cycle).toBe("monthly");
      expect(s.status).toBe("active");
      expect((await q(`select plan from public.tenants where id = $1`, [o.t]))[0]!.plan).toBe("professional");
      const invoice = (await q(`select * from public.invoices where meta->>'conversationId' = $1`, [inv.conv]))[0]!;
      expect(invoice.status).toBe("paid");
      expect(invoice.checkout_status).toBe("fulfilled");
      expect(invoice.period_end).toEqual(before.current_period_end);
      expect(await audit(o.t)).toContain("billing.plan_upgraded");
    });

    it("tek sefer: aynı ödeme ikinci kez işlenirse plan/dönem tekrar değişmez", async () => {
      await as("service_role");
      const o = await office();
      const inv = await upgradeInvoice(o);
      await fulfill(o, inv.conv, inv.total);
      const again = await fulfill(o, inv.conv, inv.total);
      expect(again).toMatchObject({ ok: true, already: true });
      expect((await q(`select count(*)::int as n from public.audit_logs where tenant_id = $1 and action = 'billing.plan_upgraded'`, [o.t]))[0]!.n).toBe(1);
    });

    it("bekleyen planlı düşürme yükseltmeyle temizlenir", async () => {
      await as("service_role");
      const o = await office();
      await q(`update public.subscriptions set pending_plan = 'advisor' where tenant_id = $1`, [o.t]);
      const inv = await upgradeInvoice(o);
      await fulfill(o, inv.conv, inv.total);
      expect((await subRow(o.t)).pending_plan).toBeNull();
    });

    it("tutar uyuşmazlığı, değişmiş plan, duraklatılmış / aktif olmayan / biten dönem reddedilir (tahsilat refund_required'a düşer)", async () => {
      await as("service_role");
      const o1 = await office();
      const i1 = await upgradeInvoice(o1);
      expect((await fulfill(o1, i1.conv, i1.total + 5)).code).toBe("22023");

      const o2 = await office({ plan: "professional" }); // teklif office'ten verilmişti ama plan artık farklı
      const i2 = await upgradeInvoice(o2, {}, 800);
      expect((await fulfill(o2, i2.conv, i2.total)).err).toMatch(/Subscription plan changed since quote/);

      const o3 = await office();
      await q(`update public.subscriptions set pause_started_at = now() - interval '1 days', pause_ends_at = now() + interval '9 days' where tenant_id = $1`, [o3.t]);
      const i3 = await upgradeInvoice(o3);
      expect((await fulfill(o3, i3.conv, i3.total)).err).toMatch(/Subscription is paused/);

      const o4 = await office({ status: "past_due" });
      const i4 = await upgradeInvoice(o4);
      expect((await fulfill(o4, i4.conv, i4.total)).err).toMatch(/not active for plan upgrade/);

      const o5 = await office({ endDays: -1 });
      const i5 = await upgradeInvoice(o5);
      expect((await fulfill(o5, i5.conv, i5.total)).err).toMatch(/period is over/);
      // Hiçbiri planı değiştirmedi.
      for (const o of [o1, o3, o4, o5]) expect((await subRow(o.t)).plan).toBe("office");
    });

    it("katalog tavanı: tahsil edilen net, yeni planın tam dönem tutarını aşamaz; meta bozuksa reddedilir", async () => {
      await as("service_role");
      const o = await office();
      const big = await upgradeInvoice(o, { newPeriodTry: 9999 }, 5100); // 4990 katalog tavanı < 5100
      expect((await fulfill(o, big.conv, big.total)).err).toMatch(/exceeds the plan period price/);
      const o2 = await office();
      const bad = await upgradeInvoice(o2, { fromPlan: "professional" }); // from = hedef
      expect((await fulfill(o2, bad.conv, bad.total)).err).toMatch(/metadata is invalid/);
      const o3 = await office();
      const noMeta = await upgradeInvoice(o3, { chargeNetTry: undefined });
      expect((await fulfill(o3, noMeta.conv, noMeta.total)).err).toMatch(/metadata is invalid/);
      const o4 = await office();
      const down = await upgradeInvoice(o4, { plan: "advisor", fromPlan: "office", newPeriodTry: 749 }, 100);
      expect((await call(
        `select public.fulfill_billing_payment_v2('demo',$1,null,'demo','subscription',$2,'advisor','monthly',$3,'TRY')`,
        [down.conv, o4.t, down.total],
      )).err).toMatch(/higher plan/);
    });

    it("bilinmeyen fatura türü hâlâ reddedilir; türsüz yenileme dönemi uzatmaya devam eder", async () => {
      await as("service_role");
      const o = await office();
      const weird = await upgradeInvoice(o, { kind: "mystery" });
      expect((await fulfill(o, weird.conv, weird.total)).err).toMatch(/Unsupported invoice kind/);

      const r = await office();
      const beforeEnd = (await subRow(r.t)).current_period_end as Date;
      seq += 1;
      const conv = `es-renew-${seq}`;
      await q(
        `insert into public.invoices(tenant_id, subscription_id, status, checkout_status, amount_try, tax_try, total_try, meta)
         values ($1,$2,'draft','pending_checkout',2490,498,2988,$3)`,
        [r.t, r.sub, JSON.stringify({ conversationId: conv, plan: "office", cycle: "monthly" })],
      );
      const res = await fulfill(r, conv, 2988, "office");
      expect(res).toMatchObject({ ok: true, plan: "office" });
      const afterEnd = (await subRow(r.t)).current_period_end as Date;
      expect(afterEnd.getTime()).toBeGreaterThan(beforeEnd.getTime() + 27 * 86_400_000);
    });

    it("plan_upgrade_ready yoklaması: yalnız service_role; her iki gövde işaretli", async () => {
      await as("service_role");
      expect(await call(`select public.plan_upgrade_ready()`)).toBe(true);
      await as("authenticated");
      expect(await call(`select public.plan_upgrade_ready()`)).toBe(false);
      await as("service_role");
      expect(await call(`select public.subscription_pause_ready()`)).toBe(true);
    });
  });
});
