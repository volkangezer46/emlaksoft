import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ErrorBoundary, isNextFrameworkError } from "@/components/error-boundary";
import { walkAll } from "@/lib/test-support/src-tree";
import { notFoundTarget } from "./_ui/not-found-target";

/**
 * B072 sözleşmesi: silinmiş / olmayan kayıt ve olmayan /app yolu KABUK İÇİNDE 404 gösterir (menü yerinde kalır).
 *  - Kabuk hata sınırı Next'in çerçeve sinyallerini (notFound / forbidden / unauthorized / redirect) YUTMAZ.
 *  - /app/not-found.tsx kabuk içinde "Kayıt bulunamadı ya da silinmiş" + Çöp kutusu + listeye dönüş sunar.
 *  - Olmayan /app yolu `[...yol]` yalnız notFound() çağırır (yönlendirme yok).
 *  - Projedeki her özel hata sınırı (getDerivedStateFromError) çerçeve hatasını yeniden fırlatır.
 */
const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

describe("kabuk hata sınırı çerçeve sinyallerini yutmaz", () => {
  const signal = (digest: string) => Object.assign(new Error("Minified React error #441"), { digest });

  it("notFound / forbidden / redirect digest'leri çerçeve hatasıdır; gerçek hata değildir", () => {
    expect(isNextFrameworkError(signal("NEXT_HTTP_ERROR_FALLBACK;404"))).toBe(true);
    expect(isNextFrameworkError(signal("NEXT_HTTP_ERROR_FALLBACK;403"))).toBe(true);
    expect(isNextFrameworkError(signal("NEXT_REDIRECT;replace;/giris;307;"))).toBe(true);
    expect(isNextFrameworkError(new Error("boom"))).toBe(false);
    expect(isNextFrameworkError(signal("1234567890"))).toBe(false);
    expect(isNextFrameworkError(null)).toBe(false);
  });

  it("getDerivedStateFromError çerçeve hatasını yeniden fırlatır, gerçek hatada hata durumuna geçer", () => {
    const nf = signal("NEXT_HTTP_ERROR_FALLBACK;404");
    expect(() => ErrorBoundary.getDerivedStateFromError(nf)).toThrow(nf);
    expect(ErrorBoundary.getDerivedStateFromError(new Error("boom"))).toMatchObject({ hasError: true });
  });

  it("projedeki her özel hata sınırı çerçeve hatasını yeniden fırlatır (notFound kullanan sayfalar korunur)", () => {
    const offenders = walkAll(join(ROOT, "src"))
      .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.(ts|tsx)$/.test(f))
      .filter((f) => readFileSync(f, "utf8").includes("getDerivedStateFromError"))
      .filter((f) => !/isNextFrameworkError\(error\)\) throw error/.test(readFileSync(f, "utf8")))
      .map((f) => f.slice(ROOT.length + 1));
    expect(offenders).toEqual([]);
  });
});

describe("kabuk içi 404", () => {
  it("/app/not-found.tsx var ve kabuk içi paneli çizer; mesaj, Çöp kutusu ve listeye dönüş", () => {
    expect(read("src/app/app/not-found.tsx")).toContain("<NotFoundPanel");
    const panel = read("src/app/app/_ui/not-found-panel.tsx");
    expect(panel).toContain("Kayıt bulunamadı ya da silinmiş");
    expect(panel).toContain('href="/app/ayarlar/cop-kutusu"');
    expect(panel).toContain("listesine dön");
    expect(existsSync(join(ROOT, "src/app/app/ayarlar/cop-kutusu/page.tsx"))).toBe(true);
  });

  it("olmayan /app yolu yalnız notFound() çağırır (yönlendirme yok)", () => {
    const src = read("src/app/app/[...yol]/page.tsx");
    expect(src).toMatch(/\bnotFound\(\)/);
    expect(src).not.toMatch(/\bredirect\(|permanentRedirect\(/);
  });

  it("hedef: bilinen listenin alt yolu kayıt (listeye dön), diğerleri sayfa", () => {
    const lists = [
      ["/app/musteriler", "Müşteriler"],
      ["/app/portfoyler", "Portföyler"],
    ] as const;
    expect(notFoundTarget("/app/musteriler/123", lists)).toEqual({ kind: "record", listHref: "/app/musteriler", listLabel: "Müşteriler" });
    expect(notFoundTarget("/app/portfoyler/abc/duzenle?x=1", lists)).toEqual({ kind: "record", listHref: "/app/portfoyler", listLabel: "Portföyler" });
    expect(notFoundTarget("/app/yok-boyle-sayfa", lists)).toEqual({ kind: "page" });
    expect(notFoundTarget("/app/bilinmeyen/123", lists)).toEqual({ kind: "page" });
  });
});
