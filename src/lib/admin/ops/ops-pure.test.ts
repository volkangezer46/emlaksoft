import { describe, expect, it } from "vitest";
import { averageSeries, buildHealthRadar, dayKeyMinus, weakestComponent, weeklyDays, type HealthRow } from "./health-radar";
import { ipKey, maskIp, summarizeLogins, twoFactorAdoption, type LoginEventRow } from "./login-security";
import { channelCoverage, consentActivity, consentSourceLabel, type ConsentCounts } from "./consent-coverage";
import { QUEUES, RETRYABLE_QUEUES, queueDef, queueState, requeuePatch, waitAgeLabel } from "./queue-health";
import { RETENTION_RULES, backupHealth, formatBytesTr, parseRetentionDetail } from "./retention-catalog";
import { listingProblemOffices, portalAccountIssue, summarizePortalAccounts, type PortalAccountRow } from "./portal-accounts";
import { explainFlagForOffice, toggleTenantInList } from "./office-flags";
import { evaluateTargeted, type FlagRule } from "@/lib/feature-flags/targeting";
import { CRON_JOBS } from "@/lib/cron-jobs";

const H = (tenantId: string, score: number, day = "2026-10-17", c: Partial<HealthRow> = {}): HealthRow => ({ tenantId, day, score, usage: 60, payment: 60, support: 60, ...c });

describe("ofis sağlığı radarı", () => {
  it("bant dağılımı, düşenler ve yeni riskliler", () => {
    const latest = [H("a", 30, undefined, { usage: 10 }), H("b", 55), H("c", 80), H("d", 35, undefined, { payment: 0 })];
    const prev = [H("a", 50, "2026-10-10"), H("b", 58, "2026-10-10"), H("c", 82, "2026-10-10"), H("d", 30, "2026-10-10")];
    const r = buildHealthRadar(latest, prev, { riskThreshold: 40 });
    expect(r.bands).toEqual({ riskli: 2, izlenmeli: 1, saglikli: 1 });
    expect(r.decliners.map((m) => m.tenantId)).toEqual(["a"]);
    expect(r.decliners[0]!.delta).toBe(-20);
    expect(r.newlyRisky.map((m) => m.tenantId)).toEqual(["a"]);
    expect(r.risky.map((m) => m.tenantId)).toEqual(["a", "d"]);
    expect(r.weakest).toEqual({ usage: 1, payment: 2, support: 0 });
    expect(r.average).toBe(50);
    expect(r.latestDay).toBe("2026-10-17");
    expect(r.compareDay).toBe("2026-10-10");
  });

  it("karşılaştırma günü olmayan ofis düşen sayılmaz; boş girdi güvenli", () => {
    expect(buildHealthRadar([H("x", 10)], []).decliners).toEqual([]);
    const empty = buildHealthRadar([], []);
    expect(empty.average).toBeNull();
    expect(empty.scored).toBe(0);
  });

  it("en zayıf bileşen; eşitlikte ödeme önce", () => {
    expect(weakestComponent({ usage: 20, payment: 50, support: 90 })).toBe("usage");
    expect(weakestComponent({ usage: 40, payment: 40, support: 40 })).toBe("payment");
  });

  it("haftalık günler ve ortalama serisi", () => {
    expect(dayKeyMinus("2026-03-01", 1)).toBe("2026-02-28");
    expect(weeklyDays("2026-10-17", 3)).toEqual(["2026-10-03", "2026-10-10", "2026-10-17"]);
    expect(averageSeries([H("a", 10, "2026-10-10"), H("b", 30, "2026-10-10"), H("a", 50, "2026-10-17")])).toEqual([
      { day: "2026-10-10", average: 20 },
      { day: "2026-10-17", average: 50 },
    ]);
  });
});

describe("giriş güvenliği", () => {
  const ev = (over: Partial<LoginEventRow>): LoginEventRow => ({ userId: null, tenantId: null, ip: "85.105.12.7", result: "failed", createdAt: "2026-10-16T10:00:00Z", ...over });

  it("IP maskelenir; anahtar ham IP değildir", () => {
    expect(maskIp("85.105.12.7")).toBe("85.105.12.•");
    expect(maskIp("2a02:4780:12::1")).toBe("2a02:4780:•");
    expect(maskIp(null)).toBe("Bilinmiyor");
    expect(ipKey("85.105.12.7")).not.toContain("85");
    expect(ipKey("1.1.1.1")).toBe(ipKey("1.1.1.1"));
  });

  it("kimlik doldurma (çok hesap) ve kaba kuvvet (çok deneme) ayrılır; hedeflenen hesap ve sonradan başarılı giriş", () => {
    const events: LoginEventRow[] = [
      ...Array.from({ length: 6 }, (_, i) => ev({ ip: "10.0.0.1", userId: `u${i}` })),
      ...Array.from({ length: 22 }, () => ev({ ip: "10.0.0.2" })),
      ...Array.from({ length: 5 }, (_, i) => ev({ ip: "10.0.0.3", userId: "victim", tenantId: "t1", result: i === 0 ? "2fa_failed" : "failed", createdAt: `2026-10-15T0${i}:00:00Z` })),
      ev({ userId: "victim", tenantId: "t1", result: "success", createdAt: "2026-10-15T09:00:00Z" }),
    ];
    const s = summarizeLogins(events, 100, { endDay: "2026-10-17" });
    expect(s.ips[0]!.kind).toBe("kimlik_doldurma");
    expect(s.ips[1]!.kind).toBe("kaba_kuvvet");
    expect(s.ips.every((i) => !i.ipMasked.endsWith(".1") && !i.ipMasked.endsWith(".2"))).toBe(true);
    expect(s.users).toHaveLength(1);
    expect(s.users[0]).toMatchObject({ userId: "victim", failures: 5, twoFactorFailures: 1, succeededAfter: true, tenantId: "t1" });
    expect(s.totals.success).toBe(100);
    expect(s.failureRate).toBe(Math.round((33 / 133) * 1000) / 10);
    expect(s.daily).toHaveLength(7);
    expect(s.daily.at(-1)!.day).toBe("2026-10-17");
    expect(s.daily.find((d) => d.day === "2026-10-16")!.failures).toBe(28);
  });

  it("TR günü: 22:30Z ertesi güne yazılır", () => {
    const s = summarizeLogins([ev({ createdAt: "2026-10-16T22:30:00Z" })], 0, { endDay: "2026-10-17", days: 2 });
    expect(s.daily).toEqual([
      { day: "2026-10-16", failures: 0 },
      { day: "2026-10-17", failures: 1 },
    ]);
  });

  it("iki adımlı doğrulama benimsemesi ve hiç açmayan ofisler", () => {
    const rows = [
      ...Array.from({ length: 4 }, () => ({ tenantId: "a", twoFactor: false })),
      { tenantId: "b", twoFactor: true },
      { tenantId: "b", twoFactor: false },
      { tenantId: "c", twoFactor: false },
    ];
    const r = twoFactorAdoption(rows);
    expect(r.users).toBe(7);
    expect(r.enabled).toBe(1);
    expect(r.percent).toBe(14.3);
    expect(r.officesWithout).toEqual([{ tenantId: "a", users: 4 }]);
    expect(twoFactorAdoption([]).percent).toBeNull();
  });
});

describe("ileti izni (İYS) uyumu", () => {
  it("kanal kapsaması; okunamayan sayım işaretlenir", () => {
    const blank = { granted: 0, denied: 0, unknown: 0, pending: 0 };
    const counts: ConsentCounts = {
      sms: { granted: 60, denied: 10, unknown: 25, pending: 5 },
      email: blank,
      whatsapp: { ...blank, granted: null },
      call: blank,
    };
    const c = channelCoverage(counts);
    expect(c[0]).toMatchObject({ channel: "sms", total: 100, grantedPct: 60, undecided: 30, unreadable: false });
    expect(c[1]!.grantedPct).toBeNull();
    expect(c[2]!.unreadable).toBe(true);
  });

  it("ret ve onay hareketleri ofis bazında; kaynak etiketi", () => {
    const a = consentActivity([
      { tenantId: "t1", channel: "sms", from: "granted", to: "denied", source: "manual", occurredAt: "x" },
      { tenantId: "t1", channel: "sms", from: "denied", to: "denied", source: "manual", occurredAt: "x" },
      { tenantId: "t2", channel: "email", from: null, to: "granted", source: "web", occurredAt: "x" },
    ]);
    expect(a.revocations).toBe(1);
    expect(a.grants).toBe(1);
    expect(a.revocationOffices).toEqual([{ tenantId: "t1", revocations: 1, grants: 0 }]);
    expect(a.sources[0]).toEqual({ source: "manual", count: 2 });
    expect(consentSourceLabel("kvkk_erasure")).toBe("KVKK silmesi");
    expect(consentSourceLabel("bir_kaynak")).toBe("bir kaynak");
  });
});

describe("arka plan kuyrukları", () => {
  const now = Date.parse("2026-10-17T12:00:00Z");
  const def = queueDef("public_mutation")!;

  it("durum kararı: takıldı > hata > birikiyor > boş > akıyor; okunamayan ayrı", () => {
    expect(queueState(def, { waiting: 3, failed: 0, oldestWaitingAt: "2026-10-17T10:00:00Z" }, now)).toBe("takildi");
    expect(queueState(def, { waiting: 3, failed: 2, oldestWaitingAt: "2026-10-17T11:55:00Z" }, now)).toBe("hata");
    expect(queueState(def, { waiting: 500, failed: 0, oldestWaitingAt: "2026-10-17T11:59:00Z" }, now)).toBe("birikiyor");
    expect(queueState(def, { waiting: 0, failed: 0, oldestWaitingAt: null }, now)).toBe("bos");
    expect(queueState(def, { waiting: 2, failed: 0, oldestWaitingAt: "2026-10-17T11:59:00Z" }, now)).toBe("saglikli");
    expect(queueState(def, { waiting: null, failed: 0, oldestWaitingAt: null }, now)).toBe("okunamadi");
    // Geri çekilmiş (gelecek zamanlı) iş takılmış sayılmaz.
    expect(queueState(def, { waiting: 1, failed: 0, oldestWaitingAt: "2026-10-18T12:00:00Z" }, now)).toBe("saglikli");
  });

  it("yaş etiketi", () => {
    expect(waitAgeLabel("2026-10-17T11:48:00Z", now)).toBe("12 dk");
    expect(waitAgeLabel("2026-10-17T09:00:00Z", now)).toBe("3 sa");
    expect(waitAgeLabel("2026-10-14T12:00:00Z", now)).toBe("3 gün");
    expect(waitAgeLabel("2026-10-18T12:00:00Z", now)).toBe("planlı");
    expect(waitAgeLabel(null, now)).toBeNull();
  });

  it("yalnız idempotent işçili kuyruklar yeniden kuyruğa alınır; yama sayacı sıfırlar", () => {
    expect(RETRYABLE_QUEUES).toEqual(["public_mutation", "storage_deletion"]);
    expect(requeuePatch("public_mutation", "T")).toMatchObject({ status: "retry", attempt_count: 0, next_attempt_at: "T", dead_lettered_at: null, lease_token: null });
    expect(requeuePatch("storage_deletion", "T")).toMatchObject({ status: "retry", attempt_count: 0 });
    expect(requeuePatch("webhook", "T")).toBeNull();
    expect(queueDef("yok")).toBeNull();
  });

  it("her kuyruğun işçisi cron envanterinde var; anahtarlar tekil", () => {
    const jobs = new Set<string>(CRON_JOBS.map((j) => j.job));
    for (const q of QUEUES) if (q.cronJob) expect(jobs.has(q.cronJob), q.key).toBe(true);
    expect(new Set(QUEUES.map((q) => q.key)).size).toBe(QUEUES.length);
  });
});

describe("veri saklama", () => {
  it("katalog adımları tekil; JSON not adım durumuna çevrilir (hata sonucu ezer)", () => {
    expect(new Set(RETENTION_RULES.map((r) => r.step)).size).toBe(RETENTION_RULES.length);
    const p = parseRetentionDetail(JSON.stringify({ retention: { deleted: 3 }, fsboPii: "skipped", emailLog: { skipped: true }, storage: { done: 1 }, queue: { waiting: 2, failed: 1 }, errors: { storage: "x" } }));
    expect(p.partial).toBe(false);
    expect(p.steps).toMatchObject({ retention: "ok", fsboPii: "skipped", emailLog: "skipped", storage: "error" });
    expect(p.queue).toEqual({ waiting: 2, failed: 1 });
  });

  it("kırpılmış not kısmi okunur", () => {
    const p = parseRetentionDetail('{"retention":{"a":1},"fsboPii":{"b":2},"errors":{"geoStats":"bo');
    expect(p.partial).toBe(true);
    expect(p.steps).toMatchObject({ retention: "ok", fsboPii: "ok", geoStats: "error" });
    expect(parseRetentionDetail(null)).toEqual({ steps: {}, partial: true, queue: null });
  });

  it("yedek sağlığı: şifreli + uzak ve 26 saat içi iyi; eski kritik", () => {
    const now = Date.parse("2026-10-17T12:00:00Z");
    expect(backupHealth([{ finishedAt: "2026-10-17T03:00:00Z", status: "ok", sizeBytes: 1, encrypted: true, remote: true }], now).level).toBe("iyi");
    expect(backupHealth([{ finishedAt: "2026-10-17T03:00:00Z", status: "ok", sizeBytes: 1, encrypted: true, remote: false }], now).level).toBe("uyari");
    const old = backupHealth(
      [
        { finishedAt: "2026-10-10T03:00:00Z", status: "ok", sizeBytes: 1, encrypted: true, remote: true },
        { finishedAt: "2026-10-17T03:00:00Z", status: "error", sizeBytes: null, encrypted: false, remote: false },
      ],
      now,
    );
    expect(old.level).toBe("kritik");
    expect(old.last!.status).toBe("error");
    expect(old.okRate).toBe(50);
    expect(backupHealth([], now)).toMatchObject({ level: "kritik", last: null, hoursSinceOk: null });
    expect(formatBytesTr(1536)).toBe("1,5 KB");
    expect(formatBytesTr(null)).toBe("—");
  });
});

describe("portal hesapları", () => {
  const A = (over: Partial<PortalAccountRow>): PortalAccountRow => ({
    tenantId: "t",
    portal: "sahibinden",
    status: "active",
    checkEnabled: true,
    planEndsAt: null,
    lastLoginOkAt: "2026-10-16T00:00:00Z",
    lastLoginFailAt: null,
    loginFailStreak: 0,
    ...over,
  });

  it("sorun sırası: giriş hatası > paket bitti > bitiyor > doğrulanmadı > kontrol kapalı", () => {
    const today = "2026-10-17";
    expect(portalAccountIssue(A({ loginFailStreak: 3, planEndsAt: "2026-10-01" }), today)).toBe("giris_hatasi");
    expect(portalAccountIssue(A({ planEndsAt: "2026-10-16" }), today)).toBe("paket_bitti");
    expect(portalAccountIssue(A({ planEndsAt: "2026-10-24" }), today)).toBe("paket_bitiyor");
    expect(portalAccountIssue(A({ planEndsAt: "2026-10-25" }), today)).toBeNull();
    expect(portalAccountIssue(A({ lastLoginOkAt: null }), today)).toBe("dogrulanmadi");
    expect(portalAccountIssue(A({ checkEnabled: false }), today)).toBe("kontrol_kapali");
    expect(portalAccountIssue(A({ status: "none", loginFailStreak: 9 }), today)).toBeNull();
  });

  it("portal özeti ve sorunlu ilan ofisleri", () => {
    const s = summarizePortalAccounts([A({ tenantId: "a" }), A({ tenantId: "b", loginFailStreak: 4 }), A({ tenantId: "a", portal: "emlakjet", planEndsAt: "2026-10-01" })], "2026-10-17");
    expect(s.accounts).toBe(3);
    expect(s.portals.find((p) => p.portal === "sahibinden")).toMatchObject({ active: 2, offices: 2 });
    expect(s.issueRows.map((r) => r.issue)).toEqual(["giris_hatasi", "paket_bitti"]);
    expect(
      listingProblemOffices([
        { tenantId: "a", state: "suspect" },
        { tenantId: "b", state: "confirmed_missing" },
        { tenantId: "b", state: "probable_missing" },
        { tenantId: "a", state: "verified" },
      ]),
    ).toEqual([
      { tenantId: "b", suspect: 0, missing: 2 },
      { tenantId: "a", suspect: 1, missing: 0 },
    ]);
  });
});

describe("ofis bazında bayrak açıklaması", () => {
  const T = "11111111-1111-1111-1111-111111111111";
  const rule = (over: Partial<FlagRule>): FlagRule => ({ flagKey: "nps_survey", tenantIds: [], plans: [], percentage: 0, startsAt: null, endsAt: null, ...over });
  const now = Date.parse("2026-10-17T12:00:00Z");

  it("karar evaluateTargeted ile birebir aynıdır", () => {
    const rules: (FlagRule | null)[] = [null, rule({ tenantIds: [T] }), rule({ percentage: 100 }), rule({ percentage: 1 }), rule({ plans: ["office"], percentage: 100 }), rule({ tenantIds: [T], endsAt: "2026-10-01T00:00:00Z" })];
    for (const globalOn of [true, false]) {
      for (const r of rules) {
        for (const plan of ["office", "business"]) {
          const target = { tenantId: T, plan };
          const e = explainFlagForOffice({ globalOn, targetable: true, rule: r, target, nowMs: now });
          expect(e.on, JSON.stringify({ globalOn, r, plan })).toBe(evaluateTargeted({ globalOn, rule: r, target, nowMs: now }));
        }
      }
    }
  });

  it("gerekçeler", () => {
    const target = { tenantId: T, plan: "office" };
    expect(explainFlagForOffice({ globalOn: false, blockedByRequires: true, targetable: true, rule: null, target, nowMs: now }).reason).toBe("bagli_kapali");
    expect(explainFlagForOffice({ globalOn: true, targetable: false, rule: null, target, nowMs: now }).reason).toBe("herkese_acik");
    expect(explainFlagForOffice({ globalOn: true, targetable: true, rule: rule({ tenantIds: [T.toUpperCase()] }), target, nowMs: now })).toMatchObject({ reason: "ofis_listesinde", inList: true });
    expect(explainFlagForOffice({ globalOn: true, targetable: true, rule: rule({ plans: ["business"], percentage: 50 }), target, nowMs: now }).reason).toBe("plan_disinda");
  });

  it("ofis listesine ekle/çıkar (yinelenmez, harf duyarsız)", () => {
    expect(toggleTenantInList([T.toUpperCase()], T, true)).toEqual([T]);
    expect(toggleTenantInList([T, "x"], T.toUpperCase(), false)).toEqual(["x"]);
  });
});
