import { describe, expect, it } from "vitest";
import {
  FIELD,
  packForFocus,
  parseBrandColor,
  parseFocusSegments,
  parseInviteEmails,
  parseOfficeType,
  parseWorkDistrictIds,
  readWizardOfficeProfile,
} from "./office-profile";
import { trialDaysLeft, trialLabel, trialUrgency } from "./trial";
import { canSwitchToRealUse, demoStripText, REAL_USE_NEXT_STEPS } from "./real-use";
import { DAY_MS } from "@/lib/clock";

const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";

describe("sihirbaz ofis profili ayrıştırıcıları", () => {
  it("ofis türü / odak / renk / ilçe / davet doğrulanır, geçersizler atılır", () => {
    expect(parseOfficeType("franchise")).toBe("franchise");
    expect(parseOfficeType("x")).toBeNull();
    expect(parseFocusSegments(["arsa", "satilik", "yok", "arsa"])).toEqual(["satilik", "arsa"]);
    expect(parseBrandColor("#1D5FD6")).toBe("#1d5fd6");
    expect(parseBrandColor("red")).toBeNull();
    expect(parseWorkDistrictIds([U1, "bad", U1.toUpperCase(), U2])).toEqual([U1, U2]);
    expect(parseInviteEmails([" A@x.com ", "a@x.com", "owner@x.com", "bozuk", "b@x.com", "c@x.com", "d@x.com"], "OWNER@x.com")).toEqual([
      "a@x.com",
      "b@x.com",
      "c@x.com",
    ]);
  });

  it("odak → örnek veri paketi (konut öncelikli)", () => {
    expect(packForFocus(["satilik", "ticari"])).toBe("konut");
    expect(packForFocus(["ticari", "arsa"])).toBe("ticari");
    expect(packForFocus(["arsa"])).toBe("arsa");
    expect(packForFocus([])).toBe("konut");
  });

  it("FormData'dan profil: hiçbir alan zorunlu değil", () => {
    const empty = readWizardOfficeProfile(new FormData(), "o@x.com");
    expect(empty).toMatchObject({ provinceId: null, officeType: null, brandColor: null, focus: [], inviteEmails: [], pack: "konut" });
    const f = new FormData();
    f.set(FIELD.provinceId, U1);
    f.set(FIELD.officeType, "kurumsal");
    f.append(FIELD.focus, "kiralik");
    f.append(FIELD.workDistricts, U2);
    f.append(FIELD.inviteEmails, "d@x.com");
    expect(readWizardOfficeProfile(f, "o@x.com")).toMatchObject({ provinceId: U1, officeType: "kurumsal", focus: ["kiralik"], workDistrictIds: [U2], inviteEmails: [] });
  });
  it("iletişim ve yetki belgesi: isteğe bağlı, kurala uymayan değer yazılmaz", () => {
    const f = new FormData();
    f.set(FIELD.officePhone, "05321234567");
    f.set(FIELD.addressLine, "  Atatürk Cd.   No: 5  ");
    f.set(FIELD.licenseNo, "3400123");
    expect(readWizardOfficeProfile(f, "o@x.com")).toMatchObject({ officePhoneRaw: "05321234567", addressLine: "Atatürk Cd. No: 5", licenseNo: "3400123" });
    const bad = new FormData();
    bad.set(FIELD.licenseNo, "<script>");
    expect(readWizardOfficeProfile(bad, "o@x.com")).toMatchObject({ officePhoneRaw: null, addressLine: null, licenseNo: null });
  });
});

describe("deneme ve gerçek kullanım görünümü", () => {
  const NOW = Date.UTC(2026, 9, 6, 12);
  it("kalan gün yukarı yuvarlanır, en az 0; metin ve aciliyet kademeleri", () => {
    expect(trialDaysLeft(new Date(NOW + 13.2 * DAY_MS).toISOString(), NOW)).toBe(14);
    expect(trialDaysLeft(new Date(NOW - DAY_MS).toISOString(), NOW)).toBe(0);
    expect(trialDaysLeft(null, NOW)).toBeNull();
    expect(trialLabel(12)).toBe("12 gün deneme kaldı");
    expect(trialLabel(1)).toBe("Deneme: son gün");
    expect(trialLabel(0)).toBe("Deneme süresi doldu");
    expect([trialUrgency(10), trialUrgency(3), trialUrgency(1), trialUrgency(null)]).toEqual(["none", "soon", "last", "none"]);
  });

  it("şerit metni yalnız örnek veri ve/veya deneme varsa üretilir", () => {
    expect(demoStripText({ sampleActive: true, trialText: "12 gün deneme kaldı" })).toBe("Demo verisiyle çalışıyorsun · 12 gün deneme kaldı");
    expect(demoStripText({ sampleActive: false, trialText: null })).toBeNull();
  });

  it("geçiş yalnız owner/gm; sonraki 3 adım gerçek sayfalara gider", () => {
    expect(["owner", "gm", "branch_manager", "advisor", null].map(canSwitchToRealUse)).toEqual([true, true, false, false, false]);
    expect(REAL_USE_NEXT_STEPS).toHaveLength(3);
    for (const s of REAL_USE_NEXT_STEPS) expect(s.href.startsWith("/app/")).toBe(true);
  });
});
