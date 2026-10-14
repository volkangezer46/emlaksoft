import { describe, expect, it } from "vitest";
import { DEFAULT_TEMPLATES } from "@/lib/message-templates";
import { buildWhatsAppDraft, varsForCategory, whatsAppDraftHref } from "@/lib/whatsapp-draft";

describe("WhatsApp taslağı", () => {
  it("müşteri kartı: şablon değişkenleri dolar, bağlantı müşterinin numarasına doğru metinle açılır", () => {
    const d = buildWhatsAppDraft("0532 123 45 67", "Merhaba {musteri}, {randevu_tarih} {randevu_saat} randevumuz: {teyit_linki}", {
      musteri: "Ayşe Yılmaz",
      randevu_tarih: "15 Ekim Perşembe",
      randevu_saat: "14:30",
      teyit_linki: "https://app.test/randevu-teyit/tok",
    });
    expect(d.message).toBe("Merhaba Ayşe Yılmaz, 15 Ekim Perşembe 14:30 randevumuz: https://app.test/randevu-teyit/tok");
    expect(d.direct).toBe(true);
    expect(d.href).toBe(`https://wa.me/905321234567?text=${encodeURIComponent(d.message)}`);
  });

  it("portföy: numara yoksa alıcıyı WhatsApp'ta seçtiren paylaşım bağlantısı; verilmeyen değişken temizlenir", () => {
    const d = buildWhatsAppDraft(null, "{portfoy} ({portfoy_kodu}) · {fiyat} {link}", { portfoy: "3+1 Daire", portfoy_kodu: "VD-1", fiyat: "4.750.000 ₺" });
    expect(d.direct).toBe(false);
    expect(d.message).toBe("3+1 Daire (VD-1) · 4.750.000 ₺");
    expect(d.href).toBe(`https://wa.me/?text=${encodeURIComponent(d.message)}`);
  });

  it("şablon seçilmeden: numara varsa boş sohbet, yoksa bağlantı yok", () => {
    expect(whatsAppDraftHref("05321234567", "")).toEqual({ href: "https://wa.me/905321234567", direct: true });
    expect(buildWhatsAppDraft(null, null, {}).href).toBeNull();
  });

  it("müşteri kartı: teyit bağlantısı ve randevu yeri ilan şablonuna sızmaz, yalnız randevu şablonunda dolar", () => {
    const vars = { musteri: "Ayşe Yılmaz", randevu_tarih: "15 Ekim Perşembe", randevu_saat: "14:30", teyit_linki: "https://app.test/randevu-teyit/tok" };
    const categoryVars = { randevu: { adres: "Çankaya Ofis" } };
    const body = (title: string) => DEFAULT_TEMPLATES.find((t) => t.title === title)!;

    const ilan = body("İlan bilgisi paylaşımı");
    const ilanMsg = buildWhatsAppDraft("05321234567", ilan.body, varsForCategory(ilan.category, vars, categoryVars)).message;
    expect(ilanMsg).not.toContain("randevu-teyit");
    expect(ilanMsg).not.toContain("Çankaya Ofis");

    const acikEv = body("Açık ev daveti");
    expect(buildWhatsAppDraft("05321234567", acikEv.body, varsForCategory(acikEv.category, vars, categoryVars)).message).not.toContain("randevu-teyit");

    const teyit = body("Randevu teyidi");
    expect(buildWhatsAppDraft("05321234567", teyit.body, varsForCategory(teyit.category, vars, categoryVars)).message).toContain("Adres: Çankaya Ofis");
  });
});
