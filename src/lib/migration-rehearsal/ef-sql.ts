/**
 * Migration provası — EmlakFiyati kontör kümesi (`--ef`, 20260826000100..000300) SQL kataloğu.
 * Çalıştırıcı (scripts/migration-rehearsal.ts) yalnız bu sabitleri çalıştırır; hepsi tek deyimdir ve transaction
 * denetimi içermez (sözleşme: rehearsal-contract.test.ts + ef-wallet-sql-contract.test.ts).
 *
 * UYARI (sözleşme testi bunu denetler): bu dosyada "kesinleştir" RPC'sinin ve durumunun ADI geçer
 * (src/lib/ef-credits/config.ts EF_RPC sözleşmesi). Bunlar transaction deyimi DEĞİLDİR; izinli tanımlayıcılar
 * EF_ALLOWED_IDENTIFIERS listesindedir ve bu dosyada başka hiçbir biçimde geçemez. Çalıştırıcı bu adları yalnız
 * buradaki sabitler üzerinden kullanır.
 */
import type { Expectation } from "./core";

/** Bu dosyada izinli tek tanımlayıcılar (sözleşme testi bunları çıkarınca kelime kalmamalı). */
export const EF_ALLOWED_IDENTIFIERS = ["ef_credit_commit", "committed_total", "committed"] as const;

/** Rezerv durumları (config.ts EfReserveResult/EfSettleResult `state`). */
export const EF_STATE = { open: "reserved", done: "committed", freed: "released", unknown: "unknown" } as const;

export const EF_SIG = {
  balance: "public.ef_credit_balance(uuid)",
  reserve: "public.ef_credit_reserve(uuid, uuid, integer, text, text)",
  settle: "public.ef_credit_commit(uuid, uuid, jsonb)",
  release: "public.ef_credit_release(uuid, uuid, text)",
  grant: "public.ef_credit_grant(uuid, integer, text, text, jsonb)",
  sweep: "public.ef_credit_sweep(interval)",
  ready: "public.ef_credit_ready()",
} as const;

const EF_FN_NAMES =
  "('ef_credit_balance','ef_credit_reserve','ef_credit_commit','ef_credit_release','ef_credit_grant','ef_credit_sweep','ef_credit_ready')";

const F10 = "public.fulfill_billing_payment(text, text, text, text, text, uuid, text, text, numeric, text)";
const FV2 = "public.fulfill_billing_payment_v2(text, text, text, text, text, uuid, text, text, numeric, text)";

type Check = { id: string; title: string; sql: string; expect: Record<string, Expectation> };

/** Dosya başına varlık kontrolleri (YAYIN_PENCERESI_2.md §7 ile aynı sorgular). */
export const EF_FILE_CHECKS: Record<string, { pre?: Check; post: Check[] }> = {
  "20260826000100_ef_credit_wallet.sql": {
    pre: {
      id: "7.1-once",
      title: "kontör cüzdanı: rezerv tablosu, ef_credit_* fonksiyonları ve defter meta sütunu migration öncesi YOK",
      sql:
        "select to_regclass('public.ef_credit_reservations') is null as tablo_yok, " +
        "(select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'ef\\_credit\\_%') as fn, " +
        "(select count(*) from information_schema.columns where table_schema='public' and table_name='account_credit_ledger' and column_name='meta') as meta",
      expect: { tablo_yok: "t", fn: "0", meta: "0" },
    },
    post: [
      {
        id: "7.1a",
        title: "defter: unit CHECK 'ef' + eski birimler, ef satır/meta CHECK'leri, kaynak 'purchase', ef satırı yok",
        sql:
          "select (select pg_get_constraintdef(oid) like '%''ef''%' from pg_constraint where conname='account_credit_ledger_unit_check' and conrelid='public.account_credit_ledger'::regclass) as unit_ef, " +
          "(select pg_get_constraintdef(oid) like '%valuation%' and pg_get_constraintdef(oid) like '%''try''%' and pg_get_constraintdef(oid) like '%''ai''%' from pg_constraint where conname='account_credit_ledger_unit_check' and conrelid='public.account_credit_ledger'::regclass) as eski_birim, " +
          "(select count(*) from pg_constraint where conrelid='public.account_credit_ledger'::regclass and conname in ('account_credit_ledger_ef_entry_check','account_credit_ledger_meta_check')) as chk, " +
          "(select pg_get_constraintdef(oid) like '%purchase%' from pg_constraint where conname='account_credit_ledger_source_check' and conrelid='public.account_credit_ledger'::regclass) as kaynak, " +
          "(select count(*) from public.account_credit_ledger where unit='ef') as ef_satir",
        expect: { unit_ef: "t", eski_birim: "t", chk: "2", kaynak: "t", ef_satir: "0" },
      },
      {
        id: "7.1b",
        title: "rezerv tablosu + RLS (tek SELECT politikası) + 7 definer RPC (search_path) + guard + anon/authenticated EXECUTE yok",
        sql:
          "select to_regclass('public.ef_credit_reservations') is not null as tablo, " +
          "(select relrowsecurity from pg_class where oid='public.ef_credit_reservations'::regclass) as rls, " +
          "(select count(*) from pg_policies where schemaname='public' and tablename='ef_credit_reservations') as pol, " +
          "(select count(*) from pg_policies where schemaname='public' and tablename='ef_credit_reservations' and cmd='SELECT') as pol_select, " +
          `(select count(*) from pg_proc where pronamespace='public'::regnamespace and prosecdef and proname in ${EF_FN_NAMES} and array_to_string(proconfig, ',') like '%search_path=%') as fn, ` +
          "(select count(*) from pg_trigger where tgname='trg_ef_credit_reservations_guard' and not tgisinternal) as trg, " +
          "(select coalesce(bool_or(has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute')), false) from pg_proc p where p.pronamespace='public'::regnamespace and p.proname like 'ef\\_credit\\_%') as dis_exec, " +
          "has_table_privilege('authenticated','public.ef_credit_reservations','insert') as auth_insert, " +
          "has_table_privilege('authenticated','public.ef_credit_reservations','select') as auth_select",
        expect: { tablo: "t", rls: "t", pol: "1", pol_select: "1", fn: "7", trg: "1", dis_exec: "f", auth_insert: "f", auth_select: "t" },
      },
    ],
  },
  "20260826000200_ef_reports.sql": {
    post: [
      {
        id: "7.2",
        title: "ef_reports: tablo, RLS, tek politika, 4 adlı FK, tekil rapor, kişisel veri sütunu yok, yazma yetkisi yok",
        sql:
          "select to_regclass('public.ef_reports') is not null as tablo, " +
          "(select relrowsecurity from pg_class where oid='public.ef_reports'::regclass) as rls, " +
          "(select count(*) from pg_policies where schemaname='public' and tablename='ef_reports') as pol, " +
          "(select count(*) from pg_constraint where conrelid='public.ef_reports'::regclass and contype='f' and conname in ('ef_reports_tenant_id_fkey','ef_reports_user_id_fkey','ef_reports_reservation_id_fkey','ef_reports_pdf_reservation_id_fkey')) as fk, " +
          "(select count(*) from pg_constraint where conrelid='public.ef_reports'::regclass and conname='ef_reports_tenant_rapor_key') as tekil, " +
          "(select count(*) from information_schema.columns where table_schema='public' and table_name='ef_reports' and column_name in ('phone','email','full_name','name','tc','tckn','address','owner_name')) as kisisel, " +
          "has_table_privilege('authenticated','public.ef_reports','insert') as auth_insert, " +
          "has_table_privilege('authenticated','public.ef_reports','select') as auth_select",
        expect: { tablo: "t", rls: "t", pol: "1", fk: "4", tekil: "1", kisisel: "0", auth_insert: "f", auth_select: "t" },
      },
    ],
  },
  "20260826000300_ef_credit_pack_fulfillment.sql": {
    post: [
      {
        id: "7.3",
        title: "fulfill + v2: credit-pack:v1 eklendi, seat-fulfillment:v1 korundu, fonksiyon yorumu güncel",
        sql:
          `select (select position('credit-pack:v1' in prosrc) > 0 from pg_proc where oid = to_regprocedure('${F10}')) as f10_paket, ` +
          `(select position('credit-pack:v1' in prosrc) > 0 from pg_proc where oid = to_regprocedure('${FV2}')) as v2_paket, ` +
          `(select position('seat-fulfillment:v1' in prosrc) > 0 from pg_proc where oid = to_regprocedure('${F10}')) as f10_koltuk, ` +
          `(select position('seat-fulfillment:v1' in prosrc) > 0 from pg_proc where oid = to_regprocedure('${FV2}')) as v2_koltuk, ` +
          `coalesce(obj_description(to_regprocedure('${FV2}'), 'pg_proc') like '%credit-pack:v1%', false) as yorum`,
        expect: { f10_paket: "t", v2_paket: "t", f10_koltuk: "t", v2_koltuk: "t", yorum: "t" },
      },
    ],
  },
};

/** İşlevsel smoke (geçici ofiste; ROLLBACK ile yok olur) ve RLS simülasyonu. */
export const EF_SMOKE = {
  balance:
    "select (b ->> 'available')::bigint as available, (b ->> 'reserved')::bigint as reserved, " +
    "(b ->> 'granted_total')::bigint as granted, (b ->> 'committed_total')::bigint as spent " +
    "from (select public.ef_credit_balance($1::uuid) as b) x",
  grant: "select public.ef_credit_grant($1::uuid, $2::int, $3, $4, $5::jsonb) as result",
  reserve: "select public.ef_credit_reserve($1::uuid, $2::uuid, $3::int, $4, $5) as result",
  settle: "select public.ef_credit_commit($1::uuid, $2::uuid, $3::jsonb) as result",
  release: "select public.ef_credit_release($1::uuid, $2::uuid, $3) as result",
  sweep: "select public.ef_credit_sweep($1::interval) as n",
  ready: "select public.ef_credit_ready() as hazir",
  /** Claim'siz kimlik (SQL editörü benzeri): auth.role() service_role değil. */
  claimsEmpty: "select set_config('request.jwt.claims', '{}', true) as claims",
  reservationCount:
    "select count(*)::int as n from public.ef_credit_reservations where tenant_id = $1::uuid and idempotency_key = $2",
  reservationState: "select state, reason, units from public.ef_credit_reservations where id = $1::uuid",
  spendRows:
    "select count(*)::int as n, coalesce(sum(amount), 0)::text as total from public.account_credit_ledger " +
    "where unit = 'ef' and entry_type = 'spend' and source_id = $1::uuid",
  grantRows:
    "select count(*)::int as n from public.account_credit_ledger where unit = 'ef' and entry_type = 'grant' and idempotency_key = $1",
  /** Süpürme testi: 1 saat önce açılmış rezerv (tablo sahibi olarak doğrudan; guard yalnız UPDATE/DELETE'i denetler). */
  insertOldReservation:
    "insert into public.ef_credit_reservations (tenant_id, user_id, units, idempotency_key, item, state, created_at) " +
    "values ($1::uuid, $2::uuid, $3::int, $4, 'valuation_arsa', 'reserved', now() - interval '1 hour') returning id::text as id",
  /** Kontör paketi faturası: v2, plan/döngü beklentisi NULL (20260826000300 KOD SÖZLEŞMESİ). */
  fulfillPack:
    "select public.fulfill_billing_payment_v2('demo', $1, null, 'demo', 'subscription', $2::uuid, null, null, $3::numeric, 'TRY') as result",
  insertReport:
    "insert into public.ef_reports (tenant_id, user_id, rapor_id, reservation_id, mahalle_id, ada, parsel, tip, guven_sinifi, sonuc_durumu, units_charged, expires_at) " +
    "values ($1::uuid, $2::uuid, $3, $4::uuid, 1, '101', '5', 'arsa', 'orta', 'deger', $5::int, now() + interval '30 days')",
  reportsOfTenant: "select count(*)::int as n from public.ef_reports where tenant_id = $1::uuid",
  reportsOfUser: "select count(*)::int as n from public.ef_reports where user_id = $1::uuid",
  reservationsOfTenant: "select count(*)::int as n from public.ef_credit_reservations where tenant_id = $1::uuid",
  reservationsOfUser: "select count(*)::int as n from public.ef_credit_reservations where user_id = $1::uuid",
} as const;

/** Katalogdaki TÜM EF SQL metinleri (sözleşme testi + statik ayrıştırma). */
export function allEfCatalogSql(): string[] {
  const out: string[] = [...Object.values(EF_SMOKE)];
  for (const spec of Object.values(EF_FILE_CHECKS)) {
    if (spec.pre) out.push(spec.pre.sql);
    for (const c of spec.post) out.push(c.sql);
  }
  return out;
}
