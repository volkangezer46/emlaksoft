import { describe, expect, it } from "vitest";
import { buildLeadCommunication, leadChannelToCommChannel } from "../lead-message";

/**
 * P0 REGRESYON KİLİDİ: Telefonu eşleşen MEVCUT müşteriden gelen talebin mesajı
 * eskiden hiçbir yere yazılmıyordu (yalnız yeni müşteri insert'inde
 * customers.notes'a gidiyordu). Vitrin değerleme hunisinde tüm talep detayı bu
 * mesajın içinde olduğundan talep tamamen görünmez oluyordu.
 *
 * Buradaki sözleşme: mesaj boş değilse ASLA null dönmez ve gövde AYNEN korunur.
 */
describe("buildLeadCommunication", () => {
  const base = { customerId: "cus-1", channel: "web_form", source: "degerleme" };

  it("MÜKERRER lead'in mesajı hiçbir koşulda kaybolmaz", () => {
    const message =
      "Değerleme talebi: Kadıköy / İstanbul, Daire, 120 m², 3+1 oda. Ön tahmin: 8.500.000 ₺ – 9.500.000 ₺.";
    const row = buildLeadCommunication({ ...base, message, duplicate: true });

    expect(row).not.toBeNull();
    expect(row!.body).toBe(message);
    expect(row!.direction).toBe("inbound");
    expect(row!.customer_id).toBe("cus-1");
    expect(row!.outcome).toBe("mukerrer_talep");
    expect(row!.subject).toContain("Mevcut müşteriden yeni talep");
  });

  it("yeni müşteride de kayıt üretir (tek yol, öngörülebilir davranış)", () => {
    const row = buildLeadCommunication({ ...base, message: "Merhaba", duplicate: false });
    expect(row).not.toBeNull();
    expect(row!.body).toBe("Merhaba");
    expect(row!.outcome).toBe("yeni_talep");
  });

  it("mesaj ne olursa olsun (uzun, çok satırlı, emoji, boşluklu) gövde AYNEN korunur", () => {
    const cases = [
      "a".repeat(5000),
      "İlk satır\nİkinci satır\n\nÜçüncü",
      "  kenarları boşluklu  ",
      "🏠 3+1 daire, acil",
      "Fiyat: 1.250.000 ₺ – 1.400.000 ₺",
    ];
    for (const m of cases) {
      const row = buildLeadCommunication({ ...base, message: m, duplicate: true });
      expect(row, `mesaj kayboldu: ${m.slice(0, 30)}`).not.toBeNull();
      expect(row!.body).toBe(m.trim());
      expect(row!.body.length).toBeGreaterThan(0);
    }
  });

  it("kanal bilinmese bile kayıt üretilir — geçersiz enum değeri yazılmaz", () => {
    const gecerli = ["note", "whatsapp", "sms", "email", "call"];
    for (const ch of ["web_form", "vitrin", "portal", "", null, undefined, "SMS", "WhatsApp"]) {
      const row = buildLeadCommunication({
        customerId: "cus-1",
        message: "talep",
        channel: ch,
        source: "x",
        duplicate: true,
      });
      expect(row).not.toBeNull();
      expect(gecerli).toContain(row!.channel);
    }
  });

  it("yalnız gerçekten yazacak bir şey yoksa null döner", () => {
    expect(buildLeadCommunication({ ...base, message: "", duplicate: true })).toBeNull();
    expect(buildLeadCommunication({ ...base, message: "   ", duplicate: true })).toBeNull();
    expect(buildLeadCommunication({ ...base, message: null, duplicate: true })).toBeNull();
    expect(buildLeadCommunication({ ...base, message: undefined, duplicate: true })).toBeNull();
  });

  it("subject 200 karakteri aşmaz (DB'ye taşma olmasın)", () => {
    const row = buildLeadCommunication({
      customerId: "cus-1",
      message: "talep",
      channel: "web_form",
      source: "k".repeat(400),
      duplicate: true,
    });
    expect(row!.subject.length).toBeLessThanOrEqual(200);
  });
});

describe("leadChannelToCommChannel", () => {
  it("bilinen kanalları comm_channel enum değerlerine eşler", () => {
    expect(leadChannelToCommChannel("whatsapp")).toBe("whatsapp");
    expect(leadChannelToCommChannel("SMS")).toBe("sms");
    expect(leadChannelToCommChannel("e-posta")).toBe("email");
    expect(leadChannelToCommChannel("telefon")).toBe("call");
  });

  it("web formu ve bilinmeyenler 'note'a düşer", () => {
    expect(leadChannelToCommChannel("web_form")).toBe("note");
    expect(leadChannelToCommChannel("saçmasapan")).toBe("note");
    expect(leadChannelToCommChannel(null)).toBe("note");
  });
});
