import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { requestApprovalIfNeeded, type ApprovalGateStore } from "@/lib/oversight/approval-gate";
import { defaultApprovalRules } from "@/lib/oversight/settings";

/**
 * Onay kapisi baglanti sozlesmesi: kapinin cagrildigini ve pending/requested/error durumunda
 * islemin (yazma/indirme) kapidan SONRA, durdurularak yapildigini kaynak duzeyinde dogrular.
 */
const src = (p: string) => readFileSync(p, "utf8");
const STOP = /approval\.status !== "not_required" && approval\.status !== "approved"/;

function callIndex(s: string, type: string) {
  const i = s.indexOf(`requestApprovalIfNeeded(gate.tenantId, gate.userId, "${type}"`);
  expect(i, `${type} kapisi cagrilmali`).toBeGreaterThan(-1);
  return i;
}

describe("onay kapisi baglantilari", () => {
  const props = src("src/app/actions/properties.ts");

  it("updateProperty: fiyat dusurme ve komisyon indirimi, requirePermission SONRASI ve guncellemeden ONCE", () => {
    const fn = props.slice(props.indexOf("export async function updateProperty"), props.indexOf("export async function setPropertyStatus"));
    const perm = fn.indexOf('requirePermission("properties", "edit")');
    const price = callIndex(fn, "price_drop");
    const comm = callIndex(fn, "commission_discount");
    const write = fn.search(/\.from\("properties"\)\s*\.update\(/);
    expect(perm).toBeGreaterThan(-1);
    expect(write).toBeGreaterThan(-1);
    expect(perm).toBeLessThan(price);
    expect(price).toBeLessThan(write);
    expect(comm).toBeLessThan(write);
    expect(fn).toMatch(/priceValue < oldPrice/);
    expect(fn).toMatch(/commissionValue < oldCommissionRate/);
    expect(fn.match(new RegExp(STOP.source, "g"))?.length).toBeGreaterThanOrEqual(2);
    expect(fn).toContain("return { error: approval.message }");
  });

  it("deleteProperty: ilan silme kapisi, silmeden once; hata donerek durur", () => {
    const fn = props.slice(props.indexOf("export async function deleteProperty"), props.indexOf("export async function reassignProperty"));
    const gateAt = callIndex(fn, "listing_delete");
    expect(fn.indexOf('requirePermission("properties", "delete")')).toBeLessThan(gateAt);
    expect(gateAt).toBeLessThan(fn.indexOf("deleted_at"));
    expect(fn).toMatch(STOP);
    expect(fn).toContain("return { error: approval.message }");
  });

  it("export.ts: tum CSV'ler exportResult tek cikisindan gecer; kapi csv uretmeden once, durumda hata doner", () => {
    const s = src("src/app/actions/export.ts");
    const fn = s.slice(s.indexOf("async function exportResult"), s.indexOf("export async function exportCustomersCsv"));
    const gateAt = fn.indexOf('requestApprovalIfNeeded(gate.tenantId, gate.userId, "bulk_export"');
    expect(gateAt).toBeGreaterThan(-1);
    expect(gateAt).toBeLessThan(fn.indexOf("toCsv(rows)"));
    expect(fn).toMatch(STOP);
    expect(fn).toContain("return { error: approval.message }");
    // atlama yolu yok: csv donen baska yer exportResult disinda olamaz
    expect(s.match(/return \{ csv/g)?.length).toBe(1);
  });

  it("tam akis /api/export/[entity]: kapi akis acilmadan once, 403 ile durur", () => {
    const s = src("src/app/api/export/[entity]/route.ts");
    const gateAt = s.indexOf('requestApprovalIfNeeded(gate.tenantId, gate.userId, "bulk_export"');
    expect(gateAt).toBeGreaterThan(-1);
    expect(gateAt).toBeGreaterThan(s.indexOf("requirePermission(def.module"));
    expect(gateAt).toBeLessThan(s.indexOf("openFullCsvStream({"));
    expect(s).toMatch(STOP);
    expect(s).toContain("jsonError(approval.message, 403)");
  });

  it("ofis kontrol ayar ekraninda 'baglantisi yapilmamis' notu kalmadi", () => {
    const s = src("src/app/app/ofis-kontrol/kurallar/settings-form.tsx");
    expect(s).not.toMatch(/bağlantısı yapılmamış/);
  });
});

describe("kapi varsayilan kapali (mantik)", () => {
  const base: ApprovalGateStore = {
    loadRules: async () => defaultApprovalRules(),
    isManager: async () => false,
    findOpen: async () => null,
    isConsumed: async () => false,
    consume: async () => true,
    create: async () => ({ id: "x" }),
  };

  it("ayar tablosu yokken (depo varsayilan kapaliya duser) dort islem de not_required", async () => {
    const store: ApprovalGateStore = { ...base, loadRules: async () => defaultApprovalRules() };
    for (const [type, payload] of [
      ["price_drop", { oldPrice: 1000, newPrice: 100, entityId: "p" }],
      ["commission_discount", { standardRate: 3, requestedRate: 1 }],
      ["listing_delete", { entityId: "p" }],
      ["bulk_export", { rows: 5000, exportEntity: "musteriler" }],
    ] as const) {
      expect((await requestApprovalIfNeeded("t", "u", type, payload, store)).status).toBe("not_required");
    }
  });

  it("kural okuma HATASI (tablo yoklugu degil) dort islemi de durdurur (fail-open yok)", async () => {
    const store: ApprovalGateStore = {
      ...base,
      loadRules: async () => {
        throw new Error("connection reset");
      },
    };
    expect((await requestApprovalIfNeeded("t", "u", "listing_delete", { entityId: "p" }, store)).status).toBe("error");
    expect((await requestApprovalIfNeeded("t", "u", "bulk_export", { rows: 5000 }, store)).status).toBe("error");
  });

  it("kural aciksa ve talep acilamazsa error doner (cagiran durdurur)", async () => {
    const rules = defaultApprovalRules();
    rules.listing_delete = { enabled: true, threshold: 0 };
    const store: ApprovalGateStore = { ...base, loadRules: async () => rules, create: async () => null };
    expect((await requestApprovalIfNeeded("t", "u", "listing_delete", { entityId: "p" }, store)).status).toBe("error");
  });
});
