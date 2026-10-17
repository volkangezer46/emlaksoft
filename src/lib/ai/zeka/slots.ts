import { DAY_MS, trParts } from "@/lib/clock";
import { parseNlQuery, type NlGeo } from "@/lib/nl-search/parse";
import { ENTITY_DEFS, NOISE_WORDS, STATUS_WORDS, CREATE_CUES, DATA_CUES, HOWTO_CUES, NAV_CUES, REPORT_CUES } from "./lexicon";
import { cleanQuery, foldQuery, matchesLexeme, phraseIn, tokens } from "./normalize";
import type { ZekaEntity, ZekaPeriod, ZekaPeriodKey, ZekaSlots, ZekaStatus } from "./types";

/**
 * Yuva (slot) çıkarımı (SAF; saat `nowMs` ile verilir, test edilebilir).
 *  - Portföy yuvaları (oda, fiyat, işlem, tür, il/ilçe/mahalle) MEVCUT doğal dil ayrıştırıcısından gelir
 *    (`src/lib/nl-search/parse.ts`; "5 milyon altı" → 5.000.000, "2-4 milyon" → 2.000.000–4.000.000, tam TL).
 *  - Tarih/saat, telefon, portföy kodu, kişi adı, durum ve tutar burada çıkarılır. Tarih/saat ve telefon, fiyat sanılmasın
 *    diye nl-search'e gitmeden ÖNCE metinden ayıklanır.
 */

const MONTHS = ["ocak", "subat", "mart", "nisan", "mayis", "haziran", "temmuz", "agustos", "eylul", "ekim", "kasim", "aralik"];
const WEEKDAYS = ["pazar", "pazartesi", "sali", "carsamba", "persembe", "cuma", "cumartesi"];

const pad = (n: number) => String(n).padStart(2, "0");
const keyOf = (y: number, m: number, d: number) => {
  const dt = new Date(Date.UTC(y, m, d));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
};
const DAY_LABEL = new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "long", weekday: "long", timeZone: "UTC" });
function dayLabel(key: string): string {
  return DAY_LABEL.format(new Date(`${key}T00:00:00Z`));
}

/** TR takvimine göre dönem. Hafta pazartesi başlar. */
export function periodFor(key: ZekaPeriodKey, nowMs: number, dayKey?: string): ZekaPeriod {
  const p = trParts(nowMs);
  const today = keyOf(p.year, p.month, p.day);
  const shift = (n: number) => keyOf(p.year, p.month, p.day + n);
  const mondayOffset = (p.weekday + 6) % 7;
  switch (key) {
    case "today":
      return { key, from: today, to: today, label: "bugün" };
    case "tomorrow":
      return { key, from: shift(1), to: shift(1), label: "yarın" };
    case "yesterday":
      return { key, from: shift(-1), to: shift(-1), label: "dün" };
    case "this_week":
      return { key, from: shift(-mondayOffset), to: shift(6 - mondayOffset), label: "bu hafta" };
    case "next_week":
      return { key, from: shift(7 - mondayOffset), to: shift(13 - mondayOffset), label: "gelecek hafta" };
    case "last_week":
      return { key, from: shift(-mondayOffset - 7), to: shift(-mondayOffset - 1), label: "geçen hafta" };
    case "this_month":
      return { key, from: keyOf(p.year, p.month, 1), to: keyOf(p.year, p.month + 1, 0), label: "bu ay" };
    case "last_month":
      return { key, from: keyOf(p.year, p.month - 1, 1), to: keyOf(p.year, p.month, 0), label: "geçen ay" };
    case "this_year":
      return { key, from: keyOf(p.year, 0, 1), to: keyOf(p.year, 11, 31), label: "bu yıl" };
    case "last_year":
      return { key, from: keyOf(p.year - 1, 0, 1), to: keyOf(p.year - 1, 11, 31), label: "geçen yıl" };
    case "day": {
      const d = dayKey ?? today;
      return { key, from: d, to: d, label: dayLabel(d) };
    }
  }
}

type DateHit = { date: string | null; time: string | null; period: ZekaPeriod | null; text: string };

/** Tarih/saat ifadelerini bulur ve metinden çıkarır (katlanmış metin üzerinde). */
export function extractDateTime(folded: string, nowMs: number): DateHit {
  let t = ` ${folded} `;
  let date: string | null = null;
  let time: string | null = null;
  let period: ZekaPeriod | null = null;
  const p = trParts(nowMs);
  const cut = (re: RegExp) => {
    t = t.replace(re, " ");
  };

  // Saat: 14:00, 14.30, saat 3, öğleden sonra 3, akşam 7
  // "14:00" her zaman saattir; noktalı biçim ("14.30") yalnız "saat" ile ya da çeyrek dakikalarda (03.11 bir tarihtir).
  const hmColon = /(?<![\d.])([01]?\d|2[0-3]):([0-5]\d)(?![\d.])/.exec(t);
  const hmDot = /(?<![\d.])([01]?\d|2[0-3])\.([0-5]\d)(?![\d.])/.exec(t);
  const hm = hmColon ?? (hmDot && (/saat\s*$/.test(t.slice(0, hmDot.index)) || ["00", "15", "30", "45"].includes(hmDot[2]!)) ? hmDot : null);
  if (hm) {
    time = `${pad(Number(hm[1]))}:${hm[2]}`;
    cut(new RegExp(hm[0].replace(".", "\\.")));
  } else {
    const sm = /\b(ogleden sonra|aksam|sabah|ogle)?\s*saat\s*(\d{1,2})(?:\s*(?:de|da|te|ta|'?te|'?de))?\b/.exec(t) ?? /\b(ogleden sonra|aksam)\s+(\d{1,2})\b/.exec(t);
    if (sm) {
      let h = Number(sm[2]);
      if ((sm[1] === "ogleden sonra" || sm[1] === "aksam") && h < 12) h += 12;
      else if (!sm[1] && h >= 1 && h <= 7) h += 12; // "saat 3" mesai içinde öğleden sonra kabul edilir
      if (h <= 23) {
        time = `${pad(h)}:00`;
        cut(new RegExp(sm[0]));
      }
    }
  }

  // Göreli günler
  const rel: [RegExp, ZekaPeriodKey][] = [
    [/\b(obur gun|ertesi gun)\b/, "day"],
    [/\byarin\w*/, "tomorrow"],
    [/\bbugun\w*/, "today"],
    [/\bdun\w*/, "yesterday"],
    [/\b(bu hafta\w*|haftaici)\b/, "this_week"],
    [/\b(gelecek hafta\w*|haftaya|onumuzdeki hafta\w*)\b/, "next_week"],
    [/\b(gecen hafta\w*|onceki hafta\w*)\b/, "last_week"],
    [/\b(bu ay\w*)\b/, "this_month"],
    [/\b(gecen ay\w*|onceki ay\w*)\b/, "last_month"],
    [/\b(bu yil\w*|bu sene\w*)\b/, "this_year"],
    [/\b(gecen yil\w*|gecen sene\w*)\b/, "last_year"],
  ];
  for (const [re, key] of rel) {
    if (!re.test(t)) continue;
    if (key === "day") {
      const d = keyOf(p.year, p.month, p.day + 2);
      period = periodFor("day", nowMs, d);
      date = d;
    } else {
      period = periodFor(key, nowMs);
      if (key === "tomorrow" || key === "today" || key === "yesterday") date = period.from;
    }
    cut(re);
    break;
  }

  // 15 kasım, 3 aralık 2026
  if (!date) {
    const mm = new RegExp(String.raw`\b(\d{1,2})\s+(${MONTHS.join("|")})\w*(?:\s+(\d{4}))?\b`).exec(t);
    if (mm) {
      const d = Number(mm[1]);
      const m = MONTHS.indexOf(mm[2]!);
      const y = mm[3] ? Number(mm[3]) : p.year;
      if (d >= 1 && d <= 31) {
        date = keyOf(y, m, d);
        period = periodFor("day", nowMs, date);
        cut(new RegExp(mm[0]));
      }
    }
  }
  // 15.11 / 15.11.2026 / 15/11
  if (!date) {
    const dm = /(?<![\d.])(\d{1,2})[./](\d{1,2})(?:[./](\d{4}))?(?![\d.])/.exec(t);
    if (dm) {
      const d = Number(dm[1]);
      const m = Number(dm[2]) - 1;
      if (d >= 1 && d <= 31 && m >= 0 && m <= 11) {
        date = keyOf(dm[3] ? Number(dm[3]) : p.year, m, d);
        period = periodFor("day", nowMs, date);
        cut(new RegExp(dm[0].replace(/[./]/g, (c) => `\\${c}`)));
      }
    }
  }
  // Hafta günü: "cuma", "pazartesi günü" → en yakın gelecek gün
  if (!date) {
    const wd = new RegExp(String.raw`\b(${[...WEEKDAYS].sort((a, b) => b.length - a.length).join("|")})\w*\b`).exec(t);
    if (wd) {
      const target = WEEKDAYS.indexOf(wd[1]!);
      let delta = (target - p.weekday + 7) % 7;
      if (delta === 0) delta = 7;
      date = keyOf(p.year, p.month, p.day + delta);
      period = periodFor("day", nowMs, date);
      cut(new RegExp(wd[0]));
    }
  }
  return { date, time, period, text: t.replace(/\s+/g, " ").trim() };
}

/** TR cep/sabit numarası (rakamlar; 0 ile, 11 hane). */
export function extractPhone(folded: string): { phone: string | null; text: string } {
  const m = /(?:\+?90[\s-]?)?\(?0?\s*([2-5]\d{2})\)?[\s-]?(\d{3})[\s-]?(\d{2})[\s-]?(\d{2})(?!\d)/.exec(folded);
  if (!m) return { phone: null, text: folded };
  return { phone: `0${m[1]}${m[2]}${m[3]}${m[4]}`, text: folded.replace(m[0], " ") };
}

/** Portföy kodu: "ORNEK-012", "P-1023", "kod 4512", "#4512", "ilan no 123456". */
export function extractListingCode(raw: string): { code: string | null } {
  const explicit = /(?:\bkod(?:u)?|\bilan\s*no|\bportf[oö]y\s*kodu|#)\s*:?\s*([A-Za-z0-9-]{3,20})/i.exec(raw);
  if (explicit) return { code: explicit[1]!.toUpperCase() };
  const shaped = /\b([A-Za-zÇĞİÖŞÜçğıöşü]{1,6}-\d{2,8})\b/.exec(raw);
  return { code: shaped ? shaped[1]!.toLocaleUpperCase("tr-TR") : null };
}

/** Tutar ("5000 TL", "₺12.500", "3 bin lira") — yalnız fiyat dışı bağlam (gelir/gider) için. Tam TL. */
export function extractAmount(folded: string): number | null {
  const m = /(?:₺\s*)?(\d{1,3}(?:[.\s]\d{3})+|\d+(?:,\d+)?)\s*(milyon|bin)?\s*(tl|lira|try)?\b/.exec(folded);
  if (!m || (!m[2] && !m[3] && !folded.includes("₺"))) return null;
  const base = Number(m[1]!.replace(/[.\s]/g, "").replace(",", "."));
  if (!Number.isFinite(base)) return null;
  const mult = m[2] === "milyon" ? 1_000_000 : m[2] === "bin" ? 1_000 : 1;
  return Math.round(base * mult);
}

/** Bağlam sözcükleri: kişi adı sanılmaz. */
function isLexicalWord(t: string): boolean {
  if (NOISE_WORDS.has(t)) return true;
  if (ENTITY_DEFS.some((e) => e.synonyms.some((s) => !s.includes(" ") && matchesLexeme(t, s)))) return true;
  const cues = [...CREATE_CUES, ...DATA_CUES, ...HOWTO_CUES, ...NAV_CUES, ...REPORT_CUES].filter((c) => !c.includes(" "));
  if (cues.some((c) => matchesLexeme(t, c))) return true;
  if (STATUS_WORDS.some((s) => s.words.some((w) => !w.includes(" ") && matchesLexeme(t, w)))) return true;
  return MONTHS.includes(t) || WEEKDAYS.some((w) => t.startsWith(w));
}

/**
 * Kişi adı: (1) "… için / ile / adlı / isimli" öncesindeki 1-3 sözcük, (2) özgün metinde Büyük Harfle başlayan ardışık
 * 2-3 sözcük. Sözlük sözcükleri ve bilinen yer adları ad sayılmaz. Bulunan ad özgün yazımıyla döner.
 */
export function extractPersonName(raw: string, placeWords: ReadonlySet<string> = new Set()): string | null {
  const words = cleanQuery(raw).replace(/[,;!?()"]/g, " ").split(/\s+/).filter(Boolean);
  const foldedWords = words.map((w) => foldQuery(w).replace(/'.*/, ""));
  const ok = (i: number) => {
    const f = foldedWords[i] ?? "";
    return /^[a-z]{2,}$/.test(f) && !isLexicalWord(f) && !placeWords.has(f);
  };
  const strip = (w: string) => w.replace(/['’][\p{L}]*$/u, "");
  const markerIdx = foldedWords.findIndex((w) => ["icin", "ile", "adli", "isimli", "adinda", "isminde"].includes(w));
  if (markerIdx > 0) {
    const picked: string[] = [];
    for (let i = markerIdx - 1; i >= 0 && picked.length < 3 && ok(i); i -= 1) picked.unshift(strip(words[i]!));
    if (picked.length > 0) return picked.join(" ");
  }
  // Kesme işaretli ad: "Ahmet Yılmaz'a", "Ayşe'nin"
  for (let i = 0; i < words.length; i += 1) {
    const w = words[i]!;
    if (/^\p{Lu}/u.test(w) && /['’]/.test(w)) {
      const picked = [strip(w)];
      if (i > 0 && /^\p{Lu}/u.test(words[i - 1]!) && ok(i - 1)) picked.unshift(words[i - 1]!);
      if (ok(i) || picked.length > 1) return picked.join(" ");
    }
  }
  for (let i = 0; i < words.length; i += 1) {
    if (!/^\p{Lu}/u.test(words[i]!) || !ok(i)) continue;
    const picked = [strip(words[i]!)];
    for (let j = i + 1; j < words.length && picked.length < 3 && /^\p{Lu}/u.test(words[j]!) && ok(j); j += 1) picked.push(strip(words[j]!));
    if (picked.length >= 2) return picked.join(" ");
  }
  return null;
}

/** Varlıklar (sorgudaki sırayla, tekil). */
/** İşlem türü sözcükleri ("kiralık", "satılık") varlık değildir: portföy süzgecidir (kira/satış varlığına sayılmaz). */
const TRANSACTION_TOKEN = /^(kiralik|satilik)/;

export function detectEntities(rawToks: readonly string[]): ZekaEntity[] {
  const toks = rawToks.map((t) => (TRANSACTION_TOKEN.test(t) ? "\u0001" : t));
  const found: { id: ZekaEntity; at: number }[] = [];
  for (const def of ENTITY_DEFS) {
    let at = -1;
    for (const syn of def.synonyms) {
      const words = syn.split(" ");
      for (let i = 0; i + words.length <= toks.length; i += 1) {
        if (words.every((w, j) => matchesLexeme(toks[i + j]!, w))) {
          at = at === -1 ? i : Math.min(at, i);
          break;
        }
      }
    }
    if (at >= 0) found.push({ id: def.id, at });
  }
  return found.sort((a, b) => a.at - b.at).map((f) => f.id);
}

export function detectStatus(toks: readonly string[]): ZekaStatus | null {
  for (const s of STATUS_WORDS) if (s.words.some((w) => phraseIn(toks, w))) return s.status;
  return null;
}

/**
 * Tüm yuvalar. `geo`: il/ilçe listeleri (sunucuda önbellekli `loadNlProvincesAndDistricts`; testte küçük liste).
 */
export function extractSlots(raw: string, opts: { nowMs: number; geo?: NlGeo }): ZekaSlots {
  const clean = cleanQuery(raw);
  const folded = foldQuery(clean);
  const dt = extractDateTime(folded, opts.nowMs);
  const ph = extractPhone(dt.text);
  const code = extractListingCode(clean).code;
  const toks = tokens(folded);
  const entities = detectEntities(toks);
  let entity = entities[0] ?? null;
  const status = detectStatus(toks);

  // Portföy yuvaları: tarih/saat/telefon ayıklanmış metinle (sayılar fiyat sanılmasın).
  const nl = parseNlQuery(ph.text, opts.geo ?? { provinces: [], districts: [] });
  const chips = new Map(nl.chips.map((c) => [c.group, c]));
  const placeChip = chips.get("mahalle") ?? chips.get("ilce") ?? chips.get("il") ?? null;
  const placeWords = new Set<string>();
  if (placeChip) for (const w of foldQuery(placeChip.label).split(/[\s()]+/)) if (w) placeWords.add(w);

  const amount = entity === "finance" || entity === "dues" || entity === "commission" ? extractAmount(folded) : null;
  const personName = extractPersonName(clean, placeWords);
  const nameWords = new Set((personName ? foldQuery(personName).split(" ") : []).filter(Boolean));

  const freeText = tokens(ph.text)
    .filter((t) => !isLexicalWord(t) && !placeWords.has(t) && !/^[\d+.,:/-]+$/.test(t) && !nl.chips.some((c) => foldQuery(c.label).includes(t)))
    .join(" ")
    .slice(0, 80);

  const propertyParams: Record<string, string> = {};
  for (const [k, v] of Object.entries(nl.filters)) if (v) propertyParams[k] = v;
  // Varlık adı geçmeden yalnız portföy süzgeci yazıldıysa ("Beşiktaş kiralık 2+1") varlık portföydür.
  if (entity === null && Object.keys(propertyParams).length > 0) {
    entity = "property";
    entities.unshift("property");
  }
  // "satış" bir anlaşma sözcüğüdür; yalnız portföy bağlamında işlem türü sayılır.
  if (entity !== "property" && entity !== null) delete propertyParams.islem;

  return {
    entity,
    entities,
    status,
    rooms: nl.filters.oda ? nl.filters.oda.split(",") : [],
    priceMin: nl.filters.fiyat_min ? Number(nl.filters.fiyat_min) : null,
    priceMax: nl.filters.fiyat_max ? Number(nl.filters.fiyat_max) : null,
    transaction: propertyParams.islem === "Satılık" || propertyParams.islem === "Kiralık" ? propertyParams.islem : null,
    propertyType: nl.filters.kategori ?? null,
    provinceId: nl.provinceId,
    districtId: nl.filters.ilce ?? null,
    neighborhoodId: nl.filters.mahalle ?? null,
    placeLabel: placeChip?.label ?? null,
    propertyParams,
    date: dt.date,
    time: dt.time,
    period: dt.period,
    personName,
    phone: ph.phone,
    listingCode: code,
    amount,
    freeText: nameWords.size > 0 ? freeText.split(" ").filter((w) => !nameWords.has(w)).join(" ") : freeText,
  };
}

/** Dönemin ISO aralığı (TR yarı açık: [from 00:00, to+1 00:00) ). */
export function periodIsoRange(period: ZekaPeriod): { fromIso: string; toIso: string } {
  const start = Date.parse(`${period.from}T00:00:00+03:00`);
  const end = Date.parse(`${period.to}T00:00:00+03:00`) + DAY_MS;
  return { fromIso: new Date(start).toISOString(), toIso: new Date(end).toISOString() };
}
