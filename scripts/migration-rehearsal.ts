/**
 * Migration PROVASI (rehearsal): `npm run db:rehearse -- --yes-i-understand-locks [--with-earnings]`
 *
 * GERÇEK canlı şemaya bağlanır, TEK transaction açar, terfi eden 13 migration'ı (20260825000100..001300; bayrakla
 * 20260816000500'ü de en sonda) dosyadaki SQL'i olduğu gibi çalıştırır, doğrular ve HER KOŞULDA ROLLBACK eder.
 * Bu betikte kalıcılaştırma deyimi YOKTUR (sözleşme: src/lib/migration-rehearsal/rehearsal-contract.test.ts).
 * schema_migrations ledger'ına YAZMAZ. apply-migrations.ts ile aynı advisory anahtarı xact düzeyinde alınır;
 * alınamazsa durur. Hata, istisna, zaman aşımı ya da SIGINT'te de ROLLBACK + bağlantı kapatma yapılır; bağlantı
 * koparsa sunucu açık transaction'ı zaten geri alır.
 *
 * Doğrulamalar: (1) fatura fonksiyonu gövdeleri md5 ÖNCE/ARA/SONRA, (2) dosya başına varlık sorguları
 * (YAYIN_PENCERESI_2.md §4), (3) saf fiyat yardımcıları, (4) geçici satırlarla işlevsel fatura smoke'u,
 * (5) authenticated rol simülasyonuyla RLS ret denemeleri. Her kontrol PASS / FAIL / ATLANDI; FAIL varsa çıkış 1.
 * Bayrak hatası ya da eksik onay: çıkış 2 ve HİÇBİR ŞEY yapılmaz (bağlantı bile açılmaz).
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import dotenv from "dotenv";
import pg from "pg";
import {
  EARNINGS_FILE,
  LOCK_KEY,
  LOCK_WARNING,
  PROMOTED_FILES,
  TIMEOUTS,
  USAGE,
  bodyMd5FromFile,
  compareRow,
  exitCodeFor,
  findTransactionControl,
  formatResults,
  parseRehearsalArgs,
  type CheckResult,
  type CheckStatus,
} from "../src/lib/migration-rehearsal/core.ts";
import {
  BILLING_FUNCTIONS,
  FILE_CHECKS,
  FN,
  HELPERS,
  SIG,
  SMOKE,
  TX,
  type ExistenceCheck,
} from "../src/lib/migration-rehearsal/sql.ts";

// ---------------------------------------------------------------------------------------------------------
// 0. Bayraklar ve dosyalar (bağlantıdan ÖNCE; hata = çıkış 2, hiçbir şey yapılmaz)
// ---------------------------------------------------------------------------------------------------------
const parsed = parseRehearsalArgs(process.argv.slice(2));
if (!parsed.ok) {
  console.error(`${parsed.error} (--help ile kullanımı gör)`);
  process.exit(2);
}
const flags = parsed.flags;
if (flags.help) {
  console.log(USAGE);
  process.exit(0);
}
console.log(LOCK_WARNING);
if (!flags.yes) {
  console.error("\n--yes-i-understand-locks verilmedi: bağlanılmadı, hiçbir şey yapılmadı.");
  process.exit(2);
}

dotenv.config({ path: ".env.local", quiet: true });
const MIGRATIONS_DIR = path.join(process.cwd(), "supabase", "migrations");
const TARGET_FILES: string[] = [...PROMOTED_FILES, ...(flags.withEarnings ? [EARNINGS_FILE] : [])];

function readMigration(file: string): string {
  const full = path.join(MIGRATIONS_DIR, file);
  if (!fs.existsSync(full)) {
    console.error(`Migration dosyası yok: ${file}. Hiçbir şey yapılmadı.`);
    process.exit(2);
  }
  return fs.readFileSync(full, "utf8");
}

const SOURCES = new Map<string, string>();
for (const file of TARGET_FILES) {
  const text = readMigration(file);
  const problems = findTransactionControl(text);
  if (problems.length > 0) {
    console.error(`${file} güvenlik taramasından geçmedi (çalıştırılmaz):\n  - ${problems.join("\n  - ")}`);
    process.exit(2);
  }
  SOURCES.set(file, text);
}

type Md5Expect = { before: string; after: string };
const EXPECTED_MD5 = new Map<string, Md5Expect>();
for (const fn of BILLING_FUNCTIONS) {
  const before = bodyMd5FromFile(readMigration(fn.before), fn.name);
  const after = bodyMd5FromFile(readMigration(fn.after), fn.name);
  if (!before || !after) {
    console.error(`${fn.name}: beklenen gövde dosyadan çıkarılamadı (${fn.before} / ${fn.after}). Hiçbir şey yapılmadı.`);
    process.exit(2);
  }
  EXPECTED_MD5.set(fn.key, { before, after });
}
const AMOUNT_FILE = "20260825000300_billing_plan_amount_integrity.sql";
const MID_FULFILL_MD5 = bodyMd5FromFile(readMigration(AMOUNT_FILE), "fulfill_billing_payment");
const MID_UPDATE_MD5 = bodyMd5FromFile(readMigration(AMOUNT_FILE), "update_tenant_plan_subscription");

const url = process.env.DATABASE_POOLER_URL || process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_POOLER_URL veya DATABASE_URL tanımlı değil (.env.local). Hiçbir şey yapılmadı.");
  process.exit(2);
}

// ---------------------------------------------------------------------------------------------------------
// Durum, sonuçlar, güvenli kapanış
// ---------------------------------------------------------------------------------------------------------
const results: CheckResult[] = [];
function add(group: string, id: string, title: string, status: CheckStatus, detail = ""): void {
  results.push({ group, id, title, status, detail });
  console.log(`  [${status}] ${id} ${title}${detail ? ` — ${detail}` : ""}`);
}

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 20_000 });
let connected = false;
let stopping = false;

type PgErr = { code?: string; message?: string };
function describeError(e: unknown): string {
  const err = e as PgErr;
  const code = err?.code ?? "";
  const msg = String(err?.message ?? e).split("\n")[0]!.slice(0, 300);
  if (code === "55P03") return `lock_timeout (${TIMEOUTS.lock}) aşıldı: tablo kilidi alınamadı (uygulama trafiği?) — ${msg}`;
  if (code === "57014") return `statement_timeout (${TIMEOUTS.statement}) aşıldı ya da sorgu iptal edildi — ${msg}`;
  return code ? `${code}: ${msg}` : msg;
}
const errCode = (e: unknown) => (e as PgErr)?.code ?? "";
const errMsg = (e: unknown) => String((e as PgErr)?.message ?? e);

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | "timeout"> {
  let timer: NodeJS.Timeout | undefined;
  const t = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), ms);
  });
  try {
    return await Promise.race([p, t]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** ROLLBACK dener, sonra bağlantıyı kapatır. Bağlantı kapanınca sunucu açık transaction'ı geri alır. */
async function rollbackAndClose(): Promise<boolean> {
  let rolledBack = false;
  if (connected) {
    const r = await withTimeout(
      client.query(TX.rollback).then(() => true, () => false),
      5_000,
    );
    rolledBack = r === true;
  }
  await withTimeout(client.end().catch(() => undefined), 5_000);
  connected = false;
  return rolledBack;
}

async function hardStop(code: number, reason: string): Promise<never> {
  if (stopping) process.exit(code);
  stopping = true;
  console.error(`\n${reason} — ROLLBACK ve bağlantı kapatma...`);
  const ok = await rollbackAndClose();
  console.error(ok ? "ROLLBACK tamam; hiçbir şey kalıcı yazılmadı." : "ROLLBACK yanıtı alınamadı; bağlantı kapatıldı (sunucu açık transaction'ı geri alır).");
  process.exit(code);
}

process.on("SIGINT", () => void hardStop(130, "SIGINT alındı"));
process.on("SIGTERM", () => void hardStop(143, "SIGTERM alındı"));
const watchdog = setTimeout(
  () => void hardStop(1, `Toplam süre bekçisi (${TIMEOUTS.overallMs / 1000} sn) aşıldı`),
  TIMEOUTS.overallMs,
);

async function q<T extends pg.QueryResultRow = Record<string, unknown>>(sql: string, params?: unknown[]) {
  return client.query<T>(sql, params as unknown[] | undefined);
}

/** rh_step içinde çalıştırır; hata olursa savepoint'e döner ve hatayı yeniden fırlatır. */
async function inStep<T>(fn: () => Promise<T>): Promise<T> {
  await q(TX.savepoint);
  try {
    const out = await fn();
    await q(TX.releaseSavepoint);
    return out;
  } catch (e) {
    await q(TX.toSavepoint);
    await q(TX.releaseSavepoint);
    throw e;
  }
}

type Attempt = { ok: true; rowCount: number } | { ok: false; code: string; message: string };
/** rh_neg içinde dener (her zaman geri döner): beklenen-ret denemeleri ve pozitif kontroller için. */
async function attempt(sql: string, params: unknown[], keep = false): Promise<Attempt> {
  await q(TX.savepointNeg);
  try {
    const r = await q(sql, params);
    if (keep) await q(TX.releaseSavepointNeg);
    else {
      await q(TX.toSavepointNeg);
      await q(TX.releaseSavepointNeg);
    }
    return { ok: true, rowCount: r.rowCount ?? 0 };
  } catch (e) {
    await q(TX.toSavepointNeg);
    await q(TX.releaseSavepointNeg);
    return { ok: false, code: errCode(e), message: errMsg(e).split("\n")[0]!.slice(0, 200) };
  }
}

async function asService(): Promise<void> {
  await q(TX.resetRole);
  await q(TX.asService);
}

async function runExistence(group: string, check: ExistenceCheck): Promise<boolean> {
  try {
    const row = await inStep(async () => (await q(check.sql)).rows[0]);
    const problems = compareRow(row, check.expect);
    add(group, check.id, check.title, problems.length === 0 ? "PASS" : "FAIL", problems.join("; "));
    return problems.length === 0;
  } catch (e) {
    add(group, check.id, check.title, "FAIL", describeError(e));
    return false;
  }
}

async function liveMd5(signature: string): Promise<string | null> {
  const r = await inStep(async () => (await q<{ md5: string }>(FN.md5, [signature])).rows[0]);
  return r?.md5 ?? null;
}

function sigFor(key: string): string {
  return SIG[key as keyof typeof SIG];
}

const numEq = (a: unknown, b: unknown) => a !== null && b !== null && Number(a) === Number(b);

// ---------------------------------------------------------------------------------------------------------
// Gruplar
// ---------------------------------------------------------------------------------------------------------
let oldOverloadMd5: string | null = null;

async function billingBodiesBefore(): Promise<void> {
  console.log("\n(1) Fatura fonksiyonları — YAYINDAN ÖNCE (canlı gövde = kaynak migration dosyası mı?)");
  for (const fn of BILLING_FUNCTIONS) {
    const exp = EXPECTED_MD5.get(fn.key)!;
    const got = await liveMd5(sigFor(fn.key));
    if (got === null) add("1-govde", `once-${fn.key}`, `${fn.name} canlıda var`, "FAIL", "fonksiyon yok");
    else add("1-govde", `once-${fn.key}`, `${fn.name} gövdesi = ${fn.before}`, got === exp.before ? "PASS" : "FAIL", `canlı ${got}, beklenen ${exp.before}`);
  }
  oldOverloadMd5 = await liveMd5(SIG.fulfill9);
  add("1-govde", "once-fulfill9", "9 argümanlı eski fulfill overload'u (bilgi; değişmemeli)", "PASS", oldOverloadMd5 ? `md5 ${oldOverloadMd5}` : "yok");
}

async function billingBodiesAfter(): Promise<void> {
  console.log("\n(1) Fatura fonksiyonları — PROVA SONRASI");
  for (const fn of BILLING_FUNCTIONS) {
    const exp = EXPECTED_MD5.get(fn.key)!;
    const got = await liveMd5(sigFor(fn.key));
    add("1-govde", `sonra-${fn.key}`, `${fn.name} gövdesi = ${fn.after}`, got === exp.after ? "PASS" : "FAIL", `prova ${got ?? "yok"}, beklenen ${exp.after}`);
  }
  const old = await liveMd5(SIG.fulfill9);
  add("1-govde", "sonra-fulfill9", "9 argümanlı eski overload DEĞİŞMEDİ", old === oldOverloadMd5 ? "PASS" : "FAIL", `önce ${oldOverloadMd5 ?? "yok"}, sonra ${old ?? "yok"}`);
}

async function midChecksAfterFile(file: string): Promise<void> {
  if (file !== AMOUNT_FILE) return;
  const f = await liveMd5(SIG.fulfill10);
  add("1-govde", "ara-fulfill10", "000300 sonrası fulfill (10 arg) = 000300 gövdesi (000600 ön koşul tabanı)", f === MID_FULFILL_MD5 ? "PASS" : "FAIL", `prova ${f ?? "yok"}, beklenen ${MID_FULFILL_MD5}`);
  const u = await liveMd5(SIG.updatePlan);
  add("1-govde", "ara-updatePlan", "000300 sonrası update_tenant_plan_subscription = 000300 gövdesi", u === MID_UPDATE_MD5 ? "PASS" : "FAIL", `prova ${u ?? "yok"}, beklenen ${MID_UPDATE_MD5}`);
}

/** Migration'ları sırayla uygular; her dosyadan önce/sonra varlık kontrolleri. Başarısızlıkta false. */
async function applyAll(): Promise<boolean> {
  console.log("\n(2) Migration'lar (tek transaction, ledger'a yazılmaz)");
  for (const [idx, file] of TARGET_FILES.entries()) {
    const spec = FILE_CHECKS[file];
    if (spec?.pre) await runExistence("2-varlik", spec.pre);
    const started = Date.now();
    try {
      await q(SOURCES.get(file)!);
      add("2-uygula", file.slice(0, 14), `${file} çalıştı`, "PASS", `${Date.now() - started} ms`);
    } catch (e) {
      add("2-uygula", file.slice(0, 14), `${file} çalıştı`, "FAIL", describeError(e));
      for (const rest of TARGET_FILES.slice(idx + 1)) {
        add("2-uygula", rest.slice(0, 14), `${rest} çalıştı`, "ATLANDI", "önceki dosya başarısız; transaction iptal durumunda");
      }
      return false;
    }
    for (const check of spec?.post ?? []) await runExistence("2-varlik", check);
    await midChecksAfterFile(file);
  }
  return true;
}

async function helperChecks(): Promise<void> {
  console.log("\n(3) Saf fiyat yardımcıları");
  try {
    const noDoc = (await inStep(async () => (await q<{ no_doc: boolean }>(HELPERS.catalog)).rows[0]))?.no_doc === true;
    if (noDoc) {
      await runExistence("3-yardimci", {
        id: "3.1",
        title: "katalog ayarı yok: onaylı fiyatlar 749/2490/4990/8990/12900, bilinmeyen plan NULL",
        sql: HELPERS.prices,
        expect: { advisor: "749", office: "2490", professional: "4990", business: "8990", enterprise: "12900", bilinmeyen: "NULL" },
      });
      await runExistence("3-yardimci", {
        id: "3.2",
        title: "yıllık = aylık × 10 (professional, office), ödenen ay 10",
        sql: HELPERS.tenTimes,
        expect: { pro_x10: "t", office_x10: "t", odenen_ay: "10" },
      });
    } else {
      add("3-yardimci", "3.1", "onaylı sabit fiyatlar", "ATLANDI", "platform_settings 'billing.plan_definitions' VAR: beklenen tutar ayardan gelir (sabit karşılaştırma yapılmadı)");
      add("3-yardimci", "3.2", "yıllık = aylık × 10", "ATLANDI", "katalog ayarı yıllık ödenen ayı değiştirebilir; 3.3 genel kuralı denetler");
    }
    await runExistence("3-yardimci", {
      id: "3.3",
      title: "her plan: yıllık = round(aylık × ödenen ay), aylık dönem = aylık, ay 1..12, geçersiz döngü NULL",
      sql: HELPERS.yearly,
      expect: { yearly_ok: "t", monthly_ok: "t", months_ok: "t", invalid_cycle_null: "t" },
    });
    const ready = await inStep(async () => {
      await asService();
      return (await q<{ hazir: boolean }>(HELPERS.seatReady)).rows[0]?.hazir;
    });
    add("3-yardimci", "3.4", "seat_purchase_ready() service_role kimliğiyle true", ready === true ? "PASS" : "FAIL", `dönen ${String(ready)}`);
  } catch (e) {
    add("3-yardimci", "3.x", "yardımcı kontrolleri", "FAIL", describeError(e));
  }
}

type Smoke = { ok: boolean; reason: string; tenant: string; owner: string; advisor: string; seatLimit: number | null };

async function insertUser(id: string, label: string): Promise<void> {
  await q(SMOKE.insertAuthUser, [id, `rehearsal+${label}-${id.slice(0, 8)}@example.invalid`]);
}

async function billingSmoke(): Promise<Smoke> {
  console.log("\n(4) İşlevsel fatura smoke'u (geçici satırlar; ROLLBACK ile yok olur)");
  const G = "4-fatura";
  const T = randomUUID();
  const S = randomUUID();
  const O = randomUUID();
  const A = randomUUID();
  const ST = randomUUID();
  const tag = T.slice(0, 8);
  const smoke: Smoke = { ok: false, reason: "", tenant: T, owner: O, advisor: A, seatLimit: null };

  // Kurulum
  try {
    await inStep(async () => {
      await asService();
      await insertUser(O, "owner");
      await insertUser(A, "advisor");
      await insertUser(ST, "staff");
      await q(SMOKE.insertTenant, [T, `Prova Ofisi ${tag}`, `rehearsal-${tag}`, "office"]);
      await q(SMOKE.insertSubscription, [S, T, "office", "1111"]);
      await q(SMOKE.insertProfile, [O, T, "Prova Sahip", "owner"]);
      await q(SMOKE.insertProfile, [A, T, "Prova Danışman", "advisor"]);
      await q(SMOKE.insertStaff, [ST, `rehearsal+staff-${tag}@example.invalid`, "Prova Faturalama"]);
      const lim = (await q<{ seat_limit: number | null }>(SMOKE.seatLimit, ["office"])).rows[0]?.seat_limit ?? null;
      smoke.seatLimit = lim === null ? null : Number(lim);
    });
    add(G, "4.0", "geçici ofis/abonelik/profil/personel kurulumu", "PASS", `tenant ${T}, office seat_limit ${smoke.seatLimit ?? "sınırsız"}`);
  } catch (e) {
    smoke.reason = `kurulum başarısız: ${describeError(e)}`;
    add(G, "4.0", "geçici ofis/abonelik/profil/personel kurulumu", "FAIL", smoke.reason);
    for (const id of ["4.a", "4.b", "4.d", "4.c"]) add(G, id, "fatura smoke adımı", "ATLANDI", "kurulum başarısız");
    return smoke;
  }

  // (a) plan yenileme: v2, tutar = plan tanımı, dönem uzar, idempotent
  try {
    await inStep(async () => {
      await asService();
      const amounts = (await q<{ monthly: string; period: string }>(SMOKE.planAmounts, ["office"])).rows[0]!;
      const total = (await q<{ total: string }>(SMOKE.grossTotal, [amounts.period])).rows[0]!.total;
      const before = (await q<{ period_end: string }>(SMOKE.subState, [T])).rows[0]!;
      const conv = `rehearsal-renew-${randomUUID()}`;
      const inv = randomUUID();
      await q(SMOKE.insertInvoice, [inv, T, S, `RH-${tag}-1`, amounts.period, JSON.stringify({ conversationId: conv, plan: "office", cycle: "monthly" })]);
      const r1 = (await q<{ result: Record<string, unknown> }>(SMOKE.fulfillV2, [conv, T, "office", total])).rows[0]!.result;
      add(G, "4.a1", "yenileme faturası işlendi (ok, already=false, tür yok)", r1.ok === true && r1.already === false && !("kind" in r1) ? "PASS" : "FAIL", JSON.stringify(r1).slice(0, 160));
      const s1 = (await q<Record<string, unknown>>(SMOKE.subState, [T])).rows[0]!;
      add(G, "4.a2", "abonelik amount_try = plan_monthly_amount('office'), aktif, plan office", numEq(s1.amount_try, amounts.monthly) && s1.status === "active" && s1.plan === "office" ? "PASS" : "FAIL", `amount ${String(s1.amount_try)} (beklenen ${amounts.monthly}), durum ${String(s1.status)}`);
      const ext = (await q<{ ok: boolean; period_end: string }>(SMOKE.periodExtended, [T, before.period_end])).rows[0]!;
      add(G, "4.a3", "dönem önceki bitiş + 1 ay uzadı", ext.ok ? "PASS" : "FAIL", `önce ${before.period_end}, sonra ${ext.period_end}`);
      const i1 = (await q<Record<string, unknown>>(SMOKE.invoiceState, [inv])).rows[0]!;
      add(G, "4.a4", "fatura paid + checkout fulfilled, toplam = net × 1,20", i1.status === "paid" && i1.checkout_status === "fulfilled" && numEq(i1.total_try, total) ? "PASS" : "FAIL", `${String(i1.status)}/${String(i1.checkout_status)}/${String(i1.total_try)}`);
      const r2 = (await q<{ result: Record<string, unknown> }>(SMOKE.fulfillV2, [conv, T, "office", total])).rows[0]!.result;
      const s2 = (await q<Record<string, unknown>>(SMOKE.subState, [T])).rows[0]!;
      const n = (await q<{ n: number }>(SMOKE.eventCount, [conv])).rows[0]!.n;
      add(G, "4.a5", "ikinci çağrı etkisiz (already=true, dönem/tutar aynı, tek olay)", r2.already === true && s2.period_end === s1.period_end && s2.amount_try === s1.amount_try && Number(n) === 1 ? "PASS" : "FAIL", `already ${String(r2.already)}, olay ${n}`);
    });
  } catch (e) {
    add(G, "4.a", "plan yenileme faturası", "FAIL", describeError(e));
  }

  // (b) ek koltuk faturası: extra_seats artar, dönem/plan/tutar/kilit değişmez, tekrar etkisiz, from uyuşmazlığı ret
  const L = smoke.seatLimit;
  try {
    await inStep(async () => {
      await asService();
      const before = (await q<Record<string, unknown>>(SMOKE.subState, [T])).rows[0]!;
      const conv = `rehearsal-seat-${randomUUID()}`;
      const inv = randomUUID();
      const total = (await q<{ total: string }>(SMOKE.grossTotal, ["500"])).rows[0]!.total;
      const meta = { conversationId: conv, plan: "office", cycle: "monthly", kind: "extra_seats", source: "rehearsal", fromExtraSeats: 0, toExtraSeats: 2, targetTotalSeats: (L ?? 5) + 2, chargeNetTry: 500, quotedPeriodTry: 798 };
      await q(SMOKE.insertInvoice, [inv, T, S, `RH-${tag}-2`, "500", JSON.stringify(meta)]);
      const r1 = (await q<{ result: Record<string, unknown> }>(SMOKE.fulfillV2, [conv, T, "office", total])).rows[0]!.result;
      add(G, "4.b1", "ek koltuk faturası işlendi (kind=extra_seats, already=false)", r1.kind === "extra_seats" && r1.already === false ? "PASS" : "FAIL", JSON.stringify(r1).slice(0, 160));
      const after = (await q<Record<string, unknown>>(SMOKE.subState, [T])).rows[0]!;
      add(G, "4.b2", "extra_seats 0 → 2", Number(after.extra_seats) === 2 ? "PASS" : "FAIL", `extra_seats ${String(after.extra_seats)}`);
      const same = (["plan", "billing_cycle", "amount_try", "price_lock_try", "price_lock_campaign", "period_start", "period_end"] as const).filter((k) => after[k] !== before[k]);
      add(G, "4.b3", "dönem UZAMADI; plan, tutar, fiyat kilidi değişmedi", same.length === 0 ? "PASS" : "FAIL", same.length ? `değişen: ${same.join(", ")}` : "");
      const i2 = (await q<Record<string, unknown>>(SMOKE.invoiceState, [inv])).rows[0]!;
      add(G, "4.b4", "koltuk faturası paid + fulfilled", i2.status === "paid" && i2.checkout_status === "fulfilled" ? "PASS" : "FAIL", `${String(i2.status)}/${String(i2.checkout_status)}`);
      const r2 = (await q<{ result: Record<string, unknown> }>(SMOKE.fulfillV2, [conv, T, "office", total])).rows[0]!.result;
      const again = (await q<Record<string, unknown>>(SMOKE.subState, [T])).rows[0]!;
      const n = (await q<{ n: number }>(SMOKE.eventCount, [conv])).rows[0]!.n;
      add(G, "4.b5", "tekrar çağrı etkisiz (already=true, extra_seats 2, tek olay)", r2.already === true && Number(again.extra_seats) === 2 && Number(n) === 1 ? "PASS" : "FAIL", `already ${String(r2.already)}, extra ${String(again.extra_seats)}, olay ${n}`);
      // from uyuşmazlığı: abonelikte 2 varken from=0 teklifi
      const conv3 = `rehearsal-seat-${randomUUID()}`;
      const inv3 = randomUUID();
      await q(SMOKE.insertInvoice, [inv3, T, S, `RH-${tag}-3`, "500", JSON.stringify({ ...meta, conversationId: conv3, toExtraSeats: 3, targetTotalSeats: (L ?? 5) + 3 })]);
      const neg = await attempt(SMOKE.fulfillV2, [conv3, T, "office", total]);
      const extraNow = (await q<Record<string, unknown>>(SMOKE.subState, [T])).rows[0]!.extra_seats;
      add(G, "4.b6", "fromExtraSeats uyuşmazlığı reddedilir (22023), extra_seats 2 kalır", !neg.ok && neg.code === "22023" && /Extra seat count changed/.test(neg.message) && Number(extraNow) === 2 ? "PASS" : "FAIL", neg.ok ? "REDDEDİLMEDİ" : `${neg.code}: ${neg.message}`);
    });
  } catch (e) {
    add(G, "4.b", "ek koltuk faturası", "FAIL", describeError(e));
  }

  // (d) koltuk tetikleyicisi: extra_seats=2 iken plan limiti + 2'ye kadar, +3'te PLAN_LIMIT_EXCEEDED:seats
  try {
    if (L === null) add(G, "4.d", "koltuk tetikleyicisi limiti", "ATLANDI", "office seat_limit sınırsız (NULL)");
    else if (L + 2 > 60) add(G, "4.d", "koltuk tetikleyicisi limiti", "ATLANDI", `office seat_limit ${L}: çok fazla geçici kullanıcı gerekir`);
    else {
      await inStep(async () => {
        await asService();
        const extra = Number((await q<Record<string, unknown>>(SMOKE.subState, [T])).rows[0]!.extra_seats);
        if (extra !== 2) throw new Error(`extra_seats ${extra} (4.b başarısız olmuş olabilir)`);
        const n0 = (await q<{ n: number }>(SMOKE.activeSeats, [T])).rows[0]!.n;
        const cap = L + 2;
        let added = 0;
        for (let k = n0; k < cap; k++) {
          const id = randomUUID();
          await insertUser(id, `seat${k}`);
          await q(SMOKE.insertProfile, [id, T, `Prova Koltuk ${k}`, "advisor"]);
          added++;
        }
        add(G, "4.d1", `limit + 2 = ${cap} aktif kullanıcıya kadar eklenebildi`, "PASS", `${added} profil eklendi (önceden ${n0})`);
        const extraId = randomUUID();
        await insertUser(extraId, "seat-over");
        const over = await attempt(SMOKE.insertProfile, [extraId, T, "Prova Fazla", "advisor"]);
        add(G, "4.d2", `${cap + 1}. kullanıcı reddedilir: PLAN_LIMIT_EXCEEDED:seats:${cap}`, !over.ok && over.message.includes(`PLAN_LIMIT_EXCEEDED:seats:${cap}`) ? "PASS" : "FAIL", over.ok ? "REDDEDİLMEDİ" : `${over.code}: ${over.message}`);
      });
    }
  } catch (e) {
    add(G, "4.d", "koltuk tetikleyicisi", "FAIL", describeError(e));
  }

  // (c) update_tenant_plan_subscription: aynı plan tutar/kilit korunur; plan değişiminde tutar plan tanımından
  try {
    await inStep(async () => {
      await asService();
      await q(SMOKE.setPriceLock, [T, "1111", "999", "rehearsal"]);
      const r1 = (await q<{ result: Record<string, unknown> }>(SMOKE.updatePlan, [T, ST, "office"])).rows[0]!.result;
      const s1 = (await q<Record<string, unknown>>(SMOKE.subState, [T])).rows[0]!;
      add(G, "4.c1", "aynı plan: kayıtlı tutar ve fiyat kilidi KORUNUR", numEq(s1.amount_try, 1111) && numEq(s1.price_lock_try, 999) && s1.price_lock_campaign === "rehearsal" && r1.amountSource === "preserved" ? "PASS" : "FAIL", `amount ${String(s1.amount_try)}, kilit ${String(s1.price_lock_try)}/${String(s1.price_lock_campaign)}, kaynak ${String(r1.amountSource)}`);
      await q(SMOKE.clearPriceLock, [T]);
      const pro = (await q<{ monthly: string }>(SMOKE.planAmounts, ["professional"])).rows[0]!.monthly;
      const r2 = (await q<{ result: Record<string, unknown> }>(SMOKE.updatePlan, [T, ST, "professional"])).rows[0]!.result;
      const s2 = (await q<Record<string, unknown>>(SMOKE.subState, [T])).rows[0]!;
      const t2 = (await q<{ plan: string }>(SMOKE.tenantPlan, [T])).rows[0]!;
      add(G, "4.c2", "plan değişimi: tutar = plan_monthly_amount('professional'), kilit yok, ofis + abonelik planı güncel", numEq(s2.amount_try, pro) && s2.price_lock_try === null && s2.plan === "professional" && t2.plan === "professional" && r2.amountSource === "catalog" ? "PASS" : "FAIL", `amount ${String(s2.amount_try)} (beklenen ${pro}), plan ${String(s2.plan)}/${t2.plan}, kaynak ${String(r2.amountSource)}`);
    });
  } catch (e) {
    add(G, "4.c", "update_tenant_plan_subscription", "FAIL", describeError(e));
  }

  smoke.ok = true;
  return smoke;
}

function advisorClaims(s: Smoke): string {
  return JSON.stringify({ sub: s.advisor, role: "authenticated", aud: "authenticated", app_metadata: { tenant_id: s.tenant, role: "advisor" } });
}

/** Ret bekleyen deneme: 42501 (RLS WITH CHECK ya da tetikleyici) PASS; başarı ya da başka kod FAIL. */
function judgeRejection(a: Attempt): { status: CheckStatus; detail: string } {
  if (a.ok) return { status: "FAIL", detail: `REDDEDİLMEDİ (${a.rowCount} satır)` };
  if (a.code === "42501") return { status: "PASS", detail: a.message };
  return { status: "FAIL", detail: `beklenmeyen hata (ret nedeni kural olmayabilir): ${a.code}: ${a.message}` };
}

async function rlsChecks(s: Smoke): Promise<void> {
  console.log("\n(5) RLS rol simülasyonu (SET LOCAL ROLE authenticated + request.jwt.claims; danışman)");
  const G = "5-rls";
  const ids = ["5.0", "5.1", "5.2", "5.3", "5.4"];
  if (!s.ok) {
    for (const id of ids) add(G, id, "RLS simülasyonu", "ATLANDI", s.reason || "fatura smoke kurulumu yok");
    return;
  }
  const T = s.tenant;
  const A = s.advisor;
  const O = s.owner;
  const pOwn = randomUUID();
  const pOwn2 = randomUUID();
  const pOther = randomUUID();
  const tag = T.slice(0, 8);
  try {
    await inStep(async () => {
      await asService();
      for (const [mod, act] of [["properties", "view"], ["properties", "create"], ["properties", "edit"], ["compliance", "view"], ["compliance", "create"]] as const) {
        await q(SMOKE.grantRolePermission, [T, "advisor", mod, act]);
      }
      await q(SMOKE.insertProperty, [pOwn, T, `RH-${tag}-P1`, "prova kendi ilanı", A, null]);
      await q(SMOKE.insertProperty, [pOwn2, T, `RH-${tag}-P2`, "prova kendi ilanı 2", A, null]);
      await q(SMOKE.insertProperty, [pOther, T, `RH-${tag}-P3`, "prova başkasının ilanı", O, O]);
      await q(SMOKE.insertOwnerInfo, [T, pOwn, A]);
    });
  } catch (e) {
    const why = `RLS kurulumu başarısız: ${describeError(e)}`;
    for (const id of ids) add(G, id, "RLS simülasyonu", id === "5.0" ? "FAIL" : "ATLANDI", why);
    return;
  }

  const asAdvisor = async () => {
    await q(TX.asAuthenticatedRole);
    await q(TX.setClaims, [advisorClaims(s)]);
  };
  const scoped = async (fn: () => Promise<void>) => {
    await q(TX.savepoint);
    try {
      await asAdvisor();
      await fn();
    } finally {
      await q(TX.toSavepoint);
      await q(TX.releaseSavepoint);
      await asService();
    }
  };

  let identityOk = false;
  try {
    await scoped(async () => {
      const who = (await q<{ tenant_id: string | null; role: string }>(SMOKE.whoAmI)).rows[0];
      identityOk = who?.tenant_id === T && who?.role === "advisor";
      add(G, "5.0", "simülasyon kimliği: current_tenant_id() = geçici ofis, current_profile_role() = advisor", identityOk ? "PASS" : "FAIL", `tenant ${String(who?.tenant_id)}, rol '${String(who?.role)}'`);
    });
  } catch (e) {
    add(G, "5.0", "simülasyon kimliği", "FAIL", describeError(e));
  }
  if (!identityOk) {
    for (const id of ids.slice(1)) add(G, id, "RLS ret denemesi", "ATLANDI", "kimlik kurulamadı: ret sonucu kurala bağlanamaz");
    return;
  }

  const posFail = (p: Attempt) => (p.ok ? "" : `pozitif kontrol başarısız (${p.code}: ${p.message}); ret kurala bağlanamaz`);

  // 5.1 approval_requests
  try {
    await scoped(async () => {
      const own = randomUUID();
      const pos = await attempt(SMOKE.approvalInsert, [T, "bekliyor", A, own], true);
      if (!pos.ok) {
        add(G, "5.1a", "onay: danışman 'onaylandi' INSERT edemez", "ATLANDI", posFail(pos));
        add(G, "5.1b", "onay: danışman kendi talebini onaylayamaz", "ATLANDI", posFail(pos));
        return;
      }
      const j1 = judgeRejection(await attempt(SMOKE.approvalInsert, [T, "onaylandi", A, randomUUID()]));
      add(G, "5.1a", "onay: danışman 'onaylandi' INSERT edemez", j1.status, j1.detail);
      const upd = await attempt(SMOKE.approvalSelfDecide, [own]);
      const st = (await q<{ status: string }>(SMOKE.approvalStatus, [own])).rows[0]?.status;
      const rejected = !upd.ok ? upd.code === "42501" : upd.rowCount === 0;
      add(G, "5.1b", "onay: danışman kendi talebini UPDATE ile onaylayamaz (durum 'bekliyor' kalır)", rejected && st === "bekliyor" ? "PASS" : "FAIL", `${upd.ok ? `${upd.rowCount} satır` : `${upd.code}: ${upd.message}`}; durum ${String(st)}`);
    });
  } catch (e) {
    add(G, "5.1", "approval_requests", "FAIL", describeError(e));
  }

  // 5.2 listing_pool_entries
  try {
    await scoped(async () => {
      const pos = await attempt(SMOKE.poolInsert, [T, pOwn, A, false]);
      if (!pos.ok) {
        add(G, "5.2a", "havuz: başka ilan için uzak tarihli claim INSERT edilemez", "ATLANDI", posFail(pos));
        add(G, "5.2b", "havuz: kendi ilanında 30 gün sonraki claim penceresi açılamaz", "ATLANDI", posFail(pos));
        return;
      }
      const j1 = judgeRejection(await attempt(SMOKE.poolInsert, [T, pOther, A, true]));
      add(G, "5.2a", "havuz: başka (atanmış) ilan için uzak tarihli claim INSERT edilemez", j1.status, j1.detail);
      const j2 = judgeRejection(await attempt(SMOKE.poolInsert, [T, pOwn2, A, true]));
      add(G, "5.2b", "havuz: kendi ilanında 30 gün sonraki claim penceresi açılamaz (claim kuralı yok)", j2.status, j2.detail);
    });
  } catch (e) {
    add(G, "5.2", "listing_pool_entries", "FAIL", describeError(e));
  }

  // 5.3 kvkk_requests
  try {
    await scoped(async () => {
      const pos = await attempt(SMOKE.kvkkInsert, [T, "access", A]);
      if (!pos.ok) {
        add(G, "5.3", "kvkk: danışman account_closure açamaz", "ATLANDI", posFail(pos));
        return;
      }
      const j = judgeRejection(await attempt(SMOKE.kvkkInsert, [T, "account_closure", A]));
      add(G, "5.3", "kvkk: danışman account_closure talebi açamaz (rol kapısı)", j.status, j.detail);
    });
  } catch (e) {
    add(G, "5.3", "kvkk_requests", "FAIL", describeError(e));
  }

  // 5.4 property_owner_info
  try {
    await scoped(async () => {
      const pos = await attempt(SMOKE.ownerInfoNote, [pOwn]);
      if (!pos.ok || pos.rowCount !== 1) {
        add(G, "5.4", "ilan sahibi: property_id değiştirilemez", "ATLANDI", pos.ok ? `pozitif kontrol ${pos.rowCount} satır (1 bekleniyordu)` : posFail(pos));
        return;
      }
      const mv = await attempt(SMOKE.ownerInfoMove, [pOwn, pOwn2]);
      const still = (await q<{ n: number }>(SMOKE.ownerInfoProperty, [pOwn])).rows[0]?.n;
      const j = judgeRejection(mv);
      add(G, "5.4", "ilan sahibi: kaydın property_id'si başka ilana taşınamaz", j.status === "PASS" && Number(still) === 1 ? "PASS" : "FAIL", `${j.detail}; kayıt yerinde ${String(still)}`);
    });
  } catch (e) {
    add(G, "5.4", "property_owner_info", "FAIL", describeError(e));
  }
}

// ---------------------------------------------------------------------------------------------------------
// Ana akış
// ---------------------------------------------------------------------------------------------------------
async function main(): Promise<void> {
  await client.connect();
  connected = true;
  const t0 = Date.now();
  try {
    await q(TX.begin);
    await q(TX.timeouts, [TIMEOUTS.statement, TIMEOUTS.lock, TIMEOUTS.idleInTransaction]);
    const info = (await q<{ version_num: number; usr: string; tx_now: string }>(TX.serverInfo)).rows[0]!;
    console.log(`\nBağlandı: PostgreSQL ${info.version_num}, kullanıcı ${info.usr}, transaction zamanı ${info.tx_now}`);

    const lock = (await q<{ ok: boolean }>(TX.tryLock, [LOCK_KEY])).rows[0]?.ok === true;
    if (!lock) {
      add("0-on", "kilit", "advisory kilit (apply-migrations ile aynı anahtar)", "FAIL", "alınamadı: başka bir migrate/prova çalışıyor");
      return;
    }
    add("0-on", "kilit", "advisory kilit (apply-migrations ile aynı anahtar)", "PASS");

    const ledger = (await q<{ ledger: string | null }>(TX.ledgerExists)).rows[0]?.ledger;
    if (!ledger) {
      add("0-on", "ledger", "schema_migrations var", "FAIL", "ledger tablosu yok; prova anlamsız");
      return;
    }
    const applied = (await q<{ version: string }>(TX.ledgerApplied, [TARGET_FILES])).rows.map((r: { version: string }) => r.version);
    if (applied.length > 0) {
      add("0-on", "ledger", "hedef dosyalar henüz uygulanmamış", "FAIL", `zaten uygulanmış: ${applied.join(", ")}`);
      return;
    }
    add("0-on", "ledger", "hedef dosyalar henüz uygulanmamış", "PASS", `${TARGET_FILES.length} dosya bekliyor`);

    await billingBodiesBefore();
    const applyOk = await applyAll();
    if (!applyOk) return;
    await billingBodiesAfter();
    await helperChecks();
    const smoke = await billingSmoke();
    await rlsChecks(smoke);
  } catch (e) {
    add("0-on", "hata", "beklenmeyen hata", "FAIL", describeError(e));
  } finally {
    clearTimeout(watchdog);
    if (!stopping) {
      const ok = await rollbackAndClose();
      console.log(
        `\n${ok ? "ROLLBACK tamam" : "ROLLBACK yanıtı alınamadı; bağlantı kapatıldı (sunucu açık transaction'ı geri alır)"} — ` +
          `hiçbir şey kalıcı yazılmadı. Transaction süresi ${Date.now() - t0} ms.`,
      );
    }
  }
}

main()
  .catch((e) => {
    add("0-on", "baglanti", "bağlantı / genel", "FAIL", describeError(e));
  })
  .finally(() => {
    if (stopping) return;
    console.log(`\n${formatResults(results)}`);
    process.exit(exitCodeFor(results));
  });

