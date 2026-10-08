import { describe, expect, it } from "vitest";
import { applyBlockCooldown, EXTENSION_LIMITS, INITIAL_PACING, pacingDecision, recordRequest } from "./extension-pacing";
import { DEFAULT_SETTINGS, hoursLabel, msUntilWindowOpens, portalEnabled, sanitizeSettings, withinWorkingHours } from "./extension-settings";
import {
  badgeFor,
  bumpHistory,
  classifyReply,
  entryFromReply,
  HEALTH_WINDOW,
  portalHealth,
  pushRecent,
  reasonCounts,
  recordHealth,
  RECENT_CAP,
  weekTotal,
  type HealthEntry,
} from "./extension-health";
import { backoffMs, dueEntries, enqueue, markDone, markFailed, OUTBOX_MAX, OUTBOX_MAX_ATTEMPTS, OUTBOX_TTL_MS, prune, sendVerdict, type OutboxEntry } from "./extension-outbox";
import { isAllowedAppOrigin, isPairingActive, isTrustedConnectRequest, isTrustedSender, PAIRING_TTL_MS } from "./extension-pairing";
import { compareVersions, EXTENSION_VERSION, extensionStoreLinks, extensionZipFileName, isOutdated } from "./extension-release";
import { buildTelemetry, sanitizeTelemetry, summarizeParserTelemetry } from "./extension-telemetry";
import { buildStatusView, deriveRunState, parseStatusView, type StatusInput } from "./extension-status-view";
import { wizardView } from "./extension-wizard";
import { reasonLabel } from "./extension-labels";
import { BRIDGE_DEFER_ERRORS, parseBridgeMessage, BRIDGE_RESPONSE_SOURCE } from "./bridge";
import { createZip, crc32, listZipEntries } from "../server/extension-zip";

const T0 = Date.UTC(2026, 9, 8, 10, 0, 0); // 2026-10-08 10:00 UTC
const DAY = "2026-10-08";

describe("hız sınırı ve duraklama ilkeleri (ayar yalnız KISAR)", () => {
  it("günlük sınır ayarı tavanı aşamaz; saatlik/aralık/engel kuralı ayarla gevşemez", () => {
    expect(EXTENSION_LIMITS.minIntervalMs).toBeGreaterThanOrEqual(20_000);
    expect(EXTENSION_LIMITS.maxPerHour).toBe(60);
    expect(EXTENSION_LIMITS.maxPerDay).toBe(600);
    const full = { ...INITIAL_PACING, dayKey: DAY, dayCount: 600 };
    // 10_000 isteyen ayar bile 600'de durur.
    expect(pacingDecision(full, T0, DAY, { maxPerDay: 10_000 })).toMatchObject({ ok: false, reason: "day_cap" });
    const halfDay = { ...INITIAL_PACING, dayKey: DAY, dayCount: 150 };
    expect(pacingDecision(halfDay, T0, DAY, { maxPerDay: 150 })).toMatchObject({ ok: false, reason: "day_cap" });
    expect(pacingDecision(halfDay, T0, DAY, { maxPerDay: 200 })).toEqual({ ok: true });
    expect(pacingDecision(halfDay, T0, DAY)).toEqual({ ok: true });
  });
  it("20 sn aralık + sapma; saatte 60; engelde 30 dk durur (ayar bunları kapatamaz)", () => {
    const s1 = recordRequest(INITIAL_PACING, T0, DAY, 0);
    expect(pacingDecision(s1, T0 + 19_000, DAY, { maxPerDay: 600 })).toMatchObject({ ok: false, reason: "interval" });
    expect(pacingDecision(s1, T0 + 20_000, DAY, { maxPerDay: 600 })).toEqual({ ok: true });
    const hour = { ...INITIAL_PACING, recentMs: Array.from({ length: 60 }, (_, i) => T0 - i * 30_000) };
    expect(pacingDecision(hour, T0, DAY, { maxPerDay: 600 })).toMatchObject({ ok: false, reason: "hour_cap" });
    for (const err of ["captcha", "login_required", "http_429", "http_403", "http_401"]) {
      const blocked = applyBlockCooldown(INITIAL_PACING, T0, err);
      expect(pacingDecision(blocked, T0 + 60_000, DAY)).toMatchObject({ ok: false, reason: "cooldown" });
      expect(blocked.cooldownUntilMs - T0).toBe(EXTENSION_LIMITS.blockCooldownMs);
    }
    // Ayrıştırıcı belirsizliği ("kontrol edilemedi") engel DEĞİLDİR: durdurmaz.
    expect(applyBlockCooldown(INITIAL_PACING, T0, "unexpected_structure")).toBe(INITIAL_PACING);
  });
});

describe("ayarlar", () => {
  it("güvenli sınırlar: ham değerler kısılır, bilinmeyen alan atılır", () => {
    expect(sanitizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    const s = sanitizeSettings({ portals: { sahibinden: false, "Kötü Ad!": true, x: 1 }, hours: { enabled: true, from: 99, to: -5 }, dailyCap: 99_999, extra: 1 });
    expect(s.dailyCap).toBe(600);
    expect(s.hours).toEqual({ enabled: true, from: 23, to: 0 });
    expect(s.portals).toEqual({ sahibinden: false });
    expect(sanitizeSettings({ dailyCap: 1 }).dailyCap).toBe(10);
    expect(sanitizeSettings({ dailyCap: "250" }).dailyCap).toBe(250);
  });
  it("portal aç/kapa: kayıt yoksa açık", () => {
    const s = sanitizeSettings({ portals: { emlakjet: false } });
    expect(portalEnabled(s, "emlakjet")).toBe(false);
    expect(portalEnabled(s, "sahibinden")).toBe(true);
  });
  it("çalışma saatleri (yerel saat): gündüz penceresi, gece yarısını aşan pencere, tüm gün", () => {
    const day = sanitizeSettings({ hours: { enabled: true, from: 9, to: 19 } });
    const tr = -180; // UTC+3: getTimezoneOffset() = -180
    expect(withinWorkingHours(day, Date.UTC(2026, 9, 8, 6, 0), tr)).toBe(true); // 09:00 yerel
    expect(withinWorkingHours(day, Date.UTC(2026, 9, 8, 16, 0), tr)).toBe(false); // 19:00 yerel (dışarıda)
    expect(withinWorkingHours(day, Date.UTC(2026, 9, 8, 5, 59), tr)).toBe(false); // 08:59
    const night = sanitizeSettings({ hours: { enabled: true, from: 22, to: 6 } });
    expect(withinWorkingHours(night, Date.UTC(2026, 9, 8, 20, 0), tr)).toBe(true); // 23:00
    expect(withinWorkingHours(night, Date.UTC(2026, 9, 8, 7, 0), tr)).toBe(false); // 10:00
    expect(withinWorkingHours(sanitizeSettings({ hours: { enabled: false, from: 9, to: 19 } }), T0, tr)).toBe(true);
    expect(withinWorkingHours(sanitizeSettings({ hours: { enabled: true, from: 5, to: 5 } }), T0, tr)).toBe(true);
    expect(hoursLabel(day)).toBe("09:00 – 19:00");
    expect(msUntilWindowOpens(day, Date.UTC(2026, 9, 8, 16, 0), tr)).toBe(14 * 3_600_000); // 19:00 → ertesi gün 09:00
  });
});

describe("sağlık, nedenler, geçmiş, rozet", () => {
  const e = (kind: HealthEntry["kind"], over: Partial<HealthEntry> = {}): HealthEntry => ({ at: T0, kind, error: null, partial: false, ...over });
  it("sınıf çıkarımı: ayrıştırıcı vermediyse hata koduna göre güvenli", () => {
    expect(classifyReply({ found: true })).toBe("live");
    expect(classifyReply({ found: false, notFound: true })).toBe("not_found");
    expect(classifyReply({ error: "http_429" })).toBe("blocked");
    expect(classifyReply({ error: "network_error" })).toBe("unknown");
    expect(classifyReply({})).toBe("unknown");
    expect(entryFromReply({ error: "captcha", classification: "blocked" }, T0)).toMatchObject({ kind: "blocked", error: "captcha" });
  });
  it("yeşil / sarı / kırmızı / veri yok", () => {
    expect(portalHealth([], false).level).toBe("idle");
    expect(portalHealth(Array.from({ length: 10 }, () => e("live")), false).level).toBe("green");
    expect(portalHealth([...Array.from({ length: 8 }, () => e("live")), e("unknown"), e("unknown")], false).level).toBe("yellow");
    expect(portalHealth([...Array.from({ length: 9 }, () => e("live")), e("blocked", { error: "http_429" })], false).level).toBe("yellow");
    expect(portalHealth([e("live"), e("unknown"), e("unknown"), e("unknown")], false).level).toBe("red");
    expect(portalHealth([e("live"), e("blocked", { error: "captcha" })], true).level).toBe("red");
    expect(portalHealth([e("live", { partial: true }), e("live", { partial: true }), e("live")], false).level).toBe("yellow");
  });
  it("halka tampon penceresi sınırlı; nedenler çoktan aza", () => {
    let map = {};
    for (let i = 0; i < HEALTH_WINDOW + 5; i += 1) map = recordHealth(map, "sahibinden", e("unknown", { error: i % 3 === 0 ? "captcha" : "unexpected_structure" }));
    expect((map as Record<string, unknown[]>).sahibinden).toHaveLength(HEALTH_WINDOW);
    const reasons = reasonCounts(map);
    expect(reasons[0].count).toBeGreaterThanOrEqual(reasons[1].count);
    expect(reasonLabel("captcha")).toMatch(/CAPTCHA/);
    expect(reasonLabel("zzz_bilinmeyen")).toBe("Okunamadı");
    expect(reasonLabel("http_503")).toMatch(/5xx/);
  });
  it("son sonuçlar sınırlı; günlük/haftalık sayaç", () => {
    let list: ReturnType<typeof pushRecent> = [];
    for (let i = 0; i < RECENT_CAP + 4; i += 1) list = pushRecent(list, { at: i, portal: "emlakjet", externalId: String(i), kind: "live", error: null });
    expect(list).toHaveLength(RECENT_CAP);
    expect(list[0].at).toBe(RECENT_CAP + 3);
    let h = {};
    for (const d of ["2026-10-01", "2026-10-02", "2026-10-05", "2026-10-08", "2026-10-08"]) h = bumpHistory(h, d);
    expect(weekTotal(h, "2026-10-08")).toBe(4); // 01 hariç (8 gün önce); 02, 05 ve 08×2 dahil (bugün dahil 7 gün)
    expect(weekTotal(h, "bozuk")).toBe(0);
  });
  it("rozet: bağlı değil / duraklatıldı / uyarı / aktif", () => {
    expect(badgeFor({ connected: false, paused: false, cooldownActive: false, warnPortals: 0 })).toMatchObject({ text: "?", color: "gray" });
    expect(badgeFor({ connected: true, paused: true, cooldownActive: false, warnPortals: 3 })).toMatchObject({ text: "II", color: "amber" });
    expect(badgeFor({ connected: true, paused: false, cooldownActive: false, warnPortals: 2 })).toMatchObject({ text: "2", color: "red" });
    expect(badgeFor({ connected: true, paused: false, cooldownActive: true, warnPortals: 0 })).toMatchObject({ text: "1", color: "red" });
    expect(badgeFor({ connected: true, paused: false, cooldownActive: false, warnPortals: 0 })).toMatchObject({ text: "✓", color: "green" });
  });
});

describe("sonuç kuyruğu (çevrimdışı) ve idempotent gönderim", () => {
  const base = { jobId: "j1", clientId: "c1", result: "present", observed: { price: 1 }, telemetry: null };
  it("aynı iş kimliği iki kez eklenirse tek kayıt; sınır ve TTL", () => {
    let q: OutboxEntry[] = enqueue([], base, T0);
    q = enqueue(q, { ...base, result: "absent" }, T0 + 1);
    expect(q).toHaveLength(1);
    expect(q[0].result).toBe("absent");
    let big: OutboxEntry[] = [];
    for (let i = 0; i < OUTBOX_MAX + 10; i += 1) big = enqueue(big, { ...base, jobId: `j${i}` }, T0 + i);
    expect(big).toHaveLength(OUTBOX_MAX);
    expect(prune(q, T0 + OUTBOX_TTL_MS + 5)).toHaveLength(0);
  });
  it("üstel geri çekilme: 30 sn, 1 dk, 2 dk ... en çok 15 dk; vadesi gelmeyen gönderilmez", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8].map(backoffMs)).toEqual([30_000, 60_000, 120_000, 240_000, 480_000, 900_000, 900_000, 900_000]);
    let q = enqueue([], base, T0);
    expect(dueEntries(q, T0)).toHaveLength(1);
    q = markFailed(q, "j1", T0);
    expect(dueEntries(q, T0 + 29_000)).toHaveLength(0);
    expect(dueEntries(q, T0 + 30_000)).toHaveLength(1);
    q = markFailed(q, "j1", T0 + 30_000);
    expect(q[0].nextAttemptAt).toBe(T0 + 30_000 + 60_000);
    for (let i = 0; i < OUTBOX_MAX_ATTEMPTS; i += 1) q = markFailed(q, "j1", T0 + 60_000 + i);
    expect(q).toHaveLength(0); // en çok deneme aşıldı: bırakılır
    expect(markDone(enqueue([], base, T0), "j1")).toHaveLength(0);
  });
  it("uç yanıtı kararı: ağ/5xx/429/401 yeniden dene; kabul/replay tamam; kalıcı ret bırak", () => {
    expect(sendVerdict(0, { ok: false, error: "network" })).toBe("retry");
    expect(sendVerdict(503, {})).toBe("retry");
    expect(sendVerdict(429, {})).toBe("retry");
    expect(sendVerdict(401, {})).toBe("retry");
    expect(sendVerdict(200, { ok: true, outcome: "replay" })).toBe("done");
    expect(sendVerdict(200, { ok: false, error: "rpc_error" })).toBe("retry");
    expect(sendVerdict(200, { ok: false, error: "failed", outcome: "job_not_found" })).toBe("drop");
    expect(sendVerdict(400, { ok: false, error: "invalid_input" })).toBe("drop");
  });
});

describe("eşleştirme: köken ve kullanıcı etkinliği", () => {
  const allowed = ["https://emlaksoft.vercel.app", "https://app.ofisim.com"];
  const ok = { fromSameWindow: true, eventOrigin: "https://emlaksoft.vercel.app", locationOrigin: "https://emlaksoft.vercel.app", allowedOrigins: allowed, userActive: true, data: { type: "connect-request", nonce: "abcdef123456" } };
  it("izinli köken tam eşleşme; alt alan/yakın alan adı/http reddedilir (localhost hariç)", () => {
    expect(isAllowedAppOrigin("https://emlaksoft.vercel.app", allowed)).toBe(true);
    expect(isAllowedAppOrigin("https://emlaksoft.vercel.app.evil.example", allowed)).toBe(false);
    expect(isAllowedAppOrigin("https://evil.emlaksoft.vercel.app", allowed)).toBe(false);
    expect(isAllowedAppOrigin("http://emlaksoft.vercel.app", allowed)).toBe(false);
    expect(isAllowedAppOrigin("https://emlaksoft.vercel.app:8443", allowed)).toBe(false);
    expect(isAllowedAppOrigin("javascript:alert(1)", allowed)).toBe(false);
    expect(isAllowedAppOrigin(null, allowed)).toBe(false);
    expect(isAllowedAppOrigin("http://localhost:3000", ["http://localhost/*"])).toBe(true);
    expect(isAllowedAppOrigin("http://localhost:3000", allowed)).toBe(false);
    expect(isAllowedAppOrigin("https://emlaksoft.vercel.app", ["https://emlaksoft.vercel.app/*"])).toBe(true);
  });
  it("bağlan isteği: yalnız aynı pencere + aynı köken + izinli köken + kullanıcı etkinliği + geçerli nonce", () => {
    expect(isTrustedConnectRequest(ok)).toBe(true);
    expect(isTrustedConnectRequest({ ...ok, fromSameWindow: false })).toBe(false);
    expect(isTrustedConnectRequest({ ...ok, eventOrigin: "https://evil.example" })).toBe(false);
    expect(isTrustedConnectRequest({ ...ok, locationOrigin: "https://evil.example", eventOrigin: "https://evil.example" })).toBe(false);
    expect(isTrustedConnectRequest({ ...ok, userActive: false })).toBe(false);
    expect(isTrustedConnectRequest({ ...ok, data: { type: "connect-request", nonce: "x" } })).toBe(false);
    expect(isTrustedConnectRequest({ ...ok, data: { type: "verify-request", nonce: "abcdef123456" } })).toBe(false);
    expect(isTrustedConnectRequest({ ...ok, data: null })).toBe(false);
  });
  it("iletiyi kabul eden gönderici: kendi eklentisi + (sekmesiz açılır pencere | izinli EmlakSoft sekmesi)", () => {
    expect(isTrustedSender({ id: "ext1" }, "ext1", allowed)).toBe(true);
    expect(isTrustedSender({ id: "ext1", tab: { url: "https://emlaksoft.vercel.app/app/ilan-kontrol" } }, "ext1", allowed)).toBe(true);
    expect(isTrustedSender({ id: "ext1", tab: { url: "https://evil.example/" } }, "ext1", allowed)).toBe(false);
    expect(isTrustedSender({ id: "baska", tab: { url: "https://emlaksoft.vercel.app/" } }, "ext1", allowed)).toBe(false);
    expect(isTrustedSender({ id: "ext1", tab: {} }, "ext1", allowed)).toBe(false);
  });
  it("bağlantı kısa ömürlü: oturum 30 gün görülmezse düşer; bağlı değilse hiç aktif değil", () => {
    expect(isPairingActive(null, T0, T0)).toBe(false);
    const p = { at: T0, origin: "https://emlaksoft.vercel.app" };
    expect(isPairingActive(p, null, T0 + PAIRING_TTL_MS - 1)).toBe(true);
    expect(isPairingActive(p, null, T0 + PAIRING_TTL_MS)).toBe(false);
    expect(isPairingActive(p, T0 + PAIRING_TTL_MS, T0 + PAIRING_TTL_MS + 5)).toBe(true); // oturum görüldü: uzar
  });
  it("köprü: yeni ileti tipleri doğrulanır; bağlı olmayan/devre dışı portal yanıtları işi bırakır", () => {
    expect(parseBridgeMessage({ source: BRIDGE_RESPONSE_SOURCE, type: "connect-response", nonce: "abc", ok: true })).toEqual({ type: "connect-response", nonce: "abc", ok: true });
    expect(parseBridgeMessage({ source: BRIDGE_RESPONSE_SOURCE, type: "connect-response", nonce: "", ok: true })).toBeNull();
    expect(parseBridgeMessage({ source: BRIDGE_RESPONSE_SOURCE, type: "status-response", id: "st-1", status: { a: 1 } })).toMatchObject({ type: "status-response", id: "st-1" });
    expect(parseBridgeMessage({ source: "baska", type: "status-response", id: "x" })).toBeNull();
    expect(BRIDGE_DEFER_ERRORS).toEqual(expect.arrayContaining(["busy", "paused", "not_connected", "portal_disabled"]));
  });
});

describe("telemetri (kişisel veri yok)", () => {
  it("eklenti yanıttan yalnız sayaç alanlarını çıkarır; ilan no/başlık/fiyat YOK", () => {
    const t = buildTelemetry("sahibinden", { found: true, price: 5, title: "Gizli başlık", advisorName: "Kişi", parserVersion: "e2@2026-10-08.1", classification: "live", layer: "json_ld", partial: false });
    expect(t).toEqual({ portal: "sahibinden", parserVersion: "e2@2026-10-08.1", classification: "live", layer: "json_ld", errorCode: null, partial: false });
    expect(JSON.stringify(t)).not.toMatch(/Gizli|Kişi/);
    expect(buildTelemetry("sahibinden", { error: "network_error" })).toBeNull(); // sürüm yok → ayrıştırıcı çalışmadı
    expect(buildTelemetry("Kötü Portal", { parserVersion: "e2@1", error: "x" })).toBeNull();
  });
  it("sunucu doğrulaması: geçersiz alanlar reddedilir", () => {
    expect(sanitizeTelemetry({ portal: "emlakjet", parserVersion: "e2@2026-10-08.1", classification: "unknown", layer: "meta", errorCode: "unexpected_structure", partial: true })).toMatchObject({ classification: "unknown", partial: true });
    expect(sanitizeTelemetry({ portal: "emlakjet", parserVersion: "e2@1", classification: "hack" })).toBeNull();
    expect(sanitizeTelemetry({ portal: "../x", parserVersion: "e2@1", classification: "live" })).toBeNull();
    expect(sanitizeTelemetry({ portal: "emlakjet", parserVersion: "x".repeat(41), classification: "live" })).toBeNull();
    expect(sanitizeTelemetry("x")).toBeNull();
    expect(sanitizeTelemetry({ portal: "emlakjet", parserVersion: "e2@1", classification: "live", layer: "uydurma", errorCode: "Büyük Harf" })).toMatchObject({ layer: null, errorCode: null });
  });
  it("sürüm başına özet: 'kontrol edilemedi' oranı, yapı tanınmadı, kısmi okuma", () => {
    const rows = [
      { portal: "sahibinden", parser_version: "e2@a", classification: "live", layer: "json_ld", error_code: "", partial: false, n: 70 },
      { portal: "sahibinden", parser_version: "e2@a", classification: "live", layer: "pattern", error_code: "", partial: true, n: 10 },
      { portal: "sahibinden", parser_version: "e2@a", classification: "unknown", layer: "", error_code: "unexpected_structure", partial: false, n: 15 },
      { portal: "sahibinden", parser_version: "e2@a", classification: "blocked", layer: "", error_code: "captcha", partial: false, n: 5 },
      { portal: "sahibinden", parser_version: "e1@z", classification: "unknown", layer: "", error_code: "unexpected_structure", partial: false, n: 4 },
    ];
    const s = summarizeParserTelemetry(rows);
    const a = s.find((x) => x.parserVersion === "e2@a")!;
    expect(a).toMatchObject({ total: 100, unreadable: 20, drift: 15, partial: 10 });
    expect(a.unreadableRate).toBeCloseTo(0.2);
    expect(s.find((x) => x.parserVersion === "e1@z")!.unreadableRate).toBe(1);
  });
});

describe("durum görünümü, sihirbaz, sürüm", () => {
  const input = (over: Partial<StatusInput> = {}): StatusInput => ({
    version: EXTENSION_VERSION,
    parserVersion: "e2@x",
    pairing: { at: T0, origin: "https://emlaksoft.vercel.app" },
    lastSessionOkAt: T0,
    appSession: "ok",
    appSeenAt: T0,
    paused: false,
    pacing: INITIAL_PACING,
    settings: DEFAULT_SETTINGS,
    health: {},
    history: {},
    recent: [],
    lastAt: null,
    lastKind: null,
    lastError: null,
    outboxCount: 0,
    leaderActive: true,
    portalIds: ["sahibinden", "hepsiemlak", "emlakjet"],
    nowMs: T0,
    dayKey: DAY,
    tzOffsetMinutes: -180,
    ...over,
  });
  it("durum önceliği", () => {
    expect(deriveRunState(input({ pairing: null })).state).toBe("disconnected");
    expect(deriveRunState(input({ paused: true })).state).toBe("paused");
    expect(deriveRunState(input({ appSession: "login_required" })).state).toBe("login_required");
    expect(deriveRunState(input({ pacing: { ...INITIAL_PACING, cooldownUntilMs: T0 + 60_000 } })).state).toBe("cooldown");
    expect(deriveRunState(input({ nowMs: Date.UTC(2026, 9, 8, 22, 0) })).state).toBe("outside_hours"); // 01:00 yerel
    expect(deriveRunState(input({ pacing: { ...INITIAL_PACING, dayKey: DAY, dayCount: 600 } })).state).toBe("day_cap");
    expect(deriveRunState(input({ leaderActive: false })).state).toBe("waiting_app");
    expect(deriveRunState(input()).state).toBe("running");
    expect(deriveRunState(input({ pairing: { at: T0 - PAIRING_TTL_MS - 1, origin: "https://emlaksoft.vercel.app" }, lastSessionOkAt: null })).state).toBe("disconnected");
  });
  it("görünüm: sayaçlar, limit göstergesi, portal sağlığı; sayfa için doğrulanır", () => {
    const pacing = { ...INITIAL_PACING, dayKey: DAY, dayCount: 12, recentMs: [T0 - 1000, T0 - 2000] };
    const v = buildStatusView(input({ pacing, history: { [DAY]: 12 }, settings: sanitizeSettings({ dailyCap: 100, portals: { emlakjet: false } }) }));
    expect(v).toMatchObject({ today: 12, week: 12, dayCap: 100, hourUsed: 2, hourCap: 60, connected: true, state: "running" });
    expect(v.portals.find((p) => p.id === "emlakjet")).toMatchObject({ enabled: false });
    expect(parseStatusView(JSON.parse(JSON.stringify(v)))).not.toBeNull();
    expect(parseStatusView({ version: 1 })).toBeNull();
    expect(parseStatusView(null)).toBeNull();
  });
  it("sihirbaz: kurulu mu / güncel mi / bağlı mı otomatik", () => {
    const w = (o: Partial<Parameters<typeof wizardView>[0]>) => wizardView({ installed: true, installedVersion: EXTENSION_VERSION, connected: true, paused: false, latestVersion: EXTENSION_VERSION, ...o });
    expect(w({ installed: false, installedVersion: null, connected: false }).stage).toBe("install");
    expect(w({ installedVersion: "0.1.0", connected: false }).stage).toBe("update");
    expect(w({ connected: false }).stage).toBe("connect");
    expect(w({ paused: true }).stage).toBe("paused");
    expect(w({}).stage).toBe("ready");
    expect(w({ connected: false }).steps).toEqual({ download: true, load: true, connect: false });
  });
  it("sürüm karşılaştırma ve mağaza bağlantıları (yalnız resmi mağaza adresi)", () => {
    expect(compareVersions("0.1.0", "0.2.0")).toBe(-1);
    expect(compareVersions("0.10.0", "0.2.0")).toBe(1);
    expect(compareVersions("1.0", "1.0.0")).toBe(0);
    expect(isOutdated("0.1.0")).toBe(true);
    expect(isOutdated(EXTENSION_VERSION)).toBe(false);
    expect(isOutdated(null)).toBe(false);
    expect(extensionZipFileName("1.2.3")).toBe("emlaksoft-ilan-kontrol-1.2.3.zip");
    expect(extensionStoreLinks({ chrome: "https://chromewebstore.google.com/detail/emlaksoft/abcdef" }).chrome).toContain("chromewebstore.google.com");
    expect(extensionStoreLinks({ chrome: "https://evil.example/detail/x", edge: "javascript:alert(1)" })).toEqual({ chrome: null, edge: null });
    expect(extensionStoreLinks({ edge: "https://microsoftedge.microsoft.com/addons/detail/emlaksoft/abc" }).edge).toContain("microsoftedge");
    expect(extensionStoreLinks({})).toEqual({ chrome: null, edge: null });
  });
});

describe("ZIP paketi", () => {
  it("belirlenimci, doğrulanabilir; geçersiz ad reddedilir", () => {
    const files = [
      { name: "manifest.json", data: Buffer.from('{"a":1}') },
      { name: "icons/icon-16.png", data: Buffer.from([1, 2, 3, 4]) },
      { name: "background.js", data: Buffer.from("x".repeat(5000)) },
    ];
    const a = createZip(files);
    const b = createZip([...files].reverse());
    expect(a.equals(b)).toBe(true);
    const entries = listZipEntries(a);
    expect(entries.map((e) => e.name)).toEqual(["background.js", "icons/icon-16.png", "manifest.json"]);
    expect(entries[0].size).toBe(5000);
    expect(entries[0].crc).toBe(crc32(Buffer.from("x".repeat(5000))));
    expect(crc32(Buffer.from("123456789"))).toBe(0xcbf43926);
    expect(() => createZip([{ name: "../x", data: Buffer.from("a") }])).toThrow();
    expect(() => createZip([{ name: "/abs", data: Buffer.from("a") }])).toThrow();
  });
});
