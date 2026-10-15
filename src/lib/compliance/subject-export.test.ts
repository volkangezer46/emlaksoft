import { describe, expect, it } from "vitest";
import {
  SUBJECT_EXPORT_ROW_LIMIT,
  buildSubjectExport,
  canonicalJson,
  displayValue,
  loadSubjectData,
  subjectExportFileName,
  subjectExportHash,
} from "./subject-export";

const META = {
  requestId: "11111111-2222-4333-8444-555555555555",
  requestType: "access",
  requestCreatedAt: "2026-10-01T09:00:00Z",
  dueAt: "2026-10-31T09:00:00Z",
  officeName: "Ege Emlak",
  generatedAt: "2026-10-15T10:00:00.000Z",
};

describe("KVKK veri sahibi dökümü", () => {
  it("beyaz liste: iç kimlikler ve depolama yolu dökülmez, gömme düz metne iner", () => {
    const doc = buildSubjectExport(
      {
        customer: { id: "c1", tenant_id: "t1", full_name: "Ayşe Kaya", phone: "05321112233", assigned_to: "u9", province: { name: "İzmir" } },
        sections: {
          documents: [{ id: "f1", file_name: "tapu.pdf", storage_path: "t1/c1/tapu.pdf", file_size: 1200, created_at: "2026-10-02T10:00:00Z" }],
          communications: [{ id: "m1", channel: "whatsapp", body: "Merhaba", created_by: "u1", created_at: "2026-10-03T10:00:00Z" }],
        },
        warnings: [],
      },
      META,
    );
    expect(doc.subject).toEqual({ full_name: "Ayşe Kaya", phone: "05321112233", province: "İzmir" });
    expect(doc.sections.documents).toEqual([{ file_name: "tapu.pdf", file_size: 1200, created_at: "2026-10-02T10:00:00Z" }]);
    expect(doc.sections.communications[0]).not.toHaveProperty("created_by");
    expect(doc.counts.documents).toBe(1);
    expect(doc.counts.audit_trail).toBe(0);
    expect(JSON.stringify(doc)).not.toMatch(/storage_path|tenant_id|"u9"|"u1"/);
  });

  it("satır sınırı aşılınca uyarı düşülür", () => {
    const rows = Array.from({ length: SUBJECT_EXPORT_ROW_LIMIT + 1 }, (_, i) => ({ action: `a${i}`, created_at: "2026-10-01T00:00:00Z" }));
    const doc = buildSubjectExport({ customer: {}, sections: { audit_trail: rows }, warnings: [] }, META);
    expect(doc.counts.audit_trail).toBe(SUBJECT_EXPORT_ROW_LIMIT);
    expect(doc.warnings.join(" ")).toMatch(/İşlem kaydı: ilk 1000/);
  });

  it("özet anahtar sırasından bağımsızdır (jsonb yeniden sıralasa da doğrulanır)", () => {
    const doc = buildSubjectExport({ customer: { full_name: "A", email: "a@b.co" }, sections: {}, warnings: [] }, META);
    const reordered = JSON.parse(canonicalJson(doc));
    expect(subjectExportHash(reordered)).toBe(subjectExportHash(doc));
    expect(subjectExportHash(doc)).toMatch(/^[0-9a-f]{64}$/);
    expect(subjectExportFileName(doc)).toBe("kvkk-veri-dokumu-11111111-2026-10-15.json");
  });

  it("görünen değerler", () => {
    expect(displayValue(null)).toBe("—");
    expect(displayValue(true)).toBe("Evet");
    expect(displayValue(["alici", "kiraci"])).toBe("alici, kiraci");
    expect(displayValue("2026-10-15T10:00:00Z")).toMatch(/2026/);
  });

  it("yükleyici: her kaynak kiracıyla süzülür, okunamayan bölüm uyarıya düşer", async () => {
    const calls: { table: string; filters: [string, string][] }[] = [];
    const client = (failTable?: string) => ({
      from(table: string) {
        const entry = { table, filters: [] as [string, string][] };
        calls.push(entry);
        const chain = {
          select: () => chain,
          eq: (c: string, v: string) => {
            entry.filters.push([c, v]);
            return chain;
          },
          order: () => chain,
          limit: async () => (table === failTable ? { data: null, error: { message: "yok" } } : { data: [{ action: "x" }], error: null }),
          maybeSingle: async () => ({ data: { full_name: "Ayşe" }, error: null }),
        };
        return chain;
      },
    });
    const raw = await loadSubjectData(client("calls"), client(), "t1", "c1");
    expect(raw.customer).toEqual({ full_name: "Ayşe" });
    expect(raw.sections.calls).toEqual([]);
    expect(raw.warnings).toEqual(["Telefon görüşmeleri okunamadı; bu bölüm boş bırakıldı."]);
    for (const call of calls) expect(call.filters).toContainEqual(["tenant_id", "t1"]);
    expect(calls.find((c) => c.table === "audit_logs")?.filters).toContainEqual(["entity_id", "c1"]);
  });
});
