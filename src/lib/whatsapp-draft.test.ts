import { describe, expect, it } from "vitest";
import { buildWhatsAppDraft, whatsAppDraftHref } from "@/lib/whatsapp-draft";

describe("WhatsApp taslağı", () => {
  it("müşteri kartı: şablon değişkenleri dolar, bağlantı müşterinin numarasına doğru metinle açılır", () => {
    const d = buildWhatsAppDraft("0532 123 45 67", "Merhaba {musteri}, {randevu_tarih} {randevu_saat} randevumuz: {link}", {
      musteri: "Ayşe Yılmaz",
      randevu_tarih: "15 Ekim Perşembe",
      randevu_saat: "14:30",
      link: "https://app.test/randevu-teyit/tok",
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
});
