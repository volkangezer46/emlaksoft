import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isSafeStorageDeletionPath } from "./storage-deletion-policy";
import { cronStepsFailed, runCronSteps } from "./cron-steps";

const TENANT = "11111111-1111-4111-8111-111111111111";
const CUSTOMER = "22222222-2222-4222-8222-222222222222";
const NOTICE = "33333333-3333-4333-8333-333333333333";
const FILE = "44444444-4444-4444-8444-444444444444";
const read = (p: string) => readFileSync(p, "utf8");

describe("rent-receipts silme politikası", () => {
  it("ofis/kiracı/bildirim/dosya yolunu kabul eder", () => {
    expect(
      isSafeStorageDeletionPath({
        tenantId: TENANT,
        parentId: CUSTOMER,
        bucket: "rent-receipts",
        objectPath: `${TENANT}/${CUSTOMER}/${NOTICE}/${FILE}.pdf`,
      }),
    ).toBe(true);
  });

  it("başka ofis, geçiş ve yanlış uzantıyı reddeder", () => {
    const base = { tenantId: TENANT, parentId: CUSTOMER, bucket: "rent-receipts" };
    expect(isSafeStorageDeletionPath({ ...base, objectPath: `${TENANT}/${CUSTOMER}/${NOTICE}/${FILE}.exe` })).toBe(false);
    expect(isSafeStorageDeletionPath({ ...base, objectPath: `${TENANT}/${CUSTOMER}/../${NOTICE}/${FILE}.pdf` })).toBe(false);
    expect(
      isSafeStorageDeletionPath({
        ...base,
        objectPath: `99999999-9999-4999-8999-999999999999/${CUSTOMER}/${NOTICE}/${FILE}.pdf`,
      }),
    ).toBe(false);
    expect(isSafeStorageDeletionPath({ ...base, parentId: null, objectPath: `${TENANT}/${CUSTOMER}/${NOTICE}/${FILE}.pdf` })).toBe(false);
  });
});

describe("20261012001800 migration sözleşmesi", () => {
  const sql = read("supabase/migrations/20261012001800_storage_cleanup_receipts.sql");
  it("kova izin listesi + silme/güncelleme tetikleyicisi + parent kısıtı", () => {
    expect(sql).toMatch(/'expense-receipts', 'rent-receipts'\)\)/);
    expect(sql).toMatch(/'rent-receipts'\) and parent_id is not null/);
    expect(sql).toMatch(/after delete or update of receipt_path on public\.rent_payment_notices/);
    expect(sql).toMatch(/security definer/);
    expect(sql).toMatch(/revoke all privileges on function public\.enqueue_orphaned_rent_receipt\(\)/);
  });
  it("kuyruk işçisi dekont için güncel meta referansını denetler", () => {
    const worker = read("src/lib/storage-deletion-outbox.ts");
    expect(worker).toMatch(/job\.bucket === "rent-receipts"[\s\S]*rent_payment_notices[\s\S]*receipt_path/);
  });
});

describe("cron adımları bağımsız çalışır", () => {
  it("biri hata verince öbürleri yine çalışır, hata adıyla toplanır", async () => {
    const ran: string[] = [];
    const out = await runCronSteps({
      retention: async () => {
        ran.push("retention");
        throw new Error("rpc down");
      },
      storage: async () => {
        ran.push("storage");
        return { claimed: 3 };
      },
    });
    expect(ran).toEqual(["retention", "storage"]);
    expect(out.results.storage).toEqual({ claimed: 3 });
    expect(out.errors.retention).toBe("rpc down");
    expect(cronStepsFailed(out)).toBe(true);
  });

  it("operational-retention ve direct-file-upload-cleanup rotaları outbox'ı ayrı adım olarak çalıştırır", () => {
    for (const route of ["operational-retention", "direct-file-upload-cleanup"]) {
      const src = read(`src/app/api/cron/${route}/route.ts`);
      expect(src).toMatch(/runCronSteps\(/);
      expect(src).toMatch(/processStorageDeletionOutbox\(/);
      expect(src).toMatch(/storageDeletionQueueStats\(/);
    }
  });
});
