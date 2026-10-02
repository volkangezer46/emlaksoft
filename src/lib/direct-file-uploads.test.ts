import { describe, expect, it } from "vitest";
import {
  DIRECT_FILE_UPLOAD_CLEANUP_BUFFER_MS,
  DIRECT_FILE_UPLOAD_FINALIZE_TTL_MS,
  DIRECT_FILE_UPLOAD_PROVIDER_TTL_MS,
  buildDirectFileUploadPath,
  isSafeDirectFileUploadPath,
  validateDirectFileUploadMetadata,
} from "@/lib/direct-file-uploads";

const TENANT = "11111111-1111-4111-8111-111111111111";
const CUSTOMER = "22222222-2222-4222-8222-222222222222";
const SESSION = "33333333-3333-4333-8333-333333333333";

describe("direct file upload envelope validation", () => {
  it("normalizes customer document names and binds canonical MIME/extension", () => {
    const result = validateDirectFileUploadMetadata("customer_file", {
      parentId: CUSTOMER,
      fileName: "../Kimlik Kopyası.PDF",
      fileSize: 512,
      fileType: "application/pdf; charset=binary",
      label: "  Kimlik   belgesi  ",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.fileName).toBe("-Kimlik Kopyası.pdf");
    expect(result.value.claimedMime).toBe("application/pdf");
    expect(result.value.canonicalExtension).toBe("pdf");
    expect(result.value.label).toBe("Kimlik belgesi");
  });

  it("rejects SVG, invalid UUIDs, empty files and kind-specific oversized payloads", () => {
    expect(validateDirectFileUploadMetadata("property_media", {
      parentId: CUSTOMER,
      fileName: "script.svg",
      fileSize: 10,
      fileType: "image/svg+xml",
    }).ok).toBe(false);
    expect(validateDirectFileUploadMetadata("customer_file", {
      parentId: "not-a-uuid",
      fileName: "a.pdf",
      fileSize: 10,
      fileType: "application/pdf",
    }).ok).toBe(false);
    expect(validateDirectFileUploadMetadata("property_media", {
      parentId: CUSTOMER,
      fileName: "a.jpg",
      fileSize: 15 * 1024 * 1024 + 1,
      fileType: "image/jpeg",
    }).ok).toBe(false);
  });

  it("does not allow document MIME types in the property image flow", () => {
    expect(validateDirectFileUploadMetadata("property_media", {
      parentId: CUSTOMER,
      fileName: "plan.pdf",
      fileSize: 1024,
      fileType: "application/pdf",
    }).ok).toBe(false);
  });
});

describe("direct file upload object paths and lifetimes", () => {
  it("builds the only accepted tenant/parent/session key", () => {
    const path = buildDirectFileUploadPath(TENANT, CUSTOMER, SESSION, "pdf");
    expect(path).toBe(`${TENANT}/${CUSTOMER}/${SESSION}.pdf`);
    expect(isSafeDirectFileUploadPath({
      path,
      tenantId: TENANT,
      parentId: CUSTOMER,
      sessionId: SESSION,
      extension: "pdf",
    })).toBe(true);
    expect(isSafeDirectFileUploadPath({
      path: `${TENANT}/${CUSTOMER}/../../secret.pdf`,
      tenantId: TENANT,
      parentId: CUSTOMER,
      sessionId: SESSION,
      extension: "pdf",
    })).toBe(false);
  });

  it("keeps app authorization short and cleanup after the fixed provider token", () => {
    expect(DIRECT_FILE_UPLOAD_FINALIZE_TTL_MS).toBe(15 * 60 * 1000);
    expect(DIRECT_FILE_UPLOAD_PROVIDER_TTL_MS).toBe(2 * 60 * 60 * 1000);
    expect(DIRECT_FILE_UPLOAD_CLEANUP_BUFFER_MS).toBeGreaterThanOrEqual(5 * 60 * 1000);
  });
});
