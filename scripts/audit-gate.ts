/**
 * Production dependency vulnerability gate.
 *
 * High/critical findings fail by default. A temporary exception must be tied
 * to the exact package, advisory identifiers, affected audit range and
 * installed versions, and must name an owner and expiry date. This prevents a
 * package-name-only allowlist from silently accepting a future vulnerability.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

type ViaAdvisory = {
  source?: number;
  url?: string;
  title?: string;
  range?: string;
};

type Advisory = {
  name: string;
  severity: string;
  range?: string;
  nodes?: string[];
  via?: Array<string | ViaAdvisory>;
  fixAvailable?: boolean | { name: string; version: string; isSemVerMajor?: boolean };
};

type AuditReport = {
  vulnerabilities?: Record<string, Advisory>;
  metadata?: { vulnerabilities?: Record<string, number> };
};

type AuditException = {
  package: string;
  advisoryIds: readonly string[];
  affectedRange: string;
  installedVersions: readonly string[];
  owner: string;
  expiresOn: `${number}-${number}-${number}`;
  reason: string;
  exitCondition: string;
};

/**
 * Keep this empty whenever possible. Example fields are intentionally strict:
 * advisoryIds use GHSA IDs (or npm:<source>/via:<package> when unavailable),
 * and installedVersions must list every vulnerable version found in nodes.
 */
const EXCEPTIONS: readonly AuditException[] = [];

function runAudit(): AuditReport {
  try {
    const output = execFileSync("npm", ["audit", "--omit=dev", "--json"], {
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
      shell: process.platform === "win32",
    });
    return JSON.parse(output) as AuditReport;
  } catch (error) {
    const stdout = (error as { stdout?: string }).stdout;
    if (!stdout) throw error;
    return JSON.parse(stdout) as AuditReport;
  }
}

function advisoryIds(advisory: Advisory): string[] {
  return [...new Set((advisory.via ?? []).map((via) => {
    if (typeof via === "string") return `via:${via}`;
    const ghsa = via.url?.match(/GHSA-[0-9a-z-]+/i)?.[0]?.toUpperCase();
    if (ghsa) return ghsa;
    return via.source ? `npm:${via.source}` : `title:${via.title ?? "unknown"}`;
  }))].sort();
}

function installedVersions(advisory: Advisory): string[] {
  const versions = new Set<string>();
  for (const node of advisory.nodes ?? []) {
    try {
      const manifest = JSON.parse(readFileSync(resolve(process.cwd(), node, "package.json"), "utf8")) as { version?: string };
      if (manifest.version) versions.add(manifest.version);
    } catch {
      versions.add("<unresolved>");
    }
  }
  return [...versions].sort();
}

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  return [...left].sort().join("\0") === [...right].sort().join("\0");
}

function exceptionProblem(exception: AuditException, advisory?: Advisory): string | null {
  const expiry = Date.parse(`${exception.expiresOn}T23:59:59Z`);
  if (!Number.isFinite(expiry)) return "geçersiz expiry tarihi";
  if (expiry < Date.now()) return `istisna süresi doldu (${exception.expiresOn})`;
  if (!exception.owner.trim()) return "owner eksik";
  if (!exception.reason.trim() || !exception.exitCondition.trim()) return "gerekçe veya çıkış koşulu eksik";
  if (exception.advisoryIds.length === 0 || exception.installedVersions.length === 0) return "advisory veya sürüm kapsamı boş";
  if (!advisory) return "bulgu çözüldü; istisna kaldırılmalı";
  if ((advisory.range ?? "") !== exception.affectedRange) return `audit aralığı değişti (${advisory.range ?? "<yok>"})`;
  const ids = advisoryIds(advisory);
  if (!sameSet(ids, exception.advisoryIds)) return `advisory kapsamı değişti (${ids.join(", ")})`;
  const versions = installedVersions(advisory);
  if (!sameSet(versions, exception.installedVersions)) return `kurulu sürüm kapsamı değişti (${versions.join(", ")})`;
  return null;
}

const report = runAudit();
if (!report.vulnerabilities) {
  console.error("KAPI GÜVENİLMEZ: npm audit çıktısında vulnerabilities alanı yok.");
  process.exit(2);
}

const serious = Object.entries(report.vulnerabilities).filter(([, advisory]) =>
  advisory.severity === "high" || advisory.severity === "critical",
);
const exceptionByPackage = new Map(EXCEPTIONS.map((entry) => [entry.package, entry]));
const failures: string[] = [];

for (const [packageName, advisory] of serious) {
  const exception = exceptionByPackage.get(packageName);
  if (!exception) {
    failures.push(`${packageName} (${advisory.severity}) · ${advisoryIds(advisory).join(", ") || "advisory bilinmiyor"}`);
    continue;
  }
  const problem = exceptionProblem(exception, advisory);
  if (problem) failures.push(`${packageName}: ${problem}`);
  else console.log(`[GEÇİCİ İSTİSNA] ${packageName} · owner ${exception.owner} · son ${exception.expiresOn}`);
}

for (const exception of EXCEPTIONS) {
  if (serious.some(([packageName]) => packageName === exception.package)) continue;
  failures.push(`${exception.package}: ${exceptionProblem(exception)}`);
}

console.log(`Üretim bağımlılıkları: ${JSON.stringify(report.metadata?.vulnerabilities ?? {})}`);
if (failures.length === 0) {
  console.log("Yeni veya süresi dolmuş high/critical bulgu yok.");
  process.exit(0);
}

console.error(`Bağımlılık güvenlik kapısı başarısız (${failures.length}):`);
for (const failure of failures) console.error(`  - ${failure}`);
console.error("Düzeltin veya advisory+sürüm+owner+expiry içeren süreli bir istisna ekleyin.");
process.exit(1);
