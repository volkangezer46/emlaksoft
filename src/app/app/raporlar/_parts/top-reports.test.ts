import { describe, expect, it } from "vitest";
import { pickTopReports, TOP_REPORTS } from "./top-reports";
import { TENANT_REPORT_LIST } from "@/lib/report-center/registry";

describe("En çok kullanılan 5 rapor (C26)", () => {
  it("her kısayol katalogda gerçekten var olan bir rapora gider", () => {
    const ids = new Set(TENANT_REPORT_LIST.map((r) => r.id));
    for (const r of TOP_REPORTS) expect(ids.has(r.id), r.id).toBe(true);
  });

  it("görünmeyen rapor yerine katalogdan doldurur; en çok 5", () => {
    const visible = [
      { id: "musteriler", title: "Müşteriler" },
      { id: "randevular", title: "Randevular" },
      { id: "gorevler", title: "Görevler" },
      { id: "portfoyler", title: "Portföyler" },
      { id: "teklifler", title: "Teklifler" },
      { id: "aramalar", title: "Aramalar" },
    ];
    const out = pickTopReports(visible);
    expect(out).toHaveLength(5);
    expect(out[0]).toEqual({ id: "portfoyler", label: "Portföy listesi" });
    expect(out[1]).toEqual({ id: "musteriler", label: "Müşteri listesi" });
    expect(out.map((r) => r.id)).not.toContain("komisyonlar");
  });
});
