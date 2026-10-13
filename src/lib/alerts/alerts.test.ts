import { describe, expect, it } from "vitest";
import { CRON_JOBS } from "@/lib/cron-jobs";
import { ALERT_RULE_KEYS, isMuted, mergeRuleConfigs, notifyDecision } from "./rules";
import { evaluateAlerts, formatAlertText, isPausedJobEvent, type AlertSnapshot } from "./evaluate";
import { channelTargetHint, decodeChannelConfig, encodeChannelConfig, isBlockedWebhookHost, parseChannelInput, parseWebhookUrl } from "./channel-config";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const NOW = Date.parse("2026-10-13T12:00:00Z");
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();
const okBeats = () => CRON_JOBS.map((j) => ({ job: j.job, last_run_at: ago(1), last_status: "ok", last_detail: null }));

function snap(over: Partial<AlertSnapshot> = {}): AlertSnapshot {
  return {
    nowMs: NOW,
    heartbeats: okBeats(),
    pausedJobs: new Set(),
    errorsLast5m: 0,
    backup: { raw: JSON.stringify({ at: ago(60), encrypted: true, remote: true }), heartbeat: { last_status: "ok", last_run_at: ago(60) } },
    disk: { host: "prod", pct: 40, at: ago(1) },
    captureProblems: 0,
    mrr: { latest: 1000, latestDay: "2026-10-13", previous: 1000, previousDay: "2026-10-06" },
    ...over,
  };
}

describe("uyarı kuralları", () => {
  const rules = mergeRuleConfigs([]);

  it("anahtar listesi migration CHECK ve tohum satırlarıyla aynı", () => {
    const sql = readFileSync(join(process.cwd(), "supabase/migrations/20261013004900_ops_alerts.sql"), "utf8");
    for (const k of ALERT_RULE_KEYS) {
      expect(sql).toContain(`'${k}'`);
      expect(sql).toMatch(new RegExp(`\\('${k}', true,`));
    }
  });

  it("varsayılanlar ve bozuk eşik", () => {
    expect(rules.disk_usage.threshold).toBe(85);
    expect(rules.health_down.threshold).toBe(2);
    const m = mergeRuleConfigs([{ key: "disk_usage", enabled: false, threshold: "999", repeat_minutes: 1, muted_until: null }]);
    expect(m.disk_usage.enabled).toBe(false);
    expect(m.disk_usage.threshold).toBe(85);
    expect(m.disk_usage.repeatMinutes).toBe(180);
  });

  it("her şey sağlıklıysa tetik yok, tüm kurallar değerlendirildi", () => {
    const r = evaluateAlerts(snap(), rules);
    expect(r.firing).toEqual([]);
    expect([...r.evaluated].sort()).toEqual(["backup_failed", "cron_error", "cron_late", "disk_usage", "error_burst", "mrr_drop", "payment_capture"]);
  });

  it("cron gecikmesi ve hatası; duraklatılan iş uyarı üretmez", () => {
    const beats = okBeats().map((b) =>
      b.job === "ticket-sla" ? { ...b, last_run_at: ago(60) } : b.job === "dunning" ? { ...b, last_status: "error", last_detail: "boom" } : b,
    );
    const r = evaluateAlerts(snap({ heartbeats: beats }), rules);
    expect(r.firing.map((f) => f.fingerprint).sort()).toEqual(["cron_error:dunning", "cron_late:ticket-sla"]);
    const paused = evaluateAlerts(snap({ heartbeats: beats, pausedJobs: new Set(["ticket-sla", "dunning"]) }), rules);
    expect(paused.firing).toEqual([]);
  });

  it("hata patlaması eşiği, disk, ödeme, MRR", () => {
    const r = evaluateAlerts(
      snap({
        errorsLast5m: 20,
        disk: { host: "prod", pct: 91.3, at: ago(2) },
        captureProblems: 2,
        mrr: { latest: 850, latestDay: "2026-10-13", previous: 1000, previousDay: "2026-10-06" },
      }),
      rules,
    );
    expect(r.firing.map((f) => f.ruleKey).sort()).toEqual(["disk_usage", "error_burst", "mrr_drop", "payment_capture"]);
    expect(r.firing.find((f) => f.ruleKey === "disk_usage")?.title).toContain("%91,3");
  });

  it("bayat disk ölçümü ve eksik veri değerlendirilmez (düzelme sayılmaz)", () => {
    const r = evaluateAlerts(snap({ disk: { host: "prod", pct: 99, at: ago(60) }, errorsLast5m: null, mrr: null, heartbeats: null }), rules);
    expect(r.firing).toEqual([]);
    expect(r.evaluated.has("disk_usage")).toBe(false);
    expect(r.evaluated.has("error_burst")).toBe(false);
    expect(r.evaluated.has("cron_late")).toBe(false);
  });

  it("yedek: hata, kayıt yok, bayat", () => {
    expect(evaluateAlerts(snap({ backup: { raw: null, heartbeat: null } }), rules).firing[0]?.title).toBe("Yedek bayat");
    expect(
      evaluateAlerts(snap({ backup: { raw: JSON.stringify({ at: ago(60 * 30) }), heartbeat: null } }), rules).firing[0]?.body,
    ).toContain("30 saat");
    expect(
      evaluateAlerts(snap({ backup: { raw: JSON.stringify({ at: ago(60) }), heartbeat: { last_status: "error", last_run_at: ago(5) } } }), rules).firing[0]?.title,
    ).toBe("Yedek başarısız");
  });

  it("kapalı kural tetiklemez", () => {
    const off = mergeRuleConfigs([{ key: "error_burst", enabled: false, threshold: 1, repeat_minutes: 60, muted_until: null }]);
    expect(evaluateAlerts(snap({ errorsLast5m: 500 }), off).firing).toEqual([]);
  });

  it("bildirim kararı: ilk, tekrar aralığı, sessiz", () => {
    const cfg = { repeatMinutes: 60, mutedUntil: null };
    expect(notifyDecision({ last_notified_at: null }, cfg, NOW)).toBe("notify");
    expect(notifyDecision({ last_notified_at: ago(30) }, cfg, NOW)).toBe("wait");
    expect(notifyDecision({ last_notified_at: ago(61) }, cfg, NOW)).toBe("notify");
    const muted = { repeatMinutes: 60, mutedUntil: new Date(NOW + 60_000).toISOString() };
    expect(notifyDecision({ last_notified_at: null }, muted, NOW)).toBe("muted");
    expect(isMuted({ mutedUntil: ago(1) }, NOW)).toBe(false);
  });

  it("mesaj biçimi", () => {
    const t = formatAlertText({ title: "Disk", body: "dolu", href: "/admin/sistem" }, "resolved", "https://emlaksoft.com.tr/");
    expect(t.subject).toBe("[DÜZELDİ] Disk");
    expect(t.text).toContain("https://emlaksoft.com.tr/admin/sistem");
  });

  it("duraklatılan işin cron olayı 'düzeldi' sayılmaz", () => {
    const paused = new Set(["ticket-sla"]);
    expect(isPausedJobEvent("cron_late:ticket-sla", paused)).toBe(true);
    expect(isPausedJobEvent("cron_error:ticket-sla", paused)).toBe(true);
    expect(isPausedJobEvent("cron_late:digest", paused)).toBe(false);
    expect(isPausedJobEvent("error_burst", paused)).toBe(false);
  });
});

describe("uyarı kanalı yapılandırması", () => {
  it("Telegram doğrulaması ve maskeli hedef", () => {
    const bad = parseChannelInput({ kind: "telegram", name: "x", botToken: "abc", chatId: "1" });
    expect(bad.ok).toBe(false);
    const ok = parseChannelInput({ kind: "telegram", name: "Ops", botToken: `123456789:${"A".repeat(35)}`, chatId: "-1001234567890" });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(channelTargetHint(ok.config)).toBe("sohbet …7890");
      expect(channelTargetHint(ok.config)).not.toContain("AAAA");
      expect(decodeChannelConfig("telegram", encodeChannelConfig(ok.config))).toEqual(ok.config);
    }
  });

  it("e-posta ve webhook", () => {
    const e = parseChannelInput({ kind: "email", name: "Ops", email: "Ops@Ornek.com" });
    expect(e.ok && e.config).toEqual({ kind: "email", to: "ops@ornek.com" });
    expect(parseChannelInput({ kind: "webhook", name: "W", url: "http://ornek.com/h" }).ok).toBe(false);
    expect(parseChannelInput({ kind: "webhook", name: "W", url: "https://ornek.com/h", secret: "kisa" }).ok).toBe(false);
    const w = parseChannelInput({ kind: "webhook", name: "W", url: "https://hooks.ornek.com/h", secret: "0123456789abcdef" });
    expect(w.ok && channelTargetHint(w.config)).toBe("hooks.ornek.com · imzalı");
  });

  it("webhook iç ağa gidemez (SSRF)", () => {
    for (const h of ["localhost", "127.0.0.1", "10.1.2.3", "172.20.0.5", "192.168.1.1", "169.254.169.254", "supabase-db", "[::1]", "x.internal", "0.0.0.0"]) {
      expect(isBlockedWebhookHost(h), h).toBe(true);
    }
    expect(isBlockedWebhookHost("hooks.slack.com")).toBe(false);
    expect(isBlockedWebhookHost("8.8.8.8")).toBe(false);
    expect(parseWebhookUrl("https://user:pw@ornek.com/").ok).toBe(false);
    expect(parseWebhookUrl("https://ornek.com:22/").ok).toBe(false);
  });

  it("sunucu betiği aynı AAD ve anahtar türetimini kullanır", () => {
    const py = readFileSync(join(process.cwd(), "scripts/sunucu/alert-send.py"), "utf8");
    const ts = readFileSync(join(process.cwd(), "src/lib/platform-secrets.ts"), "utf8");
    expect(py).toContain('"alert_channel:" + ch["id"]');
    expect(py).toContain('("platform_settings:" + storage_key)');
    for (const lit of ["emlaksoft:platform-secrets:salt:v1", "emlaksoft/platform-secrets/v1", "OTP_HMAC_SECRET", "TWO_FACTOR_COOKIE_SECRET", "PROPERTY_MEDIA_SIGNING_SECRET"]) {
      expect(ts).toContain(lit);
      expect(py).toContain(lit);
    }
  });
});
