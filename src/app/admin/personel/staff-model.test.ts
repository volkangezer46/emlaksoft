import { describe, expect, it } from "vitest";
import { generatePassword, passwordStrength, PLATFORM_ROLES, roleSummary, staffKpi } from "./staff-model";

describe("generatePassword", () => {
  it("her sınıftan karakter içerir ve uzunluğu korur", () => {
    let seed = 7;
    const rnd = (max: number) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % max;
    };
    for (let i = 0; i < 50; i += 1) {
      const p = generatePassword(rnd, 14);
      expect(p).toHaveLength(14);
      expect(p).toMatch(/[a-z]/);
      expect(p).toMatch(/[A-Z]/);
      expect(p).toMatch(/\d/);
      expect(p).toMatch(/[^A-Za-z0-9]/);
      expect(passwordStrength(p).acceptable).toBe(true);
    }
  });
});

describe("passwordStrength", () => {
  it("boş, kısa ve güçlü ayrımı", () => {
    expect(passwordStrength("").score).toBe(0);
    expect(passwordStrength("abc").acceptable).toBe(false);
    expect(passwordStrength("abc").tone).toBe("danger");
    expect(passwordStrength("Abcdefg1!xyzQ9").score).toBe(4);
  });
});

describe("roleSummary", () => {
  it("izinli + yasaklı = tüm modüller; super_admin hiçbirini yasaklamaz", () => {
    for (const r of PLATFORM_ROLES) {
      const s = roleSummary(r);
      expect(s.allowed.length + s.denied.length).toBe(15);
    }
    expect(roleSummary("super_admin").denied).toEqual([]);
    expect(roleSummary("support").denied).toContain("Personel yönetimi");
  });
});

describe("staffKpi", () => {
  it("gerçek satırlardan sayar", () => {
    const k = staffKpi(
      [
        { is_active: true, last_sign_in_at: "2026-10-01T00:00:00Z" },
        { is_active: true, last_sign_in_at: null },
        { is_active: false, last_sign_in_at: null },
      ],
      "2026-09-01T00:00:00Z",
    );
    expect(k).toEqual({ total: 3, active: 2, passive: 1, neverLoggedIn: 1, recentLogin: 1 });
  });
});
