/**
 * Migration PROVASI (rehearsal) — saf yardımcılar (DB'ye bağlanmaz, dosya yazmaz).
 * Çalıştırıcı: scripts/migration-rehearsal.ts (`npm run db:rehearse`). Sözleşme: rehearsal-contract.test.ts.
 *
 * Prova tek transaction'da terfi eden migration'ları çalıştırır, doğrular ve HER KOŞULDA ROLLBACK eder;
 * kalıcılaştırma deyimi kodda YOKTUR. Bu modül bayrak ayrıştırma, dosya güvenlik taraması (üst düzey
 * transaction denetimi), fonksiyon gövdesi çıkarma (md5 beklentileri) ve sonuç tablosunu içerir.
 */
import { createHash } from "node:crypto";

/** scripts/apply-migrations.ts ile AYNI anahtar: iki araç aynı anda çalışamaz. */
export const LOCK_KEY = 4_872_119;

/** 2026-10-05 terfi eden 13 migration, uygulama sırasıyla (docs/runbooks/YAYIN_PENCERESI_2.md §3). */
export const PROMOTED_FILES = [
  "20260825000100_properties_owner_customer_link.sql",
  "20260825000200_geo_central_management.sql",
  "20260825000300_billing_plan_amount_integrity.sql",
  "20260825000400_subscription_seat_price_lock.sql",
  "20260825000500_billing_pause_proration_business_seats.sql",
  "20260825000600_seat_purchase_fulfillment.sql",
  "20260825000700_survey_module.sql",
  "20260825000800_growth_referral_partner_attribution.sql",
  "20260825000900_growth_click_counters.sql",
  "20260825001000_ai_credit_metering.sql",
  "20260825001100_tenant_vitrin_settings.sql",
  "20260825001200_tenant_vitrin_sections_seo_optin.sql",
  "20260825001300_ownership_transfers.sql",
] as const;

/** Kazanç gizliliği (P12): yalnız `--with-earnings` ile, EN SONDA. */
export const EARNINGS_FILE = "20260816000500_commission_earnings_privacy.sql";

/**
 * EmlakFiyati kontör kümesi (`--ef`): cüzdan → raporlar → kontör paketi faturası, uygulama sırasıyla
 * (docs/runbooks/YAYIN_PENCERESI_2.md §7). Terfi eden 13 dosya + P12 canlıda uygulandığı için `--ef` onların
 * YERİNE bu üç dosyayı prova eder.
 */
export const EF_FILES = [
  "20260826000100_ef_credit_wallet.sql",
  "20260826000200_ef_reports.sql",
  "20260826000300_ef_credit_pack_fulfillment.sql",
] as const;

export const TIMEOUTS = {
  statement: "20s",
  lock: "10s",
  /** İstemci asılı kalırsa sunucu oturumu kapatır → transaction geri alınır. */
  idleInTransaction: "60s",
  /** İstemci tarafı bekçi: aşılırsa bağlantı kapatılır (sunucu transaction'ı geri alır). */
  overallMs: 180_000,
} as const;

// ---------------------------------------------------------------------------------------------------------
// Bayraklar (apply-migrations.ts kadar sıkı: bilinmeyen bayrak / argüman = çıkış 2, hiçbir şey yapılmaz)
// ---------------------------------------------------------------------------------------------------------

export const KNOWN_FLAGS = ["--yes-i-understand-locks", "--with-earnings", "--ef", "--help", "-h"] as const;

export type RehearsalFlags = { yes: boolean; withEarnings: boolean; ef: boolean; help: boolean };

export type ParsedArgs = { ok: true; flags: RehearsalFlags } | { ok: false; error: string };

export function parseRehearsalArgs(argv: readonly string[]): ParsedArgs {
  const known = new Set<string>(KNOWN_FLAGS);
  const seen = new Set<string>();
  for (const a of argv) {
    if (!a.startsWith("-")) return { ok: false, error: `Beklenmeyen argüman: ${a}. Hiçbir şey yapılmadı.` };
    if (!known.has(a)) return { ok: false, error: `Bilinmeyen seçenek: ${a}. Hiçbir şey yapılmadı.` };
    if (seen.has(a)) return { ok: false, error: `Seçenek iki kez verildi: ${a}. Hiçbir şey yapılmadı.` };
    seen.add(a);
  }
  if (seen.has("--ef") && seen.has("--with-earnings")) {
    return { ok: false, error: "--ef ile --with-earnings birlikte verilemez (ayrı kümeler). Hiçbir şey yapılmadı." };
  }
  return {
    ok: true,
    flags: {
      yes: seen.has("--yes-i-understand-locks"),
      withEarnings: seen.has("--with-earnings"),
      ef: seen.has("--ef"),
      help: seen.has("--help") || seen.has("-h"),
    },
  };
}

/** Bayraklara göre prova edilecek dosyalar, uygulama sırasıyla. */
export function targetFilesFor(flags: Pick<RehearsalFlags, "withEarnings" | "ef">): string[] {
  if (flags.ef) return [...EF_FILES];
  return [...PROMOTED_FILES, ...(flags.withEarnings ? [EARNINGS_FILE] : [])];
}

export const USAGE = [
  "Kullanım: npm run db:rehearse -- --yes-i-understand-locks [--with-earnings | --ef]",
  "  Terfi eden 13 migration'ı (ve --with-earnings ile 20260816000500'ü) ya da --ef ile EmlakFiyati kontör kümesini",
  "  (20260826000100..000300) GERÇEK şemada TEK transaction içinde çalıştırır, doğrular ve HER KOŞULDA ROLLBACK eder.",
  "  Ledger'a yazmaz. Bağlantı: DATABASE_POOLER_URL / DATABASE_URL.",
  "  --yes-i-understand-locks  kısa süreli tablo kilitlerini kabul ettiğinizi belirtir (ZORUNLU)",
  "  --with-earnings           kazanç gizliliği migration'ını da en sonda prova eder",
  "  --ef                      yalnız EmlakFiyati kontör kümesi (cüzdan, raporlar, kontör paketi faturası) + işlevsel smoke",
  "  --help, -h                bu metin",
].join("\n");

export const LOCK_WARNING = [
  "DİKKAT: kısa süreli tablo kilitleri.",
  "  Prova migration'ları gerçek şemada çalıştırır: ALTER TABLE (tenants, properties, subscriptions, demo_requests, geo_*;",
  "  --ef ile account_credit_ledger),",
  "  CREATE INDEX ve fonksiyon tanımları ROLLBACK'e kadar ACCESS EXCLUSIVE / SHARE kilitleri tutar. Bu sürede uygulamanın",
  `  bu tablolara erişimi BEKLER. Sınırlar: statement_timeout=${TIMEOUTS.statement}, lock_timeout=${TIMEOUTS.lock},`,
  `  idle_in_transaction_session_timeout=${TIMEOUTS.idleInTransaction}, toplam bekçi=${TIMEOUTS.overallMs / 1000} sn.`,
  "  Düşük trafikli bir anda çalıştırın. Devam etmek için: --yes-i-understand-locks",
].join("\n");

// ---------------------------------------------------------------------------------------------------------
// Migration dosyası güvenlik taraması: üst düzeyde transaction denetimi / CONCURRENTLY / ADD VALUE yasak.
// Yorumlar, tırnaklı dizgeler, "tanımlayıcılar" ve dolar-tırnaklı gövdeler atlanır; kalan metin ';' ile bölünür.
// ---------------------------------------------------------------------------------------------------------

/** Üst düzey (gövde dışı) SQL metni: yorum/dizge/dolar gövdeleri boşlukla değiştirilir. */
export function topLevelSql(sql: string): string {
  let out = "";
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const c = sql[i]!;
    const d = sql[i + 1];
    if (c === "-" && d === "-") {
      while (i < n && sql[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && d === "*") {
      let depth = 1;
      i += 2;
      while (i < n && depth > 0) {
        if (sql[i] === "/" && sql[i + 1] === "*") {
          depth++;
          i += 2;
        } else if (sql[i] === "*" && sql[i + 1] === "/") {
          depth--;
          i += 2;
        } else i++;
      }
      out += " ";
      continue;
    }
    if (c === "'") {
      const prev = out.length > 0 ? out[out.length - 1]! : " ";
      const escaped = (prev === "e" || prev === "E") && !/[A-Za-z0-9_]/.test(out[out.length - 2] ?? " ");
      let j = i + 1;
      while (j < n) {
        if (escaped && sql[j] === "\\") {
          j += 2;
          continue;
        }
        if (sql[j] === "'" && sql[j + 1] === "'") {
          j += 2;
          continue;
        }
        if (sql[j] === "'") break;
        j++;
      }
      out += " ";
      i = j + 1;
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      while (j < n && !(sql[j] === '"' && sql[j + 1] !== '"')) j += sql[j] === '"' ? 2 : 1;
      out += " ";
      i = j + 1;
      continue;
    }
    if (c === "$") {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i, i + 80));
      if (m) {
        const close = sql.indexOf(m[0], i + m[0].length);
        out += " ";
        i = close < 0 ? n : close + m[0].length;
        continue;
      }
    }
    out += c;
    i++;
  }
  return out;
}

const TX_KEYWORDS = new Set(["begin", "start", "commit", "end", "rollback", "abort", "savepoint", "release", "prepare"]);

/** Dosyada üst düzeyde yasak deyim varsa açıklamalarını döner (boş = güvenli). */
export function findTransactionControl(sql: string): string[] {
  const found: string[] = [];
  const top = topLevelSql(sql).toLowerCase();
  for (const raw of top.split(";")) {
    const stmt = raw.trim();
    if (!stmt) continue;
    const first = /^[a-z_]+/.exec(stmt)?.[0] ?? "";
    if (TX_KEYWORDS.has(first)) found.push(`üst düzey transaction denetimi: "${stmt.slice(0, 40)}"`);
    if (/\bconcurrently\b/.test(stmt)) found.push(`CONCURRENTLY (transaction içinde çalışmaz): "${stmt.slice(0, 60)}"`);
    if (/\balter\s+type\b[\s\S]*\badd\s+value\b/.test(stmt)) found.push(`ALTER TYPE ... ADD VALUE: "${stmt.slice(0, 60)}"`);
  }
  return found;
}

// ---------------------------------------------------------------------------------------------------------
// Fonksiyon gövdeleri ve md5 (pg_proc.prosrc = dolar tırnakları arasındaki metin; CR atılır)
// ---------------------------------------------------------------------------------------------------------

export type FunctionBody = { name: string; body: string };

export function extractFunctionBodies(sql: string): FunctionBody[] {
  const out: FunctionBody[] = [];
  const re = /create\s+or\s+replace\s+function\s+public\.([a-z0-9_]+)\s*\(/gi;
  for (const m of sql.matchAll(re)) {
    const from = m.index + m[0].length;
    const tag = /\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(from));
    if (!tag) continue;
    const start = from + tag.index + tag[0].length;
    const end = sql.indexOf(tag[0], start);
    if (end < 0) continue;
    out.push({ name: m[1]!.toLowerCase(), body: sql.slice(start, end) });
  }
  return out;
}

export function md5Body(body: string): string {
  return createHash("md5").update(body.replace(/\r/g, ""), "utf8").digest("hex");
}

/** Dosyada adı verilen fonksiyonun TEK tanımının md5'i; yoksa ya da birden çoksa null. */
export function bodyMd5FromFile(sql: string, name: string): string | null {
  const bodies = extractFunctionBodies(sql).filter((b) => b.name === name);
  return bodies.length === 1 ? md5Body(bodies[0]!.body) : null;
}

// ---------------------------------------------------------------------------------------------------------
// Sonuçlar
// ---------------------------------------------------------------------------------------------------------

export type CheckStatus = "PASS" | "FAIL" | "ATLANDI";
export type CheckResult = { group: string; id: string; title: string; status: CheckStatus; detail: string };

/** pg satır değerini karşılaştırma metnine çevirir: boolean t/f, null NULL, diğerleri String. */
export function normalizeValue(v: unknown): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "boolean") return v ? "t" : "f";
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

export type Expectation = string | { test: (v: string) => boolean; describe: string };

/** Beklentiyle karşılaştırır; uyuşmayan sütunları açıklar (boş dizi = uyumlu). */
export function compareRow(row: Record<string, unknown> | undefined, expect: Record<string, Expectation>): string[] {
  if (!row) return ["satır dönmedi"];
  const problems: string[] = [];
  for (const [col, exp] of Object.entries(expect)) {
    const got = normalizeValue(row[col]);
    const ok = typeof exp === "string" ? got === exp : exp.test(got);
    if (!ok) problems.push(`${col}=${got} (beklenen ${typeof exp === "string" ? exp : exp.describe})`);
  }
  return problems;
}

export function exitCodeFor(results: readonly CheckResult[]): 0 | 1 {
  return results.some((r) => r.status === "FAIL") ? 1 : 0;
}

export function formatResults(results: readonly CheckResult[]): string {
  const rows = results.map((r, i) => [String(i + 1), r.group, r.id, r.status, r.title, r.detail]);
  const head = ["#", "Grup", "Kontrol", "Durum", "Açıklama", "Ayrıntı"];
  const width = head.map((h, c) => Math.min(c === 5 ? 90 : 48, Math.max(h.length, ...rows.map((r) => r[c]!.length))));
  const cut = (s: string, w: number) => (s.length > w ? `${s.slice(0, w - 1)}…` : s.padEnd(w));
  const line = (cells: string[]) => cells.map((c, idx) => cut(c, width[idx]!)).join(" | ");
  const sep = width.map((w) => "-".repeat(w)).join("-+-");
  const count = (s: CheckStatus) => results.filter((r) => r.status === s).length;
  return [
    line(head),
    sep,
    ...rows.map(line),
    sep,
    `Özet: ${count("PASS")} PASS, ${count("FAIL")} FAIL, ${count("ATLANDI")} ATLANDI (toplam ${results.length}).`,
  ].join("\n");
}
