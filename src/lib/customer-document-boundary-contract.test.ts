import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("customer document storage boundary contract", () => {
  it("binds customer uploads to an owned row and canonical signature/MIME metadata", () => {
    const action = read("src/app/actions/customer-files.ts");
    const server = read("src/lib/direct-file-upload-server.ts");
    const descriptor = read("src/lib/direct-file-uploads.ts");
    const validation = read("src/lib/file-validation.ts");
    expect(action).toContain('.from("customers")');
    expect(action).toContain('.eq("tenant_id", gate.tenantId)');
    expect(server).toContain("verifyDocumentFile(file, config.allowedMime)");
    expect(descriptor).toContain("canonicalExtensionForMime(claimedMime)");
    expect(descriptor).toContain("normalizeUploadedFileName(input.fileName, claimedMime)");
    expect(validation).toContain("never a clean/AV");
    expect(server).toContain("crypto.randomUUID()");
    expect(server).toContain("createAdminClient()");
  });

  it("does not derive property-media storage keys or names from user extensions", () => {
    const server = read("src/lib/direct-file-upload-server.ts");
    const descriptor = read("src/lib/direct-file-uploads.ts");
    expect(descriptor).toContain("canonicalExtensionForMime(claimedMime)");
    expect(descriptor).toContain("normalizeUploadedFileName(input.fileName, claimedMime)");
    expect(server).toContain("crypto.randomUUID()");
    expect(descriptor).not.toContain('fileName.split(".").pop()');
  });

  it("enforces relational tenant ownership, path shape and action-aware RLS in SQL", () => {
    const migration = read(
      "supabase/migrations/20260802000420_customer_document_security_boundary.sql",
    );
    expect(migration).toContain("customer_files_customer_tenant_fkey");
    expect(migration).toContain("property_media_property_tenant_fkey");
    expect(migration).toContain("customer_files_verified_metadata_check");
    expect(migration).toContain("property_media_verified_metadata_check");
    expect(migration).toContain("public.current_active_tenant_id()");
    expect(migration).toContain("public.has_effective_permission('customers', 'view')");
    expect(migration).toContain('drop policy if exists "Authenticated tenant access"');
  });
});
