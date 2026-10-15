/**
 * Muhasebe "Kayıt" çalışma alanının SAF mantığı (istemci + sunucu + test; DOM, ağ ve saat yok).
 *
 * `/app/giderler/kayit` (yeni) ve `/app/giderler/kayit/[id]` (düzenle) sayfaları: sekme çözümü (`?tur=`), önceden doldurma
 * parametreleri (eski `finance:new-entry` olayının yerini alan bağlantılar), canlı özet hesabı (net / KDV / brüt / stopaj,
 * hesap bakiyesi önce → sonra, bütçe etkisi), olası mükerrer ve benzer kayıt sezgisi, cariden kategori önerisi ve
 * Excel/CSV'den yapıştırılan satırların ayrıştırılması.
 */
import { parseAmountShorthand } from "./amount-shorthand";
import { entryAmounts, LEDGER_VAT_RATES, type EntryAmounts } from "./ledger/vat";
import { shiftDayKey } from "./smart-entry";

export const ENTRY_BASE = "/app/giderler/kayit";

// ---------------------------------------------------------------------------
// Sekmeler
// ---------------------------------------------------------------------------

export const ENTRY_TABS = ["gider", "gelir", "transfer", "belge", "toplu"] as const;
export type EntryTab = (typeof ENTRY_TABS)[number];

export const ENTRY_TAB_LABEL: Readonly<Record<EntryTab, string>> = {
  gider: "Gider",
  gelir: "Gelir",
  transfer: "Transfer",
  belge: "Fatura / Belge",
  toplu: "Toplu giriş",
};

/** Kişisel (Kasam) kipte fatura/belge yoktur (ek ve e-Fatura ofis defterine aittir). */
export function entryTabsFor(personal: boolean): readonly EntryTab[] {
  return personal ? ENTRY_TABS.filter((t) => t !== "belge") : ENTRY_TABS;
}

export function isEntryTab(v: unknown): v is EntryTab {
  return typeof v === "string" && (ENTRY_TABS as readonly string[]).includes(v);
}

/** Tek kayıt sekmesinin yönü (belge/toplu için null). */
export function tabDirection(tab: EntryTab): "in" | "out" | "transfer" | null {
  return tab === "gider" ? "out" : tab === "gelir" ? "in" : tab === "transfer" ? "transfer" : null;
}

export function directionTab(direction: "in" | "out" | "transfer"): EntryTab {
  return direction === "in" ? "gelir" : direction === "transfer" ? "transfer" : "gider";
}

/** Son kullanılan sekme anahtarı (kullanıcı ve kapsam başına; localStorage). */
export function lastTabKey(userId: string, personal: boolean): string {
  return `emlaksoft:finance:entry-tab:${personal ? "kisisel" : "ofis"}:${userId}`;
}

/** Sekme başına taslak anahtarı (localStorage). */
export function draftKey(userId: string, personal: boolean, tab: EntryTab): string {
  return `emlaksoft:finance:entry-draft:${personal ? "kisisel" : "ofis"}:${tab}:${userId}`;
}

// ---------------------------------------------------------------------------
// Önceden doldurma (URL)
// ---------------------------------------------------------------------------

export type EntryPrefill = {
  tab: EntryTab | null;
  personal: boolean;
  amount: number | null;
  partyId: string | null;
  partyName: string | null;
  accountId: string | null;
  openItemId: string | null;
  attachmentId: string | null;
  text: string | null;
  date: string | null;
  vatRate: number | null;
  category: string | null;
  title: string | null;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export const isUuidLike = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);

type RawParams = Record<string, string | string[] | undefined>;

function first(raw: RawParams, key: string): string | null {
  const v = raw[key];
  const s = Array.isArray(v) ? v[0] : v;
  if (typeof s !== "string") return null;
  // Denetim karakterleri atılır, uzunluk sınırlanır (URL'den gelen metin yalnız öneridir).
  const t = s.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  return t ? t.slice(0, 300) : null;
}

function validDay(v: string | null): string | null {
  if (!v || !ISO_DAY.test(v)) return null;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v ? v : null;
}

/**
 * URL → önceden doldurma. Parametreler: `tur` (sekme), `kapsam=kisisel`, `tutar`, `cari` (kimlik), `cari_ad`, `hesap`,
 * `kalem` (vadeli kalem), `ek` (belge), `metin` (tek satır akıllı giriş), `tarih`, `kdv`, `kategori`, `aciklama`.
 * Geçersiz değer sessizce atılır (uydurma alan yok); tutar sıfır/negatifse yok sayılır.
 */
export function parseEntryPrefill(raw: RawParams): EntryPrefill {
  const tur = first(raw, "tur");
  const amount = parseAmountShorthand(first(raw, "tutar"));
  const partyId = first(raw, "cari");
  const vat = Number(first(raw, "kdv"));
  const category = first(raw, "kategori");
  const openItemId = first(raw, "kalem");
  return {
    tab: isEntryTab(tur) ? tur : null,
    personal: first(raw, "kapsam") === "kisisel",
    amount: amount != null && amount > 0 && amount < 1e10 ? amount : null,
    partyId: isUuidLike(partyId) ? partyId : null,
    partyName: isUuidLike(partyId) || !partyId ? (first(raw, "cari_ad")?.slice(0, 120) ?? null) : null,
    accountId: isUuidLike(first(raw, "hesap")) ? first(raw, "hesap") : null,
    openItemId: isUuidLike(openItemId) ? openItemId : null,
    attachmentId: isUuidLike(first(raw, "ek")) ? first(raw, "ek") : null,
    text: first(raw, "metin"),
    date: validDay(first(raw, "tarih")),
    vatRate: first(raw, "kdv") != null && (LEDGER_VAT_RATES as readonly number[]).includes(vat) ? vat : null,
    category: category && /^[a-z0-9_]{1,40}$/.test(category) ? category : null,
    title: first(raw, "aciklama")?.slice(0, 160) ?? null,
  };
}

export type EntryLinkInput = {
  tab?: EntryTab | null;
  personal?: boolean;
  amount?: number | null;
  partyId?: string | null;
  partyName?: string | null;
  accountId?: string | null;
  openItemId?: string | null;
  attachmentId?: string | null;
  text?: string | null;
  date?: string | null;
  vatRate?: number | null;
  category?: string | null;
  title?: string | null;
};

/** Yeni kayıt sayfası bağlantısı (önceden doldurma parametreleriyle). Boş değerler yazılmaz. */
export function entryHref(input: EntryLinkInput = {}): string {
  const sp = new URLSearchParams();
  const set = (k: string, v: string | number | null | undefined) => {
    if (v !== null && v !== undefined && v !== "") sp.set(k, String(v));
  };
  set("tur", input.tab ?? null);
  if (input.personal) sp.set("kapsam", "kisisel");
  set("tutar", input.amount != null && Number.isFinite(input.amount) && input.amount > 0 ? String(input.amount) : null);
  set("cari", input.partyId ?? null);
  set("cari_ad", input.partyName ?? null);
  set("hesap", input.accountId ?? null);
  set("kalem", input.openItemId ?? null);
  set("ek", input.attachmentId ?? null);
  set("metin", input.text ?? null);
  set("tarih", input.date ?? null);
  set("kdv", input.vatRate ?? null);
  set("kategori", input.category ?? null);
  set("aciklama", input.title ?? null);
  const s = sp.toString();
  return s ? `${ENTRY_BASE}?${s}` : ENTRY_BASE;
}

/** Kayıt düzenleme sayfası. Kişisel (Kasam) hareketi `kapsam=kisisel` ile açılır (kapı ve dönüş adresi farklıdır). */
export function entryEditHref(id: string, opts: { personal?: boolean } = {}): string {
  return `${ENTRY_BASE}/${id}${opts.personal ? "?kapsam=kisisel" : ""}`;
}

/** Kayıttan sonra / vazgeçince dönülecek liste. */
export function entryReturnHref(personal: boolean): string {
  return personal ? "/app/hesabim?sekme=kasam" : "/app/giderler?sekme=hareketler";
}

// ---------------------------------------------------------------------------
// Canlı özet
// ---------------------------------------------------------------------------

export type EntryTotals = EntryAmounts & {
  /** Hesaba yansıyan işaretli tutar (gider eksi, gelir artı). */
  signedCash: number;
};

/**
 * Canlı özet: `entryAmounts` (DB `finance_entry_amounts` ile aynı) + yönlü nakit. Tutar yoksa null.
 * KDV ve stopaj yalnız ofis kaydında hesaba girer (kişisel hesapta oranlar yok sayılır).
 */
export function computeEntryTotals(input: {
  amount: number | null;
  direction: "in" | "out" | "transfer";
  vatRate: number | null;
  vatIncluded: boolean;
  withholdingRate: number | null;
  office: boolean;
}): EntryTotals | null {
  if (input.amount == null || !Number.isFinite(input.amount) || input.amount <= 0) return null;
  const transfer = input.direction === "transfer";
  const vat = input.office && !transfer ? input.vatRate : null;
  const wh = input.office && !transfer ? input.withholdingRate : null;
  const a = entryAmounts(input.amount, vat, vat === null ? true : input.vatIncluded, wh);
  return { ...a, signedCash: input.direction === "in" ? a.cash : -a.cash };
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Hesap bakiyesi önce → sonra (transferde kaynak hesap için). */
export function balanceAfter(balance: number, totals: EntryTotals | null): number {
  return round2(balance + (totals?.signedCash ?? 0));
}

export type BudgetImpact = {
  budget: number;
  before: number;
  after: number;
  /** Kayıttan sonra bütçenin yüzde kaçı (yuvarlanmış). */
  pctAfter: number;
  over: boolean;
  remaining: number;
};

/** Bu ayın kategori bütçesine etki; bütçe yoksa (0/negatif) null (sahte metrik yok). */
export function budgetImpact(budget: number | null | undefined, actual: number, cash: number): BudgetImpact | null {
  if (budget == null || !Number.isFinite(budget) || budget <= 0) return null;
  const before = round2(Math.max(0, actual));
  const after = round2(before + Math.max(0, cash));
  return {
    budget,
    before,
    after,
    pctAfter: Math.round((after / budget) * 100),
    over: after > budget,
    remaining: round2(budget - after),
  };
}

// ---------------------------------------------------------------------------
// Geçmiş: mükerrer, benzer, cariden kategori
// ---------------------------------------------------------------------------

export type RecentEntry = {
  id: string;
  accountId: string;
  direction: "in" | "out";
  amount: number;
  date: string;
  category: string | null;
  title: string;
  counterparty: string | null;
};

/** Karşılaştırma için ad normalizasyonu: küçük harf (tr), aksan/noktalama yok, tek boşluk; şirket ekleri atılır. */
export function normalizeName(v: string | null | undefined): string {
  if (!v) return "";
  return v
    .toLocaleLowerCase("tr-TR")
    .replace(/ı/g, "i")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\b(ltd|sti|a\s?s|anonim|limited|sirketi|tic|san|ve)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function dayDiff(a: string, b: string): number {
  const ta = Date.parse(`${a}T00:00:00Z`);
  const tb = Date.parse(`${b}T00:00:00Z`);
  if (Number.isNaN(ta) || Number.isNaN(tb)) return Number.POSITIVE_INFINITY;
  return Math.round(Math.abs(ta - tb) / 86_400_000);
}

export type EntryCandidate = {
  /** Düzenlenen kaydın kendisi (karşılaştırmadan çıkarılır). */
  id?: string | null;
  direction: "in" | "out" | "transfer";
  /** Hesaba yansıyan nakit (geçmişteki `amount` da nakittir). */
  cash: number | null;
  date: string;
  counterparty: string | null;
  category: string | null;
  title?: string | null;
};

export type DuplicateHit = { entry: RecentEntry; reason: string; days: number };

export const DUPLICATE_WINDOW_DAYS = 30;

/**
 * Olası mükerrer (ENGELLEMEZ, yalnız uyarır): aynı yön + aynı tutar (kuruş) + son 30 gün içinde, ve
 * (aynı cari/karşı taraf YA DA aynı kategori ve ≤3 gün). En yakın tarih önce; en çok 3.
 */
export function findDuplicates(c: EntryCandidate, recent: readonly RecentEntry[]): DuplicateHit[] {
  if (c.direction === "transfer" || c.cash == null || c.cash <= 0) return [];
  const cents = Math.round(c.cash * 100);
  const party = normalizeName(c.counterparty);
  const out: DuplicateHit[] = [];
  for (const e of recent) {
    if (e.id === c.id || e.direction !== c.direction) continue;
    if (Math.round(e.amount * 100) !== cents) continue;
    const days = dayDiff(e.date, c.date);
    if (days > DUPLICATE_WINDOW_DAYS) continue;
    const sameParty = party !== "" && normalizeName(e.counterparty) === party;
    const sameCategory = Boolean(c.category) && e.category === c.category;
    if (sameParty) out.push({ entry: e, days, reason: days === 0 ? "Aynı gün, aynı tutar ve cari" : `${days} gün arayla aynı tutar ve cari` });
    else if (sameCategory && days <= 3) out.push({ entry: e, days, reason: days === 0 ? "Aynı gün, aynı tutar ve kategori" : `${days} gün arayla aynı tutar ve kategori` });
  }
  return out.sort((a, b) => a.days - b.days).slice(0, 3);
}

function tokens(v: string | null | undefined): Set<string> {
  return new Set(normalizeName(v).split(" ").filter((t) => t.length >= 3));
}

/**
 * Benzer son kayıtlar: aynı cari (en güçlü), açıklamada ortak sözcük, aynı kategori. Puanla sıralanır, en yeni önce;
 * mükerrer adayları ve düzenlenen kayıt hariç. En çok `limit`.
 */
export function similarEntries(c: EntryCandidate, recent: readonly RecentEntry[], limit = 4, exclude: ReadonlySet<string> = new Set()): RecentEntry[] {
  if (c.direction === "transfer") return [];
  const party = normalizeName(c.counterparty);
  const words = tokens(c.title);
  const scored: { e: RecentEntry; score: number }[] = [];
  for (const e of recent) {
    if (e.id === c.id || exclude.has(e.id) || e.direction !== c.direction) continue;
    let score = 0;
    if (party && normalizeName(e.counterparty) === party) score += 5;
    if (words.size > 0) for (const w of tokens(e.title)) if (words.has(w)) score += 2;
    if (c.category && e.category === c.category) score += 1;
    if (score >= 2) scored.push({ e, score });
  }
  return scored
    .sort((a, b) => b.score - a.score || (a.e.date < b.e.date ? 1 : a.e.date > b.e.date ? -1 : 0))
    .slice(0, limit)
    .map((s) => s.e);
}

/**
 * Cariden kategori: bu cariye/karşı tarafa aynı yönde en sık kullanılan kategori (eşitlikte en yeni). Geçmiş yoksa null.
 * `allowed`: seçilebilir kategoriler (arşivlenmiş/yetkisiz kategori önerilmez).
 */
export function categoryFromHistory(
  counterparty: string | null | undefined,
  direction: "in" | "out" | "transfer",
  recent: readonly RecentEntry[],
  allowed: ReadonlySet<string>,
): { category: string; count: number } | null {
  const party = normalizeName(counterparty);
  if (!party || direction === "transfer") return null;
  const counts = new Map<string, { count: number; last: string }>();
  for (const e of recent) {
    if (e.direction !== direction || !e.category || !allowed.has(e.category)) continue;
    if (normalizeName(e.counterparty) !== party) continue;
    const cur = counts.get(e.category) ?? { count: 0, last: "" };
    counts.set(e.category, { count: cur.count + 1, last: e.date > cur.last ? e.date : cur.last });
  }
  let best: { category: string; count: number; last: string } | null = null;
  for (const [category, v] of counts) {
    if (!best || v.count > best.count || (v.count === best.count && v.last > best.last)) best = { category, ...v };
  }
  return best ? { category: best.category, count: best.count } : null;
}

// ---------------------------------------------------------------------------
// Toplu giriş (Excel / CSV yapıştırma)
// ---------------------------------------------------------------------------

export type BulkCategory = { value: string; label: string; direction: "in" | "out" };

export type BulkRow = {
  key: string;
  date: string;
  direction: "in" | "out";
  amountText: string;
  category: string;
  title: string;
  counterparty: string;
  vatRate: number | null;
};

export const BULK_MAX_ROWS = 100;

function splitDelimited(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"' && cur.trim() === "") {
      quoted = true;
      cur = "";
    } else if (ch === delimiter) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

/** Excel sekme ile, Türkçe CSV noktalı virgülle, İngilizce CSV virgülle ayırır. */
export function detectDelimiter(lines: readonly string[]): string {
  const sample = lines.slice(0, 5).join("\n");
  if (sample.includes("\t")) return "\t";
  if (sample.includes(";")) return ";";
  return ",";
}

/** "15.03.2026", "15/03/2026", "2026-03-15", "15.03.26" → "2026-03-15"; geçersizse null. */
export function parseDayCell(v: string): string | null {
  const s = v.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) return validDay(`${m[1]}-${m[2]!.padStart(2, "0")}-${m[3]!.padStart(2, "0")}`);
  m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})$/.exec(s);
  if (m) {
    const y = m[3]!.length === 2 ? `20${m[3]}` : m[3]!;
    return validDay(`${y}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}`);
  }
  return null;
}

const IN_CELL = new Set(["gelir", "giris", "tahsilat", "alacak", "+", "in"]);
const OUT_CELL = new Set(["gider", "cikis", "odeme", "borc", "-", "out", "harcama", "masraf"]);

function directionCell(v: string): "in" | "out" | null {
  const n = normalizeName(v) || v.trim();
  if (IN_CELL.has(n)) return "in";
  if (OUT_CELL.has(n)) return "out";
  return null;
}

/** Hücre tutar mı? Negatif tutar gider sayılır ("-1.250,00", "(1.250,00)"). */
function amountCell(v: string): { amount: number; negative: boolean } | null {
  const s = v.trim().replace(/\s+/g, "").toLocaleLowerCase("tr-TR").replace(/^₺/, "");
  const m = /^([-−+(]?)([\d.,]+)(k|b|bin|m|mn|milyon)?(tl|try|₺)?\)?$/.exec(s);
  if (!m) return null;
  const amount = parseAmountShorthand(`${m[2]}${m[3] ?? ""}`);
  return amount != null ? { amount, negative: m[1] === "-" || m[1] === "−" || m[1] === "(" } : null;
}

function vatCell(v: string): number | null {
  const m = /^%?\s*(\d{1,2})\s*%?$/.exec(v.trim());
  if (!m) return null;
  const n = Number(m[1]);
  return (LEDGER_VAT_RATES as readonly number[]).includes(n) ? n : null;
}

function categoryCell(v: string, categories: readonly BulkCategory[]): BulkCategory | null {
  const n = normalizeName(v);
  if (!n) return null;
  return categories.find((c) => normalizeName(c.label) === n || c.value === v.trim()) ?? null;
}

type Column = "date" | "direction" | "amount" | "category" | "title" | "counterparty" | "vat";

const HEADER_WORDS: readonly [Column, readonly string[]][] = [
  ["date", ["tarih", "date", "islem tarihi"]],
  ["direction", ["tur", "tip", "yon", "type"]],
  ["amount", ["tutar", "miktar", "amount", "toplam", "bedel"]],
  ["category", ["kategori", "ne icin", "category"]],
  ["title", ["aciklama", "baslik", "description", "detay"]],
  ["counterparty", ["cari", "karsi taraf", "kime", "kimden", "firma", "kisi"]],
  ["vat", ["kdv", "vat", "kdv orani"]],
];

function headerColumns(cells: readonly string[]): Column[] | null {
  const cols = cells.map((c) => {
    const n = normalizeName(c);
    return HEADER_WORDS.find(([, words]) => words.includes(n))?.[0] ?? null;
  });
  return cols.filter(Boolean).length >= 2 && cols.includes("amount") ? (cols as Column[]) : null;
}

/**
 * Yapıştırılan metni satırlara çevirir. Başlık satırı varsa (Tarih, Tutar, Açıklama…) sütunlar adla eşlenir; yoksa her hücre
 * türüne göre tanınır (tarih, tutar, yön, KDV, kategori; kalan ilk metin açıklama, ikincisi cari). Boş satırlar atlanır;
 * en çok `BULK_MAX_ROWS`. Doğrulama `validateBulkRow` ile ayrıca yapılır (satır başına hata).
 */
export function parseBulkPaste(
  text: string,
  opts: { categories: readonly BulkCategory[]; today: string; defaultDirection: "in" | "out"; keyPrefix?: string },
): BulkRow[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n").filter((l) => l.trim() !== "");
  if (lines.length === 0) return [];
  const delimiter = detectDelimiter(lines);
  const header: Column[] | null = headerColumns(splitDelimited(lines[0]!, delimiter));
  const body = header ? lines.slice(1) : lines;
  const rows: BulkRow[] = [];
  for (const line of body.slice(0, BULK_MAX_ROWS)) {
    const cells = splitDelimited(line, delimiter);
    const row: BulkRow = {
      key: `${opts.keyPrefix ?? "r"}${rows.length}`,
      date: opts.today,
      direction: opts.defaultDirection,
      amountText: "",
      category: "",
      title: "",
      counterparty: "",
      vatRate: null,
    };
    let explicitDirection = false;
    let negative = false;
    const texts: string[] = [];
    cells.forEach((cell, i) => {
      if (!cell) return;
      const col = header?.[i] ?? null;
      if (col) {
        if (col === "date") row.date = parseDayCell(cell) ?? cell;
        else if (col === "direction") {
          const d = directionCell(cell);
          if (d) {
            row.direction = d;
            explicitDirection = true;
          }
        } else if (col === "amount") {
          const a = amountCell(cell);
          row.amountText = a ? String(a.amount).replace(".", ",") : cell;
          negative = a?.negative ?? false;
        } else if (col === "category") {
          const c = categoryCell(cell, opts.categories);
          row.category = c?.value ?? "";
          if (c && !explicitDirection) row.direction = c.direction;
          if (!c) texts.push(cell);
        } else if (col === "title") row.title = cell.slice(0, 160);
        else if (col === "counterparty") row.counterparty = cell.slice(0, 120);
        else if (col === "vat") row.vatRate = vatCell(cell);
        return;
      }
      if (header) return;
      const day = parseDayCell(cell);
      if (day && row.date === opts.today) {
        row.date = day;
        return;
      }
      const d = directionCell(cell);
      if (d) {
        row.direction = d;
        explicitDirection = true;
        return;
      }
      const vat = /%/.test(cell) ? vatCell(cell) : null;
      if (vat != null) {
        row.vatRate = vat;
        return;
      }
      const a = !row.amountText ? amountCell(cell) : null;
      if (a) {
        row.amountText = String(a.amount).replace(".", ",");
        negative = a.negative;
        return;
      }
      const c = !row.category ? categoryCell(cell, opts.categories) : null;
      if (c) {
        row.category = c.value;
        if (!explicitDirection) row.direction = c.direction;
        return;
      }
      texts.push(cell);
    });
    if (negative && !explicitDirection) row.direction = "out";
    if (!row.title && texts[0]) row.title = texts[0].slice(0, 160);
    if (!row.counterparty && texts[1]) row.counterparty = texts[1].slice(0, 120);
    // Kategori yönle çelişiyorsa (ör. "Gelir" satırına gider kategorisi) temizlenir.
    if (row.category && !opts.categories.some((c) => c.value === row.category && c.direction === row.direction)) row.category = "";
    rows.push(row);
  }
  return rows;
}

export type BulkRowError = { field: "date" | "amount" | "category" | "title"; message: string };

/** Satır doğrulaması (sunucu kuralıyla aynı sınırlar; nihai karar RPC'de). */
export function validateBulkRow(row: BulkRow, today: string, categories: readonly BulkCategory[]): BulkRowError[] {
  const errors: BulkRowError[] = [];
  const amount = parseAmountShorthand(row.amountText);
  if (amount == null || amount <= 0 || amount > 9_999_999_999.99) errors.push({ field: "amount", message: "Geçerli bir tutar girin" });
  const day = validDay(row.date);
  if (!day) errors.push({ field: "date", message: "Tarih GG.AA.YYYY ya da YYYY-AA-GG olmalı" });
  else if (day > today) errors.push({ field: "date", message: "Tarih gelecekte olamaz" });
  else if (day < "2000-01-01") errors.push({ field: "date", message: "Tarih çok eski" });
  if (!row.category || !categories.some((c) => c.value === row.category && c.direction === row.direction)) {
    errors.push({ field: "category", message: "Kategori seçin" });
  }
  if (row.title.length > 160) errors.push({ field: "title", message: "Açıklama en çok 160 karakter" });
  return errors;
}

/** Toplu girişin toplamı (geçerli satırlar): gelir, gider, net ve geçerli satır sayısı. */
export function bulkTotals(rows: readonly BulkRow[], today: string, categories: readonly BulkCategory[]) {
  let income = 0;
  let expense = 0;
  let valid = 0;
  for (const r of rows) {
    if (validateBulkRow(r, today, categories).length > 0) continue;
    const a = parseAmountShorthand(r.amountText) ?? 0;
    valid++;
    if (r.direction === "in") income += a;
    else expense += a;
  }
  return { income: round2(income), expense: round2(expense), net: round2(income - expense), valid, invalid: rows.length - valid };
}

/** Boş toplu satır (bugün, varsayılan yön). */
export function emptyBulkRow(key: string, today: string, direction: "in" | "out"): BulkRow {
  return { key, date: today, direction, amountText: "", category: "", title: "", counterparty: "", vatRate: null };
}

/** Vadeli kayıt için varsayılan vade (gün eklenmiş). */
export function defaultDueDate(day: string, days = 30): string {
  return shiftDayKey(day, days);
}
