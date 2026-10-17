import { describe, expect, it } from "vitest";
import { groupOfficeSessions, summarizeOfficeSessions, summarizeUserAgent, toOfficeSessionRow, type OfficeSessionRow } from "./office-sessions";
import { buildLimitRows, groupLimitRows, parseThreshold, summarizeLimits } from "./limits";
import { ENV_SECRETS, SECRET_ROTATION_WARN_DAYS, parseRotatedAt, rotationAge, sortRotationRows, type SecretRotationRow } from "./secret-rotation";
import {
  FOUR_EYES_DEFAULTS,
  SENSITIVE_FOUR_EYES_KEYS,
  SENSITIVE_FOUR_EYES_KINDS,
  approvalStatusLabel,
  checkDecision,
  decidableKinds,
  fourEyesRequired,
  isGrantKind,
} from "@/lib/platform-security/four-eyes-policy";
import { STEP_UP_ACTIONS } from "@/lib/platform-security/step-up-policy";
import { FOUR_EYES_SETTING_DEFS } from "@/lib/settings/registry/four-eyes";

const NOW = Date.parse("2026-10-17T12:00:00Z");
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();

describe("ofis oturumları (saf)", () => {
  const row = (o: Partial<OfficeSessionRow>): OfficeSessionRow => ({
    sessionId: "s",
    userId: "u1",
    name: "Ayşe",
    role: "advisor",
    tenantId: "t1",
    tenantName: "Kadıköy",
    createdAt: iso(86_400_000 * 3),
    lastActiveAt: iso(3_600_000),
    aal: "aal1",
    ipMasked: "85.105.x.x",
    userAgent: null,
    expiresAt: null,
    ...o,
  });

  it("user agent özeti sürüm ve ayrıntı taşımaz", () => {
    expect(summarizeUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36")).toBe("Chrome · Windows");
    expect(summarizeUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) AppleWebKit Version/17.0 Mobile Safari/604.1")).toBe("Safari · iPhone");
    expect(summarizeUserAgent("Mozilla/5.0 (Macintosh) Edg/120.0")).toBe("Edge · macOS");
    expect(summarizeUserAgent("node")).toBe("Uygulama / API");
    expect(summarizeUserAgent(null)).toBe("Bilinmeyen cihaz");
  });

  it("RPC satırı yalnız beklenen alanları taşır (belirteç alanı oluşmaz)", () => {
    const r = toOfficeSessionRow({ session_id: "s1", user_id: "u", tenant_id: "t", token: "GIZLI", refresh_token_hmac_key: "GIZLI", ip_masked: "1.2.x.x" });
    expect(r).not.toBeNull();
    expect(JSON.stringify(r)).not.toContain("GIZLI");
    expect(toOfficeSessionRow({ session_id: "s1" })).toBeNull();
  });

  it("ofis → kullanıcı gruplaması ve özet", () => {
    const rows = [
      row({ sessionId: "a", aal: "aal2" }),
      row({ sessionId: "b", lastActiveAt: iso(86_400_000 * 2) }),
      row({ sessionId: "c" }),
      row({ sessionId: "d", userId: "u2", name: "Mehmet", tenantId: "t2", tenantName: "Bodrum" }),
    ];
    const g = groupOfficeSessions(rows);
    expect(g.map((x) => x.tenantId)).toEqual(["t1", "t2"]);
    expect(g[0]!.users[0]!.sessions).toHaveLength(3);
    expect(g[0]!.users[0]!.sessions.at(-1)!.sessionId).toBe("b");
    const s = summarizeOfficeSessions(rows, NOW);
    expect(s).toMatchObject({ sessions: 4, users: 2, offices: 2, aal2: 1, multiDeviceUsers: 1, active24h: 3 });
  });
});

describe("paket limitleri (saf)", () => {
  it("eşik üstü ölçüler; limitsiz ölçü girmez; AI ve değerleme kotası", () => {
    const rows = buildLimitRows(
      [
        { tenant_id: "t1", metric: "seats", used: 9, cap: 10 },
        { tenant_id: "t1", metric: "customers", used: "50", cap: "1000" },
        { tenant_id: "t2", metric: "active_properties", used: 120, cap: 100 },
        { tenant_id: "t3", metric: "branches", used: 1, cap: 0 },
        { tenant_id: "t3", metric: "bilinmeyen", used: 5, cap: 5 },
      ],
      [{ tenantId: "t3", aiUsed: 85.5, aiQuota: 100, valuationReports: 1, valuationQuota: 10 }],
      80,
    );
    expect(rows.map((r) => `${r.tenantId}:${r.metric}:${r.pct}`)).toEqual(["t2:active_properties:120", "t1:seats:90", "t3:ai:86"]);
    const s = summarizeLimits(rows);
    expect(s).toMatchObject({ offices: 3, over: 1 });
    expect(s.byMetric.ai).toBe(1);
    expect(groupLimitRows(rows)[0]!.tenantId).toBe("t2");
  });

  it("eşik süzgeci yalnız izinli değerler", () => {
    expect(parseThreshold("90")).toBe(90);
    expect(parseThreshold("55")).toBe(80);
    expect(parseThreshold(undefined)).toBe(80);
  });
});

describe("sır rotasyon yaşı (saf)", () => {
  it("tarih ayrıştırma: gün biçimi, ISO, gelecek ve bozuk", () => {
    expect(parseRotatedAt("2026-01-01", NOW)).toBe("2026-01-01T00:00:00.000Z");
    expect(parseRotatedAt("2027-01-01", NOW)).toBeNull();
    expect(parseRotatedAt("dün", NOW)).toBeNull();
    expect(parseRotatedAt(undefined, NOW)).toBeNull();
  });

  it(`${SECRET_ROTATION_WARN_DAYS} gün sonrası uyarı; tanımsız ve izlenmeyen uyarı almaz`, () => {
    expect(rotationAge(iso(86_400_000 * 181), true, NOW)).toEqual({ ageDays: 181, warn: true });
    expect(rotationAge(iso(86_400_000 * 180), true, NOW)).toEqual({ ageDays: 180, warn: false });
    expect(rotationAge(iso(86_400_000 * 400), false, NOW)).toEqual({ ageDays: null, warn: false });
    expect(rotationAge(null, true, NOW)).toEqual({ ageDays: null, warn: false });
  });

  it("sıralama: uyarılı → yaşlı → izlenmeyen → tanımsız", () => {
    const base = { group: "imza", source: "ortam", href: null } as const;
    const r = (id: string, set: boolean, ageDays: number | null, warn: boolean): SecretRotationRow => ({ ...base, id, label: id, set, rotatedAt: null, ageDays, warn });
    expect(sortRotationRows([r("tanimsiz", false, null, false), r("izsiz", true, null, false), r("genc", true, 10, false), r("eski", true, 200, true)]).map((x) => x.id)).toEqual([
      "eski",
      "genc",
      "izsiz",
      "tanimsiz",
    ]);
  });

  it("katalog yalnız ad taşır; ad benzersiz", () => {
    expect(new Set(ENV_SECRETS.map((e) => e.name)).size).toBe(ENV_SECRETS.length);
    for (const e of ENV_SECRETS) expect(e.name).toMatch(/^[A-Z0-9_]+$/);
  });
});

describe("hassas işlem dört göz (politika)", () => {
  const superA = { role: "super_admin" as const };
  const ops = { role: "ops" as const };
  const pending = { kind: "session_revoke", module: "members", status: "pending", requested_by: "A", expires_at: new Date(NOW + 3_600_000).toISOString() };

  it("türler izin modelinde, ayarı ve doğrulayıcı kodu tanımlı; varsayılan kapalı", () => {
    for (const k of SENSITIVE_FOUR_EYES_KINDS) {
      expect(isGrantKind(k)).toBe(true);
      expect(fourEyesRequired(k, FOUR_EYES_DEFAULTS)).toBe(false);
      expect(fourEyesRequired(k, { ...FOUR_EYES_DEFAULTS, sensitive: { ...FOUR_EYES_DEFAULTS.sensitive, [k]: true } })).toBe(true);
      expect(FOUR_EYES_SETTING_DEFS.some((d) => d.key === SENSITIVE_FOUR_EYES_KEYS[k] && d.label.startsWith("Hassas işlemlerde dört göz onayı"))).toBe(true);
    }
    expect(STEP_UP_ACTIONS.queue_requeue).toBeTruthy();
    expect(STEP_UP_ACTIONS.impersonation).toBeTruthy();
    expect(isGrantKind("refund")).toBe(false);
  });

  it("karar yalnız talep edenden farklı süper admin; operasyon onaylayamaz", () => {
    expect(checkDecision(pending, "B", superA, "approve", NOW).ok).toBe(true);
    expect(checkDecision(pending, "A", superA, "approve", NOW).ok).toBe(false);
    const opsCheck = checkDecision(pending, "B", ops, "approve", NOW);
    expect(opsCheck.ok).toBe(false);
    expect(decidableKinds(ops)).not.toContain("session_revoke");
    expect(decidableKinds(superA)).toEqual(expect.arrayContaining([...SENSITIVE_FOUR_EYES_KINDS]));
  });

  it("izin türünde durum etiketi: onaylandı = kullanılmayı bekliyor; yürütüldü = kullanıldı", () => {
    expect(approvalStatusLabel({ ...pending, status: "approved" }, NOW)).toMatch(/kullanmasını bekliyor/);
    expect(approvalStatusLabel({ ...pending, status: "approved", expires_at: iso(1000) }, NOW)).toMatch(/süresi doldu/);
    expect(approvalStatusLabel({ ...pending, status: "executed" }, NOW)).toBe("Onaylandı ve kullanıldı");
    expect(approvalStatusLabel({ ...pending, kind: "refund", status: "approved" }, NOW)).toBe("Onaylandı (yürütülüyor)");
  });
});
