import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { reportCenterHref, reportDownloadHref } from "./links";
import { getReport } from "./registry";

const ROOT = process.cwd();

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) walk(rel, out);
    else if (e.name.endsWith(".tsx")) out.push(rel);
  }
  return out;
}

describe("bağlantı üreticileri", () => {
  it("rapor merkezi ve indirme adresleri", () => {
    expect(reportCenterHref("tenant", "musteriler", { q: "ali", type: "", kanal: undefined })).toBe("/app/raporlar?sekme=merkez&rapor=musteriler&q=ali");
    expect(reportCenterHref("platform", "faturalar")).toBe("/admin/raporlar?sekme=merkez&rapor=faturalar");
    expect(reportDownloadHref("platform", "faturalar", "xlsx", { durum: "paid" })).toBe("/api/admin/rapor/faturalar?format=xlsx&durum=paid");
    expect(reportDownloadHref("tenant", "komisyonlar", "csv", { from: "2026-01-01" })).toBe("/api/app/rapor/komisyonlar?format=csv&from=2026-01-01");
  });
});

describe('sayfalardaki "Raporlarda aç" bağlantıları', () => {
  const usages: { file: string; scope: "tenant" | "platform"; report: string; keys: string[] }[] = [];
  for (const file of [...walk("src/app/app"), ...walk("src/app/admin")]) {
    const text = readFileSync(join(ROOT, file), "utf8");
    for (const m of text.matchAll(/<ReportOpenLink([\s\S]*?)\/>/g)) {
      const body = m[1]!;
      const report = /report=(?:"([a-z0-9-]+)"|\{[^}]*"([a-z0-9-]+)"[^}]*"([a-z0-9-]+)"[^}]*\})/.exec(body);
      if (!report) continue;
      const ids = [report[1], report[2], report[3]].filter(Boolean) as string[];
      const scope = /scope="platform"/.test(body) ? "platform" : "tenant";
      const filt = /filters=\{\{([\s\S]*?)\}\}/.exec(body)?.[1] ?? "";
      const keys = [...filt.matchAll(/(?:^|,)\s*([a-zA-Z]+)\s*:/g)].map((k) => k[1]!);
      for (const id of ids) usages.push({ file, scope, report: id, keys });
    }
  }

  it("sayfalarda kaldırılan indirme düğmelerinin yerine bağlantılar var", () => {
    expect(usages.length).toBeGreaterThanOrEqual(30);
  });

  it.each(usages.map((u) => [`${u.file} → ${u.scope}:${u.report}`, u] as const))("%s", (_name, u) => {
    const def = getReport(u.scope, u.report);
    expect(def, `rapor yok: ${u.scope}:${u.report}`).toBeTruthy();
    const allowed = new Set(def!.filters.map((f) => f.key));
    for (const k of u.keys) expect(allowed.has(k), `${u.report}: '${k}' filtresi tanımlı değil`).toBe(true);
  });

  it("hiçbir sayfa eski indirme bileşenlerini ya da kaldırılan eylemleri kullanmaz", () => {
    const banned = [/ExportCsvButton/, /ExportButton\b/, /ReportExportBar/, /downloadCsv\(/, /actions\/export"/, /platform-export/, /exportActivityCsv/];
    const offenders: string[] = [];
    for (const file of [...walk("src/app"), ...walk("src/components")]) {
      const text = readFileSync(join(ROOT, file), "utf8");
      for (const re of banned) if (re.test(text)) offenders.push(`${file}: ${re}`);
    }
    expect(offenders).toEqual([]);
  });
});
