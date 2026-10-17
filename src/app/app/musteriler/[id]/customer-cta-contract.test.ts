import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_MATRIX } from "@/lib/permissions";
import type { EffectivePermissions } from "@/lib/permissions-effective";
import { customerCtaPermissions, NO_CUSTOMER_CTAS } from "./customer-cta-perms";

/**
 * Sözleşme: müşteri kartı kullanıcıyı açamayacağı sayfaya götüren "oluştur" düğmesi/bağlantısı çizmez.
 * Kartta bir oluşturma yoluna (…/yeni) ya da modül listesine giden her satır `can.<izin>` koşulu taşımalıdır.
 */
const SRC = readFileSync("src/app/app/musteriler/[id]/customer-360-tabs.tsx", "utf8");

/** Yol deseni → satırda bulunması gereken izin anahtarı. */
const GATED: { pattern: RegExp; perm: keyof typeof NO_CUSTOMER_CTAS }[] = [
  { pattern: /\/talep\/yeni/, perm: "demandsCreate" },
  { pattern: /\/app\/anlasmalar\/yeni/, perm: "dealsCreate" },
  { pattern: /href="\/app\/anlasmalar"/, perm: "dealsView" },
  { pattern: /\/app\/teklifler\/yeni/, perm: "offersCreate" },
  { pattern: /\/app\/sozlesmeler\/yeni/, perm: "contractsCreate" },
  { pattern: /href="\/app\/sozlesmeler"/, perm: "contractsView" },
  { pattern: /\/app\/randevular\/yeni|>Randevu ver</, perm: "appointmentsCreate" },
];

const perms = (role: keyof typeof DEFAULT_MATRIX) => DEFAULT_MATRIX[role] as EffectivePermissions;

describe("müşteri kartı CTA izin sözleşmesi", () => {
  it("kartta kapısız oluşturma/bağlantı CTA'sı yok", () => {
    const lines = SRC.split("\n");
    const offenders: string[] = [];
    for (const { pattern, perm } of GATED) {
      lines.forEach((line, i) => {
        // Satır yorumları ve metin içi örnekler sayılmaz; JSX/ifade satırları denetlenir.
        if (!pattern.test(line) || line.trim().startsWith("//") || line.trim().startsWith("*")) return;
        if (!line.includes(`can.${perm}`)) offenders.push(`${i + 1}: ${perm} → ${line.trim().slice(0, 120)}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it("Teklifler bölümü yalnız offers görme izniyle çizilir", () => {
    const at = SRC.indexOf("Teklifler\n");
    expect(at).toBeGreaterThan(0);
    const guard = SRC.lastIndexOf("can.offersView ?", at);
    expect(guard).toBeGreaterThan(0);
    expect(at - guard).toBeLessThan(800);
  });

  it("varsayılan prop fail-closed", () => {
    expect(SRC).toMatch(/can = NO_CUSTOMER_CTAS/);
    expect(Object.values(NO_CUSTOMER_CTAS).every((v) => v === false)).toBe(true);
  });

  it("danışman (WP2) kendi müşterisine 'Anlaşma başlat' ve 'Teklif ver' görür; çağrı merkezi görmez; ofis sahibi görür", () => {
    const advisor = customerCtaPermissions(perms("advisor"));
    expect(advisor.offersView).toBe(true);
    expect(advisor.offersCreate).toBe(true);
    expect(advisor.dealsCreate).toBe(true);
    const cc = customerCtaPermissions(perms("call_center"));
    expect(cc.offersCreate).toBe(false);
    expect(cc.dealsCreate).toBe(false);
    const owner = customerCtaPermissions(perms("owner"));
    expect(owner.offersCreate).toBe(true);
    expect(owner.dealsCreate).toBe(true);
    expect(owner.contractsCreate).toBe(true);
  });

  it("salt-okunur rol hiçbir oluşturma CTA'sı görmez", () => {
    const ro = customerCtaPermissions(perms("readonly"));
    expect(ro.demandsCreate || ro.dealsCreate || ro.offersCreate || ro.contractsCreate || ro.appointmentsCreate).toBe(false);
  });
});
