import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildPortalTabs, portalRequestMessage, resolvePortalTab, signerMatchesCustomer } from "@/lib/customer-portal/portal-model";

describe("müşteri tek portalı", () => {
  it("sekmeler yalnız verisi olan rollerden; hiçbiri yoksa alıcı (boş durum)", () => {
    expect(buildPortalTabs({ buyer: 2, owner: 1, renter: 0, documents: 1 })).toEqual(["alici", "malik", "belgeler"]);
    expect(buildPortalTabs({ buyer: 0, owner: 0, renter: 1, documents: 0 })).toEqual(["kiraci"]);
    expect(buildPortalTabs({ buyer: 0, owner: 0, renter: 0, documents: 0 })).toEqual(["alici"]);
    expect(resolvePortalTab("malik", ["alici", "malik"])).toBe("malik");
    expect(resolvePortalTab("kiraci", ["alici", "malik"])).toBe("alici");
  });

  it("imzacı eşleşmesi telefonun son 10 hanesiyle; telefon yoksa eşleşmez (başkasının imza bağlantısı gösterilmez)", () => {
    expect(signerMatchesCustomer("+90 532 123 45 67", "05321234567")).toBe(true);
    expect(signerMatchesCustomer("05321234567", null)).toBe(false);
    expect(signerMatchesCustomer(null, "05321234567")).toBe(false);
    expect(signerMatchesCustomer("05329999999", "05321234567")).toBe(false);
  });

  it("RPC kodları Türkçe mesaja; bilinmeyen kod hata", () => {
    expect(portalRequestMessage("ok").ok).toBe(true);
    expect(portalRequestMessage("rate_limited").ok).toBe(false);
    expect(portalRequestMessage("??").text).toMatch(/kaydedilemedi/);
  });

  it("yazma yolu service_role kullanmaz; malik portalı taslak teklifleri göstermez; geriye dönük malik bağlantısı korunur", () => {
    const action = readFileSync("src/app/actions/customer-portal-requests.ts", "utf8");
    expect(action).not.toContain("createAdminClient");
    expect(action).toContain('rpc("portal_customer_request"');
    expect(readFileSync("src/app/actions/owner-portal.ts", "utf8")).toContain('.neq("status", "draft")');
    const loader = readFileSync("src/app/actions/customer-portal.ts", "utf8");
    expect(loader).toContain('.eq("owner_customer_id", customerId)');
    expect(loader).toContain('.eq("renter_customer_id", customerId)');
    expect(loader).toContain("/malik-portali/");
    // Yeni service_role çağrısı yok: dosyada tek createAdminClient() (getCustomerPortalData).
    expect(loader.match(/createAdminClient\(\)/g)?.length).toBe(1);
  });
});
