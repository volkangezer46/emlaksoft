/**
 * Tek satır akıllı giriş ayrıştırıcısı (SAF; dış servis, LLM, saat yok).
 *
 *   "gider 4.500 portal sahibinden"      → { direction: "out", amount: 4500, category: "portal", title: "sahibinden" }
 *   "+ 48000 komisyon Ahmet Yılmaz"      → { direction: "in", amount: 48000, category: "komisyon", partyName: "Ahmet Yılmaz" }
 *   "1,2m kira"                          → { direction: "out", amount: 1200000, category: "kira" }
 *   "kira tahsilatı 25k Ayşe Kaya vadeli" → { direction: "in", category: "kira_tahsilat", partyName: "Ayşe Kaya", deferred: true }
 *
 * Kurallar: yön önce açık sözcükten ("gelir", "gider", "+", "-", "transfer"), yoksa kategorinin yönünden gelir.
 * Büyük harfle başlayan ardışık sözcükler cari (kişi/firma) adıdır; kalan sözcükler açıklamadır. Tahmin edilemeyen alan
 * `null` kalır (uydurma yok); pencere yalnız dolu alanları önceden doldurur.
 */
import { AMOUNT_SUFFIX_PATTERN, parseAmountShorthand } from "./amount-shorthand";
import { LEDGER_VAT_RATES } from "./ledger/vat";

/** Yalnız penceredeki KDV çiplerinin karşılığı olan oranlar kabul edilir (ör. "%18" oran sayılmaz, açıklamada kalır). */
const VAT_RATES = new Set<number>(LEDGER_VAT_RATES);

export type SmartDirection = "in" | "out" | "transfer";

/** Ayrıştırıcının tanıdığı kategori (sistem `CASH_CATEGORIES` + ofisin kendi kategorileri). */
export type SmartCategory = { value: string; label: string; direction: "in" | "out" };

export type SmartEntry = {
  direction: SmartDirection | null;
  amount: number | null;
  category: string | null;
  partyName: string | null;
  title: string | null;
  /** "%20", "kdv 10" → 20 / 10. */
  vatRate: number | null;
  /** "kdv dahil" → true, "kdv hariç" / "+kdv" → false. */
  vatIncluded: boolean | null;
  /** "vadeli", "vade 30", "30 gün vadeli": ödenmedi, açık kalem olarak açılır. */
  deferred: boolean;
  /** "vade 30" / "30 gün" → 30. */
  dueInDays: number | null;
  /** "dün" → -1, "bugün" → 0 (tarih alanı bu kayma ile kurulur). */
  dayOffset: number | null;
};

const IN_WORDS = new Set(["gelir", "tahsilat", "tahsil", "aldım", "alındı", "giriş", "gelen"]);
const OUT_WORDS = new Set(["gider", "ödeme", "ödedim", "ödendi", "harcama", "masraf", "çıkış", "giden"]);
const TRANSFER_WORDS = new Set(["transfer", "virman", "aktarım", "aktar"]);
const FILLER = new Set(["için", "ile", "olarak", "tl", "₺", "try", "lira", "ve", "de", "da"]);

/**
 * Sistem kategorilerinin eş anlamlıları (küçük harf, tr-TR). Çok sözcüklüler önce denenir.
 * `in`/`out`: sözcük yalnız o yönde bu kategoriye gider (ör. "kira" girişte kira tahsilatıdır).
 */
const SYNONYMS: readonly { words: string; value: string; when?: "in" | "out" }[] = [
  { words: "kira tahsilatı", value: "kira_tahsilat" },
  { words: "kira tahsilat", value: "kira_tahsilat" },
  { words: "aidat tahsilatı", value: "aidat_tahsilat" },
  { words: "aidat tahsilat", value: "aidat_tahsilat" },
  { words: "kira yönetimi", value: "kira_yonetimi" },
  { words: "aidat yönetimi", value: "aidat_yonetimi" },
  { words: "hizmet bedeli", value: "hizmet_bedeli" },
  { words: "portal üyeliği", value: "portal" },
  { words: "ofis gideri", value: "ofis" },
  { words: "diğer gelir", value: "diger_gelir" },
  { words: "diğer gider", value: "diger_gider" },
  { words: "kira", value: "kira_tahsilat", when: "in" },
  { words: "kira", value: "kira", when: "out" },
  { words: "aidat", value: "aidat_tahsilat", when: "in" },
  { words: "aidat", value: "aidat", when: "out" },
  { words: "komisyon", value: "komisyon" },
  { words: "hizmet", value: "hizmet_bedeli" },
  { words: "maaş", value: "maas" },
  { words: "maas", value: "maas" },
  { words: "sgk", value: "sgk" },
  { words: "muhasebe", value: "muhasebe" },
  { words: "muhasebeci", value: "muhasebe" },
  { words: "portal", value: "portal" },
  { words: "ilan", value: "portal" },
  { words: "reklam", value: "reklam" },
  { words: "ulaşım", value: "ulasim" },
  { words: "yakıt", value: "ulasim" },
  { words: "benzin", value: "ulasim" },
  { words: "taksi", value: "ulasim" },
  { words: "ofis", value: "ofis" },
  { words: "kırtasiye", value: "ofis" },
];

const lower = (s: string) => s.toLocaleLowerCase("tr-TR");
const AMOUNT_TOKEN = new RegExp(`^\\d[\\d.,]*(${AMOUNT_SUFFIX_PATTERN})?(₺|tl)?$`, "i");
const SUFFIX_TOKEN = new RegExp(`^(${AMOUNT_SUFFIX_PATTERN})$`, "i");

function emptyEntry(): SmartEntry {
  return { direction: null, amount: null, category: null, partyName: null, title: null, vatRate: null, vatIncluded: null, deferred: false, dueInDays: null, dayOffset: null };
}

/** Tek satırı ayrıştırır. `categories`: tanınan kategoriler (yönleri buradan gelir); ofis kategorileri etiketle eşleşir. */
export function parseSmartEntry(text: string, categories: readonly SmartCategory[]): SmartEntry {
  const out = emptyEntry();
  let src = String(text ?? "").trim().slice(0, 300);
  if (!src) return out;

  // Baştaki işaret: "+ 48000" gelir, "- 4500" gider.
  const sign = /^([+-])\s*/.exec(src);
  if (sign) {
    out.direction = sign[1] === "+" ? "in" : "out";
    src = src.slice(sign[0].length);
  }

  const tokens = src.split(/\s+/).filter(Boolean);
  const used = new Array<boolean>(tokens.length).fill(false);
  const low = tokens.map(lower);

  // KDV: "%20", "kdv 20", "kdv %10", "kdv dahil/hariç", "+kdv".
  for (let i = 0; i < tokens.length; i++) {
    const t = low[i]!;
    const pct = /^%(\d{1,2})$/.exec(t) ?? /^(\d{1,2})%$/.exec(t);
    if (pct && VAT_RATES.has(Number(pct[1]))) {
      out.vatRate = Number(pct[1]);
      used[i] = true;
      continue;
    }
    if (t === "+kdv") {
      out.vatIncluded = false;
      used[i] = true;
      continue;
    }
    if (t === "kdv") {
      used[i] = true;
      const next = low[i + 1];
      const rate = next ? /^%?(\d{1,2})%?$/.exec(next) : null;
      if (rate) {
        // "kdv 18" gibi çipte olmayan oran sayılmaz; sayı tutar diye de okunmasın diye tüketilir.
        if (VAT_RATES.has(Number(rate[1]))) out.vatRate = Number(rate[1]);
        used[i + 1] = true;
      } else if (next === "dahil") {
        out.vatIncluded = true;
        used[i + 1] = true;
      } else if (next === "hariç" || next === "haric") {
        out.vatIncluded = false;
        used[i + 1] = true;
      }
    }
  }

  // Vade ve gün: "vadeli", "vade 30", "30 gün vadeli", "dün", "bugün".
  for (let i = 0; i < tokens.length; i++) {
    if (used[i]) continue;
    const t = low[i]!;
    if (t === "vadeli" || t === "vade" || t === "veresiye") {
      out.deferred = true;
      used[i] = true;
      const next = low[i + 1];
      if (t === "vade" && next && /^\d{1,3}$/.test(next)) {
        out.dueInDays = Number(next);
        used[i + 1] = true;
        if (low[i + 2] === "gün") used[i + 2] = true;
      }
    } else if (/^\d{1,3}$/.test(t) && low[i + 1] === "gün") {
      out.dueInDays = Number(t);
      out.deferred = true;
      used[i] = used[i + 1] = true;
    } else if (t === "dün") {
      out.dayOffset = -1;
      used[i] = true;
    } else if (t === "bugün") {
      out.dayOffset = 0;
      used[i] = true;
    }
  }

  // Yön sözcüğü (ilk eşleşen).
  for (let i = 0; i < tokens.length; i++) {
    if (used[i]) continue;
    const t = low[i]!;
    const dir: SmartDirection | null = TRANSFER_WORDS.has(t) ? "transfer" : IN_WORDS.has(t) ? "in" : OUT_WORDS.has(t) ? "out" : null;
    if (!dir) continue;
    // "kira tahsilatı" gibi kategori ifadesinin parçası olan "tahsilat" yön sözcüğü olarak tüketilmez.
    if (t === "tahsilat" && i > 0 && (low[i - 1] === "kira" || low[i - 1] === "aidat")) continue;
    out.direction ??= dir;
    used[i] = true;
  }

  // Tutar: ilk sayı token'ı (+ ayrı yazılmış "bin"/"milyon"/"k" son eki).
  for (let i = 0; i < tokens.length; i++) {
    if (used[i] || !AMOUNT_TOKEN.test(tokens[i]!)) continue;
    let raw = tokens[i]!;
    const next = tokens[i + 1];
    if (next && SUFFIX_TOKEN.test(next)) {
      raw = `${raw}${next}`;
      used[i + 1] = true;
    }
    const amount = parseAmountShorthand(raw);
    if (amount != null) {
      out.amount = amount;
      used[i] = true;
      break;
    }
  }

  // Kategori: ofis kategorisi etiketi (tam ifade) > çok sözcüklü eş anlamlı > tek sözcük.
  const known = new Map(categories.map((c) => [c.value, c]));
  const fits = (value: string) => {
    const c = known.get(value);
    if (!c) return false;
    return out.direction == null || out.direction === "transfer" || c.direction === out.direction;
  };
  const tryPhrase = (phrase: string, value: string): boolean => {
    const words = lower(phrase).split(/\s+/);
    for (let i = 0; i + words.length <= tokens.length; i++) {
      if (words.every((w, j) => !used[i + j] && (low[i + j] === w || (j === words.length - 1 && low[i + j]!.startsWith(w) && low[i + j]!.length - w.length <= 3)))) {
        if (!fits(value)) return false;
        for (let j = 0; j < words.length; j++) used[i + j] = true;
        out.category = value;
        return true;
      }
    }
    return false;
  };
  const custom = categories.filter((c) => c.value.startsWith("x_")).sort((a, b) => b.label.length - a.label.length);
  for (const c of custom) if (tryPhrase(c.label, c.value)) break;
  if (!out.category) {
    for (const s of SYNONYMS) {
      if (s.when && out.direction && out.direction !== s.when) continue;
      if (s.when && !out.direction && s.when === "in") continue; // yön yokken "kira" gider sayılır
      if (tryPhrase(s.words, s.value)) break;
    }
  }
  if (out.category && (out.direction == null || out.direction === "transfer")) {
    const dir = known.get(out.category)?.direction ?? null;
    if (out.direction == null) out.direction = dir;
  }

  // Kalan sözcükler: büyük harfle başlayan ardışık sözcükler cari adı, gerisi açıklama.
  const rest: { word: string; party: boolean }[] = [];
  for (let i = 0; i < tokens.length; i++) {
    if (used[i]) continue;
    const word = tokens[i]!;
    if (FILLER.has(low[i]!)) continue;
    rest.push({ word, party: /^\p{Lu}/u.test(word) });
  }
  // İlk büyük harfli ardışık blok cari adıdır (ör. "Ahmet Yılmaz", "Sahibinden A.Ş.").
  const start = rest.findIndex((r) => r.party);
  if (start >= 0) {
    let end = start;
    while (end + 1 < rest.length && rest[end + 1]!.party) end++;
    out.partyName = rest.slice(start, end + 1).map((r) => r.word).join(" ").slice(0, 120);
    rest.splice(start, end - start + 1);
  }
  const title = rest.map((r) => r.word).join(" ").trim();
  out.title = title ? title.slice(0, 160) : null;
  return out;
}

/** "YYYY-MM-DD" gününe gün ekler (saf takvim hesabı; saat dilimi ve saat yok). Geçersiz girişte gün aynen döner. */
export function shiftDayKey(day: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m || !Number.isFinite(days)) return day;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + Math.trunc(days)));
  return `${String(d.getUTCFullYear()).padStart(4, "0")}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

/** Ayrıştırmadan en az bir alan çıktı mı (pencere önizlemesi "anlaşıldı" çiplerini yalnız o zaman gösterir). */
export function hasSmartSignal(e: SmartEntry): boolean {
  return e.amount != null || e.category != null || e.direction != null || e.partyName != null || e.deferred || e.vatRate != null;
}
