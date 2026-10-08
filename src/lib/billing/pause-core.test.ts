import { describe, expect, it } from "vitest";
import { DAY_MS } from "@/lib/clock";
import {
  PAUSE_ABSOLUTE_MAX_DAYS,
  PAUSE_BLOCK_MESSAGE,
  PAUSE_YEARLY_WINDOW_DAYS,
  clampPauseMaxDays,
  evaluatePause,
  isPausedWriteBlocked,
  pauseViewOf,
  resumeExtensionMs,
  resumedPeriodEndMs,
} from "@/lib/billing/pause-core";

const NOW = Date.UTC(2026, 9, 7);
const ok = {
  enabled: true,
  role: "owner",
  status: "active",
  periodEndMs: NOW + 20 * DAY_MS,
  cancelAtPeriodEnd: false,
  pausedAtMs: null,
  lastStartedMs: null,
  maxDays: 30,
  days: 30,
  nowMs: NOW,
};

describe("duraklatma süre ve limit kuralları", () => {
  it("uygun abonelik: planlı bitiş = şimdi + gün", () => {
    const d = evaluatePause(ok);
    expect(d).toEqual({ ok: true, endsAtMs: NOW + 30 * DAY_MS });
  });

  it("ayar azami süreyi aşamaz (varsayılan 30)", () => {
    const d = evaluatePause({ ...ok, days: 31 });
    expect(d).toMatchObject({ ok: false, code: "too_long" });
    expect((d as { message: string }).message).toMatch(/en fazla 30 gün/);
    expect(evaluatePause({ ...ok, maxDays: 45, days: 45 }).ok).toBe(true);
  });

  it("gün sayısı pozitif tam sayı olmalı", () => {
    for (const days of [0, -3, 1.5, Number.NaN]) {
      expect(evaluatePause({ ...ok, days })).toMatchObject({ ok: false, code: "invalid_days" });
    }
  });

  it("yılda 1 kez: son duraklatmadan 365 gün geçmeden reddedilir, sonra serbest", () => {
    const last = NOW - 100 * DAY_MS;
    const d = evaluatePause({ ...ok, lastStartedMs: last });
    expect(d).toMatchObject({ ok: false, code: "yearly_limit", nextAllowedAtMs: last + PAUSE_YEARLY_WINDOW_DAYS * DAY_MS });
    expect(evaluatePause({ ...ok, lastStartedMs: NOW - 366 * DAY_MS }).ok).toBe(true);
    expect(evaluatePause({ ...ok, lastStartedMs: NOW - PAUSE_YEARLY_WINDOW_DAYS * DAY_MS + 1 }).ok).toBe(false);
  });

  it("yalnız ofis sahibi; yalnız aktif, dönemi süren, iptal talebi olmayan abonelik", () => {
    expect(evaluatePause({ ...ok, role: "gm" })).toMatchObject({ code: "not_owner" });
    expect(evaluatePause({ ...ok, status: "trialing" })).toMatchObject({ code: "not_active" });
    expect(evaluatePause({ ...ok, status: "past_due" })).toMatchObject({ code: "not_active" });
    expect(evaluatePause({ ...ok, periodEndMs: NOW - 1 })).toMatchObject({ code: "period_over" });
    expect(evaluatePause({ ...ok, periodEndMs: null })).toMatchObject({ code: "period_over" });
    expect(evaluatePause({ ...ok, cancelAtPeriodEnd: true })).toMatchObject({ code: "cancel_pending" });
    expect(evaluatePause({ ...ok, pausedAtMs: NOW - DAY_MS })).toMatchObject({ code: "already_paused" });
  });

  it("bayrak kapalıysa her şey reddedilir (varsayılan KAPALI)", () => {
    expect(evaluatePause({ ...ok, enabled: false })).toMatchObject({ ok: false, code: "disabled" });
  });

  it("ayar değeri 1..90 dışında / bozuksa varsayılan 30", () => {
    expect(clampPauseMaxDays("45")).toBe(45);
    expect(clampPauseMaxDays(PAUSE_ABSOLUTE_MAX_DAYS)).toBe(90);
    for (const bad of ["0", "91", "abc", "", null, undefined, 1.5, -1]) expect(clampPauseMaxDays(bad)).toBe(30);
  });
});

describe("devam: dönem bitişi duraklatma süresi kadar uzar", () => {
  const started = NOW;
  const ends = NOW + 30 * DAY_MS;
  const periodEnd = NOW + 10 * DAY_MS;

  it("erken devam: geçen süre kadar", () => {
    expect(resumeExtensionMs(started, ends, NOW + 5 * DAY_MS)).toBe(5 * DAY_MS);
    expect(resumedPeriodEndMs(periodEnd, started, ends, NOW + 5 * DAY_MS)).toBe(periodEnd + 5 * DAY_MS);
  });

  it("planlı bitişte (cron) tam süre; geç çalışan cron planlı bitişi AŞAMAZ", () => {
    expect(resumeExtensionMs(started, ends, ends)).toBe(30 * DAY_MS);
    expect(resumeExtensionMs(started, ends, ends + 3 * DAY_MS)).toBe(30 * DAY_MS);
  });

  it("negatif uzama yok", () => {
    expect(resumeExtensionMs(started, ends, started - 1000)).toBe(0);
  });
});

describe("salt-okunur kapı", () => {
  it("duraklatılmışsa yazma eylemleri engellenir; okuma ve abonelik modülü serbest", () => {
    expect(isPausedWriteBlocked(true, "customers", "create")).toBe(true);
    expect(isPausedWriteBlocked(true, "properties", "edit")).toBe(true);
    expect(isPausedWriteBlocked(true, "settings", "delete")).toBe(true);
    expect(isPausedWriteBlocked(true, "customers", "view")).toBe(false);
    expect(isPausedWriteBlocked(true, "billing", "edit")).toBe(false);
  });

  it("duraklatılmamışsa hiçbir şey engellenmez", () => {
    expect(isPausedWriteBlocked(false, "customers", "create")).toBe(false);
  });

  it("hata metni açık ve Türkçe", () => {
    expect(PAUSE_BLOCK_MESSAGE).toMatch(/salt-okunur/);
    expect(PAUSE_BLOCK_MESSAGE).toMatch(/devam ettirin/);
  });

  it("satırdan görünüm: yalnız pause_started_at doluysa duraklatılmış", () => {
    expect(pauseViewOf(null).paused).toBe(false);
    expect(pauseViewOf({ pause_started_at: null, pause_ends_at: null }).paused).toBe(false);
    const v = pauseViewOf({ pause_started_at: "2026-10-07T00:00:00Z", pause_ends_at: "2026-11-06T00:00:00Z" });
    expect(v.paused).toBe(true);
    expect(v.endsAtMs! - v.startedAtMs!).toBe(30 * DAY_MS);
  });
});
