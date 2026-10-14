import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { DEFAULT_SEO_SETTINGS, type AuditRun } from "@/lib/seo/store";
import { AUTOPILOT_KINDS, runAutopilot, parseAutopilot, type AutopilotDeps, type AutopilotSettings } from "./autopilot";
import { auditRunToCollectorResult, BUILTIN_SEO_COLLECTOR } from "./builtin-seo-latest";
import { EXECUTORS, canDraft, executorFor, hrefExecutor, ignoreExecutor, screenFallback } from "./executors";
import { canAutoOptimize, fingerprintOf, isInPublicScope, normalizeUrlForFingerprint } from "./fingerprint";
import { areaScore, areaSentence, siteScore, topGains, type ScoredIssue } from "./score";
import { TRANSITIONS, nextStatus, planCollectorMerge, type IssueEvent } from "./state";
import { ISSUE_STATUSES, type CollectorResult, type IssueExecutor, type IssueInput, type IssueStatus, type SiteIssue } from "./types";

const NOW = "2026-10-13T09:00:00.000Z";
const OLD = "2026-10-01T09:00:00.000Z";

function row(p: Partial<SiteIssue> & Pick<SiteIssue, "url" | "code">): SiteIssue {
  const area = p.area ?? "seo";
  return {
    id: p.id ?? `id-${p.url}-${p.code}`,
    area,
    url: p.url,
    code: p.code,
    severity: p.severity ?? "uyari",
    title: p.title ?? p.code,
    explain: "",
    fingerprint: fingerprintOf(area, p.code, p.url),
    collector: p.collector ?? "c1",
    first_seen: OLD,
    last_seen: OLD,
    status: p.status ?? "acik",
    evidence: null,
    proposal: p.proposal ?? null,
    href: p.href ?? null,
    manual_only: p.manual_only ?? false,
    publish_ref: null,
    resolved_at: p.resolved_at ?? null,
    ignored_by: p.ignored_by ?? null,
    ignored_reason: p.ignored_reason ?? null,
  };
}

const input = (url: string, code: string, extra: Partial<IssueInput> = {}): IssueInput => ({ area: "seo", url, code, severity: "uyari", title: code, explain: "", ...extra });
const result = (issues: IssueInput[], scanned: CollectorResult["scanned"]): CollectorResult => ({ collector: "c1", area: "seo", scanned, issues });

describe("durum makinesi", () => {
  it("geçiş tablosu: her durum tanımlı; açık iş durumları 'gone' ile doğrulanır, yoksayıldı toplayıcıyla değişmez", () => {
    expect(Object.keys(TRANSITIONS).sort()).toEqual([...ISSUE_STATUSES].sort());
    for (const s of ["acik", "onerildi", "taslakta", "yayinda", "yeniden_acildi"] as IssueStatus[]) expect(nextStatus(s, "gone")).toBe("dogrulandi");
    expect(nextStatus("dogrulandi", "seen")).toBe("yeniden_acildi");
    expect(nextStatus("yoksayildi", "seen")).toBe("yoksayildi");
    expect(nextStatus("yoksayildi", "gone")).toBe("yoksayildi");
    expect(nextStatus("yoksayildi", "unignore")).toBe("acik");
  });

  it("akış: acik → onerildi → taslakta → yayinda → dogrulandi; geçersiz geçiş null", () => {
    const flow: [IssueStatus, IssueEvent, IssueStatus | null][] = [
      ["acik", "propose", "onerildi"],
      ["onerildi", "draft", "taslakta"],
      ["taslakta", "publish", "yayinda"],
      ["yayinda", "seen", "yayinda"],
      ["yayinda", "gone", "dogrulandi"],
      ["yayinda", "draft", null],
      ["dogrulandi", "publish", null],
      ["acik", "unignore", null],
      ["taslakta", "ignore", "yoksayildi"],
    ];
    for (const [from, ev, to] of flow) expect(nextStatus(from, ev), `${from} --${ev}`).toBe(to);
  });
});

describe("parmak izi normalleştirme", () => {
  it("sorgu, parça ve sondaki '/' atılır; mutlak adres yola iner; kök '/' kalır", () => {
    expect(normalizeUrlForFingerprint("https://emlaksoft.com.tr/fiyatlar/?utm_source=x#ust")).toBe("/fiyatlar");
    expect(normalizeUrlForFingerprint("/kayit/")).toBe("/kayit");
    expect(normalizeUrlForFingerprint("/kayit?ref=abc")).toBe("/kayit");
    expect(normalizeUrlForFingerprint("https://emlaksoft.com.tr")).toBe("/");
    expect(normalizeUrlForFingerprint("//a//b//")).toBe("/a/b");
    expect(fingerprintOf("seo", "long-title", "https://x.tr/a/?q=1")).toBe("seo|long-title|/a");
    expect(fingerprintOf("seo", "long-title", "/a/")).toBe(fingerprintOf("seo", "long-title", "/a?b=2"));
  });

  it("kapsam: oturum, portal ve yönetim yolları kapsam dışı; /kayit kapsamda ama otomatik düzeltmeye kapalı", () => {
    for (const p of ["/app/musteriler", "/admin/site", "/giris", "/kayit/tamamla", "/sifre-yenile", "/auth/callback", "/malik-portali/x", "/api/x"]) {
      expect(isInPublicScope(p), p).toBe(false);
      expect(canAutoOptimize(p), p).toBe(false);
    }
    expect(isInPublicScope("/kayit")).toBe(true);
    expect(canAutoOptimize("/kayit")).toBe(false);
    expect(canAutoOptimize("/fiyatlar")).toBe(true);
    expect(canAutoOptimize("/")).toBe(true);
  });
});

describe("upsertCollectorResult birleştirme kuralları (M3)", () => {
  it("yeni bulgu 'acik', görülen bulgunun last_seen'i tazelenir", () => {
    const prev = row({ url: "/a", code: "x" });
    const plan = planCollectorMerge([prev], result([input("/a", "x"), input("/b", "y")], ["/a", "/b"]), NOW);
    expect(plan.inserts.map((r) => [r.url, r.status])).toEqual([["/b", "acik"]]);
    expect(plan.updates).toHaveLength(1);
    expect(plan.updates[0]).toMatchObject({ id: prev.id, status: "acik", last_seen: NOW, first_seen: OLD });
  });

  it("rotasyonda TARANMAYAN URL'nin bulgusu kapanmaz; taranıp kaybolan bulgu 'dogrulandi' olur", () => {
    const scannedGone = row({ url: "/a", code: "x" });
    const notScanned = row({ url: "/c", code: "x" });
    const plan = planCollectorMerge([scannedGone, notScanned], result([], ["/a/", "/b"]), NOW);
    expect(plan.updates.map((u) => [u.url, u.status])).toEqual([["/a", "dogrulandi"]]);
    expect(plan.updates[0]!.resolved_at).toBe(NOW);
    expect(plan.counts).toMatchObject({ dogrulandi: 1, dokunulmadi: 1 });
  });

  it("scanned 'all': kaybolan her açık bulgu doğrulanır; yoksayılan ve zaten doğrulanan dokunulmaz", () => {
    const plan = planCollectorMerge(
      [row({ url: "/a", code: "x" }), row({ url: "/b", code: "x", status: "yoksayildi", ignored_reason: "bilerek" }), row({ url: "/c", code: "x", status: "dogrulandi" })],
      result([], "all"),
      NOW,
    );
    expect(plan.updates.map((u) => [u.url, u.status])).toEqual([["/a", "dogrulandi"]]);
  });

  it("doğrulandıktan sonra tekrar görünen bulgu 'yeniden_acildi' olur; yoksayılan gerekçesiyle korunur", () => {
    const back = row({ url: "/a", code: "x", status: "dogrulandi", resolved_at: OLD });
    const ign = row({ url: "/b", code: "x", status: "yoksayildi", ignored_by: "u1", ignored_reason: "bilerek kısa" });
    const plan = planCollectorMerge([back, ign], result([input("/a", "x"), input("/b", "x")], "all"), NOW);
    const byUrl = Object.fromEntries(plan.updates.map((u) => [u.url, u]));
    expect(byUrl["/a"]).toMatchObject({ status: "yeniden_acildi", resolved_at: null });
    expect(byUrl["/b"]).toMatchObject({ status: "yoksayildi", ignored_by: "u1", ignored_reason: "bilerek kısa" });
    expect(plan.counts.yenidenAcildi).toBe(1);
  });

  it("aynı parmak izi bir koşuda bir kez işlenir; sınırlar kırpılır", () => {
    const long = "ş".repeat(400);
    const plan = planCollectorMerge([], result([input("/a?x=1", "x", { title: long, explain: long }), input("/a/", "x")], "all"), NOW);
    expect(plan.inserts).toHaveLength(1);
    expect(plan.inserts[0]!.title.length).toBe(160);
    expect(plan.inserts[0]!.explain.length).toBe(240);
  });
});

const sc = (id: string, severity: ScoredIssue["severity"], area: ScoredIssue["area"] = "seo", status: IssueStatus = "acik", url = `/${id}`): ScoredIssue => ({ id, area, severity, status, url, title: id });

describe("Site notu", () => {
  it("100'den başlar: kritik −8, uyarı −3, bilgi −0,5; alan ağırlığı uygulanır", () => {
    expect(siteScore([], true)).toBe(100);
    expect(siteScore([sc("a", "kritik"), sc("b", "uyari"), sc("c", "bilgi")], true)).toBe(88.5);
    expect(siteScore([sc("a", "kritik", "reklam")], true)).toBe(96);
  });

  it("veri yoksa not yok (null); yoksayılan ve doğrulanan düşürmez; taban 0", () => {
    expect(siteScore([sc("a", "kritik")], false)).toBeNull();
    expect(siteScore([sc("a", "kritik", "seo", "yoksayildi"), sc("b", "kritik", "seo", "dogrulandi")], true)).toBe(100);
    const many = Array.from({ length: 20 }, (_, i) => sc(`k${i}`, "kritik"));
    expect(siteScore(many, true)).toBe(0);
    expect(areaScore(many, "seo", true)).toBe(0);
    expect(areaScore(many, "hiz", true)).toBe(100);
  });

  it("'şunu düzeltirseniz +N': en büyük kazançlı 3 bulgu; taban 0 iken gerçek fark", () => {
    const g = topGains([sc("a", "bilgi"), sc("b", "kritik"), sc("c", "uyari"), sc("d", "kritik", "reklam"), sc("e", "uyari", "seo", "yoksayildi")]);
    expect(g.picks.map((p) => p.id)).toEqual(["b", "d", "c"]);
    expect(g.gain).toBe(15);
    const floor = topGains(Array.from({ length: 20 }, (_, i) => sc(`k${i}`, "kritik")));
    expect(floor.gain).toBe(0); // 3 düzeltme sonrası ceza hâlâ 100'ün üstünde
  });

  it("alan cümlesi teknik değil; bağlı değil / veri birikiyor ayrımı", () => {
    expect(areaSentence("seo", [sc("a", "uyari", "seo", "acik", "/x"), sc("b", "kritik", "seo", "acik", "/y")], { connected: true, hasData: true })).toBe("Arama motorları 2 sayfanızda sorun görüyor; 1 tanesi acil");
    expect(areaSentence("hiz", [], { connected: false, hasData: false })).toBe("Henüz bağlı değil");
    expect(areaSentence("seo", [], { connected: true, hasData: false })).toBe("Veri birikiyor");
    expect(areaSentence("seo", [], { connected: true, hasData: true })).toBe("Arama motorları sitenizde sorun görmüyor");
    for (const a of ["seo", "hiz", "olcum", "reklam"] as const) {
      expect(areaSentence(a, [sc("a", "uyari", a)], { connected: true, hasData: true })).not.toMatch(/LCP|INP|p75|CLS|TTFB/);
    }
  });
});

function audit(findings: AuditRun["findings"]): AuditRun {
  return { at: NOW, durationMs: 1, trigger: "cron", summary: { critical: 0, warning: 0, info: 0, pagesChecked: 3, linksChecked: 0 } as AuditRun["summary"], findings, h1: {}, truncated: false, notes: [] };
}

describe("builtin-seo-latest (kapsam sözleşmesi)", () => {
  const O = "https://emlaksoft.com.tr";
  const run = audit([
    { code: "long-description", severity: "info", url: `${O}/kayit`, message: "Açıklama 178 karakter; arama sonucunda kesilebilir.", fix: "Kısaltın." },
    { code: "long-description", severity: "info", url: `${O}/fiyatlar/`, message: "Açıklama 178 karakter; arama sonucunda kesilebilir.", fix: "Kısaltın." },
    { code: "missing-og-title", severity: "info", url: `${O}/kayit/tamamla`, message: "og:title yok.", fix: "Ekleyin." },
    { code: "missing-og-title", severity: "info", url: `${O}/giris`, message: "og:title yok.", fix: "Ekleyin." },
    { code: "missing-h1", severity: "warning", url: `${O}/`, message: "Sayfada h1 yok.", fix: "Ekleyin." },
  ]);
  const res = auditRunToCollectorResult(run);

  it("kapsam 'all', kaynak tarihi robotun taraması; robot hiç çalışmadıysa hiçbir şey kapanmaz", () => {
    expect(res).toMatchObject({ collector: BUILTIN_SEO_COLLECTOR, area: "seo", scanned: "all", sourceAt: NOW });
    expect(auditRunToCollectorResult(null)).toMatchObject({ scanned: [], issues: [], sourceAt: null });
  });

  it("kısmi tarama (truncated): bulgular gelir ama kapsam boş, açık bulgu 'dogrulandi' olmaz", () => {
    const partial = auditRunToCollectorResult({ ...run, truncated: true });
    expect(partial.scanned).toEqual([]);
    expect(partial.issues.length).toBe(res.issues.length);
    expect(partial.note).toContain("kısmi");
    // Depoda kırpılan ya da taranmayan sayfanın açık bulgusu birleştirmede KAPANMAZ.
    const plan = planCollectorMerge([row({ url: "/hakkimizda", code: "long-title" })], partial, NOW);
    expect(plan.updates.some((u) => u.status === "dogrulandi")).toBe(false);
    expect(plan.counts.dogrulandi).toBe(0);
  });

  it("/kayit bulgusu manualOnly olur ve öneri taşımaz; /fiyatlar önerisi gerçek açıklamadan (SEO kural önerisi) gelir", () => {
    const LONG = "EmlakSoft paketleri, aylık ve yıllık fiyatlar, kullanıcı ve portföy limitleri ile özellik karşılaştırması. Ücretsiz deneme, kredi kartı gerekmez; dilediğiniz an paketinizi değiştirin.";
    const settings = { ...DEFAULT_SEO_SETTINGS, pages: { "/fiyatlar": { description: LONG }, "/kayit": { description: LONG } } };
    const withSettings = auditRunToCollectorResult(run, settings);
    const kayit = withSettings.issues.find((i) => i.url === "/kayit")!;
    expect(kayit.manualOnly).toBe(true);
    expect(kayit.proposal).toBeNull();
    // Eylemsiz öneri (elle) kanıtta kalır.
    expect(String(kayit.evidence?.suggestion ?? "")).toContain("/kayit açıklaması");
    const fiyat = withSettings.issues.find((i) => i.url === "/fiyatlar")!;
    expect(fiyat.manualOnly).toBe(false);
    expect(fiyat.proposal).toMatchObject({ kind: "seo_meta_draft:long-description", params: { field: "description", risk: "guvenli" } });
    expect(fiyat.proposal!.summary).toMatch(/^\/fiyatlar açıklaması \d+→\d+ karakter$/);
    expect(String(fiyat.proposal!.after).length).toBeLessThanOrEqual(155);
    expect(fiyat.severity).toBe("bilgi");
    expect(fiyat.href).toBe("/admin/site/seo?sekme=sayfalar&sayfa=%2Ffiyatlar#editor");
    // Ayar okunamazsa öneri üretilmez (bulgu yine gelir).
    expect(res.issues.find((i) => i.url === "/fiyatlar")!.proposal).toBeNull();
  });

  it("/kayit/tamamla ve /giris HİÇBİR ZAMAN 'Taslağa al' almaz (kuyruğa bile girmez; yürütücü kayıtlı olsa da)", () => {
    expect(res.issues.some((i) => i.url === "/kayit/tamamla" || i.url === "/giris")).toBe(false);
    const fake: IssueExecutor = { kind: "seo_meta_draft:missing-og-title", label: "x", risk: "guvenli", mode: "draft", plan: async () => null, apply: async () => ({ issueId: "", ok: true, message: "", before: null, after: null }) };
    const list = [...EXECUTORS, fake];
    for (const url of ["/kayit/tamamla", "/giris", "/kayit"]) {
      expect(canDraft({ url, manual_only: false, proposal: { kind: fake.kind, summary: "" } }, list), url).toBe(false);
    }
    expect(canDraft({ url: "/fiyatlar", manual_only: false, proposal: { kind: fake.kind, summary: "" } }, list)).toBe(true);
  });
});

describe("yürütücü kaydı", () => {
  it("yerleşik href ve ignore; Otopilot izin listesindeki her tür kayıtlı, güvenli ve uygulanabilir; bilinmeyen tür için ekran bağlantısı", () => {
    expect(executorFor("href")).toBe(hrefExecutor);
    expect(executorFor("ignore")).toBe(ignoreExecutor);
    for (const kind of AUTOPILOT_KINDS) {
      const ex = executorFor(kind);
      expect(ex, kind).not.toBeNull();
      expect(ex!.risk, kind).toBe("guvenli");
      expect(ex!.mode, kind).not.toBe("link");
      expect(typeof ex!.plan, kind).toBe("function");
      expect(typeof ex!.apply, kind).toBe("function");
    }
    expect(new Set(EXECUTORS.map((e) => e.kind)).size).toBe(EXECUTORS.length);
    expect(screenFallback({ href: "/admin/site/seo?sekme=sayfalar", area: "seo" })).toEqual({ href: "/admin/site/seo?sekme=sayfalar", label: "SEO merkezi" });
    // Bilinmeyen tür taslak düğmesi almaz.
    expect(canDraft({ url: "/fiyatlar", manual_only: false, proposal: { kind: "bilinmeyen", summary: "" } })).toBe(false);
  });
});

describe("runAutopilot", () => {
  const issueA = row({ id: "a", url: "/fiyatlar", code: "long-description", proposal: { kind: "seo_meta_draft:long-description", summary: "" } });
  const issueRisky = row({ id: "b", url: "/hakkimizda", code: "long-title", proposal: { kind: "riskli_tur", summary: "" } });
  const issueNotAllowed = row({ id: "c", url: "/iletisim", code: "missing-og-title", proposal: { kind: "seo_meta_draft:missing-og-title", summary: "" } });
  const issueManual = row({ id: "d", url: "/kayit", code: "long-description", manual_only: true, proposal: { kind: "seo_meta_draft:long-description", summary: "" } });

  function setup(settings: Partial<AutopilotSettings>) {
    const applied: string[] = [];
    const exec = (kind: string, risk: IssueExecutor["risk"]): IssueExecutor => ({
      kind,
      label: kind,
      risk,
      mode: "draft",
      plan: async (i) => ({ issueId: i.id, kind, target: i.url, summary: "", before: "178", after: "155", risk }),
      apply: async (p) => {
        applied.push(p.issueId);
        return { issueId: p.issueId, ok: true, message: "taslak", before: "178", after: "155", draftSurface: "seo", status: "taslakta" };
      },
    });
    const writes: unknown[] = [];
    const deps: AutopilotDeps = {
      readSettings: async () => ({ ...parseAutopilot(null), ...settings }),
      listIssues: async () => [issueA, issueRisky, issueNotAllowed, issueManual],
      executors: [exec("seo_meta_draft:long-description", "guvenli"), exec("riskli_tur", "orta"), exec("seo_meta_draft:missing-og-title", "guvenli")],
      record: async (x) => void writes.push(["record", x]),
      patchIssue: async (id, p) => void writes.push(["patch", id, p]),
      publishSurfaces: async (ids) => {
        writes.push(["publish", ids]);
        return ids.map((s) => ({ surface: s, label: s, ok: true, message: "Yayınlandı." }));
      },
    };
    return { deps, applied, writes };
  }

  it("ayar varsayılanı KAPALI; bozuk değer kapalıya düşer, bilinmeyen tür izin listesine giremez", () => {
    expect(parseAutopilot(null)).toMatchObject({ enabled: false, publish: false });
    expect(parseAutopilot("{bozuk")).toMatchObject({ enabled: false });
    expect(parseAutopilot(JSON.stringify({ enabled: true, kinds: ["indexnow", "sil_her_seyi"] })).kinds).toEqual(["indexnow"]);
  });

  it("kapalıyken HİÇBİR yazma yapılmaz", async () => {
    const { deps, applied, writes } = setup({ enabled: false });
    const r = await runAutopilot(deps);
    expect(r.ran).toBe(false);
    expect(applied).toEqual([]);
    expect(writes).toEqual([]);
  });

  it("açıkken yalnız izin listesindeki ve 'guvenli' eylemler; manuel ve riskli olanlar atlanır; her işlem otopilot kaynaklı kaydedilir", async () => {
    const { deps, applied, writes } = setup({ enabled: true, kinds: ["seo_meta_draft:long-description"], enabledBy: "u1" });
    const r = await runAutopilot(deps);
    expect(applied).toEqual(["a"]);
    expect(r).toMatchObject({ ran: true, prepared: 1, failed: 0 });
    const records = writes.filter((w) => (w as unknown[])[0] === "record").map((w) => (w as [string, { source: string; kind: string }])[1]);
    expect(records.every((x) => x.source === "otopilot")).toBe(true);
    expect(records.map((x) => x.kind)).toEqual(["seo_meta_draft:long-description", "autopilot_run"]);
    expect(writes.some((w) => (w as unknown[])[0] === "publish")).toBe(false);
  });

  it("publish=true ise hazırlanan taslakların yüzeyleri Yayın masası üzerinden yayınlanır", async () => {
    const { deps, writes } = setup({ enabled: true, publish: true, kinds: ["seo_meta_draft:long-description", "seo_meta_draft:missing-og-title"], enabledBy: "u1" });
    const r = await runAutopilot(deps);
    expect(r.prepared).toBe(2);
    expect(writes).toContainEqual(["publish", ["seo"]]);
    expect(r.published).toEqual([{ surface: "seo", label: "seo", ok: true, message: "Yayınlandı." }]);
  });
});
