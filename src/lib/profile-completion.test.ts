import { describe, expect, it } from "vitest";
import {
  computeProfileCompletion,
  profileStepHref,
  profileStepNeighbors,
  resolveProfileStep,
  type ProfileFacts,
} from "./profile-completion";

const EMPTY: ProfileFacts = {
  provinceId: null,
  districtId: null,
  addressLine: null,
  phone: null,
  licenseNo: null,
  taxNumber: null,
  logoUrl: null,
  brandColor: null,
  extAvailable: true,
  officeType: null,
  focusSegments: null,
  workDistrictIds: null,
  memberCount: 1,
};

const FULL: ProfileFacts = {
  provinceId: "p",
  districtId: "d",
  addressLine: "Bağdat Cad. No:42 Kadıköy",
  phone: "02161234567",
  licenseNo: "TT-123",
  taxNumber: "1234567890",
  logoUrl: "https://x/logo.png",
  brandColor: "#1d5fd6",
  extAvailable: true,
  officeType: "bagimsiz",
  focusSegments: ["satilik"],
  workDistrictIds: ["d"],
  memberCount: 3,
};

describe("ofis profili eksiklik hesabı", () => {
  it("boş ofis: her madde eksik, %0, ilk adım konum", () => {
    const c = computeProfileCompletion(EMPTY);
    expect(c.total).toBe(11);
    expect(c.doneCount).toBe(0);
    expect(c.percent).toBe(0);
    expect(c.complete).toBe(false);
    expect(c.nextStep).toBe("konum");
    expect(c.missingByStep.odak).toBe(3);
  });

  it("her şey dolu: %100, tamamlandı, sıradaki adım yok", () => {
    const c = computeProfileCompletion(FULL);
    expect(c.percent).toBe(100);
    expect(c.complete).toBe(true);
    expect(c.nextStep).toBeNull();
    expect(c.missing).toHaveLength(0);
  });

  it("kısa adres ve yalnız kurucu olan ekip eksik sayılır", () => {
    const c = computeProfileCompletion({ ...FULL, addressLine: "Kısa", memberCount: 1 });
    expect(c.missing.map((m) => m.id)).toEqual(["adres", "ekip"]);
    expect(c.nextStep).toBe("konum");
  });

  it("il var ama ilçe yok: konum eksik", () => {
    expect(computeProfileCompletion({ ...FULL, districtId: null }).missing.map((m) => m.id)).toEqual(["konum"]);
  });

  it("genişletme sütunları yoksa odak maddeleri listeye girmez (sahte eksik yok)", () => {
    const c = computeProfileCompletion({ ...EMPTY, extAvailable: false });
    expect(c.items.map((i) => i.id)).not.toContain("tur");
    expect(c.total).toBe(8);
  });

  it("adım çözümü: geçerli param > ilk eksik > ilk adım", () => {
    const part = computeProfileCompletion({ ...FULL, logoUrl: null });
    expect(resolveProfileStep("ekip", part)).toBe("ekip");
    expect(resolveProfileStep("saçma", part)).toBe("marka");
    expect(resolveProfileStep(undefined, computeProfileCompletion(FULL))).toBe("konum");
  });

  it("komşular ve bağlantı", () => {
    expect(profileStepNeighbors("konum")).toEqual({ prev: null, next: "iletisim" });
    expect(profileStepNeighbors("ekip")).toEqual({ prev: "odak", next: null });
    expect(profileStepHref("marka")).toBe("/app/ayarlar/profil-tamamla?adim=marka");
  });
});
