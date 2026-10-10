import type { ProbeClassification } from "./core";
import {
  portalHealth,
  reasonCounts,
  weekTotal,
  type HealthLevel,
  type HealthMap,
  type History,
  type RecentItem,
} from "./extension-health";
import { isPairingActive, type Pairing } from "./extension-pairing";
import { EXTENSION_LIMITS, pacingDecision, todayCount, type PacingState } from "./extension-pacing";
import { SCAN_LIMITS, type ScanProgress, type ScanResultKind, type ScanStates } from "./extension-scan";
import { hoursLabel, msUntilWindowOpens, portalEnabled, withinWorkingHours, type ExtensionSettings } from "./extension-settings";

/**
 * EKLENTİ DURUM GÖRÜNÜMÜ (SAF, testli). Açılır pencere, uygulama içi sayfa (köprü `status-response`) ve rozet AYNI görünümü
 * kullanır: tek doğruluk kaynağı. Yalnız sayaç/sağlık bilgisi içerir; başlık, fiyat, ilan sahibi adı YOK.
 */

export type AppSession = "ok" | "login_required" | "forbidden" | "unknown";
export type RunState = "disconnected" | "paused" | "login_required" | "cooldown" | "outside_hours" | "day_cap" | "hour_cap" | "waiting_app" | "running";

export type PortalHealthView = {
  id: string;
  enabled: boolean;
  level: HealthLevel;
  total: number;
  unreadable: number;
  blocked: number;
  partial: number;
  lastAt: number | null;
};

/** Günlük mağaza taraması özeti (sayaç ve zaman; ilan içeriği YOK). */
export type ScanStatusView = {
  /** En son TAM tarama (herhangi bir portal). */
  lastFullAt: number | null;
  active: boolean;
  activePortal: string | null;
  /** Süren taramada okunan sayfa / ilan sayısı ve portalın bildirdiği toplam (yoksa null). Eski sürümlerde yok. */
  activePages?: number;
  activeRead?: number;
  activeExpected?: number | null;
  pendingUploads: number;
  portals: { id: string; lastFullAt: number | null; lastTryAt: number | null; lastResult: ScanResultKind | null; lastRead: number; lastExpected: number | null }[];
};

export type ExtensionStatusView = {
  version: string;
  parserVersion: string;
  connected: boolean;
  appSession: AppSession;
  appSeenAt: number | null;
  paused: boolean;
  state: RunState;
  today: number;
  week: number;
  dayCap: number;
  hourUsed: number;
  hourCap: number;
  /** Sıradaki kontrolün tahmini zamanı (ms) ya da null (çalışmıyor). */
  nextAt: number | null;
  cooldownUntil: number;
  lastAt: number | null;
  lastKind: ProbeClassification | null;
  lastError: string | null;
  portals: PortalHealthView[];
  reasons: { code: string; count: number }[];
  recent: RecentItem[];
  outboxCount: number;
  settings: ExtensionSettings;
  workingHours: string;
  warnPortals: number;
  /** Eski eklenti sürümlerinde yok. */
  scan?: ScanStatusView;
};

export type StatusInput = {
  version: string;
  parserVersion: string;
  pairing: Pairing;
  lastSessionOkAt: number | null;
  appSession: AppSession;
  appSeenAt: number | null;
  paused: boolean;
  pacing: PacingState;
  settings: ExtensionSettings;
  health: HealthMap;
  history: History;
  recent: RecentItem[];
  lastAt: number | null;
  lastKind: ProbeClassification | null;
  lastError: string | null;
  outboxCount: number;
  leaderActive: boolean;
  portalIds: readonly string[];
  nowMs: number;
  dayKey: string;
  tzOffsetMinutes: number;
  scan?: { states: ScanStates; progress: ScanProgress | null; pendingUploads: number };
};

/** Çalışma durumu — öncelik sırası: bağlı değil → duraklatıldı → oturum → engel → saat → sınırlar → sekme → çalışıyor. */
export function deriveRunState(i: StatusInput): { state: RunState; nextAt: number | null } {
  const { nowMs } = i;
  const connected = isPairingActive(i.pairing, i.lastSessionOkAt, nowMs);
  if (!connected) return { state: "disconnected", nextAt: null };
  if (i.paused) return { state: "paused", nextAt: null };
  if (i.appSession === "login_required" || i.appSession === "forbidden") return { state: "login_required", nextAt: null };
  if (i.pacing.cooldownUntilMs > nowMs) return { state: "cooldown", nextAt: i.pacing.cooldownUntilMs };
  if (!withinWorkingHours(i.settings, nowMs, i.tzOffsetMinutes)) {
    return { state: "outside_hours", nextAt: nowMs + msUntilWindowOpens(i.settings, nowMs, i.tzOffsetMinutes) };
  }
  const d = pacingDecision(i.pacing, nowMs, i.dayKey, { maxPerDay: i.settings.dailyCap });
  if (!d.ok && d.reason === "day_cap") return { state: "day_cap", nextAt: null };
  if (!d.ok && d.reason === "hour_cap") return { state: "hour_cap", nextAt: nowMs + d.waitMs };
  if (!i.leaderActive) return { state: "waiting_app", nextAt: null };
  return { state: "running", nextAt: d.ok ? nowMs : nowMs + d.waitMs };
}

export function buildStatusView(i: StatusInput): ExtensionStatusView {
  const { nowMs } = i;
  const { state, nextAt } = deriveRunState(i);
  const cooldownActive = i.pacing.cooldownUntilMs > nowMs;
  const portals: PortalHealthView[] = i.portalIds.map((id) => {
    const h = portalHealth(i.health[id], cooldownActive);
    return { id, enabled: portalEnabled(i.settings, id), ...h };
  });
  const hourAgo = nowMs - 3_600_000;
  return {
    version: i.version,
    parserVersion: i.parserVersion,
    connected: isPairingActive(i.pairing, i.lastSessionOkAt, nowMs),
    appSession: i.appSession,
    appSeenAt: i.appSeenAt,
    paused: i.paused,
    state,
    today: todayCount(i.pacing, i.dayKey),
    week: weekTotal(i.history, i.dayKey),
    dayCap: Math.min(EXTENSION_LIMITS.maxPerDay, i.settings.dailyCap),
    hourUsed: i.pacing.recentMs.filter((t) => t > hourAgo).length,
    hourCap: EXTENSION_LIMITS.maxPerHour,
    nextAt,
    cooldownUntil: i.pacing.cooldownUntilMs,
    lastAt: i.lastAt,
    lastKind: i.lastKind,
    lastError: i.lastError,
    portals,
    reasons: reasonCounts(i.health),
    recent: i.recent,
    outboxCount: i.outboxCount,
    settings: i.settings,
    workingHours: hoursLabel(i.settings),
    warnPortals: portals.filter((p) => p.enabled && (p.level === "red" || p.level === "yellow")).length,
    scan: buildScanView(i),
  };
}

export function buildScanView(i: Pick<StatusInput, "scan" | "portalIds">): ScanStatusView {
  const st = i.scan?.states ?? {};
  const list = i.portalIds.map((id) => ({
    id,
    lastFullAt: st[id]?.lastFullAt ?? null,
    lastTryAt: st[id]?.lastTryAt ?? null,
    lastResult: st[id]?.lastResult ?? null,
    lastRead: st[id]?.lastRead ?? 0,
    lastExpected: st[id]?.lastExpected ?? null,
  }));
  const fulls = list.map((p) => p.lastFullAt).filter((x): x is number => x !== null);
  return {
    lastFullAt: fulls.length > 0 ? Math.max(...fulls) : null,
    active: !!i.scan?.progress,
    activePortal: i.scan?.progress?.portal ?? null,
    activePages: i.scan?.progress?.pages ?? 0,
    activeRead: i.scan?.progress?.items.length ?? 0,
    activeExpected: i.scan?.progress?.totalCount ?? null,
    pendingUploads: i.scan?.pendingUploads ?? 0,
    portals: list,
  };
}

/** Sıradaki günlük taramanın en erken zamanı; hiç tam tarama yoksa null (tarayıcı/EmlakSoft bağlanır bağlanmaz başlar). */
export function nextScanAt(lastFullAt: number | null): number | null {
  return lastFullAt === null ? null : lastFullAt + SCAN_LIMITS.dueAfterMs;
}

/** Sayfaya (köprü) giden görünümü doğrular: geçersizse null. Sayfa yalnız bilinen alanları gösterir. */
export function parseStatusView(raw: unknown): ExtensionStatusView | null {
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Partial<ExtensionStatusView>;
  if (typeof o.version !== "string" || typeof o.connected !== "boolean" || typeof o.paused !== "boolean" || typeof o.state !== "string") return null;
  if (!Array.isArray(o.portals) || !Array.isArray(o.recent) || !Array.isArray(o.reasons)) return null;
  return o as ExtensionStatusView;
}
