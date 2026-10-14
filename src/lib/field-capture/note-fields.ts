import { DAY_MS, TR_OFFSET_MS, trDayStartMs, trParts } from "@/lib/clock";
import { formatMoneyShort, parseNlQuery, type NlGeo } from "@/lib/nl-search/parse";
import { foldTr } from "@/lib/tr-text";

/**
 * Sahadan not / sesli not dökümünden YAPILANDIRILMIŞ alan önerisi — KURAL TABANLI, saf fonksiyon.
 *
 * "iki artı bir, 3 milyon bütçe, Kadıköy, cuma 3'te yer gösterme, yarın tekrar ara" →
 *   oda 2+1 · bütçe ≤ 3.000.000 · bölge Kadıköy · randevu cuma 15:00 · sonraki görev "Yarın tekrar ara" (yarın 09:00).
 *
 * Oda / bütçe / bölge çıkarımı doğal dilli arama ayrıştırıcısıyla AYNI kurallardır (`parseNlQuery`; konum listeleri
 * dışarıdan verilir, burası veritabanına dokunmaz). Önce konuşma dilindeki sayılar rakama çevrilir ("iki artı bir" → 2+1,
 * "üç buçuk milyon" → 3 buçuk milyon). Tarih/saat Türkiye saatiyle hesaplanır; saat söylenmediyse ya da "saat 3" gibi
 * belirsizse öneri `assumed` taşır ve ekranda "varsayım" diye görünür. Hiçbir öneri kendiliğinden uygulanmaz: kullanıcı
 * tek tek onaylar. Anlaşılmayan şey uydurulmaz (alan boş kalır).
 */

export type NoteRegion = {
  provinceId: string | null;
  provinceName: string | null;
  districtId: string | null;
  districtName: string | null;
  neighborhoodId: string | null;
  neighborhoodName: string | null;
  label: string;
};

export type NoteWhen = { iso: string; label: string; assumed: boolean };

export type NoteFieldSuggestions = {
  rooms: string | null;
  budgetMin: number | null;
  budgetMax: number | null;
  budgetLabel: string | null;
  region: NoteRegion | null;
  appointment: NoteWhen | null;
  nextTask: { title: string; due: NoteWhen | null } | null;
  /** Önerilerin kaynağı: kural tabanlı, ya da AI eksikleri tamamladı. */
  source: "kural" | "kural+ai";
};

export const EMPTY_NOTE_FIELDS: NoteFieldSuggestions = {
  rooms: null,
  budgetMin: null,
  budgetMax: null,
  budgetLabel: null,
  region: null,
  appointment: null,
  nextTask: null,
  source: "kural",
};

export function hasNoteFields(s: NoteFieldSuggestions | null | undefined): boolean {
  return Boolean(s && (s.rooms || s.budgetMax != null || s.budgetMin != null || s.region || s.appointment || s.nextTask));
}

// ---------------------------------------------------------------------------
// Konuşma dilindeki sayılar
// ---------------------------------------------------------------------------

const UNITS: Record<string, number> = {
  sifir: 0, bir: 1, iki: 2, uc: 3, dort: 4, bes: 5, alti: 6, yedi: 7, sekiz: 8, dokuz: 9,
};
const TENS: Record<string, number> = {
  on: 10, yirmi: 20, otuz: 30, kirk: 40, elli: 50, altmis: 60, yetmis: 70, seksen: 80, doksan: 90,
};
/** Sayı sözcüğü dizisinin rakama çevrilmesi için ARDINDAN gelmesi gereken bağlam (yanlış "bir ev" → "1 ev" olmasın). */
const NUMBER_CONTEXT_AFTER = /^\s*(?:arti|\+|milyon|milyar|bin|bucuk|tl|lira|metre|m2|metrekare|kat|oda|gun|hafta)/;
const NUMBER_CONTEXT_BEFORE = /(?:saat|ayin|\d\s+arti|\d\s*\+)\s*$/;

/** Katlanmış metinde sayı sözcüğü dizilerini rakama çevirir ("uc yuz elli bin" → "350 bin", "iki arti bir" → "2+1"). */
export function normalizeSpokenNumbers(folded: string): string {
  // "saat ucte" / "saat on birde" → "saat uc te" (ek ayrılır ki sayı sözcüğü tanınsın)
  const split = folded
    .replace(/([,;!?]|\.(?!\d))/g, " $1 ")
    .replace(/\b(saat\s+(?:on\s+)?)(bir|iki|uc|dort|bes|alti|yedi|sekiz|dokuz|on)'?(te|ta|de|da)\b/g, "$1$2 $3")
    .trim();
  const words = split.split(/\s+/);
  const out: string[] = [];
  let i = 0;
  while (i < words.length) {
    const w = words[i];
    if (!(w in UNITS || w in TENS || w === "yuz")) {
      out.push(w);
      i += 1;
      continue;
    }
    // Sayı dizisi: [birim] yüz · [onlar] · [birim]  ("uc yuz elli" = 350, "yirmi bes" = 25)
    let j = i;
    let total = 0;
    let consumed = false;
    if (words[j] in UNITS && words[j + 1] === "yuz") {
      total += UNITS[words[j]] * 100;
      j += 2;
      consumed = true;
    } else if (words[j] === "yuz") {
      total += 100;
      j += 1;
      consumed = true;
    }
    if (words[j] in TENS) {
      total += TENS[words[j]];
      j += 1;
      consumed = true;
    }
    if (words[j] in UNITS && !(consumed && UNITS[words[j]] === 0)) {
      total += UNITS[words[j]];
      j += 1;
      consumed = true;
    }
    const rest = words.slice(j).join(" ");
    const before = out.join(" ");
    if (consumed && (NUMBER_CONTEXT_AFTER.test(rest) || NUMBER_CONTEXT_BEFORE.test(before))) {
      out.push(String(total));
      i = j;
    } else {
      out.push(w);
      i += 1;
    }
  }
  return out
    .join(" ")
    .replace(/(\d)\s+arti\s+(\d)/g, "$1+$2")
    .replace(/(\d)\s*\+\s*(\d)/g, "$1+$2");
}

// ---------------------------------------------------------------------------
// Tarih / saat (Türkiye saati)
// ---------------------------------------------------------------------------

const MONTHS = ["ocak", "subat", "mart", "nisan", "mayis", "haziran", "temmuz", "agustos", "eylul", "ekim", "kasim", "aralik"];
const DAY_TAIL = String.raw`(?:\s+gunu)?(?:ya|ye|a|e|da|de|dan|den)?\b`;
const WEEKDAYS: [RegExp, number][] = [
  [new RegExp(String.raw`\bpazartesi${DAY_TAIL}`), 1],
  [new RegExp(String.raw`\bsali${DAY_TAIL}`), 2],
  [new RegExp(String.raw`\bcarsamba${DAY_TAIL}`), 3],
  [new RegExp(String.raw`\bpersembe${DAY_TAIL}`), 4],
  [new RegExp(String.raw`\bcumartesi${DAY_TAIL}`), 6],
  [new RegExp(String.raw`\bcuma${DAY_TAIL}`), 5],
  [new RegExp(String.raw`\bpazar${DAY_TAIL}`), 0],
];
const WEEKDAY_LABEL = ["Pazar", "Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi"];
const MONTH_LABEL = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];

/** TR duvar saati (yıl, ay 0-tabanlı, gün, saat, dk) → epoch ms. */
function trWallToMs(y: number, m: number, d: number, h: number, min: number): number {
  return Date.UTC(y, m, d, h, min) - TR_OFFSET_MS;
}

export function formatWhenLabel(ms: number, nowMs: number): string {
  const p = trParts(ms);
  const dayDiff = Math.round((trDayStartMs(ms) - trDayStartMs(nowMs)) / DAY_MS);
  const hhmm = `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
  const day =
    dayDiff === 0 ? "Bugün" : dayDiff === 1 ? "Yarın" : dayDiff > 1 && dayDiff < 7 ? WEEKDAY_LABEL[p.weekday] : `${p.day} ${MONTH_LABEL[p.month]}`;
  return `${day} ${hhmm}`;
}

type DayHit = { dayStartMs: number; assumedDay: boolean };

function readDay(t: string, nowMs: number): DayHit | null {
  const today = trDayStartMs(nowMs);
  const todayParts = trParts(nowMs);
  // Açık tarih: "15 ekim", "15 ekimde"
  const named = new RegExp(String.raw`\b(\d{1,2})\s+(${MONTHS.join("|")})`).exec(t);
  if (named) {
    const d = Number(named[1]);
    const m = MONTHS.indexOf(named[2]);
    if (d >= 1 && d <= 31) {
      let ms = trWallToMs(todayParts.year, m, d, 0, 0);
      if (ms < today) ms = trWallToMs(todayParts.year + 1, m, d, 0, 0);
      return { dayStartMs: ms, assumedDay: false };
    }
  }
  // Sayısal tarih: "15.10", "15/10/2026" (saat değil: önünde "saat" yok, ardında "'da/'te" eki yok)
  const numeric = /(?<!saat\s)(?<![\d.:])(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?(?![\d:])(?!\s*'?\s*(?:te|ta|de|da)\b)/.exec(t);
  if (numeric) {
    const d = Number(numeric[1]);
    const m = Number(numeric[2]) - 1;
    const yRaw = numeric[3] ? Number(numeric[3]) : null;
    if (d >= 1 && d <= 31 && m >= 0 && m <= 11) {
      const y = yRaw == null ? todayParts.year : yRaw < 100 ? 2000 + yRaw : yRaw;
      let ms = trWallToMs(y, m, d, 0, 0);
      if (yRaw == null && ms < today) ms = trWallToMs(y + 1, m, d, 0, 0);
      return { dayStartMs: ms, assumedDay: false };
    }
  }
  if (/\b(?:obur\s*gun|ertesi\s*gun|yarindan\s+sonra)/.test(t)) return { dayStartMs: today + 2 * DAY_MS, assumedDay: false };
  if (/\byarin/.test(t)) return { dayStartMs: today + DAY_MS, assumedDay: false };
  if (/\bbugun|\bbu\s+aksam|\bbu\s+sabah|\bbirazdan/.test(t)) return { dayStartMs: today, assumedDay: false };
  const nextWeek = /\bhaftaya|\bgelecek\s+hafta|\bonumuzdeki\s+hafta/.test(t);
  for (const [re, wd] of WEEKDAYS) {
    if (re.test(t)) {
      let delta: number;
      if (nextWeek) {
        // "haftaya salı": gelecek haftanın (pazartesi başlangıçlı) salısı
        const toNextMonday = (1 - todayParts.weekday + 7) % 7 || 7;
        delta = toNextMonday + ((wd + 6) % 7);
      } else {
        delta = (wd - todayParts.weekday + 7) % 7;
        if (delta === 0) delta = 7;
      }
      return { dayStartMs: today + delta * DAY_MS, assumedDay: false };
    }
  }
  if (nextWeek) return { dayStartMs: today + 7 * DAY_MS, assumedDay: true };
  const inDays = /\b(\d{1,2})\s+gun\s+sonra/.exec(t);
  if (inDays) return { dayStartMs: today + Number(inDays[1]) * DAY_MS, assumedDay: false };
  return null;
}

type TimeHit = { hour: number; minute: number; assumed: boolean };

function readTime(t: string): TimeHit | null {
  const evening = /\b(?:aksam|ogleden\s+sonra|ogle?den\s+sonra|gece)/.test(t);
  const morning = /\bsabah/.test(t);
  const fix = (h: number, explicitMinutes: boolean): TimeHit => {
    if (h < 12 && evening) return { hour: h + 12, minute: 0, assumed: false };
    // "saat 3" iş saatinde öğleden sonradır (sabah denmediyse) — varsayım olarak işaretlenir.
    if (h >= 1 && h <= 7 && !morning) return { hour: h + 12, minute: 0, assumed: !explicitMinutes };
    return { hour: h, minute: 0, assumed: false };
  };
  // "14:30" her zaman saattir; "14.30" yalnız "saat" ile ya da "'da/'te" ekiyle (yoksa tarih olabilir: "15.10").
  const hm =
    /(?<![\d.])(\d{1,2}):(\d{2})(?![\d])/.exec(t) ??
    /saat\s+(\d{1,2})\.(\d{2})(?![\d])/.exec(t) ??
    /(?<![\d.])(\d{1,2})\.(\d{2})\s*'?\s*(?:te|ta|de|da)\b/.exec(t);
  if (hm) {
    const h = Number(hm[1]);
    const m = Number(hm[2]);
    if (h <= 23 && m <= 59) {
      const base = fix(h, true);
      return { hour: base.hour, minute: m, assumed: false };
    }
  }
  const saat = /\bsaat\s+(\d{1,2})(?:\s*bucuk)?/.exec(t) ?? /(?<![\d.,+])(\d{1,2})\s*(?:'|’)?\s*(?:te|ta|de|da)\b/.exec(t);
  if (saat) {
    const h = Number(saat[1]);
    if (h <= 23) {
      const r = fix(h, false);
      if (/bucuk/.test(saat[0])) r.minute = 30;
      return r;
    }
  }
  if (/\bogle(?:n|de|ye)?\b/.test(t) && !evening) return { hour: 12, minute: 0, assumed: false };
  return null;
}

/** Bir parçadaki tarih (+ saat) ifadesi. Saat yoksa varsayılan saat + `assumed`. */
export function readWhen(rawSegment: string, nowMs: number, defaultHour: number): NoteWhen | null {
  const t = normalizeSpokenNumbers(foldTr(rawSegment).replace(/[’‘`´]/g, "'"));
  const day = readDay(t, nowMs);
  const time = readTime(t);
  if (!day && !time) return null;
  let dayStart = day?.dayStartMs ?? trDayStartMs(nowMs);
  const hour = time?.hour ?? defaultHour;
  const minute = time?.minute ?? 0;
  let ms = dayStart + hour * 3_600_000 + minute * 60_000;
  // Yalnız saat söylendi ve geçtiyse ertesi gün.
  if (!day && ms <= nowMs) {
    dayStart += DAY_MS;
    ms += DAY_MS;
  }
  if (ms <= nowMs) return null;
  return {
    iso: new Date(ms).toISOString(),
    label: formatWhenLabel(ms, nowMs),
    assumed: Boolean(day?.assumedDay || !time || time.assumed),
  };
}

// ---------------------------------------------------------------------------
// Randevu / görev parçaları
// ---------------------------------------------------------------------------

const APPOINTMENT_WORDS =
  /\b(?:randevu[a-z]*|gosterim[a-z]*|goster(?:ece|me|il)[a-z]*|yer\s+goster[a-z]*|bakmaya|gezme[a-z]*|gezdir[a-z]*|ziyaret[a-z]*|bulus[a-z]*|gorusme[a-z]*|gelece(?:k|kler)[a-z]*|gelsin)\b/;
const TASK_WORDS =
  /\b(?:ara(?:yacag[a-z]*|yacak[a-z]*|yalim|yin|nacak|mali[a-z]*|sin|r|riz)?|geri\s+don[a-z]*|donus[a-z]*|gonder[a-z]*|yolla[a-z]*|ilet(?:ece|il|elim|meli)[a-z]*|hatirlat[a-z]*|takip|kontrol\s+et[a-z]*|teklif[a-z]*|hazirla[a-z]*|sor(?:ulacak|alim|mali|acag)[a-z]*|bilgi\s+ver[a-z]*|haber\s+ver[a-z]*|yapilacak|sonraki\s+adim)\b/;

function segmentsOf(text: string): string[] {
  return text
    .split(/[.;!?\n]+|,(?!\d)|\s+(?:sonra|ayrica|bir\s+de)\s+/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 1);
}

function cleanTaskTitle(segment: string): string {
  const s = segment.replace(/^(?:sonraki\s+adım|yapılacak|not)\s*[:\-–]\s*/i, "").replace(/\s+/g, " ").trim();
  if (!s) return "";
  return (s.charAt(0).toLocaleUpperCase("tr-TR") + s.slice(1)).slice(0, 120);
}

// ---------------------------------------------------------------------------
// Ana fonksiyon
// ---------------------------------------------------------------------------

export function extractNoteFields(
  text: string,
  opts: { nowMs: number; geo?: NlGeo },
): NoteFieldSuggestions {
  const raw = String(text ?? "").slice(0, 2000);
  if (!raw.trim()) return { ...EMPTY_NOTE_FIELDS };
  const segments = segmentsOf(raw);

  // Randevu ve görev parçaları; bunlar konum/fiyat ayrıştırmasına girmez ("cuma" bir semte benzemesin).
  let appointment: NoteWhen | null = null;
  let nextTask: NoteFieldSuggestions["nextTask"] = null;
  const rest: string[] = [];
  for (const seg of segments) {
    const folded = foldTr(seg);
    const isAppointment = APPOINTMENT_WORDS.test(folded);
    const isTask = TASK_WORDS.test(folded);
    if (isAppointment && !appointment) {
      const when = readWhen(seg, opts.nowMs, 10);
      if (when) {
        appointment = when;
        continue;
      }
    }
    if (isTask && !nextTask) {
      const title = cleanTaskTitle(seg);
      if (title) {
        nextTask = { title, due: readWhen(seg, opts.nowMs, 9) };
        continue;
      }
    }
    rest.push(seg);
  }

  const normalized = normalizeSpokenNumbers(foldTr(rest.join(", ")).replace(/[’‘`´]/g, "'"));
  const parsed = parseNlQuery(normalized, opts.geo ?? { provinces: [], districts: [] });
  const rooms = parsed.filters.oda ? parsed.filters.oda.split(",")[0] : null;
  const budgetMin = parsed.filters.fiyat_min ? Number(parsed.filters.fiyat_min) : null;
  const budgetMax = parsed.filters.fiyat_max ? Number(parsed.filters.fiyat_max) : null;
  const budgetLabel =
    budgetMin != null && budgetMax != null
      ? `${formatMoneyShort(budgetMin)} – ${formatMoneyShort(budgetMax)}`
      : budgetMax != null
        ? `en fazla ${formatMoneyShort(budgetMax)}`
        : budgetMin != null
          ? `en az ${formatMoneyShort(budgetMin)}`
          : null;

  let region: NoteRegion | null = null;
  const geo = opts.geo;
  if (geo && (parsed.filters.il || parsed.filters.ilce)) {
    const district = parsed.filters.ilce ? geo.districts.find((d) => d.id === parsed.filters.ilce) ?? null : null;
    const provinceId = parsed.provinceId ?? district?.parentId ?? parsed.filters.il ?? null;
    const province = provinceId ? geo.provinces.find((p) => p.id === provinceId) ?? null : null;
    const neighborhood = parsed.filters.mahalle ? geo.neighborhoods?.find((n) => n.id === parsed.filters.mahalle) ?? null : null;
    const label = [neighborhood ? `${neighborhood.name} Mah.` : null, district?.name, province?.name].filter(Boolean).join(", ");
    region = {
      provinceId: province?.id ?? null,
      provinceName: province?.name ?? null,
      districtId: district?.id ?? null,
      districtName: district?.name ?? null,
      neighborhoodId: neighborhood?.id ?? null,
      neighborhoodName: neighborhood?.name ?? null,
      label,
    };
  }

  return { rooms, budgetMin, budgetMax, budgetLabel, region, appointment, nextTask, source: "kural" };
}

/** Kural sonucunun EKSİK alanlarını (yalnız onlar) AI önerisiyle tamamlar; kural bulgusu ezilmez. */
export function mergeNoteFields(rule: NoteFieldSuggestions, ai: Partial<NoteFieldSuggestions> | null): NoteFieldSuggestions {
  if (!ai) return rule;
  const out: NoteFieldSuggestions = { ...rule };
  let used = false;
  if (!out.rooms && ai.rooms) {
    out.rooms = ai.rooms;
    used = true;
  }
  if (out.budgetMax == null && out.budgetMin == null && (ai.budgetMax != null || ai.budgetMin != null)) {
    out.budgetMin = ai.budgetMin ?? null;
    out.budgetMax = ai.budgetMax ?? null;
    out.budgetLabel = ai.budgetLabel ?? null;
    used = true;
  }
  if (!out.region && ai.region) {
    out.region = ai.region;
    used = true;
  }
  if (!out.appointment && ai.appointment) {
    out.appointment = ai.appointment;
    used = true;
  }
  if (!out.nextTask && ai.nextTask) {
    out.nextTask = ai.nextTask;
    used = true;
  }
  if (used) out.source = "kural+ai";
  return out;
}

// ---------------------------------------------------------------------------
// AI tamamlaması (isteğe bağlı): istem + çıktı doğrulaması (saf)
// ---------------------------------------------------------------------------

export function buildNoteFieldsMessages(text: string, nowMs: number): { system: string; user: string } {
  const p = trParts(nowMs);
  const today = `${p.year}-${String(p.month + 1).padStart(2, "0")}-${String(p.day).padStart(2, "0")} ${WEEKDAY_LABEL[p.weekday]}`;
  return {
    system:
      "Sen bir emlak ofisi asistanısın. Danışmanın sahadan aldığı Türkçe nottan alan çıkar. YALNIZCA JSON döndür: " +
      '{"rooms": "2+1" | null, "budget_min": sayı | null, "budget_max": sayı | null, "region": "ilçe ya da semt adı" | null, ' +
      '"appointment_at": "YYYY-MM-DDTHH:mm" | null, "next_task": "kısa görev cümlesi" | null, "next_task_at": "YYYY-MM-DDTHH:mm" | null}. ' +
      `Bugün ${today} (Türkiye saati). Tutarlar TL ve tam sayı. Metinde OLMAYAN bilgiyi UYDURMA; emin değilsen null yaz.`,
    user: text,
  };
}

type AiJson = Partial<Record<"rooms" | "budget_min" | "budget_max" | "region" | "appointment_at" | "next_task" | "next_task_at", unknown>>;

function aiWhen(raw: unknown, nowMs: number): NoteWhen | null {
  if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(raw)) return null;
  const ms = Date.parse(`${raw}:00+03:00`);
  if (!Number.isFinite(ms) || ms <= nowMs || ms - nowMs > 366 * DAY_MS) return null;
  return { iso: new Date(ms).toISOString(), label: formatWhenLabel(ms, nowMs), assumed: true };
}

function aiMoney(raw: unknown): number | null {
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw.replace(/[^\d]/g, "")) : NaN;
  return Number.isFinite(n) && n >= 10_000 && n <= 100_000_000_000 ? Math.round(n) : null;
}

/**
 * AI JSON çıktısını doğrular ve öneriye çevirir. Kurallar: oda "N+M" biçiminde; tutar makul aralıkta; bölge YALNIZ konum
 * listesinde eşleşirse; tarih gelecekte ve bir yıl içinde (hepsi `assumed`); görev cümlesi kaynak metinle en az bir anlamlı
 * sözcük paylaşmalı (uydurma görev reddedilir). Geçersiz alan sessizce düşer.
 */
export function aiFieldsFromJson(
  json: unknown,
  opts: { nowMs: number; geo?: NlGeo; sourceText: string },
): Partial<NoteFieldSuggestions> | null {
  if (!json || typeof json !== "object") return null;
  const j = json as AiJson;
  const out: Partial<NoteFieldSuggestions> = {};
  if (typeof j.rooms === "string" && /^(?:[1-9]|10)\+[0-9]$/.test(j.rooms.trim())) out.rooms = j.rooms.trim();
  const bMin = aiMoney(j.budget_min);
  const bMax = aiMoney(j.budget_max);
  if (bMin != null || bMax != null) {
    const swap = bMin != null && bMax != null && bMin > bMax;
    const min = swap ? bMax : bMin;
    const max = swap ? bMin : bMax;
    out.budgetMin = min;
    out.budgetMax = max;
    out.budgetLabel =
      min != null && max != null
        ? `${formatMoneyShort(min)} – ${formatMoneyShort(max)}`
        : max != null
          ? `en fazla ${formatMoneyShort(max)}`
          : `en az ${formatMoneyShort(min as number)}`;
  }
  if (typeof j.region === "string" && j.region.trim() && opts.geo) {
    const r = extractNoteFields(j.region.slice(0, 80), { nowMs: opts.nowMs, geo: opts.geo }).region;
    if (r) out.region = r;
  }
  const appt = aiWhen(j.appointment_at, opts.nowMs);
  if (appt) out.appointment = appt;
  if (typeof j.next_task === "string" && j.next_task.trim()) {
    const source = foldTr(opts.sourceText).split(/[^a-z0-9]+/).filter((w) => w.length >= 4);
    const title = cleanTaskTitle(j.next_task.trim());
    const shares = foldTr(title)
      .split(/[^a-z0-9]+/)
      .some((w) => w.length >= 4 && source.some((s) => s.slice(0, 4) === w.slice(0, 4)));
    if (title && shares) out.nextTask = { title, due: aiWhen(j.next_task_at, opts.nowMs) };
  }
  return Object.keys(out).length > 0 ? out : null;
}
