import { describe, expect, it } from "vitest";
import { getHtmlAdapter, listHtmlAdapters } from "./index";

/**
 * "İlanlarım" (mağaza listesi) kart alanları — SENTETİK sayfa (gerçek portal HTML'i KOPYALANMADI, DOĞRULANMADI).
 * Kilitlenen kural: okunamayan alan null kalır (uydurulmaz), toplam ilan sayısı yoksa liste "tam" sayılamaz.
 */

const sah = getHtmlAdapter("sahibinden")!;
const URL_ = "https://banaozel.sahibinden.com/ilanlarim";

const card = (id: string, title: string, price: string, extra = "") => `
  <li class="classified"><a href="/ilan/emlak-konut-${id}/detay" title="${title}">
    <img data-src="https://i0.shbdn.example/photos/${id}.jpg" alt="">
    <span class="price">${price}</span> <span class="meta">120 m² 3+1</span>
    <span class="location">Kadıköy / Caferağa</span>${extra}</a></li>`;

const html = `<html><div class="result-count">2 ilan bulundu</div>
  ${card("1111111111", "Kadıköy 3+1 satılık daire", "4.250.000 TL")}
  ${card("2222222222", "Bostancı 2+1", "3.100.000 TL", "<em>Pasif</em>")}
  <a href="/ilanlarim?pagingOffset=20" rel="next">Sonraki</a></html>`;

describe("ilanlarım kart alanları", () => {
  const r = sah.parseStore({ status: 200, finalUrl: URL_, html });

  it("başlık, fiyat, m², oda, konum, küçük resim ve durum okunur", () => {
    expect(r.error).toBeNull();
    expect(r.items[0]).toMatchObject({
      externalId: "1111111111",
      title: "Kadıköy 3+1 satılık daire",
      price: 4_250_000,
      sqm: 120,
      rooms: "3+1",
      location: "Kadıköy / Caferağa",
      status: "active",
    });
    expect(r.items[0].thumbUrl).toContain("1111111111.jpg");
    expect(r.items[1].status).toBe("passive");
    expect(r.nextUrl).toBe("https://banaozel.sahibinden.com/ilanlarim?pagingOffset=20");
  });

  it("toplam ilan sayısı okunur; okunamazsa null (liste tam sayılamaz)", () => {
    expect(r.totalCount).toBe(2);
    const noTotal = sah.parseStore({ status: 200, finalUrl: URL_, html: card("3333333333", "Daire", "1.000.000 TL") });
    expect(noTotal.totalCount).toBeNull();
  });

  it("yabancı para birimi görünüyorsa fiyat yazılmaz", () => {
    const usd = sah.parseStore({ status: 200, finalUrl: URL_, html: card("4444444444", "Villa", "$ 500.000 TL") });
    expect(usd.items[0].price ?? null).toBeNull();
  });

  it("başlangıç adresleri yalnız portal alanında", () => {
    for (const a of listHtmlAdapters()) {
      expect(a.storeStartUrls.length).toBeGreaterThan(0);
      for (const u of a.storeStartUrls) expect(a.isPortalUrl(u)).toBe(true);
    }
  });
});
