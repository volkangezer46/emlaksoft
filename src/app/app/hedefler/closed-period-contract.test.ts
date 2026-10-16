import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const page = readFileSync(join(__dirname, "page.tsx"), "utf8");
const panel = readFileSync(join(__dirname, "target-create-panel.tsx"), "utf8");

describe("Hedefler sözleşmesi", () => {
  it("kapanmış dönem tempo/projeksiyon değil sonuç gösterir", () => {
    expect(page).toContain("const closed = elapsed >= 100;");
    expect(page).toContain("Dönem kapandı · hedef tutturuldu.");
    expect(page).toContain("Dönem kapandı · hedefin %");
    // Özet kutusu geçmiş dönemin kaçırılan hedefini de saydığı için "Tempo geride" değil "Geride kalan".
    expect(page).toContain('label="Geride kalan"');
    expect(page).not.toContain('label="Tempo geride"');
  });

  it("silme onayı başarı bildirimi verir", () => {
    expect(page).toContain('successMessage="Hedef silindi"');
  });

  it("kişi/takım/şube seçicileri zorunlu (boş seçimle gönderim tarayıcıda durur)", () => {
    for (const name of ["profile_id", "team_id", "branch_id"]) {
      expect(panel).toMatch(new RegExp(`name="${name}"\\s+required`));
    }
  });
});
