import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  isSafeStorageDeletionPath,
  publicUrlReferencesStorageObject,
} from "./storage-deletion-policy";

const TENANT = "11111111-1111-4111-8111-111111111111";
const PARENT = "22222222-2222-4222-8222-222222222222";
const FILE = "33333333-3333-4333-8333-333333333333.pdf";
const read = (path: string) => readFileSync(path, "utf8");

describe("storage deletion lifecycle", () => {
  it("accepts only bucket-specific tenant and parent object shapes", () => {
    expect(
      isSafeStorageDeletionPath({
        tenantId: TENANT,
        parentId: PARENT,
        bucket: "customer-files",
        objectPath: `${TENANT}/${PARENT}/${FILE}`,
      }),
    ).toBe(true);
    expect(
      isSafeStorageDeletionPath({
        tenantId: TENANT,
        parentId: PARENT,
        bucket: "property-media",
        objectPath: `${TENANT}/${PARENT}/photo.webp`,
      }),
    ).toBe(true);
    expect(
      isSafeStorageDeletionPath({
        tenantId: TENANT,
        parentId: PARENT,
        bucket: "agent-photos",
        objectPath: `${TENANT}/${PARENT}.jpg`,
      }),
    ).toBe(true);
    expect(
      isSafeStorageDeletionPath({
        tenantId: TENANT,
        parentId: null,
        bucket: "tenant-logos",
        objectPath: `${TENANT}/logo.svg`,
      }),
    ).toBe(true);
  });

  it("rejects traversal, cross-tenant, arbitrary bucket and malformed owner paths", () => {
    const base = { tenantId: TENANT, parentId: PARENT };
    expect(
      isSafeStorageDeletionPath({
        ...base,
        bucket: "customer-files",
        objectPath: `${TENANT}/${PARENT}/../secret.pdf`,
      }),
    ).toBe(false);
    expect(
      isSafeStorageDeletionPath({
        ...base,
        bucket: "property-media",
        objectPath: `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/${PARENT}/photo.webp`,
      }),
    ).toBe(false);
    expect(
      isSafeStorageDeletionPath({
        ...base,
        bucket: "unknown",
        objectPath: `${TENANT}/${PARENT}/photo.webp`,
      }),
    ).toBe(false);
    expect(
      isSafeStorageDeletionPath({
        ...base,
        bucket: "agent-photos",
        objectPath: `${TENANT}/other.jpg`,
      }),
    ).toBe(false);
  });

  it("recognizes a current public fixed-key reference without trusting query strings", () => {
    const path = `${TENANT}/${PARENT}.webp`;
    const url = `https://example.supabase.co/storage/v1/object/public/agent-photos/${path}?v=123`;
    expect(publicUrlReferencesStorageObject(url, "agent-photos", path)).toBe(true);
    expect(publicUrlReferencesStorageObject(url, "agent-photos", `${TENANT}/other.webp`)).toBe(
      false,
    );
    expect(publicUrlReferencesStorageObject("not-a-url", "agent-photos", path)).toBe(false);
  });

  it("uses an atomic DB outbox trigger and never performs storage-first user deletion", () => {
    const migration = read(
      "supabase/migrations/20260810000900_storage_object_lifecycle.sql",
    );
    const customer = read("src/app/actions/customer-files.ts");
    const property = read("src/app/actions/property-media.ts");
    const documents = read("src/app/actions/documents.ts");
    const worker = read("src/lib/storage-deletion-outbox.ts");

    expect(migration).toContain("after delete on public.customer_files");
    expect(migration).toContain("after delete on public.property_media");
    expect(migration).toContain("insert into public.storage_deletion_outbox");
    expect(migration).toContain("on conflict (bucket, object_path) do update");
    expect(migration).toContain("and uploaded_by = (select auth.uid())");
    expect(customer).not.toContain(".remove(");
    expect(property).not.toContain(".remove(");
    expect(documents).not.toContain(".remove(");
    expect(worker).toContain("objectAlreadyMissing(removalError)");
    expect(worker).toContain('status: terminal ? "failed" : "retry"');
    expect(worker).toContain("currentMetadataReference");
  });

  it("names signature-only validation honestly and documents the lack of malware scanning", () => {
    const migration = read(
      "supabase/migrations/20260810000900_storage_object_lifecycle.sql",
    );
    const attachments = read("src/lib/ticket-attachments.ts");
    expect(migration).toContain("scan_status = 'signature_verified'");
    expect(migration).toContain("it is not a malware-clean verdict");
    expect(attachments).toContain('"signature_verified" | "blocked"');
    expect(attachments).not.toContain('TicketAttachmentStatus = "verified"');
  });
});
