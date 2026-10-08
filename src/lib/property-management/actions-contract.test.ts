import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Mülk yönetimi action sözleşmesi: her dışa açık action `rentals` modül kapısıyla başlar; iptal eylemleri `delete`,
 * diğer yazmalar `edit` ister; service_role (createAdminClient) KULLANILMAZ; IBAN denetim kaydına yazılmaz.
 */
const src = readFileSync("src/app/actions/rental-finance.ts", "utf8");
const blocks = src.split(/\nexport async function /).slice(1);

describe("rental-finance action kapıları", () => {
  it("action'lar bulundu", () => {
    expect(blocks.length).toBeGreaterThanOrEqual(7);
  });
  it.each(blocks.map((b) => [b.slice(0, b.indexOf("(")), b] as const))("%s: ilk iş requirePermission('rentals', ...)", (_name, body) => {
    const head = body.slice(0, 400);
    expect(head).toMatch(/requirePermission\("rentals", "(edit|delete)"\)/);
  });
  it("iptal eylemleri delete ister", () => {
    for (const name of ["voidRentPayment", "voidOwnerPayout"]) {
      const b = blocks.find((x) => x.startsWith(name))!;
      expect(b.slice(0, 400)).toContain('"rentals", "delete"');
    }
  });
  it("service_role yok, IBAN denetim kaydına yazılmaz", () => {
    expect(src).not.toMatch(/createAdminClient/);
    expect(src).not.toMatch(/newValue:\s*\{[^}]*owner_iban/);
  });
  it("yazma RPC'leri JWT kimliğiyle çağrılır", () => {
    for (const rpc of ["record_rent_payment", "void_rent_payment", "record_owner_payout", "void_owner_payout"]) {
      expect(src).toContain(`rpc("${rpc}"`);
    }
  });
});
