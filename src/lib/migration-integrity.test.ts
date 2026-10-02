import { describe, expect, it } from "vitest";
import {
  migrationChecksum,
  migrationChecksumVariants,
} from "@/lib/migration-integrity";

describe("migration integrity", () => {
  const lf = "create table example (id uuid);\n-- Türkçe açıklama\n";
  const crlf = lf.replace(/\n/g, "\r\n");

  it("uses one canonical checksum on Linux and Windows", () => {
    expect(migrationChecksum(lf)).toBe(migrationChecksum(crlf));
  });

  it("recognizes both historical raw line-ending checksums", () => {
    const variants = migrationChecksumVariants(lf);
    expect(variants.size).toBe(2);
    for (const checksum of variants) {
      expect(migrationChecksumVariants(crlf).has(checksum)).toBe(true);
    }
  });

  it("does not hide SQL changes behind compatibility handling", () => {
    const changed = lf.replace("uuid", "bigint");
    const originalVariants = migrationChecksumVariants(lf);
    for (const checksum of migrationChecksumVariants(changed)) {
      expect(originalVariants.has(checksum)).toBe(false);
    }
  });
});
