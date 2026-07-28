import { describe, expect, it } from "vitest";
import {
  agentInitials,
  isValidAgentSlug,
  parseChips,
  shortenCustomerName,
  slugifyAgentName,
} from "./agent-profile";

describe("slugifyAgentName", () => {
  it("Türkçe karakterleri ASCII'ye indirger", () => {
    expect(slugifyAgentName("Ayşe Gül Öztürk")).toBe("ayse-gul-ozturk");
    expect(slugifyAgentName("İbrahim ÇAĞLAR")).toBe("ibrahim-caglar");
  });

  it("üretilen slug DB kısıtına uyar", () => {
    for (const name of ["Ali Veli", "  Zeynep   Kaya  ", "Öz-Öz Şen"]) {
      expect(isValidAgentSlug(slugifyAgentName(name))).toBe(true);
    }
  });

  it("çok kısa/boş girdide boş döner (çağıran yedek üretsin)", () => {
    expect(slugifyAgentName("")).toBe("");
    expect(slugifyAgentName("!!")).toBe("");
    expect(slugifyAgentName("Ay")).toBe("");
  });

  it("60 karakteri aşmaz ve tire ile bitmez", () => {
    const slug = slugifyAgentName("A".repeat(80) + " Soyad");
    expect(slug.length).toBeLessThanOrEqual(60);
    expect(slug.endsWith("-")).toBe(false);
  });
});

describe("isValidAgentSlug", () => {
  it("geçersiz biçimleri reddeder", () => {
    for (const bad of ["-ali", "ali-", "Ali", "ab", "ali_veli", "ali veli", ""]) {
      expect(isValidAgentSlug(bad)).toBe(false);
    }
  });
});

describe("parseChips", () => {
  it("kırpar, tekilleştirir ve adet sınırını uygular", () => {
    expect(parseChips(" Kadıköy , kadıköy ,Ataşehir,  ", 8)).toEqual(["Kadıköy", "Ataşehir"]);
    expect(parseChips("a,b,c,d", 2)).toEqual(["a", "b"]);
    expect(parseChips(null, 5)).toEqual([]);
  });
});

describe("shortenCustomerName", () => {
  it("yalnız baş harf + soyadı bırakır", () => {
    expect(shortenCustomerName("Ahmet Yılmaz")).toBe("A. Yılmaz");
    expect(shortenCustomerName("ayşe gül öztürk")).toBe("A. öztürk");
    expect(shortenCustomerName("Mehmet")).toBe("M.");
    expect(shortenCustomerName(null)).toBe("Bir müşteri");
  });
});

describe("agentInitials", () => {
  it("en fazla iki baş harf döner", () => {
    expect(agentInitials("Ayşe Gül Öztürk")).toBe("AG");
    expect(agentInitials("")).toBe("");
  });
});
