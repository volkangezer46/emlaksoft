import { describe, expect, it } from "vitest";
import { foldTr, queryStems, suggestHelpArticles } from "./search";

const content = {
  guides: [
    { slug: "portal-ilan", title: "Portal ilanını yayına alma", intro: "İlanı sahibinden ve hepsiemlak'a gönderin.", steps: ["Portföyü açın", "Portal sekmesi"], href: "/app/portfoyler", cta: "Aç" },
    { slug: "musteri-ekle", title: "Müşteri ekleme", intro: "Yeni müşteri kaydı.", steps: ["Müşteriler > Yeni"], href: "/app/musteriler", cta: "Aç" },
  ],
  faq: [
    { id: "ilan-gitmiyor", category: "kayitlar" as const, q: "İlanım portala neden gitmiyor?", a: "Portal bağlantısı ve zorunlu alanları kontrol edin." },
    { id: "fatura", category: "paket" as const, q: "Faturamı nereden indiririm?", a: "Abonelik sayfasından." },
  ],
};

describe("yardım önerisi", () => {
  it("Türkçe katlama ve dolgu sözcükleri", () => {
    expect(foldTr("İLANIM Şube")).toBe("ilanim sube");
    expect(queryStems("Portal ilanım yayına gitmiyor lütfen")).toEqual(["porta", "ilani", "yayin"]);
  });
  it("başlık eşleşmesi öne çıkar, en çok 3 öneri, href derin bağlantı", () => {
    const s = suggestHelpArticles(content, "Portal ilanım yayına gitmiyor");
    expect(s.length).toBeGreaterThan(0);
    expect(s.length).toBeLessThanOrEqual(3);
    expect(s[0]!.slug).toBe("portal-ilan");
    expect(s[0]!.href).toBe("/app/yardim?sekme=rehberler#portal-ilan");
    expect(s.map((x) => x.slug)).not.toContain("fatura");
  });
  it("anlamsız ya da kısa sorguda öneri yok", () => {
    expect(suggestHelpArticles(content, "bir sorun var")).toEqual([]);
    expect(suggestHelpArticles(content, "xyzw qwer")).toEqual([]);
  });
});
