import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildManualLines, isManualLineFilled, manualLineIssue } from "./manual-invoice";

/**
 * SK6/B112 + B037 (fatura kısmı): elle fatura formu.
 *  - Satır doğrulaması istemci ve sunucuda AYNI (manualLineIssue); geçersiz kalem sessizce önizlemeden düşüp sunucuda reddedilmez.
 *  - Form `onSubmit` + kontrollü alanlar: React 19 form eylemi sunucu hatasından sonra ofis seçimini ve iç notu sıfırlamaz.
 *  - Başarıda sunucu eylemi revalidate + redirect'i tek yanıtta yapar; istemci router.push / router.refresh çağırmaz.
 */
const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");

describe("elle fatura satır doğrulaması", () => {
  it("boş satır (yalnız varsayılan miktar 1) atlanır; dolu geçersiz satır alan adıyla hata verir", () => {
    expect(isManualLineFilled({ description: "", quantity: "1", unitNet: "" })).toBe(false);
    expect(manualLineIssue({ description: "", quantity: "1", unitNet: "" })).toBeNull();
    expect(manualLineIssue({ description: "K", quantity: "1", unitNet: "100" })).toMatchObject({ field: "description" });
    expect(manualLineIssue({ description: "Kurulum", quantity: "0", unitNet: "100" })).toMatchObject({ field: "quantity" });
    expect(manualLineIssue({ description: "Kurulum", quantity: "1", unitNet: "abc" })).toMatchObject({ field: "unitNet" });
    expect(manualLineIssue({ description: "Kurulum", quantity: "2", unitNet: "2.500" })).toBeNull();
  });

  it("sunucu aynı kuralla reddeder ve satır numarasını verir (istemci odağı bu numarayla bulur)", () => {
    const res = buildManualLines(
      [
        { description: "Kurulum", quantity: "1", unitNet: "2.500" },
        { description: "", quantity: "1", unitNet: "" },
        { description: "Eğitim", quantity: "1", unitNet: "-5" },
      ],
      0.2,
    );
    expect(res).toEqual({ error: "2. kalem: birim fiyat geçersiz (KDV hariç, pozitif)." });
  });
});

describe("elle fatura formu sözleşmesi", () => {
  const form = read("src/app/admin/billing/faturalar/yeni/manual-invoice-form.tsx");
  const action = read("src/app/actions/platform-invoices.ts");
  const create = action.slice(action.indexOf("export async function createManualInvoice"), action.indexOf("export async function issueManualInvoice"));

  it("form eylemi değil onSubmit + preventDefault; ofis ve iç not kontrollü (hata sonrası korunur)", () => {
    expect(form).not.toMatch(/<form[^>]*\saction=/);
    expect(form).toMatch(/<form onSubmit=\{onSubmit\}/);
    expect(form).toMatch(/e\.preventDefault\(\)/);
    expect(form).toMatch(/<select[\s\S]*?id="mi-tenant"[\s\S]*?value=\{tenantId\}[\s\S]*?onChange=/);
    expect(form).not.toMatch(/defaultValue=\{defaultTenantId/);
    expect(form).toMatch(/<textarea name="note" value=\{note\} onChange=/);
  });

  it("geçersiz kalem varken düğme kapalı; satır içi hata gösterilir", () => {
    expect(form).toMatch(/invalid\.length === 0/);
    expect(form).toMatch(/disabled=\{!canSubmit\}/);
    expect(form).toMatch(/manualLineIssue\(r\)/);
  });

  it("çift tazeleme yok: istemci router.push/refresh çağırmaz; eylem redirect eder, denetim kaydı after()", () => {
    expect(form).not.toMatch(/router\.(push|refresh)\(/);
    expect(form).not.toMatch(/useRouter/);
    expect(create).toMatch(/redirect\(`\/admin\/billing\/faturalar\/\$\{id\}`\)/);
    expect(create).toMatch(/afterSafe\(/);
    expect(create).not.toMatch(/await logPlatformActivity/);
  });
});
