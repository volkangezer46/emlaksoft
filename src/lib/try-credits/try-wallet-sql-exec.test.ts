import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * İŞLEVSEL SQL TESTİ: 20260826000400 + 000500 gerçek PL/pgSQL ile (pglite, bellek içi Postgres) çalıştırılır.
 * `@electric-sql/pglite` bağımlılık DEĞİLDİR (package.json'a eklenmedi): kuruluysa koşar, yoksa ATLANIR.
 *   Çalıştırmak için:  npm i --no-save @electric-sql/pglite && npx vitest run src/lib/try-credits/try-wallet-sql-exec
 * Şema, canlıdaki tablo/fonksiyonların SADELEŞTİRİLMİŞ taklididir (tenants/profiles/invoices/ledger/auth.role()); fulfill_v2
 * bir taklittir (fatura toplamını doğrulayıp 'paid' yapar). Gerçek fulfill gövdeleri sahip provasında doğrulanır.
 * Tek bağlantı olduğundan EŞ ZAMANLILIK burada denenmez (advisory lock varlığı sözleşme testinde); yarış senaryoları
 * "ardışık çift harcama" olarak sınanır.
 */
type Db = {
  exec: (sql: string) => Promise<unknown>;
  query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
};
const spec = "@electric-sql/pglite";
const mod: { PGlite: new () => Db } | null = await import(/* @vite-ignore */ spec).catch(() => null);

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");

const STUB = `
create role service_role; create role authenticated; create role anon;
create schema auth;
create function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.role', true),''),'anon') $$;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
create function public.current_tenant_id() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.tenant', true),'')::uuid $$;
create function public.current_profile_role() returns text language sql stable as $$ select 'owner' $$;
create table public.tenants(id uuid primary key default gen_random_uuid());
create table public.profiles(id uuid primary key default gen_random_uuid(), tenant_id uuid references public.tenants(id));
create table public.invoices(id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id), status text not null default 'draft', checkout_status text, total_try numeric not null default 0, currency text default 'TRY', meta jsonb not null default '{}', created_at timestamptz default now());
create table public.billing_fulfillment_events(id uuid primary key default gen_random_uuid(), provider text, conversation_id text, result jsonb);
create table public.account_credit_ledger (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  unit text not null, entry_type text not null, amount numeric(14,2) not null check (amount <> 0), source text not null, source_id uuid,
  idempotency_key text not null unique, available_at timestamptz not null default now(), expires_at timestamptz, created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(), feature text, model text, tokens_in int, tokens_out int);
alter table public.account_credit_ledger add constraint account_credit_ledger_unit_check check (unit in ('try','ai','valuation','ef'));
alter table public.account_credit_ledger add constraint account_credit_ledger_source_check check (source in ('referral','partner','campaign','manual','usage','plan','purchase','bonus','refund'));
alter table public.account_credit_ledger enable row level security;
create function public.account_credit_ledger_immutable() returns trigger language plpgsql as $$ begin raise exception 'append-only' using errcode='42501'; end $$;
create trigger trg_imm before update or delete on public.account_credit_ledger for each row execute function public.account_credit_ledger_immutable();
create policy own on public.account_credit_ledger for select using (tenant_id = public.current_tenant_id());
create function public.fulfill_billing_payment_v2(p_provider text,p_conversation_id text,p_payment_id text,p_source text,p_target_type text,p_expected_tenant_id uuid,p_expected_plan text,p_expected_cycle text,p_expected_amount_try numeric,p_expected_currency text) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_t numeric; begin
 select total_try into v_t from public.invoices where meta->>'conversationId'=p_conversation_id;
 if abs(v_t - p_expected_amount_try) > 0.01 then raise exception 'Invoice total does not match.' using errcode='22023'; end if;
 update public.invoices set status='paid' where meta->>'conversationId'=p_conversation_id;
 insert into public.billing_fulfillment_events(provider, conversation_id, result) values (p_provider,p_conversation_id,'{"ok":true}');
 return jsonb_build_object('ok',true,'already',false,'targetType','subscription'); end $$;
create function public.fulfill_billing_payment(p_provider text,p_conversation_id text,p_payment_id text,p_source text,p_target_type text,p_expected_tenant_id uuid,p_expected_plan text,p_expected_cycle text,p_expected_amount_try numeric,p_expected_currency text) returns jsonb language sql as $$ select '{}'::jsonb $$;
`;

describe.skipIf(!mod)("TL kredi SQL — gerçek PL/pgSQL (pglite)", () => {
  let db: Db;
  let T: string;
  let U: string;
  let seq = 0;

  const q = async (sql: string, params?: unknown[]) => (await db.query(sql, params)).rows;
  /** İlk sütun (jsonb) ya da hata {err, code}. */
  type Res = {
    ok?: boolean;
    code?: string;
    err?: string;
    reservation_id?: string;
    balance?: number;
    reserved?: number;
    next_expiry_at?: unknown;
    expiring_amount?: number;
    open_reservations?: unknown[];
    [k: string]: unknown;
  };
  const call = async (sql: string, params?: unknown[]): Promise<Res> => {
    try {
      const row = (await q(sql, params))[0];
      return (row ? Object.values(row)[0] : undefined) as Res;
    } catch (e) {
      const err = e as { message: string; code?: string };
      return { err: err.message, code: err.code };
    }
  };
  const newTenant = async () => ((await q(`insert into public.tenants default values returning id`))[0]!.id as string);
  const invoice = async (tenant: string, total: number, extra: Record<string, unknown> = {}) => {
    seq += 1;
    const conv = `es-test-${seq}`;
    const row = (
      await q(`insert into public.invoices(tenant_id,total_try,meta,checkout_status) values ($1,$2,$3,'pending_checkout') returning id`, [
        tenant,
        total,
        JSON.stringify({ conversationId: conv, ...extra }),
      ])
    )[0]!;
    return { id: row.id as string, conv };
  };
  const grant = (tenant: string, amount: number, idem: string, kind = "manual", expires: string | null = null) =>
    call(`select public.try_credit_grant($1,$2,$3,$4,$5,null)`, [tenant, amount, kind, idem, expires]);
  const balance = (tenant: string) => call(`select public.try_credit_balance($1)`, [tenant]);
  const reserve = (tenant: string, user: string | null, amount: number, idem: string, inv: string, share = 0.5) =>
    call(`select public.try_credit_reserve($1,$2,$3,$4,$5,$6)`, [tenant, user, amount, idem, inv, share]);
  const asService = () => db.exec(`select set_config('request.jwt.claim.role','service_role',false)`);

  beforeAll(async () => {
    db = new mod!.PGlite();
    await db.exec(STUB);
    for (const f of ["20260826000400_try_credit_wallet.sql", "20260826000500_try_credit_invoice_payment.sql"]) {
      await db.exec(read(`supabase/migrations/${f}`));
    }
    await asService();
    T = await newTenant();
    U = (await q(`insert into public.profiles(tenant_id) values ($1) returning id`, [T]))[0]!.id as string;
  }, 60_000);

  it("yükleme: idempotent, farklı istekle aynı anahtar reddedilir, geçersiz tür/ondalık reddedilir", async () => {
    expect(await balance(T)).toMatchObject({ available: 0, balance: 0 });
    expect(await grant(T, 100, "grant-0001")).toMatchObject({ ok: true, already: false, available: 100 });
    expect(await grant(T, 100, "grant-0001")).toMatchObject({ ok: true, already: true, available: 100 });
    expect((await grant(T, 50, "grant-0001")).code).toBe("22023");
    expect((await grant(T, 5, "grant-0002", "bogus")).code).toBe("22023");
    expect((await grant(T, 1.005, "grant-0003")).code).toBe("22023");
  });

  it("fatura sınırı %50, çift harcama yok, fatura başına tek rezerv, idempotent rezerv", async () => {
    const inv = await invoice(T, 200);
    expect(await reserve(T, U, 120, "resv-0001", inv.id)).toMatchObject({ ok: false, code: "over_cap", max_amount: 100 });
    const r = await reserve(T, U, 100, "resv-0002", inv.id);
    expect(r).toMatchObject({ ok: true, state: "reserved", available: 0 });
    expect(await reserve(T, U, 100, "resv-0002", inv.id)).toMatchObject({ ok: true, code: "duplicate", reservation_id: r.reservation_id });
    expect((await reserve(T, U, 90, "resv-0002", inv.id)).code).toBe("22023");
    expect(await reserve(T, U, 10, "resv-0003", inv.id)).toMatchObject({ ok: false, code: "invoice_already_reserved" });
    const inv2 = await invoice(T, 100);
    // aynı krediyi İKİNCİ faturada harcama denemesi: tutulu kredi nedeniyle reddedilir
    expect(await reserve(T, U, 50, "resv-0004", inv2.id)).toMatchObject({ ok: false, code: "insufficient", available: 0 });
    expect(await balance(T)).toMatchObject({ available: 0, balance: 100, reserved: 100 });
    expect(await call(`select public.try_credit_invoice_hold($1,$2)`, [T, inv.conv])).toMatchObject({ has_hold: true, amount: 100, cash_try: 100, state: "reserved" });

    // ödeme: nakit kimliği şart, toplam tutmazsa reddedilir (kredi harcanmaz)
    expect((await call(`select public.try_credit_fulfill_invoice($1,$2,null,'callback',null,null,100)`, [inv.conv, T])).code).toBe("22023");
    expect((await call(`select public.try_credit_fulfill_invoice($1,$2,'pay-1','callback',null,null,90)`, [inv.conv, T])).code).toBe("22023");
    expect(await balance(T)).toMatchObject({ reserved: 100, spent_total: 0 });
    const done = await call(`select public.try_credit_fulfill_invoice($1,$2,'pay-1','callback',null,null,100)`, [inv.conv, T]);
    expect(done).toMatchObject({ ok: true, walletCreditTry: 100, walletCashTry: 100 });
    expect(await balance(T)).toMatchObject({ available: 0, balance: 0, reserved: 0, spent_total: 100 });
    const paid = (await q(`select status, meta from public.invoices where id=$1`, [inv.id]))[0]!;
    expect(paid.status).toBe("paid");
    expect((paid.meta as Record<string, unknown>).paidWith).toBe("account_credit+iyzico");
    // tekrar: kesinleştirme idempotent, serbest bırakma reddedilir
    expect(await call(`select public.try_credit_commit($1,$2,null)`, [T, r.reservation_id])).toMatchObject({ ok: true, already: true });
    expect(await call(`select public.try_credit_release($1,$2,'x')`, [T, r.reservation_id])).toMatchObject({ ok: false, state: "committed" });

    // iade: kısmi, idempotent, harcanan krediyi aşamaz
    expect(await call(`select public.try_credit_refund_invoice($1,$2,30,'refund-0001','t')`, [T, inv.id])).toMatchObject({ ok: true, restored: 30, remaining: 70, available: 30 });
    expect(await call(`select public.try_credit_refund_invoice($1,$2,30,'refund-0001','t')`, [T, inv.id])).toMatchObject({ ok: true, already: true, available: 30 });
    expect(await call(`select public.try_credit_refund_invoice($1,$2,80,'refund-0002','t')`, [T, inv.id])).toMatchObject({ ok: false, code: "exceeds_credit_used", remaining: 70 });
    expect(await call(`select public.try_credit_refund_invoice($1,$2,null,'refund-0003','t')`, [T, inv.id])).toMatchObject({ ok: true, restored: 70, available: 100 });
    expect(await call(`select public.try_credit_refund_invoice($1,$2,null,'refund-0004','t')`, [T, inv.id])).toMatchObject({ ok: false, code: "exceeds_credit_used" });
  });

  it("clawback: bakiye eksiye düşer ama harcanamaz; yeni kredi önce borcu kapatır; orijinal grant aşılamaz", async () => {
    expect(await call(`select public.try_credit_reverse($1,250,'abuse','claw-0001',null,null)`, [T])).toMatchObject({ ok: true, balance: -150, available: 0, debt: 150 });
    const inv = await invoice(T, 100);
    expect(await reserve(T, U, 10, "resv-0005", inv.id)).toMatchObject({ ok: false, code: "insufficient", available: 0 });
    expect(await grant(T, 200, "grant-0004", "referral")).toMatchObject({ ok: true, balance: 50, available: 50 });
    expect(await call(`select public.try_credit_reverse($1,500,'x','claw-0002','grant-0004',null)`, [T])).toMatchObject({ ok: false, code: "exceeds_original", remaining: 200 });
    expect(await call(`select public.try_credit_reverse($1,50,'x','claw-0003','grant-0004',null)`, [T])).toMatchObject({ ok: true, balance: 0 });
    expect(await call(`select public.try_credit_reverse($1,50,'x','claw-0003','grant-0004',null)`, [T])).toMatchObject({ ok: true, already: true, balance: 0 });
    expect((await call(`select public.try_credit_reverse($1,60,'x','claw-0003','grant-0004',null)`, [T])).code).toBe("22023");
  });

  it("vade: süresi dolan kredi bakiyeden düşer; vadeden önce harcama vadeli kovayı tüketir (FIFO by expiry)", async () => {
    const t2 = await newTenant();
    expect(await grant(t2, 100, "exp-00001", "campaign", new Date(Date.now() + 3_600_000).toISOString())).toMatchObject({ ok: true, balance: 100 });
    expect(await balance(t2)).toMatchObject({ expiring_amount: 100 });
    expect((await grant(t2, 100, "exp-00002", "campaign", new Date(Date.now() - 3_600_000).toISOString())).code).toBe("22023");
    await db.exec(`alter table public.account_credit_ledger disable trigger trg_imm`);
    await db.exec(
      `update public.account_credit_ledger set created_at = created_at - interval '3 hours', expires_at = expires_at - interval '2 hours' where tenant_id='${t2}'`,
    );
    await db.exec(`alter table public.account_credit_ledger enable trigger trg_imm`);
    expect(await balance(t2)).toMatchObject({ balance: 0, available: 0 });

    const t3 = await newTenant();
    await grant(t3, 100, "fifo-0001", "campaign", new Date(Date.now() + 86_400_000).toISOString());
    await grant(t3, 100, "fifo-0002", "manual");
    const inv = await invoice(t3, 200);
    const res = await reserve(t3, null, 100, "fifo-resv1", inv.id);
    expect(res.ok).toBe(true);
    expect((await call(`select public.try_credit_commit($1,$2,null)`, [t3, res.reservation_id])).ok).toBe(true);
    const b = await balance(t3);
    expect(b.balance).toBe(100);
    expect(b.expiring_amount).toBe(0);
    expect(b.next_expiry_at).toBeNull();
  });

  it("sahipsiz rezerv: void fatura serbest bırakılır; serbest kalmış rezervle ödeme REDDEDİLİR (kredi harcanmaz)", async () => {
    await grant(T, 300, "regrant-01");
    const inv = await invoice(T, 100);
    expect((await reserve(T, U, 40, "dead-resv1", inv.id)).ok).toBe(true);
    await q(`update public.invoices set status='void' where id=$1`, [inv.id]);
    expect(Number(await call(`select public.try_credit_release_dead(500)`))).toBeGreaterThanOrEqual(1);
    expect((await balance(T)).reserved).toBe(0);
    expect((await call(`select public.try_credit_fulfill_invoice($1,$2,'pay-9','callback',null,null,60)`, [inv.conv, T])).code).toBe("22023");

    const inv2 = await invoice(T, 100);
    await reserve(T, U, 40, "rel-resv01", inv2.id);
    expect(await call(`select public.try_credit_release_invoice($1,$2,'checkout_failed')`, [T, inv2.id])).toMatchObject({ ok: true, state: "released" });
    // serbest kalan faturaya yeniden rezerv mümkün (yeni idem)
    expect((await reserve(T, U, 40, "rel-resv02", inv2.id)).ok).toBe(true);
  });

  it("tam kredi (pay=1): iyzico'suz tek işlemde tamamlanır; ödeme kimliği reddedilir; uyumsuzlukta hiçbir şey harcanmaz", async () => {
    const t4 = await newTenant();
    await grant(t4, 500, "full-grant1");
    const inv = await invoice(t4, 120);
    expect((await reserve(t4, null, 120, "full-resv01", inv.id, 1)).ok).toBe(true);
    expect((await call(`select public.try_credit_fulfill_invoice($1,$2,'pay-x','callback',null,null,0)`, [inv.conv, t4])).code).toBe("22023");
    expect(await call(`select public.try_credit_fulfill_invoice($1,$2,null,'callback',null,null,0)`, [inv.conv, t4])).toMatchObject({ ok: true, walletCashTry: 0 });
    expect((await q(`select provider from public.billing_fulfillment_events where conversation_id=$1`, [inv.conv]))[0]!.provider).toBe("demo");
    expect(await balance(t4)).toMatchObject({ balance: 380 });

    const bad = await invoice(t4, 100);
    await reserve(t4, null, 50, "atom-resv01", bad.id);
    expect((await call(`select public.try_credit_fulfill_invoice($1,$2,'pay-bad','callback',null,null,40)`, [bad.conv, t4])).code).toBe("22023");
    expect(await balance(t4)).toMatchObject({ balance: 380, reserved: 50 });
  });

  it("yetki: service_role dışı RPC çağıramaz; ofis özeti yalnız kendi tenant'ı; ready false/true", async () => {
    await db.exec(`select set_config('request.jwt.claim.role','authenticated',false)`);
    expect((await call(`select public.try_credit_balance($1)`, [T])).code).toBe("42501");
    expect(await call(`select public.try_credit_ready()`)).toBe(false);
    await db.exec(`select set_config('request.jwt.claim.tenant','${T}',false)`);
    const ov = await call(`select public.try_credit_my_overview()`);
    expect(ov).toMatchObject({ balance: expect.any(Number) });
    expect(Array.isArray(ov.open_reservations)).toBe(true);
    await db.exec(`select set_config('request.jwt.claim.role','anon',false)`);
    expect((await call(`select public.try_credit_my_overview()`)).code).toBe("42501");
    await asService();
    expect(await call(`select public.try_credit_ready()`)).toBe(true);
  });
});
