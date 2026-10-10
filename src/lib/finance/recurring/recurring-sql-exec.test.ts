import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadPglite, type Db } from "@/lib/test-support/pglite";

/**
 * İŞLEVSEL SQL TESTİ (pglite): 20261010000900_recurring_rules — ay sonu kuralı, dönem başına tek üretim (idempotent), geçmişe dönük
 * kayıt yok, onay kipi (taslak/onay/atla), ofis gideri üretimi (maaş ve kişisel hariç), kişisel gizlilik, maaş yalnız owner/gm,
 * "kurala çevir" (çift kayıt yok), vade -3 gün hatırlatma, service_role kapısı, ofis izolasyonu, rollback.
 * Tarih mantığı gerçek bugüne göre kurulur (RPC'ler sunucu saatini kullanır); cron günü `p_today` ile ileri alınır.
 */
const mod = await loadPglite();
const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");

const STUB = `
create role service_role; create role authenticated; create role anon;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create function public.current_active_tenant_id() returns uuid language sql stable as $$ select nullif(current_setting('test.tenant', true), '')::uuid $$;
create function public.current_profile_role() returns text language sql stable as $$ select coalesce(nullif(current_setting('test.role', true), ''), '') $$;
create function public.has_effective_permission(p_module text, p_action text) returns boolean language sql stable as $$
  select position(p_module || ':' || p_action in coalesce(current_setting('test.perms', true), '')) > 0 $$;
create table public.tenants(id uuid primary key default gen_random_uuid());
create table public.profiles(id uuid primary key default gen_random_uuid(), tenant_id uuid, role text default 'advisor', is_active boolean default true);
create table public.expenses(id uuid primary key default gen_random_uuid(), tenant_id uuid, created_by uuid, category text default 'diger', title text,
  amount numeric default 0, currency text default 'TRY', expense_date date, notes text, receipt_url text, recurrence text, portal_key text,
  created_at timestamptz default now());
create table public.commissions(id uuid primary key default gen_random_uuid(), tenant_id uuid not null);
create table public.rent_payments(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, voided_at timestamptz);
create table public.building_payments(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, voided_at timestamptz);
create table public.audit_logs(id uuid primary key default gen_random_uuid(), tenant_id uuid, actor_id uuid, action text, entity_type text,
  entity_id uuid, old_value jsonb, new_value jsonb);
create table public.notifications(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, user_id uuid, title text not null, body text,
  href text, kind text not null default 'info', dedupe_key text, created_at timestamptz default now());
create unique index notifications_tenant_dedupe_key_uidx on public.notifications (tenant_id, dedupe_key) where dedupe_key is not null;
grant usage on schema public to authenticated;
grant select on all tables in schema public to authenticated;
`;

describe.skipIf(!mod)("recurring_rules + recurring_occurrences (pglite)", () => {
  let db: Db;
  let T: string, T2: string, OWNER: string, GM: string, ADV: string, ADV2: string, ACC: string, OTHER: string;
  let OFFICE: string, MY: string;
  let TODAY: string;
  const q = async (sql: string, params?: unknown[]) => (await db.query(sql, params)).rows;
  const as = async (uid: string, tenant: string, perms: string, role: string) => {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub','${uid}',false), set_config('test.tenant','${tenant}',false),
      set_config('test.perms','${perms}',false), set_config('test.role','${role}',false)`);
    await db.exec(`set role authenticated`);
  };
  const asService = async () => {
    await db.exec(`reset role; set role service_role`);
  };
  const FULL = "expenses:view expenses:create expenses:edit expenses:delete";
  const VIEW = "expenses:view";
  const rpc = async (sql: string, params: unknown[]) => (await q(`select ${sql} as r`, params))[0]!.r as Record<string, unknown>;
  const addDays = async (d: string, n: number) => String((await q(`select ($1::date + $2::int)::text as d`, [d, n]))[0]!.d);
  const create = (scope: string, dir: string, cat: string, title: string, amount: number, acc: string, opts: { freq?: string; day?: number; start?: string | null; mode?: string; portal?: string | null; expCat?: string | null; end?: string | null } = {}) =>
    rpc(`public.recurring_rule_create($1, $2, $3, $4, $5::numeric, $6::uuid, $7, $8::int, $9::date, $10::date, $11, $12, $13, true)`, [
      scope, dir, cat, title, amount, acc, opts.freq ?? "monthly", opts.day ?? 5, opts.start ?? null, opts.end ?? null, opts.mode ?? "auto", opts.portal ?? null, opts.expCat ?? "ofis",
    ]);
  const runDue = async (today: string, skip: string[] = []) => {
    await asService();
    return (await rpc(`public.recurring_run_due($1::date, $2::uuid[])`, [today, skip])) as Record<string, number | string>;
  };

  beforeAll(async () => {
    db = new mod!.PGlite();
    await db.exec(STUB);
    T = (await q(`insert into public.tenants default values returning id`))[0]!.id as string;
    T2 = (await q(`insert into public.tenants default values returning id`))[0]!.id as string;
    const prof = async (tenant: string, role: string) => (await q(`insert into public.profiles(tenant_id, role) values ($1, $2) returning id`, [tenant, role]))[0]!.id as string;
    OWNER = await prof(T, "owner");
    GM = await prof(T, "gm");
    ADV = await prof(T, "advisor");
    ADV2 = await prof(T, "advisor");
    ACC = await prof(T, "accounting");
    OTHER = await prof(T2, "owner");
    await db.exec(read("supabase/migrations/20261010000600_finance_accounts_cash_entries.sql"));
    await db.exec(read("supabase/migrations/20261010000900_recurring_rules.sql"));
    TODAY = String((await q(`select (now() at time zone 'Europe/Istanbul')::date::text as d`))[0]!.d);
    await db.exec(`grant select on all tables in schema public to authenticated; grant all on all tables in schema public to service_role; grant usage on schema public to service_role`);
    await as(OWNER, T, FULL, "owner");
    OFFICE = (await rpc(`public.finance_account_create('office', 'bank', 'İş Bankası Kadıköy', null, 'TRY', 50000::numeric, $1::date)`, [TODAY])).account_id as string;
    await as(ADV, T, "", "advisor");
    MY = (await rpc(`public.finance_account_create('user', 'cash', 'Benim kasam', null, 'TRY', 1000::numeric, $1::date)`, [TODAY])).account_id as string;
  });

  it("ödeme günü ay sonu kuralı: 31 kısa ayda ayın son günüdür; dönem adımları anchor ayına hizalıdır", async () => {
    await db.exec(`reset role`);
    const d = async (p: string, day: number) => String((await q(`select public.recurring_due_date($1::date, $2) ::text as d`, [p, day]))[0]!.d);
    expect(await d("2026-02-01", 31)).toBe("2026-02-28");
    expect(await d("2028-02-15", 31)).toBe("2028-02-29");
    expect(await d("2026-04-01", 31)).toBe("2026-04-30");
    expect(await d("2026-05-01", 31)).toBe("2026-05-31");
    expect(await d("2026-03-01", 10)).toBe("2026-03-10");
    const p = async (anchor: string, day: number, freq: string, from: string) =>
      String((await q(`select public.recurring_period_on_or_after($1::date, $2, $3, $4::date)::text as d`, [anchor, day, freq, from]))[0]!.d);
    expect(await p("2026-10-01", 10, "monthly", "2026-10-11")).toBe("2026-11-01");
    expect(await p("2026-10-01", 10, "monthly", "2026-10-10")).toBe("2026-10-01");
    expect(await p("2026-10-01", 10, "quarterly", "2026-10-11")).toBe("2027-01-01");
    expect(await p("2026-10-01", 10, "yearly", "2026-10-11")).toBe("2027-10-01");
  });

  it("ofis kuralı expenses yetkisi ister; danışman ofis kuralı açamaz, kişisel kural açabilir; kiracı/hesap doğrulanır", async () => {
    await as(ADV, T, "", "advisor");
    expect((await create("office", "out", "kira", "Kadıköy ofis kirası", 45000, OFFICE)).outcome).toBe("forbidden");
    expect((await create("user", "out", "ulasim", "Aylık kart", 800, OFFICE)).outcome).toBe("forbidden");
    const mine = await create("user", "out", "ulasim", "Aylık kart", 800, MY, { day: 31 });
    expect(mine.outcome).toBe("created");
    await as(OWNER, T, FULL, "owner");
    expect((await create("office", "out", "kira", "Geçmişte", 10, OFFICE, { start: "2020-01-01" })).outcome).toBe("invalid_input");
    expect((await create("office", "out", "kira", "Sıfır", 0, OFFICE)).outcome).toBe("invalid_input");
    expect((await create("office", "out", "kira", "Gün 40", 10, OFFICE, { day: 40 })).outcome).toBe("invalid_input");
    expect((await create("office", "out", "kira", "Kuruş", 1.234, OFFICE)).outcome).toBe("invalid_input");
    expect((await create("office", "out", "kira", "Yanlış hesap", 10, MY)).outcome).toBe("forbidden");
    await as(OTHER, T2, FULL, "owner");
    expect((await create("office", "out", "kira", "Çapraz ofis", 10, OFFICE)).outcome).toBe("not_found");
  });

  it("dönem başına tek üretim: aynı gün iki kez çalışınca ikinci çalışma hiçbir şey eklemez; gider kaydı yalnız ofis gideri için üretilir", async () => {
    await as(OWNER, T, FULL, "owner");
    const rent = await create("office", "out", "kira", "Kadıköy ofis kirası", 45000, OFFICE, { day: 31, expCat: "ofis" });
    const portal = await create("office", "out", "portal", "sahibinden.com üyeliği", 3200, OFFICE, { day: 31, portal: "sahibinden", expCat: "reklam" });
    const income = await create("office", "in", "hizmet_bedeli", "Aylık yönetim bedeli", 7000, OFFICE, { day: 31 });
    expect([rent.outcome, portal.outcome, income.outcome]).toEqual(["created", "created", "created"]);
    const rules = await q(`select id, next_due::text as nd, title from public.recurring_rules where tenant_id = $1 and scope = 'office'`, [T]);
    expect(rules).toHaveLength(3);
    // En geç vadeden sonrasına ilerlet: her kural tek dönem üretir
    const target = await addDays(String(rules.map((r) => r.nd as string).sort().pop()), 1);
    const first = await runDue(target);
    expect(first).toMatchObject({ outcome: "ok", failed: 0 });
    expect(Number(first.posted)).toBeGreaterThanOrEqual(4); // 3 ofis + 1 kişisel
    const count = async () => Number((await q(`select count(*)::int as c from public.recurring_occurrences`))[0]!.c);
    const entries = async () => Number((await q(`select count(*)::int as c from public.cash_entries where source_type = 'recurring'`))[0]!.c);
    const [c1, e1] = [await count(), await entries()];
    const second = await runDue(target);
    expect(second).toMatchObject({ posted: 0, drafts: 0, skipped: 0 });
    expect([await count(), await entries()]).toEqual([c1, e1]);
    // Aynı dönemi elle ikinci kez eklemek benzersiz anahtara takılır
    await db.exec(`reset role`);
    await expect(db.exec(`insert into public.recurring_occurrences(tenant_id, rule_id, period, due_date, amount, status)
      select tenant_id, rule_id, period, due_date, amount, 'pending' from public.recurring_occurrences limit 1`)).rejects.toThrow();
    // Gider kaydı: kira + portal üretildi (portal_key korunur), gelir ve kişisel için yok
    await db.exec(`reset role`);
    const exps = await q(`select title, category, portal_key, amount::float8 as a from public.expenses where tenant_id = $1 and notes = 'Düzenli ödeme' order by title`, [T]);
    expect(exps.map((e) => e.title)).toEqual(["Kadıköy ofis kirası", "sahibinden.com üyeliği"]);
    expect(exps.find((e) => e.title.startsWith("sahibinden"))).toMatchObject({ category: "reklam", portal_key: "sahibinden", a: 3200 });
    const linked = await q(`select count(*)::int as c from public.cash_entries where source_type = 'recurring' and expense_id is not null and created_expense`);
    expect(Number(linked[0]!.c)).toBe(2);
  });

  it("geçmişe dönük kayıt yok: kural başlangıcından önceki dönem üretilmez; kaçan cron günlerinde ileri dönemler tek tek üretilir", async () => {
    await as(OWNER, T, FULL, "owner");
    const rule = await create("office", "out", "ofis", "Su", 100, OFFICE, { day: 1 });
    const id = rule.rule_id as string;
    const before = await q(`select next_due::text as nd, next_period::text as np from public.recurring_rules where id = $1`, [id]);
    expect(String(before[0]!.nd) >= TODAY).toBe(true);
    await runDue(TODAY, []);
    expect(Number((await q(`select count(*)::int as c from public.recurring_occurrences where rule_id = $1`, [id]))[0]!.c)).toBe(0);
    const far = await addDays(String(before[0]!.nd), 70);
    await runDue(far);
    await db.exec(`reset role`);
    const occ = await q(`select period::text as p, due_date::text as d, status from public.recurring_occurrences where rule_id = $1 order by period`, [id]);
    expect(occ.length).toBeGreaterThanOrEqual(2);
    expect(occ.every((o) => o.status === "posted")).toBe(true);
    expect(occ[0]!.p).toBe(String(before[0]!.np));
    expect(occ.every((o) => String(o.d) >= TODAY)).toBe(true);
  });

  it("onay kipi: taslak + bildirim üretir, hareket YOK; onaylayınca tutar değiştirilebilir, atlayınca hareket yok; ikinci karar reddedilir", async () => {
    await as(OWNER, T, FULL, "owner");
    const rule = await create("office", "out", "muhasebe", "Muhasebe ücreti", 2500, OFFICE, { day: 31, mode: "approve" });
    const id = rule.rule_id as string;
    const nd = String((await q(`select next_due::text as nd from public.recurring_rules where id = $1`, [id]))[0]!.nd);
    const res = await runDue(await addDays(nd, 40));
    expect(Number(res.drafts)).toBeGreaterThanOrEqual(1);
    await as(OWNER, T, FULL, "owner");
    const pending = await q(`select id from public.recurring_occurrences where rule_id = $1 and status = 'pending' order by period`, [id]);
    expect(pending.length).toBeGreaterThanOrEqual(2);
    expect(await q(`select 1 from public.cash_entries where source_type = 'recurring' and title = 'Muhasebe ücreti'`)).toHaveLength(0);
    // yetkisiz görüntüleyici onaylayamaz
    await as(ACC, T, VIEW, "accounting");
    expect((await rpc(`public.recurring_occurrence_approve($1::uuid, null)`, [pending[0]!.id])).outcome).toBe("forbidden");
    await as(OWNER, T, FULL, "owner");
    expect((await rpc(`public.recurring_occurrence_approve($1::uuid, 2750::numeric)`, [pending[0]!.id])).outcome).toBe("approved");
    expect((await q(`select amount::float8 as a from public.cash_entries where title = 'Muhasebe ücreti' and source_type = 'recurring'`))[0]).toMatchObject({ a: 2750 });
    expect((await rpc(`public.recurring_occurrence_approve($1::uuid, null)`, [pending[0]!.id])).outcome).toBe("already_decided");
    expect((await rpc(`public.recurring_occurrence_skip($1::uuid)`, [pending[1]!.id])).outcome).toBe("skipped");
    expect((await rpc(`public.recurring_occurrence_skip($1::uuid)`, [pending[1]!.id])).outcome).toBe("already_decided");
    expect(Number((await q(`select count(*)::int as c from public.cash_entries where title = 'Muhasebe ücreti' and source_type = 'recurring'`))[0]!.c)).toBe(1);
    // bildirim: ofis kuralı owner/gm/accounting'e, danışmana değil
    await db.exec(`reset role`);
    const notified = await q(`select distinct user_id from public.notifications where dedupe_key like 'recurring-draft:%'`);
    const ids = notified.map((n) => n.user_id);
    expect(ids).toContain(OWNER);
    expect(ids).not.toContain(ADV);
  });

  it("kişisel kural yalnız sahibine görünür (ofis sahibi dahil); bildirimi yalnız ona gider; ofis gideri üretmez", async () => {
    await as(OWNER, T, FULL, "owner");
    expect(await q(`select 1 from public.recurring_rules where scope = 'user'`)).toHaveLength(0);
    expect(await q(`select 1 from public.recurring_occurrences o where exists (select 1 from public.recurring_rules r where r.id = o.rule_id and r.scope = 'user')`)).toHaveLength(0);
    await as(ADV2, T, VIEW, "advisor");
    expect(await q(`select 1 from public.recurring_rules where scope = 'user'`)).toHaveLength(0);
    await as(ADV, T, "", "advisor");
    const mine = await q(`select id from public.recurring_rules where scope = 'user'`);
    expect(mine).toHaveLength(1);
    expect((await q(`select count(*)::int as c from public.recurring_occurrences where rule_id = $1`, [mine[0]!.id]))[0]!.c).toBeGreaterThanOrEqual(1);
    await db.exec(`reset role`);
    expect(await q(`select 1 from public.expenses where title = 'Aylık kart'`)).toHaveLength(0);
    const rcpt = await q(`select distinct user_id from public.notifications where dedupe_key like $1`, [`recurring-post:${mine[0]!.id}:%`]);
    expect(rcpt.map((n) => n.user_id)).toEqual([ADV]);
    // başkası kuralı değiştiremez/durduramaz
    await as(OWNER, T, FULL, "owner");
    expect((await rpc(`public.recurring_rule_set_active($1::uuid, false)`, [mine[0]!.id])).outcome).toBe("forbidden");
    expect((await rpc(`public.recurring_rule_delete($1::uuid)`, [mine[0]!.id])).outcome).toBe("forbidden");
    await as(ADV, T, "", "advisor");
    expect((await rpc(`public.recurring_rule_set_active($1::uuid, false)`, [mine[0]!.id])).outcome).toBe("paused");
    expect((await rpc(`public.recurring_rule_delete($1::uuid)`, [mine[0]!.id])).outcome).toBe("has_history");
  });

  it("maaş kuralı yalnız owner/gm tarafından açılır ve okunur; gider kaydı üretmez; bildirimi muhasebeye gitmez", async () => {
    await as(ACC, T, FULL, "accounting");
    expect((await create("office", "out", "maas", "Ekim maaşı", 30000, OFFICE, { day: 28 })).outcome).toBe("forbidden");
    await as(GM, T, FULL, "gm");
    const sal = await create("office", "out", "maas", "Danışman maaşları", 30000, OFFICE, { day: 28 });
    expect(sal.outcome).toBe("created");
    expect((await create("user", "out", "maas", "Kişisel maaş", 1, MY)).outcome).toBe("invalid_input");
    expect((await create("office", "in", "maas", "Maaş geliri", 1, OFFICE)).outcome).toBe("invalid_input");
    await as(ACC, T, FULL, "accounting");
    expect(await q(`select 1 from public.recurring_rules where category = 'maas'`)).toHaveLength(0);
    expect((await rpc(`public.recurring_rule_update($1::uuid, 'x', 1::numeric, $2::uuid, 5, null, 'auto')`, [sal.rule_id, OFFICE])).outcome).toBe("forbidden");
    await as(OWNER, T, FULL, "owner");
    expect(await q(`select 1 from public.recurring_rules where category = 'maas'`)).toHaveLength(1);
    const nd = String((await q(`select next_due::text as nd from public.recurring_rules where id = $1`, [sal.rule_id]))[0]!.nd);
    await runDue(await addDays(nd, 1));
    await db.exec(`reset role`);
    expect(await q(`select 1 from public.expenses where title = 'Danışman maaşları'`)).toHaveLength(0);
    expect(Number((await q(`select count(*)::int as c from public.cash_entries where title = 'Danışman maaşları'`))[0]!.c)).toBe(1);
    const rcpt = (await q(`select distinct user_id from public.notifications where dedupe_key like $1`, [`recurring-post:${sal.rule_id}:%`])).map((n) => n.user_id);
    expect(rcpt.sort()).toEqual([OWNER, GM].sort());
    // maaş hareketi muhasebeden gizli (Paket A kuralı sürer)
    await as(ACC, T, FULL, "accounting");
    expect(await q(`select 1 from public.cash_entries where title = 'Danışman maaşları'`)).toHaveLength(0);
  });

  it("kurala çevir: seri hatırlatmadan çıkar (çift kayıt yok), geçmiş dönem üretilmez, ikinci çevirme reddedilir", async () => {
    await db.exec(`reset role`);
    for (const d of ["2026-07-05", "2026-08-05", "2026-09-05"]) {
      await db.query(`insert into public.expenses(tenant_id, category, title, amount, expense_date, recurrence) values ($1, 'ofis', 'Aidat ofis', 1500, $2, 'monthly')`, [T, d]);
    }
    const seriesId = (await q(`select id from public.expenses where title = 'Aidat ofis' order by expense_date desc limit 1`))[0]!.id as string;
    await as(ADV2, T, VIEW, "advisor");
    expect((await rpc(`public.recurring_rule_from_expense($1::uuid, $2::uuid, null, 'auto')`, [seriesId, OFFICE])).outcome).toBe("forbidden");
    await as(OWNER, T, FULL, "owner");
    expect((await rpc(`public.recurring_rule_from_expense($1::uuid, $2::uuid, null, 'auto')`, [seriesId, MY])).outcome).toBe("forbidden");
    const res = await rpc(`public.recurring_rule_from_expense($1::uuid, $2::uuid, null, 'approve')`, [seriesId, OFFICE]);
    expect(res).toMatchObject({ outcome: "created", series_rows: 3 });
    expect(await q(`select 1 from public.expenses where title = 'Aidat ofis' and recurrence is not null`)).toHaveLength(0);
    const rule = (await q(`select amount::float8 as a, pay_day, mode, next_due::text as nd, source_expense_id from public.recurring_rules where id = $1`, [res.rule_id]))[0]!;
    expect(rule).toMatchObject({ a: 1500, pay_day: 5, mode: "approve", source_expense_id: seriesId });
    expect(String(rule.nd) >= TODAY).toBe(true);
    expect((await rpc(`public.recurring_rule_from_expense($1::uuid, $2::uuid, null, 'auto')`, [seriesId, OFFICE])).outcome).toBe("not_found");
    await runDue(TODAY);
    expect(Number((await q(`select count(*)::int as c from public.recurring_occurrences where rule_id = $1`, [res.rule_id]))[0]!.c)).toBe(0);
  });

  it("vade -3 gün hatırlatması vade başına bir kez gider; tutar/gün güncellemesi sonraki dönemi yeniden hesaplar", async () => {
    await as(OWNER, T, FULL, "owner");
    const soon = await addDays(TODAY, 2);
    const day = Number(soon.slice(8, 10));
    const rule = await create("office", "out", "diger_gider", "Hatırlatma denemesi", 500, OFFICE, { day, start: soon, expCat: "diger" });
    expect(rule.outcome).toBe("created");
    const a = await runDue(TODAY);
    expect(Number(a.reminded)).toBeGreaterThanOrEqual(1);
    const b = await runDue(TODAY);
    expect(Number(b.reminded)).toBe(0);
    await db.exec(`reset role`);
    expect(Number((await q(`select count(*)::int as c from public.notifications where dedupe_key like $1`, [`recurring-remind:${rule.rule_id}:%`]))[0]!.c)).toBeGreaterThanOrEqual(1);
    await as(OWNER, T, FULL, "owner");
    const upd = await rpc(`public.recurring_rule_update($1::uuid, 'Hatırlatma (güncel)', 650::numeric, $2::uuid, 31, null, 'approve')`, [rule.rule_id, OFFICE]);
    expect(upd.outcome).toBe("updated");
    const r = (await q(`select title, amount::float8 as a, pay_day, mode, remind_for from public.recurring_rules where id = $1`, [rule.rule_id]))[0]!;
    expect(r).toMatchObject({ title: "Hatırlatma (güncel)", a: 650, pay_day: 31, mode: "approve", remind_for: null });
  });

  it("arşivdeki hesaba üretim atlanır ve nedeni kaydedilir; modülü kapalı kiracı atlanır", async () => {
    await as(OWNER, T, FULL, "owner");
    const acc = (await rpc(`public.finance_account_create('office', 'cash', 'Eski kasa', null, 'TRY', 0::numeric, $1::date)`, [TODAY])).account_id as string;
    const rule = await create("office", "out", "ofis", "Arşiv denemesi", 90, acc, { day: 31 });
    const nd = String((await q(`select next_due::text as nd from public.recurring_rules where id = $1`, [rule.rule_id]))[0]!.nd);
    await rpc(`public.finance_account_set_archived($1::uuid, true)`, [acc]);
    const skipped = await runDue(await addDays(nd, 1), [T]);
    expect(Number(skipped.posted) + Number(skipped.skipped) + Number(skipped.drafts)).toBe(0);
    const res = await runDue(await addDays(nd, 1));
    expect(Number(res.skipped)).toBeGreaterThanOrEqual(1);
    await db.exec(`reset role`);
    expect((await q(`select status, skip_reason from public.recurring_occurrences where rule_id = $1`, [rule.rule_id]))[0]).toMatchObject({ status: "skipped", skip_reason: "archived" });
  });

  it("recurring_run_due yalnız service_role; tablolara doğrudan yazma yoktur", async () => {
    await as(OWNER, T, FULL, "owner");
    await expect(db.query(`select public.recurring_run_due(current_date, '{}')`)).rejects.toThrow();
    await expect(db.exec(`insert into public.recurring_rules(tenant_id, scope, direction, category, title, amount, account_id, frequency, pay_day, start_date, anchor)
      values ('${T}', 'office', 'out', 'ofis', 'x', 1, '${OFFICE}', 'monthly', 1, current_date, current_date)`)).rejects.toThrow();
    await expect(db.exec(`update public.recurring_rules set amount = 1`)).rejects.toThrow();
  });

  it("rollback tabloları ve fonksiyonları düşürür; üretilmiş hareketler yerinde kalır", async () => {
    await db.exec(`reset role`);
    await db.exec(read("supabase/rollbacks/20261010000900_recurring_rules.rollback.sql"));
    expect((await q(`select to_regclass('public.recurring_rules') as t`))[0]!.t).toBeNull();
    expect((await q(`select to_regprocedure('public.recurring_run_due(date,uuid[])') as t`))[0]!.t).toBeNull();
    expect(Number((await q(`select count(*)::int as c from public.cash_entries where source_type = 'recurring'`))[0]!.c)).toBeGreaterThan(0);
  });
});
