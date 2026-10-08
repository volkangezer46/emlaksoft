import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Bina yönetimi action sözleşmesi: her dışa açık action `expenses` modül kapısıyla başlar (oluşturma = create, tahsilat/düzenleme = edit,
 * iptal/arşiv = delete); mahsup ayrıca rentals:edit ister; service_role (createAdminClient) KULLANILMAZ; yazma RPC'leri JWT kimliğiyle çağrılır.
 */
const src = readFileSync("src/app/actions/building-management.ts", "utf8");
const blocks = src.split(/\nexport async function /).slice(1);

describe("building-management action kapıları", () => {
  it("action'lar bulundu", () => {
    expect(blocks.length).toBeGreaterThanOrEqual(12);
  });
  it.each(blocks.map((b) => [b.slice(0, b.indexOf("(")), b] as const))("%s: ilk iş requirePermission('expenses', ...)", (_name, body) => {
    expect(body.slice(0, 300)).toMatch(/requirePermission\("expenses", (?:"(?:create|edit|delete)"|input\.id \? "edit" : "create")\)/);
  });
  it("iptal / arşiv eylemleri delete ister", () => {
    for (const name of ["archiveBuilding", "voidBuildingBatch", "voidBuildingPayment"]) {
      const b = blocks.find((x) => x.startsWith(name))!;
      expect(b.slice(0, 300), name).toContain('"expenses", "delete"');
    }
  });
  it("tahsilat / mahsup / daire pasifleştirme edit ister; oluşturmalar create ister", () => {
    for (const name of ["recordBuildingPayment", "offsetChargeToOwner", "setUnitActive", "updateBuilding"]) {
      expect(blocks.find((x) => x.startsWith(name))!.slice(0, 300), name).toContain('"expenses", "edit"');
    }
    for (const name of ["createBuilding", "createUnitsBulk", "createAidatBatch", "createExpenseShare"]) {
      expect(blocks.find((x) => x.startsWith(name))!.slice(0, 300), name).toContain('"expenses", "create"');
    }
  });
  it("mahsup ayrıca rentals:edit kapısı koyar", () => {
    const b = blocks.find((x) => x.startsWith("offsetChargeToOwner"))!;
    expect(b).toMatch(/requirePermission\("rentals", "edit"\)/);
  });
  it("service_role yok; yazma RPC'leri çağrılır", () => {
    expect(src).not.toMatch(/createAdminClient/);
    for (const rpc of ["create_building_batch", "void_building_batch", "record_building_payment", "void_building_payment", "offset_building_charge_to_owner"]) {
      expect(src).toContain(`rpc("${rpc}"`);
    }
  });
  it("tahakkuk / tahsilat tablolarına doğrudan yazılmaz (yalnız RPC)", () => {
    expect(src).not.toMatch(/from\("building_(charges|charge_batches|payments)"\)\s*\.\s*(insert|update|delete|upsert)/);
  });
  it("ham veritabanı hata metni kullanıcıya dönmez", () => {
    expect(src).not.toMatch(/error:\s*(error|\w+Err)\.message/);
  });
});

describe("portal ve rapor yüzeyleri", () => {
  it("portal bölümü salt-okunur: yazma çağrısı yok", () => {
    const portal = readFileSync("src/components/public/building-dues-section.tsx", "utf8");
    expect(portal).not.toMatch(/\.(insert|update|delete|upsert|rpc)\(/);
    expect(portal).not.toMatch(/use server|use client/);
  });
  it("portal okuyucusu izleyenin ödeyen olduğu tahakkuklarla sınırlıdır ve tenant süzgeci taşır", () => {
    const load = readFileSync("src/lib/building-management/load.ts", "utf8");
    const portalFn = load.slice(load.indexOf("export async function loadPortalCustomerDues"));
    expect(portalFn).toContain('.eq("tenant_id", tenantId)');
    expect(portalFn).toMatch(/payerRole === input\.role/);
  });
});
