import type { ProbeClassification, ProbeReply } from "./core";

/**
 * EKLENTİ SAĞLIK/GEÇMİŞ MANTIĞI (SAF, testli; saat dışarıdan verilir). Portal bazında son N kontrolün sonucu halka tamponunda
 * tutulur; yeşil/sarı/kırmızı sağlık, "kontrol edilemedi" nedenleri, son sonuçlar ve günlük/haftalık sayaçlar buradan çıkar.
 * Tamponlar YEREL (chrome.storage.local) kalır; yalnız ilan no + sonuç türü + hata kodu tutulur (başlık/fiyat saklanmaz).
 */

export const HEALTH_WINDOW = 20;
export const RECENT_CAP = 12;
export const HISTORY_DAYS = 14;

export type HealthEntry = { at: number; kind: ProbeClassification; error: string | null; partial: boolean };
export type HealthMap = Record<string, HealthEntry[]>;
export type RecentItem = { at: number; portal: string; externalId: string | null; kind: ProbeClassification; error: string | null };

/** Okunabilen sonuç: yayında / kaldırıldı / bulunamadı. Engel ve belirsiz "kontrol edilemedi"dir. */
export function isReadable(kind: ProbeClassification): boolean {
  return kind === "live" || kind === "removed" || kind === "not_found";
}

/** Ham yanıttan sınıf (ayrıştırıcı vermediyse hata koduna göre güvenli çıkarım). */
export function classifyReply(reply: ProbeReply): ProbeClassification {
  if (reply.classification) return reply.classification;
  if (reply.error) return /^(http_401|http_403|http_429|captcha|login_required)$/.test(reply.error) ? "blocked" : "unknown";
  if (reply.found === true) return "live";
  if (reply.found === false && reply.notFound === true) return "not_found";
  return "unknown";
}

export function entryFromReply(reply: ProbeReply, nowMs: number): HealthEntry {
  const kind = classifyReply(reply);
  return { at: nowMs, kind, error: reply.error ? String(reply.error).slice(0, 60) : null, partial: reply.partial === true };
}

export function recordHealth(map: HealthMap, portal: string, entry: HealthEntry): HealthMap {
  const prev = map[portal] ?? [];
  return { ...map, [portal]: [...prev, entry].slice(-HEALTH_WINDOW) };
}

export function pushRecent(list: readonly RecentItem[], item: RecentItem): RecentItem[] {
  return [item, ...list].slice(0, RECENT_CAP);
}

export type HealthLevel = "green" | "yellow" | "red" | "idle";
export type PortalHealth = { level: HealthLevel; total: number; unreadable: number; blocked: number; partial: number; lastAt: number | null };

/**
 * Sağlık: hiç veri yoksa `idle`. Kırmızı: portal engeli beklemesi sürüyor ya da (en az 4 kontrolde) yarıdan çoğu okunamadı.
 * Sarı: son kontrollerde herhangi bir engel, okunamayan oranı ≥ %20 ya da kısmi okuma (fiyat/başlık yok) oranı ≥ %30.
 */
export function portalHealth(entries: readonly HealthEntry[] | undefined, cooldownActive: boolean): PortalHealth {
  const list = entries ?? [];
  const total = list.length;
  if (total === 0) return { level: "idle", total: 0, unreadable: 0, blocked: 0, partial: 0, lastAt: null };
  const unreadable = list.filter((e) => !isReadable(e.kind)).length;
  const blocked = list.filter((e) => e.kind === "blocked").length;
  const partial = list.filter((e) => e.kind === "live" && e.partial).length;
  const lastAt = list[total - 1].at;
  let level: HealthLevel = "green";
  if ((cooldownActive && blocked > 0 && !isReadable(list[total - 1].kind)) || (total >= 4 && unreadable / total > 0.5)) level = "red";
  else if (blocked > 0 || unreadable / total >= 0.2 || partial / total >= 0.3) level = "yellow";
  return { level, total, unreadable, blocked, partial, lastAt };
}

/** "Kontrol edilemedi" nedenleri: son pencerelerde hata koduna göre sayım (çoktan aza). */
export function reasonCounts(map: HealthMap, limit = 4): { code: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const list of Object.values(map)) {
    for (const e of list) {
      if (isReadable(e.kind)) continue;
      const code = e.error ?? "unexpected_structure";
      counts.set(code, (counts.get(code) ?? 0) + 1);
    }
  }
  return [...counts.entries()].map(([code, count]) => ({ code, count })).sort((a, b) => b.count - a.count || a.code.localeCompare(b.code)).slice(0, limit);
}

// ---------------------------------------------------------------- günlük geçmiş

export type History = Record<string, number>;

export function bumpHistory(history: History, dayKey: string): History {
  const next = { ...history, [dayKey]: (history[dayKey] ?? 0) + 1 };
  const keys = Object.keys(next).sort();
  for (const k of keys.slice(0, Math.max(0, keys.length - HISTORY_DAYS))) delete next[k];
  return next;
}

function dayIndex(dayKey: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayKey);
  if (!m) return null;
  return Math.floor(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86_400_000);
}

/** Bugün dahil son 7 günün toplamı. */
export function weekTotal(history: History, todayKey: string): number {
  const today = dayIndex(todayKey);
  if (today === null) return 0;
  let sum = 0;
  for (const [k, v] of Object.entries(history)) {
    const d = dayIndex(k);
    if (d !== null && d <= today && d > today - 7) sum += v;
  }
  return sum;
}

// ---------------------------------------------------------------- rozet

export type BadgeColor = "green" | "amber" | "red" | "gray";
export type BadgeInfo = { text: string; color: BadgeColor; title: string };

/**
 * Araç çubuğu rozeti: bağlı değil = gri "?"; duraklatıldı = sarı "II"; engel beklemesi/uyarı sayısı = kırmızı sayı; aksi halde
 * aktif = yeşil "✓". Uyarı sayısı = kırmızı/sarı portal sayısı (+ engel beklemesi varsa en az 1).
 */
export function badgeFor(i: { connected: boolean; paused: boolean; cooldownActive: boolean; warnPortals: number }): BadgeInfo {
  if (!i.connected) return { text: "?", color: "gray", title: "EmlakSoft İlan Kontrol: bağlı değil" };
  if (i.paused) return { text: "II", color: "amber", title: "EmlakSoft İlan Kontrol: duraklatıldı" };
  const warn = Math.max(i.warnPortals, i.cooldownActive ? 1 : 0);
  if (warn > 0) return { text: String(Math.min(warn, 9)), color: "red", title: `EmlakSoft İlan Kontrol: ${warn} uyarı` };
  return { text: "✓", color: "green", title: "EmlakSoft İlan Kontrol: aktif" };
}
