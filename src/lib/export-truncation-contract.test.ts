import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// CSV dışa aktarmalar: sınıra takılma kullanıcıya bildirilir ve her indirme audit_logs'a yazılır.
const source = readFileSync("src/app/actions/export.ts", "utf8");
const button = readFileSync("src/components/app/export-csv-button.tsx", "utf8");

describe("dışa aktarma sınırı ve denetim izi", () => {
  it("tek sınır sabiti kullanılır, sabit kodlanmış limit kalmaz", () => {
    expect(source).toContain("const EXPORT_LIMIT = 2000;");
    expect(source).not.toMatch(/\.limit\(2000\)/);
    expect(source.match(/\.limit\(EXPORT_LIMIT\)/g)!.length).toBeGreaterThanOrEqual(15);
  });

  it("her dışa aktarma exportResult üzerinden döner (uyarı + audit)", () => {
    const direct = source.match(/return \{ csv: toCsv\(rows\)/g) ?? [];
    expect(direct).toHaveLength(0);
    expect(source.match(/return exportResult\(gate, /g)!.length).toBeGreaterThanOrEqual(15);
  });

  it("exportResult uyarı satırı ekler ve kişisel veri içermeyen audit kaydı yazar", () => {
    expect(source).toContain("rows.length >= EXPORT_LIMIT");
    expect(source).toContain("UYARI: Yalnızca ilk");
    expect(source).toContain('action: "export.csv"');
    // Kayıt yalnız sayı/bayrak/dosya adı taşır; satır içeriği audit'e girmez.
    expect(source).toContain("newValue: { rows: rows.length, truncated, filename }");
  });

  it("istemci düğmesi kesilmeyi kullanıcıya gösterir", () => {
    expect(button).toContain("res.truncated");
  });
});
