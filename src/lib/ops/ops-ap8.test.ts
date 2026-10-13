import { describe, expect, it } from "vitest";
import { BACKUP_MAX_AGE_HOURS, evaluateBackup, parseBackupRecord } from "./backup-status";
import { classifyError, selectAutoResolvable, autoResolveCutoffIso } from "@/lib/errors/classify";
import { filterSystemRows, humanOnlyFrom, isSystemSettingKey } from "@/lib/settings/system-keys";
import { evaluateSecretHealth, type SecretCandidate } from "@/lib/settings/secret-health";
import { getSettingDef } from "@/lib/settings/registry";

const NOW = Date.parse("2026-10-13T12:00:00Z");
const H = 3_600_000;
const rec = (o: Record<string, unknown> = {}) =>
  JSON.stringify({
    at: new Date(NOW - 2 * H).toISOString(),
    dbFile: "db-x.dump.age",
    sizeBytes: 1024,
    tables: 300,
    encrypted: true,
    remote: true,
    storageObjects: 10,
    archiveFiles: 10,
    retentionDays: 14,
    ...o,
  });

describe("yedek durumu eşik tablosu", () => {
  it.each([
    ["sağlıklı", rec(), "ok", []],
    ["26 saatten eski", rec({ at: new Date(NOW - (BACKUP_MAX_AGE_HOURS + 1) * H).toISOString() }), "danger", ["saat önce"]],
    ["tam 26 saat eşik içinde", rec({ at: new Date(NOW - BACKUP_MAX_AGE_HOURS * H).toISOString() }), "ok", []],
    ["şifresiz", rec({ encrypted: false }), "danger", ["şifresiz"]],
    ["uzak kopya yok", rec({ remote: false }), "danger", ["Uzak kopya yok"]],
    ["dosya sayısı uyuşmuyor", rec({ archiveFiles: 9 }), "warn", ["uyuşmuyor"]],
    ["sayım bilinmiyor (null) uyarı üretmez", rec({ storageObjects: null }), "ok", []],
  ])("%s", (_name, raw, tone, titles) => {
    const ev = evaluateBackup(raw, NOW);
    expect(ev.tone).toBe(tone);
    for (const t of titles) expect(ev.issues.some((i) => i.title.toLowerCase().includes(t.toLowerCase()))).toBe(true);
    if (titles.length === 0) expect(ev.issues).toEqual([]);
  });

  it("kayıt yoksa 'henüz yazılmadı' (0 değil); bozuksa okunamadı", () => {
    const none = evaluateBackup(null, NOW);
    expect(none).toMatchObject({ tone: "none", record: null, emptyText: "Yedek bilgisi henüz yazılmadı." });
    expect(evaluateBackup("{bozuk", NOW).emptyText).toMatch(/okunamadı/);
    expect(parseBackupRecord(JSON.stringify({ sizeBytes: 1 }))).toBeNull();
  });

  it("şifresiz + uzak yok birlikte iki kırmızı satır", () => {
    const ev = evaluateBackup(rec({ encrypted: false, remote: false }), NOW);
    expect(ev.issues.filter((i) => i.tone === "danger")).toHaveLength(2);
    expect(ev.issues.every((i) => i.action.length > 10)).toBe(true);
  });
});

describe("classifyError", () => {
  it.each([
    ["ChunkLoadError: Loading chunk 123 failed.", "surum_gecisi"],
    ["Loading chunk app/page failed", "surum_gecisi"],
    ["TypeError: Failed to fetch dynamically imported module: https://x/_next/a.js", "surum_gecisi"],
    ["Minified React error #441; visit https://react.dev/errors/441", "react_render"],
    ["An error occurred in the Server Components render. The specific message is omitted", "react_render"],
    ["Müşteri listesi verileri eksik yüklendi (customers-list)", "diger"],
    ["", "diger"],
  ])("%s → %s", (msg, cls) => {
    expect(classifyError(msg)).toBe(cls);
  });
});

describe("otomatik kapanma seçicisi", () => {
  const rows = [
    { id: "eski-acik", resolved_at: null, last_seen: new Date(NOW - 15 * 24 * H).toISOString() },
    { id: "yeni-acik", resolved_at: null, last_seen: new Date(NOW - 13 * 24 * H).toISOString() },
    { id: "eski-kapali", resolved_at: "2026-09-01T00:00:00Z", last_seen: new Date(NOW - 40 * 24 * H).toISOString() },
  ];
  it("yalnız N günden eski AÇIK kayıtlar seçilir", () => {
    expect(selectAutoResolvable(rows, NOW, 14).map((r) => r.id)).toEqual(["eski-acik"]);
    expect(selectAutoResolvable(rows, NOW, 30).map((r) => r.id)).toEqual([]);
    expect(autoResolveCutoffIso(NOW, 14)).toBe(new Date(NOW - 14 * 24 * H).toISOString());
  });
  it("ayar varsayılanı 14 gün", () => {
    expect(getSettingDef("errors.auto_resolve_days")?.default).toBe(14);
  });
});

describe("sistem anahtarı süzgeci", () => {
  it.each([
    ["insight_engine_cursor", true],
    ["seo.audit.latest", true],
    ["seo.audit.history", true],
    ["seo.indexnow.seen", true],
    ["seo.indexnow.seen_2026", true],
    ["ops.backup.last", true],
    ["publishing.scheduled", true],
    ["publishing.scheduled_extra", false],
    ["seo.auditx", false],
    ["billing.default_trial_days", false],
    [null, false],
  ])("%s → %s", (key, expected) => {
    expect(isSystemSettingKey(key)).toBe(expected);
  });

  it("varsayılan AÇIK; gizlenen sayısı döner", () => {
    expect(humanOnlyFrom(undefined)).toBe(true);
    expect(humanOnlyFrom("goster")).toBe(false);
    const rows = [{ k: "insight_engine_cursor" }, { k: "billing.default_trial_days" }, { k: "ops.backup.last" }];
    expect(filterSystemRows(rows, (r) => r.k, true)).toEqual({ rows: [{ k: "billing.default_trial_days" }], hidden: 2 });
    expect(filterSystemRows(rows, (r) => r.k, false).hidden).toBe(0);
  });
});

describe("şifreli anahtar sağlığı", () => {
  const c = (key: string): SecretCandidate => ({ key, storageKey: key, label: key, href: `/x/${key}` });
  it("çözülemeyen 'cozulemedi', boş 'tanimsiz', düz metin/çözülen 'ok'; değer dönmez", () => {
    const out = evaluateSecretHealth(
      [c("a"), c("b"), c("c"), c("d")],
      { a: "v1.iv.tag.bozuk", b: null, c: "v1.iv.tag.iyi", d: "eski-duz-metin" },
      { a: "2026-10-01T00:00:00Z" },
      (_k, raw) => (raw.endsWith("iyi") ? "acik" : null),
    );
    expect(out.map((o) => o.durum)).toEqual(["cozulemedi", "tanimsiz", "ok", "ok"]);
    expect(out[0]).toEqual({ key: "a", label: "a", durum: "cozulemedi", changedAt: "2026-10-01T00:00:00Z", href: "/x/a" });
    expect(JSON.stringify(out)).not.toContain("acik");
  });
});
