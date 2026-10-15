/**
 * Cari hesap, açık kalem ve yaşlandırma yardımcıları (SAF; sunucu ve istemci kullanır, veritabanı/saat okumaz).
 *
 * Tanımlar (ekranda, ekstrede ve raporda aynı):
 *  - Bakiye işareti: pozitif = cari bize borçlu (alacağımız var), negatif = biz cariye borçluyuz.
 *  - Yaşlandırma: vade tarihinden bugüne geçen gün. Vadesi bugün ya da ileride olan kalem "vadesi gelmedi";
 *    1–30 gün "0–30", 31–60, 61–90, 91 ve üstü "90+". Vadesiz kalem (vade tarihi yok) ayrı "vadesiz" kovasındadır:
 *    gecikmiş sayılmaz, "90+"ya da "vadesi gelmedi"ye karışmaz (`finance_aging` RPC'si ile aynı).
 *  - Kalem durumu: ödenen 0 → açık, 0 < ödenen < tutar → kısmi, ödenen ≥ tutar → kapandı.
 * Para hesabı kuruş (tam sayı) üzerinden yapılır; toplamlar kayan nokta sapması taşımaz.
 */
import { parseMoneyInput } from "@/lib/money-input";

// ---------------------------------------------------------------------------
// Cari türleri
// ---------------------------------------------------------------------------

export const PARTY_KINDS = ["musteri", "malik", "kiraci", "tedarikci", "danisman", "diger"] as const;
export type PartyKindKey = (typeof PARTY_KINDS)[number];

export const PARTY_KIND_LABEL: Record<PartyKindKey, string> = {
  musteri: "Müşteri",
  malik: "Malik",
  kiraci: "Kiracı",
  tedarikci: "Tedarikçi",
  danisman: "Danışman",
  diger: "Diğer",
};

export function partyKindOf(value: unknown): PartyKindKey | null {
  return typeof value === "string" && (PARTY_KINDS as readonly string[]).includes(value) ? (value as PartyKindKey) : null;
}

export function partyKindLabel(value: unknown): string {
  const k = partyKindOf(value);
  return k ? PARTY_KIND_LABEL[k] : "Diğer";
}

/**
 * Cari seçicide öneri türü: kaynağa ve kategoriye göre en olası cari türü (yalnız sıralama/varsayılan; kısıt değildir).
 * Kira tahsilatı → kiracı, mülk sahibi ödemesi → malik, komisyon → müşteri, maaş/prim → danışman, diğer çıkışlar → tedarikçi.
 */
export function kindHintFor(input: { direction?: "in" | "out" | "transfer" | null; category?: string | null; sourceType?: string | null }): PartyKindKey | null {
  const cat = input.category ?? "";
  const src = input.sourceType ?? "";
  if (src === "rent" || cat === "kira_tahsilat") return "kiraci";
  if (src === "owner_payout" || cat === "mulk_sahibi_odeme") return "malik";
  if (src === "commission" || cat === "komisyon") return "musteri";
  if (cat === "maas" || cat === "prim") return "danisman";
  if (input.direction === "out") return "tedarikci";
  if (input.direction === "in") return "musteri";
  return null;
}

// ---------------------------------------------------------------------------
// Kuruş
// ---------------------------------------------------------------------------

export function toKurus(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

export const fromKurus = (k: number): number => k / 100;

export function num(value: unknown): number {
  return fromKurus(toKurus(value));
}

// ---------------------------------------------------------------------------
// Tarih (saf metin + UTC; yerel saat dilimine bağlı değil)
// ---------------------------------------------------------------------------

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
export const isIsoDay = (v: unknown): v is string => typeof v === "string" && ISO_DAY.test(v);

function dayNumber(iso: string): number {
  return Math.floor(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / 86_400_000);
}

/** "YYYY-MM-DD" + n gün. */
export function addDays(iso: string, days: number): string {
  const d = new Date((dayNumber(iso) + days) * 86_400_000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

/** Vade tarihinden `today`'e geçen gün (vadesi ileride ise negatif). */
export function daysPastDue(dueDate: string, today: string): number {
  return dayNumber(today) - dayNumber(dueDate.slice(0, 10));
}

// ---------------------------------------------------------------------------
// Yaşlandırma
// ---------------------------------------------------------------------------

export const AGING_BUCKETS = ["vadesi_gelmedi", "0-30", "31-60", "61-90", "90+", "vadesiz"] as const;
export type AgingBucketKey = (typeof AGING_BUCKETS)[number];

export const AGING_LABEL: Record<AgingBucketKey, string> = {
  vadesi_gelmedi: "Vadesi gelmedi",
  "0-30": "0–30 gün",
  "31-60": "31–60 gün",
  "61-90": "61–90 gün",
  "90+": "90+ gün",
  vadesiz: "Vadesiz",
};

/** Gecikmiş kova mı (vadesi gelmemiş ve vadesiz kalem gecikme toplamına ve "Vadesi geçen" süzgecine girmez). */
export function isOverdueBucket(bucket: AgingBucketKey): boolean {
  return bucket !== "vadesi_gelmedi" && bucket !== "vadesiz";
}

export function agingBucketKeyOf(value: unknown): AgingBucketKey | null {
  return typeof value === "string" && (AGING_BUCKETS as readonly string[]).includes(value) ? (value as AgingBucketKey) : null;
}

export function agingBucketOf(dueDate: string | null | undefined, today: string): AgingBucketKey {
  if (!dueDate || !isIsoDay(dueDate.slice(0, 10))) return "vadesiz";
  const d = daysPastDue(dueDate, today);
  if (d <= 0) return "vadesi_gelmedi";
  if (d <= 30) return "0-30";
  if (d <= 60) return "31-60";
  if (d <= 90) return "61-90";
  return "90+";
}

/**
 * Kovanın vade aralığı (her iki uç dahil). Filtreli liste sorgusu bunu kullanır; `nullOnly` yalnız vadesiz kalemleri
 * seçer (aralık uçları o zaman kullanılmaz). `agingBucketOf` ile birebir aynı sınırlar (testle sabit).
 */
export function bucketDueRange(bucket: AgingBucketKey, today: string): { dueFrom: string | null; dueTo: string | null; nullOnly: boolean } {
  switch (bucket) {
    case "vadesiz":
      return { dueFrom: null, dueTo: null, nullOnly: true };
    case "vadesi_gelmedi":
      return { dueFrom: today, dueTo: null, nullOnly: false };
    case "0-30":
      return { dueFrom: addDays(today, -30), dueTo: addDays(today, -1), nullOnly: false };
    case "31-60":
      return { dueFrom: addDays(today, -60), dueTo: addDays(today, -31), nullOnly: false };
    case "61-90":
      return { dueFrom: addDays(today, -90), dueTo: addDays(today, -61), nullOnly: false };
    case "90+":
      return { dueFrom: null, dueTo: addDays(today, -91), nullOnly: false };
  }
}

export type AgingRow = { bucket: AgingBucketKey; cnt: number; amount: number };
export type AgingSummary = { rows: AgingRow[]; total: number; count: number; overdue: number; overdueCount: number };

/** RPC (`finance_aging`) satırlarını 6 kovaya tamamlar (eksik kova 0), sırayı sabitler ve toplamları kuruşla çıkarır. */
export function normalizeAging(raw: readonly { bucket?: unknown; cnt?: unknown; amount?: unknown }[] | null | undefined): AgingSummary {
  const byKey = new Map<AgingBucketKey, { cnt: number; k: number }>();
  for (const r of raw ?? []) {
    const key = agingBucketKeyOf(r.bucket);
    if (!key) continue;
    const prev = byKey.get(key) ?? { cnt: 0, k: 0 };
    byKey.set(key, { cnt: prev.cnt + Math.max(0, Math.trunc(Number(r.cnt) || 0)), k: prev.k + toKurus(r.amount) });
  }
  return summarize(AGING_BUCKETS.map((bucket) => ({ bucket, cnt: byKey.get(bucket)?.cnt ?? 0, k: byKey.get(bucket)?.k ?? 0 })));
}

/** Açık kalem listesinden yaşlandırma (RPC yoksa ya da tutarlılık denetimi için; RPC ile aynı sınırlar). */
export function agingFromItems(items: readonly { due_date?: string | null; amount_open?: unknown }[], today: string): AgingSummary {
  const acc = new Map<AgingBucketKey, { cnt: number; k: number }>(AGING_BUCKETS.map((b) => [b, { cnt: 0, k: 0 }]));
  for (const it of items) {
    const k = toKurus(it.amount_open);
    if (k <= 0) continue;
    const slot = acc.get(agingBucketOf(it.due_date ?? null, today))!;
    slot.cnt += 1;
    slot.k += k;
  }
  return summarize(AGING_BUCKETS.map((bucket) => ({ bucket, ...acc.get(bucket)! })));
}

function summarize(rows: readonly { bucket: AgingBucketKey; cnt: number; k: number }[]): AgingSummary {
  let totalK = 0;
  let count = 0;
  let overdueK = 0;
  let overdueCount = 0;
  for (const r of rows) {
    totalK += r.k;
    count += r.cnt;
    if (isOverdueBucket(r.bucket)) {
      overdueK += r.k;
      overdueCount += r.cnt;
    }
  }
  return {
    rows: rows.map((r) => ({ bucket: r.bucket, cnt: r.cnt, amount: fromKurus(r.k) })),
    total: fromKurus(totalK),
    count,
    overdue: fromKurus(overdueK),
    overdueCount,
  };
}

/** Çubuk genişliği yüzdesi (toplam 0 ise 0; görünür olsun diye dolu kova en az %2). */
export function bucketShare(amount: number, total: number): number {
  if (total <= 0 || amount <= 0) return 0;
  return Math.max(2, Math.round((amount / total) * 1000) / 10);
}

// ---------------------------------------------------------------------------
// Açık kalem durumu ve kısmi tahsilat
// ---------------------------------------------------------------------------

export type OpenItemStatus = "open" | "partial" | "paid" | "cancelled";

export const OPEN_ITEM_STATUS_LABEL: Record<OpenItemStatus, string> = {
  open: "Açık",
  partial: "Kısmi",
  paid: "Kapandı",
  cancelled: "İptal",
};

export function remainingOf(amount: unknown, paid: unknown): number {
  return fromKurus(Math.max(0, toKurus(amount) - toKurus(paid)));
}

/** Ödenen tutara göre durum (RPC ile aynı kural; iptal ayrı alandan gelir). */
export function statusAfter(amount: unknown, paid: unknown): Exclude<OpenItemStatus, "cancelled"> {
  const a = toKurus(amount);
  const p = toKurus(paid);
  if (p <= 0) return "open";
  if (p >= a) return "paid";
  return "partial";
}

export const SETTLE_MAX = 9_999_999_999.99;

/** Tahsil et / Öde tutarı: pozitif, en çok iki ondalık, kalan tutarı aşamaz. */
export function parseSettleAmount(raw: unknown, remaining: number): { ok: true; value: number } | { ok: false; error: string } {
  const parsed = parseMoneyInput(typeof raw === "number" || typeof raw === "string" ? raw : null, { max: SETTLE_MAX });
  if (!parsed.ok || parsed.value == null || parsed.value <= 0) return { ok: false, error: "Geçerli, en çok iki ondalık haneli bir tutar girin." };
  if (toKurus(parsed.value) > toKurus(remaining)) return { ok: false, error: "Tutar kalan tutardan büyük olamaz." };
  return { ok: true, value: parsed.value };
}

// ---------------------------------------------------------------------------
// Ekstre ve bakiye
// ---------------------------------------------------------------------------

export type StatementLine = {
  d: string;
  doc_type: string;
  ref_id: string | null;
  title: string;
  debit: number;
  credit: number;
  running_balance: number;
  href: string | null;
};

/** RPC satırını sayısal ve güvenli biçime çevirir (tutarlar kuruşa yuvarlanır). */
export function normalizeStatementLine(r: Record<string, unknown>): StatementLine {
  return {
    d: String(r.d ?? "").slice(0, 10),
    doc_type: String(r.doc_type ?? ""),
    ref_id: typeof r.ref_id === "string" ? r.ref_id : null,
    title: String(r.title ?? ""),
    debit: num(r.debit),
    credit: num(r.credit),
    running_balance: num(r.running_balance),
    href: safeHref(r.href),
  };
}

/**
 * `finance_party_statement` argümanları. Süzgeç yoksa sınırlar null gider: FN1 RPC'si p_from null iken devir satırı
 * üretmez, p_to null iken ileri tarihli kalemleri de katar; böylece kapanış bakiyesi `finance_party_balances.balance`
 * (tarihten bağımsız açık kalemler) ile aynıdır. Süzgeçte yalnız verilen sınır gönderilir.
 */
export function statementRpcArgs(partyId: string, from: string | null | undefined, to: string | null | undefined): { p_party_id: string; p_from: string | null; p_to: string | null } {
  return { p_party_id: partyId, p_from: from || null, p_to: to || null };
}

/** Ekstrenin kapanış bakiyesi = son satırın yürüyen bakiyesi (satır yoksa 0). */
export function closingBalance(lines: readonly Pick<StatementLine, "running_balance">[]): number {
  return lines.length === 0 ? 0 : lines[lines.length - 1].running_balance;
}

/** Yürüyen bakiyeyi borç/alacaktan yeniden hesaplar (açılış bakiyesiyle) — ekstre tutarlılık denetimi. */
export function recomputeRunning(lines: readonly Pick<StatementLine, "debit" | "credit">[], opening = 0): number[] {
  let k = toKurus(opening);
  return lines.map((l) => {
    k += toKurus(l.debit) - toKurus(l.credit);
    return fromKurus(k);
  });
}

/**
 * Ekstre belge türü etiketleri — `finance_party_statement.doc_type` değerleri (FN1 sözleşmesi:
 * devir | alacak | borc | tahsilat | odeme | pesin_tahsilat | pesin_odeme). Bilinmeyen tür "Kayıt" olarak gösterilir.
 */
export const STATEMENT_DOC_LABEL: Record<string, string> = {
  devir: "Devir",
  alacak: "Alacak",
  borc: "Borç",
  tahsilat: "Tahsilat",
  odeme: "Ödeme",
  pesin_tahsilat: "Peşin tahsilat",
  pesin_odeme: "Peşin ödeme",
};

export function statementDocLabel(docType: string): string {
  return STATEMENT_DOC_LABEL[docType] ?? "Kayıt";
}

/** Bakiye açıklaması: kim kime borçlu. */
export function balanceCaption(balance: number): string {
  const k = toKurus(balance);
  if (k > 0) return "Cari bize borçlu";
  if (k < 0) return "Biz cariye borçluyuz";
  return "Hesap kapalı";
}

/** Yalnız uygulama içi göreli bağlantılar (`/app/...`) geçer; dış adres veya protokol bağlantısı düşer. */
export function safeHref(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  return /^\/app(?:[/?#]|$)/.test(v) && !v.startsWith("//") ? v : null;
}

// ---------------------------------------------------------------------------
// Açık kalem kaynakları
// ---------------------------------------------------------------------------

export const OPEN_ITEM_SOURCES = ["manual", "rent", "commission", "recurring", "owner_payout", "building", "due", "payout"] as const;
export type OpenItemSource = (typeof OPEN_ITEM_SOURCES)[number];

export const OPEN_ITEM_SOURCE_LABEL: Record<OpenItemSource, string> = {
  manual: "Elle girilen",
  rent: "Kira",
  commission: "Komisyon",
  recurring: "Düzenli ödeme",
  owner_payout: "Mülk sahibine ödeme",
  building: "Bina aidatı",
  due: "Aidat borcu",
  payout: "Danışman hakedişi",
};

export function openItemSourceOf(value: unknown): OpenItemSource | null {
  return typeof value === "string" && (OPEN_ITEM_SOURCES as readonly string[]).includes(value) ? (value as OpenItemSource) : null;
}

/**
 * Görünüm satırlarını anahtara göre tekilleştirir (aynı kaynak kaydı iki kez gelirse tek satır). Kira tahakkuku ya da
 * hesaplanmış komisyon için elle açılmış kalem de varsa (source_type/source_id aynı) elle girilen kalem önceliklidir:
 * tahsilat oradan yapılır, kaynak satırı çift kayıt olmaz.
 */
export function dedupeOpenItems<T extends { key: string; source: string; source_id: string | null; manual_source?: { type: string | null; id: string | null } | null }>(rows: readonly T[]): T[] {
  const seen = new Set<string>();
  const manualCovers = new Set<string>();
  for (const r of rows) {
    if (r.source === "manual" && r.manual_source?.type && r.manual_source.id) manualCovers.add(`${r.manual_source.type}:${r.manual_source.id}`);
  }
  const out: T[] = [];
  for (const r of rows) {
    if (seen.has(r.key)) continue;
    seen.add(r.key);
    if (r.source !== "manual" && r.source_id && manualCovers.has(`${r.source}:${r.source_id}`)) continue;
    out.push(r);
  }
  return out;
}
