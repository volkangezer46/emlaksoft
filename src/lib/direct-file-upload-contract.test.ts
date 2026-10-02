import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("customer/property signed direct upload production contract", () => {
  const migration = source("supabase/migrations/20260810000940_direct_file_upload_sessions.sql");
  const server = source("src/lib/direct-file-upload-server.ts");
  const client = source("src/lib/direct-file-upload-client.ts");
  const customerAction = source("src/app/actions/customer-files.ts");
  const propertyAction = source("src/app/actions/property-media.ts");
  const customerUi = source("src/app/app/musteriler/[id]/customer-files-tab.tsx");
  const propertyUi = source("src/app/app/portfoyler/[id]/property-media-manager.tsx");
  const cleanup = source("src/lib/direct-file-upload-cleanup.ts");
  const cleanupRoute = source("src/app/api/cron/direct-file-upload-cleanup/route.ts");
  const deletionWorker = source("src/lib/storage-deletion-outbox.ts");

  it("keeps upload envelopes service-role-only with tenant-bound parent/requester FKs", () => {
    expect(migration).toContain("create table public.direct_file_uploads");
    expect(migration).toContain("direct_file_uploads_customer_tenant_fkey");
    expect(migration).toContain("direct_file_uploads_property_tenant_fkey");
    expect(migration).toContain("direct_file_uploads_requester_tenant_fkey");
    expect(migration).toContain("revoke all privileges on table public.direct_file_uploads");
    expect(migration).toContain("to service_role");
  });

  it("never accepts a browser bucket/path and signs a random exact object with upsert disabled", () => {
    expect(server).toContain("const sessionId = crypto.randomUUID()");
    expect(server).toContain("buildDirectFileUploadPath(");
    expect(server).toContain("createSignedUploadUrl(storagePath, { upsert: false })");
    expect(customerAction).not.toMatch(/PrepareCustomerFileUploadInput[\s\S]{0,250}(bucket|storagePath|path):/);
    expect(propertyAction).not.toMatch(/PreparePropertyMediaUploadInput[\s\S]{0,250}(bucket|storagePath|path):/);
  });

  it("checks permission, tenant and parent ownership at both prepare and finalize boundaries", () => {
    expect(customerAction.match(/requirePermission\("customers", "edit"\)/g)?.length).toBeGreaterThanOrEqual(2);
    expect(customerAction.match(/customerBelongsToTenant/g)?.length).toBeGreaterThanOrEqual(3);
    expect(propertyAction.match(/requirePermission\("properties", "edit"\)/g)?.length).toBeGreaterThanOrEqual(3);
    expect(propertyAction.match(/propertyBelongsToTenant/g)?.length).toBeGreaterThanOrEqual(3);
    expect(server).toContain("sessionMatchesContext(session, context)");
  });

  it("uploads in the browser and finalizes by session id only", () => {
    expect(client).toContain("uploadToSignedUrl(target.path, target.token, file");
    expect(customerUi).toContain("prepareCustomerFileUpload");
    expect(customerUi).toContain("uploadToDirectFileTarget");
    expect(customerUi).toContain("finalizeCustomerFileUpload(customerId, prepared.upload.sessionId)");
    expect(propertyUi).toContain("preparePropertyMediaUpload");
    expect(propertyUi).toContain("uploadToDirectFileTarget");
    expect(propertyUi).toContain("finalizePropertyMediaUpload(propertyId, prepared.upload.sessionId)");
    expect(customerAction).not.toContain("export async function uploadCustomerFile");
    expect(propertyAction).not.toContain("export async function uploadPropertyMedia");
    expect(server).toContain("checkRateLimit(");
    expect(server).toContain('failurePolicy: "deny"');
  });

  it("bounds server download, verifies real bytes, then uses an atomic lease-gated metadata RPC", () => {
    expect(server).toContain("storage.info(session.storage_path)");
    expect(server).toContain("blob.size > config.maxBytes");
    expect(server).toContain("verifyImageFile(file, config.allowedMime)");
    expect(server).toContain("verifyDocumentFile(file, config.allowedMime)");
    expect(server).toContain('admin.rpc("finalize_direct_file_upload"');
    expect(migration).toContain("for update");
    expect(migration).toContain("v_session.lease_id is distinct from p_lease_id");
    expect(migration).toContain("on conflict (id) do nothing");
    expect(migration).toContain("set status = 'finalized'");
  });

  it("waits beyond provider token expiry and persists cleanup in the durable outbox", () => {
    expect(migration).toContain("signed_token_expires_at");
    expect(migration).toContain("cleanup_after > signed_token_expires_at");
    expect(cleanup).toContain('.lte("cleanup_after", nowIso)');
    expect(cleanup).toContain("enqueueStorageDeletion({");
    expect(cleanup).not.toContain(".remove(");
    expect(cleanupRoute).toContain("CRON_SECRET");
    expect(cleanupRoute).toContain('recordHeartbeat("direct-file-upload-cleanup"');
  });

  it("retains any object still referenced by private relational metadata", () => {
    expect(deletionWorker).toContain('job.bucket === "customer-files" || job.bucket === "property-media"');
    expect(deletionWorker).toContain('.eq("storage_path", job.object_path)');
    expect(deletionWorker).toContain("referenced: Boolean(data)");
  });
});
