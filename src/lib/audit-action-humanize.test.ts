import { execSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { actionLabel } from "@/lib/audit-labels";
import { auditLabelOf, humanizeAuditAction } from "./audit-action-humanize";
import { feedActionLabel } from "@/lib/oversight/feed";
import { auditActionLabel } from "@/lib/admin-format";

describe("humanizeAuditAction", () => {
  it("Ofis kontrol akışında görülen ham kodlar Türkçe", () => {
    expect(feedActionLabel("module.toggle")).toBe("Modül açıldı/kapatıldı");
    expect(feedActionLabel("module.bundle")).toBe("Modül paketi açıldı/kapatıldı");
    expect(humanizeAuditAction("site_page.publish")).toBe("Site sayfası yayımlandı");
    expect(humanizeAuditAction("custom_field.create")).toBe("Özel alan oluşturuldu");
    expect(humanizeAuditAction("message_template.weird_verb")).toBe("Mesaj şablonu işlemi");
    expect(humanizeAuditAction("bilinmeyen.kod")).toBe("Sistem işlemi");
  });

  it("sözlük önce gelir; admin biçimi de ham kod döndürmez", () => {
    const [code, label] = Object.entries(actionLabel)[0]!;
    expect(auditLabelOf(code)).toBe(label);
    expect(auditActionLabel("site_menu.publish")).toBe("Site menüsü yayımlandı");
    expect(auditActionLabel("x.y")).not.toContain("·");
  });

  it("koddaki HİÇBİR işlem kodu kullanıcıya ham çıkmaz (etiket koda eşit değil, nokta içermez)", () => {
    const out = execSync(`grep -rhoE 'action: "[a-z_]+\\.[a-z_.]+"' src --include=*.ts --include=*.tsx`, { encoding: "utf8" });
    const codes = [...new Set(out.split("\n").filter(Boolean).map((l) => l.replace(/^action: "/, "").replace(/"$/, "")))];
    expect(codes.length).toBeGreaterThan(100);
    const raw = codes.filter((c) => /\./.test(feedActionLabel(c)) || feedActionLabel(c) === c);
    expect(raw).toEqual([]);
  });
});
