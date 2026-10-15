import { describe, expect, it } from "vitest";
import { isAllowedCorsOrigin } from "@/lib/public-request-security";
import { prepareWrite } from "@/lib/settings/prepare";
import { getSettingDef } from "@/lib/settings/registry";
import {
  LEAD_ALLOWED_ORIGINS_KEY,
  mergeLeadOrigins,
  normalizeLeadOrigin,
  parseLeadOriginsStored,
  parseLeadOriginsStrict,
} from "./lead-origins";

describe("lead.allowed_origins: sıkı ayrıştırma", () => {
  it("https alan adı (isteğe bağlı port ve sondaki /) kabul, küçük harfe ve origin biçimine iner", () => {
    expect(normalizeLeadOrigin("https://Ornek-Emlak.com.tr/")).toBe("https://ornek-emlak.com.tr");
    expect(normalizeLeadOrigin("https://www.ornek.com:8443")).toBe("https://www.ornek.com:8443");
    expect(normalizeLeadOrigin("https://ornek.com:443")).toBe("https://ornek.com");
  });
  it.each([
    "http://ornek.com",
    "https://ornek.com/iletisim",
    "https://ornek.com?x=1",
    "https://ornek.com#a",
    "https://kisi:sifre@ornek.com",
    "https://*.ornek.com",
    "https://localhost",
    "https://127.0.0.1",
    "https://intranet",
    "ornek.com",
    "javascript:alert(1)",
  ])("reddedilir: %s", (v) => {
    expect(normalizeLeadOrigin(v)).toBeNull();
    expect(parseLeadOriginsStrict(v).ok).toBe(false);
  });
  it("en çok 5 kaynak; tekrarlar birleşir; saklama virgüllü", () => {
    const five = ["a", "b", "c", "d", "e"].map((x) => `https://${x}.com`);
    const ok = parseLeadOriginsStrict([...five, "https://A.com/"].join("\n"));
    expect(ok).toEqual({ ok: true, origins: five, formatted: five.join(",") });
    expect(parseLeadOriginsStrict([...five, "https://f.com"].join(",")).ok).toBe(false);
    expect(parseLeadOriginsStrict("")).toEqual({ ok: true, origins: [], formatted: "" });
  });
  it("okumada bozuk depo değeri boş liste (ek izin yok)", () => {
    expect(parseLeadOriginsStored("https://ok.com,http://kotu.com")).toEqual([]);
    expect(parseLeadOriginsStored(null)).toEqual([]);
    expect(parseLeadOriginsStored("https://ok.com")).toEqual(["https://ok.com"]);
  });
});

describe("lead.allowed_origins: birleştirme ve CORS", () => {
  it("env + platform + ofis listeleri tekrarsız birleşir", () => {
    const merged = mergeLeadOrigins(["https://env.com"], ["https://emlaksoft.com.tr"], ["https://ofis.com", "https://env.com"]);
    expect(merged).toEqual(["https://env.com", "https://emlaksoft.com.tr", "https://ofis.com"]);
    expect(isAllowedCorsOrigin("https://ofis.com", merged)).toBe(true);
    expect(isAllowedCorsOrigin("https://baska.com", merged)).toBe(false);
  });
});

describe("lead.allowed_origins: ayar kaydı", () => {
  it("ofis kapsamlı, varsayılan boş; geçersiz değer yazılamaz, geçerli değer normalize saklanır", () => {
    const def = getSettingDef(LEAD_ALLOWED_ORIGINS_KEY)!;
    expect(def.scope).toBe("tenant");
    expect(def.default).toBe("");
    expect(prepareWrite({ key: LEAD_ALLOWED_ORIGINS_KEY, value: "http://ornek.com" }).ok).toBe(false);
    const ok = prepareWrite({ key: LEAD_ALLOWED_ORIGINS_KEY, value: "https://Ornek.com/\nhttps://b.com" });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.item.formatted).toBe("https://ornek.com,https://b.com");
  });
});
