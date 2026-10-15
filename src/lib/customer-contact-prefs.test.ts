import { describe, expect, it } from "vitest";
import {
  contactPrefsFromRow,
  contactPrefsSummary,
  contactWindowNote,
  isMissingContactPrefsColumn,
  isWithinContactWindow,
  sanitizeContactPrefs,
} from "./customer-contact-prefs";

// İstanbul = UTC+3
const at = (y: number, m: number, d: number, hIst: number) => Date.UTC(y, m - 1, d, hIst - 3, 0, 0);

describe("customer-contact-prefs (CRM-G11)", () => {
  it("tanınmayan değerleri atar, pencereleri sabit sıraya dizer", () => {
    expect(sanitizeContactPrefs({ channel: "fax", windows: ["aksam", "x", "sabah", "aksam"], language: "TR" })).toEqual({
      channel: null,
      windows: ["sabah", "aksam"],
      language: null,
    });
    expect(contactPrefsFromRow({ preferred_channel: "whatsapp", contact_window: ["hafta_sonu"], preferred_language: "en" })).toEqual({
      channel: "whatsapp",
      windows: ["hafta_sonu"],
      language: "en",
    });
  });

  it("rozet metni: kanal · zaman · (Türkçe dışı) dil", () => {
    expect(contactPrefsSummary({ channel: "whatsapp", windows: ["aksam"], language: "tr" })).toBe("WhatsApp tercih · akşam");
    expect(contactPrefsSummary({ channel: null, windows: [], language: "ru" })).toBe("Rusça");
    expect(contactPrefsSummary({ channel: null, windows: [], language: null })).toBeNull();
  });

  it("İstanbul saatine göre pencere", () => {
    const thu19 = at(2026, 10, 15, 19);
    const thu11 = at(2026, 10, 15, 11);
    const sat11 = at(2026, 10, 17, 11);
    expect(isWithinContactWindow([], thu11)).toBe(true);
    expect(isWithinContactWindow(["aksam"], thu19)).toBe(true);
    expect(isWithinContactWindow(["aksam"], thu11)).toBe(false);
    expect(isWithinContactWindow(["hafta_sonu"], thu19)).toBe(false);
    expect(isWithinContactWindow(["hafta_sonu"], sat11)).toBe(true);
    expect(contactWindowNote(["aksam"], thu11)).toBe("Uygun saat: akşam (18:00–21:00)");
    expect(contactWindowNote(["aksam"], thu19)).toBeNull();
  });

  it("sütun yok hatasını tanır", () => {
    expect(isMissingContactPrefsColumn({ code: "42703" })).toBe(true);
    expect(isMissingContactPrefsColumn({ message: 'column customers.preferred_channel does not exist' })).toBe(true);
    expect(isMissingContactPrefsColumn({ code: "42501", message: "permission denied" })).toBe(false);
  });
});
