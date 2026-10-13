import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * Ekranlar "bağlı değil" durumunda gerçek bileşenlerle çizilir: boş durum + sihirbaz bağlantısı, uydurma sayı yok.
 * Sunucu eylemleri ve yönlendirici sahte (render sırasında hiçbiri çağrılmaz).
 */
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {}, push() {}, prefetch() {} }), usePathname: () => "/admin" }));
vi.mock("@/app/actions/google-connect", () => {
  const no = async () => ({ error: "test" });
  return {
    saveGoogleClient: no,
    startGoogleConnect: no,
    listGscProperties: no,
    selectGscProperty: no,
    saveAdsAccount: no,
    testAdsConnection: no,
    disconnectGoogle: no,
  };
});

const { buildConnectionView, serviceCard } = await import("./view-model");
const { ConnectionsView, ADS_HONESTY_SENTENCE } = await import("@/app/admin/site/baglantilar/connections-view");
const { PerformanceView } = await import("@/app/admin/seo/performans/performance-view");
const { AdsView } = await import("@/app/admin/site/reklam/google/ads-view");

const empty = buildConnectionView({
  snapshot: { client: null, tokens: { gsc: null, ads: null }, adsAccount: null, gscProperty: null, problems: [] },
  quotas: { inspection: null, ads: null },
  today: "2026-10-13",
  secretsEnabled: true,
});

describe("bağlı değilken ekranlar", () => {
  it("görünüm modeli: iki hizmet de 'Bağlı değil', belirteç/sır yok", () => {
    expect(empty.services.map((s) => [s.service, s.statusLabel])).toEqual([
      ["gsc", "Bağlı değil"],
      ["ads", "Bağlı değil"],
    ]);
    expect(empty.anyConnected).toBe(false);
  });

  it("Bağlantılar: kartlar, 5 adımlı sihirbaz, 'Bunu ekibimiz yapsın', dürüstlük cümlesi (super_admin)", () => {
    const html = renderToStaticMarkup(createElement(ConnectionsView, { view: { ...empty, readError: false }, canWrite: true }));
    expect(html.match(/Bağlı değil/g)?.length).toBeGreaterThanOrEqual(2);
    for (const step of ["Google Cloud projesi ve OAuth istemcisi", "İstemci kimliğini girin", "Search Console", "developer token", "Ads&#x27;i bağlayın"]) {
      expect(html, step).toContain(step);
    }
    expect(html.match(/href="mailto:destek@emlaksoft\.com\.tr/g)).toHaveLength(5);
    expect(html).toContain("mailto:destek@emlaksoft.com.tr");
    expect(html).toContain(ADS_HONESTY_SENTENCE.replace(/'/g, "&#x27;").slice(0, 40));
    expect(html).toContain("https://emlaksoft.com.tr/api/admin/google/callback");
    expect(html).toContain("Testing");
    expect(html).toContain("Basic erişim başvurusu günler sürebilir");
    expect(html).toContain('name="clientId"');
  });

  it("Bağlantılar: ops salt okur (form yok), şifreleme kapalıysa uyarı", () => {
    const html = renderToStaticMarkup(createElement(ConnectionsView, { view: { ...empty, secretsEnabled: false }, canWrite: false }));
    expect(html).toContain("Salt okunur görünüm");
    expect(html).not.toContain('name="clientId"');
    expect(html).toContain("Şifreleme anahtarı tanımlı değil");
  });

  it("Performans: kurulum kartı, tablo/sayı yok", () => {
    const html = renderToStaticMarkup(
      createElement(PerformanceView, {
        data: { card: serviceCard(empty, "gsc"), property: null, period: 28, tab: "sorgular", queries: null, pages: null, inspections: null },
      }),
    );
    expect(html).toContain("Search Console bağlı değil");
    expect(html).toContain("/admin/site/baglantilar");
    expect(html).not.toContain("<table");
  });

  it("Google Ads: boş durum + sihirbaz bağlantısı, uydurma veri yok", () => {
    const html = renderToStaticMarkup(
      createElement(AdsView, {
        data: { card: serviceCard(empty, "ads"), period: 30, customerId: null, dashboard: null, recommendations: [], readonly: true },
      }),
    );
    expect(html).toContain("Google Ads bağlı değil");
    expect(html).toContain("/admin/site/baglantilar");
    expect(html).toContain("Google Ads içinden yapılır");
    expect(html).not.toContain("<table");
    expect(html).not.toContain("CAC (gerçek kayıt)");
  });
});
