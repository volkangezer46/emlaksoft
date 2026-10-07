export const STORAGE_DELETION_BUCKETS = [
  "customer-files",
  "property-media",
  "agent-photos",
  "tenant-logos",
  "expense-receipts",
] as const;

export type StorageDeletionBucket = (typeof STORAGE_DELETION_BUCKETS)[number];

export type StorageDeletionPathInput = {
  tenantId: string;
  parentId: string | null;
  bucket: string;
  objectPath: string;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NESTED_FILE_RE = /^[a-z0-9][a-z0-9._-]{0,199}$/i;

export function isStorageDeletionBucket(value: string): value is StorageDeletionBucket {
  return (STORAGE_DELETION_BUCKETS as readonly string[]).includes(value);
}

/**
 * Fail-closed object-key policy for the service-role deletion worker.
 * Every supported bucket has a fixed tenant/owner shape; accepting arbitrary
 * bucket names or paths would turn the outbox into a privileged delete API.
 */
export function isSafeStorageDeletionPath(input: StorageDeletionPathInput): boolean {
  const { tenantId, parentId, bucket, objectPath } = input;
  if (!UUID_RE.test(tenantId) || !isStorageDeletionBucket(bucket)) return false;
  if (
    !objectPath ||
    objectPath.length > 1_024 ||
    objectPath.includes("..") ||
    objectPath.includes("\\") ||
    objectPath.startsWith("/")
  ) {
    return false;
  }

  if (bucket === "customer-files" || bucket === "property-media" || bucket === "expense-receipts") {
    if (!parentId || !UUID_RE.test(parentId)) return false;
    const prefix = `${tenantId}/${parentId}/`;
    return objectPath.startsWith(prefix) && NESTED_FILE_RE.test(objectPath.slice(prefix.length));
  }

  if (bucket === "agent-photos") {
    if (!parentId || !UUID_RE.test(parentId)) return false;
    return new RegExp(`^${tenantId}/${parentId}\\.(jpg|png|webp)$`, "i").test(objectPath);
  }

  return new RegExp(`^${tenantId}/logo\\.(jpg|png|webp|svg)$`, "i").test(objectPath);
}

/** Public fixed-key assets must not be removed while metadata points at them. */
export function publicUrlReferencesStorageObject(
  value: unknown,
  bucket: "agent-photos" | "tenant-logos",
  objectPath: string,
): boolean {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    const pathname = decodeURIComponent(new URL(value).pathname);
    const suffix = `/object/public/${bucket}/${objectPath}`;
    return pathname.endsWith(suffix);
  } catch {
    return false;
  }
}
