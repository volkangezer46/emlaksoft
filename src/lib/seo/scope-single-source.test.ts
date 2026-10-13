import { describe, expect, it } from "vitest";
import * as googleCollector from "@/lib/google/collector";
import * as measureScope from "@/lib/measure/scope";
import * as fingerprint from "@/lib/site-issues/fingerprint";
import { ISSUE_LIMITS } from "@/lib/site-issues/types";
import { NEVER_STATIC_PREFIXES, STATIC_ROUTES, isStaticEligiblePath } from "@/lib/static-home/registry";
import { seoPages } from "./registry";
import * as scope from "./scope";

/**
 * S0 TEK KAYNAK sözleşmesi: kapsam kararı yalnız `seo/scope.ts`'te verilir; Kokpit (site-issues), ölçüm (measure),
 * Google toplayıcısı ve statik kayıt defteri ona bağlıdır. Üyelik/oturum yolları hiçbir kopyada kapsam içine girmez.
 */

const MEMBER = ["/app", "/app/musteriler", "/admin", "/admin/site", "/giris", "/giris/mfa", "/kayit", "/kayit/tamamla", "/sifre-yenile", "/sifre-sifirla", "/auth/callback"];
const ORIGIN = "https://emlaksoft.com.tr";

describe("S0: tek kapsam kaynağı", () => {
  it("Kokpit ve ölçüm işlevleri scope.ts'in AYNI işlevleridir (kopya yok)", () => {
    expect(fingerprint.canAutoOptimize).toBe(scope.canAutoOptimize);
    expect(fingerprint.normalizeUrlForFingerprint).toBe(scope.normalizeUrlForFingerprint);
    expect(measureScope.canMeasure).toBe(scope.canMeasure);
    expect(measureScope.pathTemplate).toBe(scope.pathTemplate);
    expect(measureScope.NEVER_MEASURED_PREFIXES).toBe(scope.NEVER_MEASURED_PREFIXES);
    expect(scope.FINGERPRINT_URL_MAX).toBe(ISSUE_LIMITS.url);
  });

  it("üyelik/oturum yolları hiçbir kopyada otomatik iyileştirme, statik sunum ya da Kokpit taslağı almaz", () => {
    for (const p of MEMBER) {
      expect(scope.canAutoOptimize(p), p).toBe(false);
      expect(scope.canAutoOptimize(`${ORIGIN}${p}?x=1`), p).toBe(false);
      expect(fingerprint.canAutoOptimize(p), p).toBe(false);
      expect(googleCollector.canAutoOptimize(p), p).toBe(false);
      expect(isStaticEligiblePath(p), p).toBe(false);
      expect(scope.isManualOnly(`${ORIGIN}${p}`), p).toBe(true);
    }
    // /kayit sayılır (kayıt hunisinin girişi) ama alt yolları ve oturumlu alanlar sayılmaz.
    expect(scope.canMeasure("/kayit")).toBe(true);
    for (const p of MEMBER.filter((x) => x !== "/kayit")) expect(scope.canMeasure(p), p).toBe(false);
  });

  it("statik kayıt defterindeki her yol scope.canAutoOptimize; üyelik önekleri statik yasak listesinde", () => {
    for (const r of STATIC_ROUTES) expect(scope.canAutoOptimize(r.path), r.path).toBe(true);
    for (const p of scope.MEMBER_PREFIXES) expect(NEVER_STATIC_PREFIXES as readonly string[], p).toContain(p);
  });

  it("otomatik iyileştirme listesindeki her yol scope.canAutoOptimize ve indekslenebilir; Google önerisi kapsamı daha dar", () => {
    const auto = scope.autoOptimizeRegistryPaths();
    expect(auto.length).toBeGreaterThan(0);
    for (const p of auto) {
      expect(scope.canAutoOptimize(p), p).toBe(true);
      expect(scope.isMemberPath(p), p).toBe(false);
    }
    for (const def of seoPages()) {
      if (googleCollector.canAutoOptimize(def.path)) expect(scope.canAutoOptimize(def.path), def.path).toBe(true);
    }
  });

  it("ölçülen her yol SEO kapsamı içindedir (kapsam dışı yol sayılmaz)", () => {
    for (const p of ["/", "/fiyatlar", "/araclar", "/gizlilik", "/rehber", "/rehber/kira-artisi", "/rehber/kategori/kira", "/vitrin/ofis", "/hakkimizda"]) {
      expect(scope.canMeasure(p), p).toBe(true);
      expect(scope.isOutOfScope(p), p).toBe(false);
    }
    for (const p of ["/vitrin/ofis/favoriler", "/brand-asset/logo", "/malik-portali/abc", "/odeme-link/x"]) expect(scope.canMeasure(p), p).toBe(false);
  });

  it("parmak izi normalleştirmesi yalnız yoldur (köken, sorgu, parça, sondaki ve yinelenen / atılır)", () => {
    expect(scope.normalizeUrlForFingerprint(`${ORIGIN}/fiyatlar/?utm=x#a`)).toBe("/fiyatlar");
    expect(scope.normalizeUrlForFingerprint("//a//b//")).toBe("/a/b");
    expect(scope.normalizeUrlForFingerprint(ORIGIN)).toBe("/");
  });
});
