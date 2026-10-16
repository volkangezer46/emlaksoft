/**
 * TV panosu saf mantığı (sunucu bağımlılığı YOK; istemci de kullanır).
 *
 * TV herkese açık odada görünür: müşteri telefonu/e-postası ASLA; kişi adları (müşteri ve personel) yalnız
 * "Ahmet Y." biçiminde (ad + soyadın baş harfi) gösterilir. Tasarım notu: docs/design/TV_MODU_v2.md.
 */
import { DAY_MS, TR_OFFSET_MS } from "@/lib/clock";

/* -------------------------------------------------------------------------- */
/* İsim kısaltma                                                               */
/* -------------------------------------------------------------------------- */

const cap = (w: string) => `${w.charAt(0).toLocaleUpperCase("tr-TR")}${w.slice(1).toLocaleLowerCase("tr-TR")}`;

/** "ayşe nur YILMAZ" → "Ayşe Y."; tek sözcük → "Ayşe"; boş → "Müşteri". Tam ad asla çıktıda bulunmaz. */
export function shortName(full: string | null | undefined, fallback = "Müşteri"): string {
  const parts = String(full ?? "")
    .trim()
    .split(/\s+/)
    // Yalnız harfle başlayan sözcükler: "[SAHA] Ali Er" → "Ali E.", "Müşteri 46186" → "Müşteri" (numara soyad sayılmaz).
    .filter((w) => /^\p{L}/u.test(w))
    .map((w) => w.replace(/[^\p{L}'-]/gu, ""))
    .filter(Boolean);
  if (parts.length === 0) return fallback;
  // Tek sözcükte ad uzunsa kısaltılır: tek sözcüklü kayıtlar çoğu zaman soyadsız tam ad değil, takma addır.
  const first = cap(parts[0]).slice(0, 14);
  if (parts.length === 1) return first;
  const last = parts[parts.length - 1];
  return `${first} ${last.charAt(0).toLocaleUpperCase("tr-TR")}.`;
}

/** Avatar için iki baş harf (kısaltılmış addan; tam ad gerekmez). */
export function initialsOf(short: string): string {
  return short
    .split(/\s+/)
    .map((w) => w.charAt(0))
    .join("")
    .slice(0, 2)
    .toLocaleUpperCase("tr-TR");
}

/* -------------------------------------------------------------------------- */
/* Sahneler ve ayar modeli (ofis ayarı `office.tv.config`)                     */
/* -------------------------------------------------------------------------- */

export const TV_SCENES = ["bugun", "performans", "lig", "ilanlar", "hedefler", "duyurular", "sistem"] as const;
export type TvSceneId = (typeof TV_SCENES)[number];

export const TV_SCENE_META: Record<TvSceneId, { label: string; short: string; hint: string; defaultSec: number }> = {
  bugun: { label: "Bugün", short: "Bugün", hint: "Randevular, görevler ve yeni talepler", defaultSec: 20 },
  performans: { label: "Ofis performansı", short: "Performans", hint: "Büyük göstergeler ve 14 günlük grafik", defaultSec: 18 },
  lig: { label: "Danışman ligi", short: "Lig", hint: "Podyum, seri ve hedef halkaları", defaultSec: 18 },
  ilanlar: { label: "Yeni portföyler", short: "Portföyler", hint: "Tam ekran kapak fotoğrafları, fiyat ve konum", defaultSec: 30 },
  hedefler: { label: "Hedefler", short: "Hedefler", hint: "Ofis, şube ve danışman hedefleri", defaultSec: 15 },
  duyurular: { label: "Duyurular ve kutlamalar", short: "Duyurular", hint: "Duyurular, kapanan satışlar, yıldönümleri", defaultSec: 15 },
  sistem: { label: "Portal ve sistem", short: "Sistem", hint: "Portal yayını, teyit sağlığı, bağlantı", defaultSec: 10 },
};

/** Sahne süresi seçenekleri (sn). */
export const SCENE_SECONDS = [10, 15, 20, 30, 45, 60, 90] as const;
export const SCENE_MIN_SEC = 8;
export const SCENE_MAX_SEC = 120;

export type TvTheme = "dark" | "light";
export type TvSceneSetting = { id: TvSceneId; on: boolean; sec: number };

export type TvConfig = {
  /** Sahne sırası = dizi sırası. */
  scenes: TvSceneSetting[];
  theme: TvTheme;
  /** Ciro / komisyon tutarları. Varsayılan KAPALI; ayrıca sunucuda earnings_all şarttır, cihazda hiç açılmaz. */
  showMoney: boolean;
  /** 22:00–07:00 arası gece modu (yalnız saat, düşük parlaklık). */
  nightMode: boolean;
};

export const DEFAULT_TV_CONFIG: TvConfig = {
  scenes: TV_SCENES.map((id) => ({ id, on: true, sec: TV_SCENE_META[id].defaultSec })),
  theme: "dark",
  showMoney: false,
  nightMode: true,
};

const clampSec = (v: unknown, def: number): number => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= SCENE_MIN_SEC && n <= SCENE_MAX_SEC ? n : def;
};

/** Saklanan (güvenilmeyen) değeri güvenli ayara çevirir: bilinmeyen sahne atılır, eksik sahne sona açık eklenir. */
export function parseTvConfig(raw: unknown): TvConfig {
  let obj: unknown = raw;
  if (typeof raw === "string") {
    try {
      obj = JSON.parse(raw);
    } catch {
      return structuredClone(DEFAULT_TV_CONFIG);
    }
  }
  if (!obj || typeof obj !== "object") return structuredClone(DEFAULT_TV_CONFIG);
  const o = obj as Record<string, unknown>;
  const seen = new Set<TvSceneId>();
  const scenes: TvSceneSetting[] = [];
  if (Array.isArray(o.scenes)) {
    for (const s of o.scenes) {
      const r = (s ?? {}) as Record<string, unknown>;
      const id = String(r.id ?? "") as TvSceneId;
      if (!(TV_SCENES as readonly string[]).includes(id) || seen.has(id)) continue;
      seen.add(id);
      scenes.push({ id, on: r.on !== false, sec: clampSec(r.sec, TV_SCENE_META[id].defaultSec) });
    }
  }
  for (const id of TV_SCENES) if (!seen.has(id)) scenes.push({ id, on: true, sec: TV_SCENE_META[id].defaultSec });
  return {
    scenes,
    theme: o.theme === "light" ? "light" : "dark",
    showMoney: o.showMoney === true,
    nightMode: o.nightMode !== false,
  };
}

/** Depoya yazılacak kanonik metin (yalnız bilinen alanlar). */
export function formatTvConfig(c: TvConfig): string {
  const p = parseTvConfig(c);
  return JSON.stringify({ scenes: p.scenes, theme: p.theme, showMoney: p.showMoney, nightMode: p.nightMode });
}

/* -------------------------------------------------------------------------- */
/* Sahne planlama (içerik farkında + günün saatine göre vurgu)                 */
/* -------------------------------------------------------------------------- */

export type PlannedScene = { id: TvSceneId; ms: number };

/** Gün içi vurgu: sabah plan (bugün), akşam skor (lig). */
export function sceneEmphasis(id: TvSceneId, hour: number): number {
  if (id === "bugun" && hour < 11) return 1.5;
  if (id === "lig" && hour >= 16) return 1.25;
  return 1;
}

/**
 * Yayın listesi: açık VE içeriği olan sahneler, ayar sırasıyla. Hiçbiri kalmazsa "bugün" (anlamlı boş durum taşır)
 * tek başına döner; ekran asla boş kalmaz.
 */
export function planScenes(config: TvConfig, available: Partial<Record<TvSceneId, boolean>>, hour: number): PlannedScene[] {
  const out = config.scenes
    .filter((s) => s.on && available[s.id] !== false)
    .map((s) => ({ id: s.id, ms: Math.round(s.sec * sceneEmphasis(s.id, hour) * 1000) }));
  if (out.length > 0) return out;
  const today = config.scenes.find((s) => s.id === "bugun");
  return [{ id: "bugun", ms: (today?.sec ?? TV_SCENE_META.bugun.defaultSec) * 1000 }];
}

/** Sarmalı dizin (←/→ ve otomatik ilerleme). */
export function stepIndex(index: number, length: number, dir: 1 | -1 = 1): number {
  if (length <= 0) return 0;
  return (((index + dir) % length) + length) % length;
}

/** Plan değişince (veri geldi, ayar değişti) aynı sahnede kal; o sahne artık yoksa aynı konumdaki sahneye geç. */
export function reconcileIndex(prevId: TvSceneId | null, prevIndex: number, plan: readonly PlannedScene[]): number {
  if (plan.length === 0) return 0;
  if (prevId) {
    const i = plan.findIndex((p) => p.id === prevId);
    if (i >= 0) return i;
  }
  return Math.min(Math.max(0, prevIndex), plan.length - 1);
}

/** Sahne içi döngü (ilan fotoğrafları vb.): öğe başına süre, sahne süresine sığacak biçimde en az `minMs`. */
export function perItemMs(sceneMs: number, count: number, minMs = 6000): number {
  if (count <= 1) return sceneMs;
  return Math.max(minMs, Math.floor(sceneMs / count));
}

/* -------------------------------------------------------------------------- */
/* Zaman: gece modu, günlük yeniden yükleme, burn-in                           */
/* -------------------------------------------------------------------------- */

export function isNightHour(hour: number): boolean {
  return hour >= 22 || hour < 7;
}

/** Bir sonraki İstanbul saat `hour`:00 anına kalan ms (her zaman > 0). */
export function msUntilTrHour(nowMs: number, hour = 4): number {
  const local = nowMs + TR_OFFSET_MS;
  const dayStart = Math.floor(local / DAY_MS) * DAY_MS;
  let target = dayStart + hour * 3_600_000;
  if (target <= local) target += DAY_MS;
  return target - local;
}

/** Burn-in önleme: çok yavaş ±2px kayma (dakikada bir adım), saf fonksiyon. */
export function burnInOffset(minuteTick: number): { x: number; y: number } {
  const steps = [
    [0, 0],
    [1, 0],
    [2, 1],
    [1, 2],
    [0, 1],
    [-1, 2],
    [-2, 1],
    [-1, 0],
    [-2, -1],
    [-1, -2],
    [0, -1],
    [1, -2],
    [2, -1],
    [1, 0],
  ] as const;
  const i = ((Math.floor(minuteTick) % steps.length) + steps.length) % steps.length;
  return { x: steps[i][0], y: steps[i][1] };
}

/* -------------------------------------------------------------------------- */
/* Göstergeler                                                                  */
/* -------------------------------------------------------------------------- */

/** Önceki eş döneme göre değişim (%). Önceki 0 ise: şimdi de 0 → 0, değilse null ("yeni"). */
export function pctChange(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null;
  if (previous <= 0) return current > 0 ? null : 0;
  return Math.round(((current - previous) / previous) * 100);
}

/** Zaman damgalarını son `days` TR gününe kovalar (en eski → bugün). */
export function dailySeries(isos: readonly (string | null | undefined)[], nowMs: number, days = 14): number[] {
  const out = Array.from({ length: days }, () => 0);
  const todayStart = Math.floor((nowMs + TR_OFFSET_MS) / DAY_MS);
  for (const iso of isos) {
    const t = iso ? Date.parse(iso) : NaN;
    if (!Number.isFinite(t)) continue;
    const idx = days - 1 - (todayStart - Math.floor((t + TR_OFFSET_MS) / DAY_MS));
    if (idx >= 0 && idx < days) out[idx] += 1;
  }
  return out;
}

/** Bu ay (ay başından şimdiye) ve geçen ayın aynı uzunluktaki dilimi. */
export function monthWindowCounts(
  isos: readonly (string | null | undefined)[],
  monthStartMs: number,
  prevMonthStartMs: number,
  nowMs: number,
): { current: number; previous: number } {
  const prevEnd = Math.min(monthStartMs, prevMonthStartMs + (nowMs - monthStartMs));
  let current = 0;
  let previous = 0;
  for (const iso of isos) {
    const t = iso ? Date.parse(iso) : NaN;
    if (!Number.isFinite(t)) continue;
    if (t >= monthStartMs && t <= nowMs) current += 1;
    else if (t >= prevMonthStartMs && t < prevEnd) previous += 1;
  }
  return { current, previous };
}

/** Ay sonu tahmini: bugüne kadarki hızla ay sonunda ulaşılacak değer (etiketli tahmin; ilk 3 günde tahmin yok). */
export function paceProjection(done: number, dayOfMonth: number, daysInMonth: number): number | null {
  if (dayOfMonth < 3 || daysInMonth <= 0 || dayOfMonth > daysInMonth) return null;
  return Math.round((done / dayOfMonth) * daysInMonth);
}

export function daysInTrMonth(year: number, month0: number): number {
  return new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
}

/** Randevu penceresi: şimdiden önceki en çok `before` + sonraki kayıtlar, toplam `size` (zaman çizelgesi). */
export function windowAroundNow<T extends { at: string }>(items: readonly T[], nowMs: number, size = 7, before = 2): { items: T[]; nextId: T | null } {
  const sorted = [...items].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const firstFuture = sorted.findIndex((x) => Date.parse(x.at) >= nowMs);
  const pivot = firstFuture < 0 ? sorted.length : firstFuture;
  let start = Math.max(0, pivot - before);
  if (sorted.length - start < size) start = Math.max(0, sorted.length - size);
  return { items: sorted.slice(start, start + size), nextId: firstFuture >= 0 ? sorted[firstFuture] : null };
}

/* -------------------------------------------------------------------------- */
/* Olay akışı ve yeni talepler (kişisel veri YOK)                              */
/* -------------------------------------------------------------------------- */

export type TvEventKind = "customer" | "appointment" | "deal" | "property" | "badge";

export const TV_EVENT_LABELS: Record<TvEventKind, string> = {
  customer: "Yeni müşteri eklendi",
  appointment: "Randevu tamamlandı",
  deal: "Teklif kabul edildi",
  property: "Yeni portföy eklendi",
  badge: "Yeni rozet kazanıldı",
};

export type TvEvent = { id: string; kind: TvEventKind; label: string; at: string };

/** Ham (id, tür, zaman) kayıtlarından en yeni N olayı üretir; etiket sabit metindir, kayıt içeriği taşımaz. */
export function buildTvEvents(
  raw: readonly { id: string; kind: TvEventKind; at: string | null | undefined }[],
  limit = 10,
): TvEvent[] {
  return raw
    .filter((r): r is { id: string; kind: TvEventKind; at: string } => Boolean(r.at) && Number.isFinite(Date.parse(String(r.at))))
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, limit)
    .map((r) => ({ id: `${r.kind}:${r.id}`, kind: r.kind, label: TV_EVENT_LABELS[r.kind], at: r.at }));
}

const LEAD_SOURCE_LABELS: Record<string, string> = {
  web: "Web sitesi",
  web_sitesi: "Web sitesi",
  referral: "Referans",
  tavsiye: "Referans",
  phone: "Telefon",
  telefon: "Telefon",
  walk_in: "Ofis ziyareti",
  ofis_ziyareti: "Ofis ziyareti",
  social: "Sosyal medya",
  sosyal_medya: "Sosyal medya",
  portal: "Portal",
  portal_sahibinden: "Sahibinden",
  portal_hepsiemlak: "Hepsiemlak",
  portal_zingat: "Zingat",
  portal_emlakjet: "Emlakjet",
};

/** Müşteri kaynağı → TV etiketi; bilinmeyen/boş kaynak null (satırda gösterilmez). */
export function leadSourceLabel(source: string | null | undefined): string | null {
  const key = String(source ?? "").trim().toLowerCase();
  return key ? (LEAD_SOURCE_LABELS[key] ?? null) : null;
}

/** Görev türü → TV etiketi (görev BAŞLIĞI serbest metindir, TV'ye taşınmaz). */
export const TASK_KIND_LABELS: Record<string, string> = {
  followup: "Takip",
  call: "Arama",
  visit: "Ziyaret",
  document: "Evrak",
  other: "Görev",
};

/** Önceki listede olmayan kimlikler (yeni öğe vurgusu / kutlama için). İlk yüklemede (prev null) boş. */
export function newIds(prev: ReadonlySet<string> | null, next: readonly string[]): Set<string> {
  const out = new Set<string>();
  if (!prev) return out;
  for (const id of next) if (!prev.has(id)) out.add(id);
  return out;
}

/* -------------------------------------------------------------------------- */
/* Veri kapsamı                                                                */
/* -------------------------------------------------------------------------- */

/** Ofis Panosu'nu (TV) görebilen roller (ofis geneli kapsam). */
export const TV_VIEW_ROLES = ["owner", "gm", "branch_manager"] as const;

export function canViewTv(role: string | null | undefined): boolean {
  return (TV_VIEW_ROLES as readonly string[]).includes(role ?? "");
}
