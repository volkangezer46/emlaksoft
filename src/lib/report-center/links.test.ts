import { describe, expect, it } from "vitest";
import { reportCenterHref, reportDownloadHref } from "./links";

describe("bağlantı üreticileri", () => {
  it("rapor merkezi ve indirme adresleri", () => {
    expect(reportCenterHref("tenant", "musteriler", { q: "ali", type: "", kanal: undefined })).toBe("/app/raporlar?sekme=merkez&rapor=musteriler&q=ali");
    expect(reportCenterHref("platform", "faturalar")).toBe("/admin/raporlar?sekme=merkez&rapor=faturalar");
    expect(reportDownloadHref("platform", "faturalar", "xlsx", { durum: "paid" })).toBe("/api/admin/rapor/faturalar?format=xlsx&durum=paid");
    expect(reportDownloadHref("tenant", "komisyonlar", "csv", { from: "2026-01-01" })).toBe("/api/app/rapor/komisyonlar?format=csv&from=2026-01-01");
  });
});
