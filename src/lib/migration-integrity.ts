import crypto from "node:crypto";
import fs from "node:fs";

function shortSha256(value: Buffer | string): string {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 16);
}

/**
 * SQL migration contents are text. Git stores them with LF while Windows may
 * materialize the same blob with CRLF, so byte-for-byte hashing creates false
 * ledger drift across deployment hosts. Canonical checksums always use LF.
 */
export function canonicalMigrationSql(value: Buffer | string): string {
  return (Buffer.isBuffer(value) ? value.toString("utf8") : value).replace(/\r\n/g, "\n");
}

export function migrationChecksum(value: Buffer | string): string {
  return shortSha256(canonicalMigrationSql(value));
}

/**
 * Existing ledgers may contain a pre-canonical raw checksum written on either
 * Linux (LF) or Windows (CRLF). Accept only those two byte representations of
 * the exact same SQL; spaces, statements and every other semantic byte remain
 * immutable.
 */
export function migrationChecksumVariants(value: Buffer | string): ReadonlySet<string> {
  const canonical = canonicalMigrationSql(value);
  return new Set([
    shortSha256(canonical),
    shortSha256(canonical.replace(/\n/g, "\r\n")),
  ]);
}

export function migrationFileChecksum(filePath: string): string {
  return migrationChecksum(fs.readFileSync(filePath));
}

export function migrationFileMatchesChecksum(filePath: string, expected: string): boolean {
  return migrationChecksumVariants(fs.readFileSync(filePath)).has(expected);
}
