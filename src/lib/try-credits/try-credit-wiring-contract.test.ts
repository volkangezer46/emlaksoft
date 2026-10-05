import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/** Kaynak taraması: TL kredi cüzdanının ödeme akışına bağlantıları ve yasaklı kalıplar. */
const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");
const billing = read("src/app/actions/billing.ts");
const callback = read("src/app/api/iyzico/callback/route.ts");
const webhook = read("src/app/api/iyzico/webhook/route.ts");
const reconciliation = read("src/lib/billing/reconciliation.ts");
const fulfillment = read("src/lib/billing/fulfillment.ts");
const platformBilling = read("src/app/actions/platform-billing.ts");
const page = read("src/app/app/abonelik/page.tsx");

function actionBody(name: string): string {
  const start = billing.indexOf(`export async function ${name}(`);
  expect(start, name).toBeGreaterThan(-1);
  const next = billing.indexOf("\nexport async function ", start + 10);
  return billing.slice(start, next < 0 ? undefined : next);
}

describe("service_role allowlist gevşetilmedi", () => {
  it("try-credits modülünde createAdminClient YOK (istemci çağıran işlevden gelir)", () => {
    const dir = resolve(process.cwd(), "src/lib/try-credits");
    for (const f of readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))) {
      expect(read(`src/lib/try-credits/${f}`), f).not.toContain("createAdminClient");
    }
    expect(read("src/app/app/abonelik/cuzdan-section.tsx")).not.toContain("createAdminClient");
    expect(read("src/components/app/wallet-credit-toggle.tsx")).not.toContain("createAdminClient");
  });

  it("ofis okuma yolu service_role kullanmaz: RLS'li istemci + authenticated RPC/görünüm", () => {
    const reader = read("src/lib/try-credits/reader.ts");
    expect(reader).toContain("TRY_RPC.myOverview");
    expect(reader).toContain("TRY_MOVEMENTS_VIEW");
    expect(reader).not.toMatch(/admin/i);
  });
});

describe("üç satın alma akışı krediyi sunucuda uygular (istemciden tutar ALINMAZ)", () => {
  for (const name of ["startPlanCheckout", "startSeatPurchase", "startCreditPackPurchase"]) {
    it(`${name}: yalnız use_credit bayrağı; pay ayardan; fatura taslağıyla birlikte rezerv; iyzico yalnız nakit`, () => {
      const b = actionBody(name);
      expect(b).toContain('String(formData.get("use_credit") ?? "") === "1"');
      expect(b).toContain("walletCredit: useCredit ? { userId: user.id, maxShare: await getTryMaxShare() } : null");
      expect(b).toMatch(/price: chargeTry,\s+paidPrice: chargeTry,/);
      expect(b).not.toMatch(/formData\.get\("(credit_try|credit_amount|wallet)/);
      // tam kredi dalı iyzico'dan ÖNCE ve capture'sız
      expect(b.indexOf("fulfillInvoiceWithWalletCredit")).toBeGreaterThan(-1);
      expect(b.indexOf("fulfillInvoiceWithWalletCredit")).toBeLessThan(b.indexOf("initializeCheckoutForm"));
      // başarısız checkout rezervi bırakır
      expect(b).toContain("markCheckoutInvoiceFailed");
    });
  }

  it("plan satın almada kredi yalnız owner/gm; demo (iyzico yok) modunda reddedilir", () => {
    const b = actionBody("startPlanCheckout");
    expect(b).toMatch(/useCredit && gate\.role !== "owner" && gate\.role !== "gm"/);
    expect(b).toMatch(/if \(useCredit && !configured\)/);
  });

  it("koltuk ve paket satın alma zaten owner/gm ile sınırlı", () => {
    expect(actionBody("startSeatPurchase")).toMatch(/gate\.role !== "owner" && gate\.role !== "gm"/);
    expect(actionBody("startCreditPackPurchase")).toMatch(/gate\.role !== "owner" && gate\.role !== "gm"/);
  });

  it("her action requirePermission ile başlar", () => {
    for (const name of ["startPlanCheckout", "startSeatPurchase", "startCreditPackPurchase"]) {
      expect(actionBody(name)).toContain('await requirePermission("billing", "edit"');
    }
  });
});

describe("ödeme doğrulama ve tamamlama", () => {
  it("callback ve webhook: iyzico'dan beklenen tutar = toplam − kredi rezervi; belirsizse fail-closed", () => {
    for (const src of [callback, webhook]) {
      expect(src).toContain("tryInvoiceHold(admin, invoice.tenant_id, conversationId)");
      expect(src).toContain("expectedProviderAmountTry(amounts.totalTry, hold)");
      expect(src).not.toMatch(/amountTry: amounts\.totalTry,/);
    }
  });

  it("fulfillBillingPaymentAtomic: rezerv sorgusu capture sonrası, belirsizse retry_pending; kredi yolu try_credit_fulfill_invoice", () => {
    expect(fulfillment).toContain("tryInvoiceHold(admin, input.expectedTenantId, input.conversationId)");
    expect(fulfillment).toContain('"retry_pending", "wallet_hold_lookup"');
    expect(fulfillment).toContain("TRY_RPC.fulfillInvoice");
    expect(fulfillment).toContain('"fulfill_billing_payment_v2"');
    expect(fulfillment).toContain("Bu fatura için etkin bir kredi rezervi bulunamadı.");
  });

  it("reconciliation: void/expired faturaların rezervleri süpürülür", () => {
    expect(reconciliation).toContain("tryReleaseDead(admin, 500)");
  });

  it("fulfillment.ts yeni createAdminClient çağrısı eklemedi (kabul listesi sayısı aynı)", () => {
    const calls = fulfillment.match(/createAdminClient\(\)/g) ?? [];
    expect(calls).toHaveLength(6);
  });
});

describe("iade / iptal", () => {
  it("iade: kredi geri yazma iade kaydından ÖNCE ve başarısızsa kayıt düşülmez", () => {
    const i = platformBilling.indexOf("export async function recordInvoiceRefund");
    const body = platformBilling.slice(i, platformBilling.indexOf("const CAPTURE_ACTIONS", i));
    expect(body).toContain("creditRestoreForRefund(");
    expect(body.indexOf("tryRefundInvoice(")).toBeGreaterThan(-1);
    expect(body.indexOf("tryRefundInvoice(")).toBeLessThan(body.indexOf('.from("invoices")\n    .update('));
    expect(body).toContain("iade kaydı düşülmedi");
    expect(body).toContain("tryRefundIdem(invoiceId");
  });

  it("fatura iptali kredi rezervini bırakır", () => {
    const i = platformBilling.indexOf("export async function voidInvoice");
    const body = platformBilling.slice(i, platformBilling.indexOf("export async function recordInvoiceRefund", i));
    expect(body).toContain('tryReleaseInvoice(admin, updated.tenant_id as string, invoiceId, "invoice_void")');
  });
});

describe("abonelik sayfası: Cüzdan bölümü", () => {
  it("sekme kayıtlı, süzgeç URL'den, bakiye RLS'li RPC ile; zaman clock.ts'ten", () => {
    expect(page).toContain('resolveTab(sp, ["plan", "kontor", "cuzdan", "faturalar", "iptal"], "plan")');
    expect(page).toContain('{ id: "cuzdan", label: "Cüzdan" }');
    expect(page).toContain("readTryOverview(supabase)");
    expect(page).toContain("<CuzdanSection");
    const section = read("src/app/app/abonelik/cuzdan-section.tsx");
    expect(section).not.toMatch(/Date\.now\(|new Date\(\)/);
    expect(section).toContain('from "@/lib/clock"');
    // sıfır çıkmaz: kartlar Link
    expect((section.match(/<Link/g) ?? []).length).toBeGreaterThanOrEqual(8);
  });

  it("kredi onay kutusu üç satın alma arayüzünde; iyzico yokken (demo) gösterilmez", () => {
    expect(read("src/app/app/abonelik/checkout-button.tsx")).toContain('fd.set("use_credit", "1")');
    expect(read("src/app/app/abonelik/seat-panel.tsx")).toContain('fd.set("use_credit", "1")');
    expect(read("src/app/app/abonelik/kontor-panel.tsx")).toContain('fd.set("use_credit", "1")');
    expect(page).toMatch(/configured &&\s+isSeatOwner &&\s+walletOverview/);
  });

  it("istemci bileşeni zod/sunucu modülü çekmez (paket bütçesi)", () => {
    const toggle = read("src/components/app/wallet-credit-toggle.tsx");
    expect(toggle).not.toMatch(/from "@\/lib\/try-credits\/(config|wallet|reader|settings|checkout)"/);
    expect(read("src/lib/try-credits/view.ts")).not.toMatch(/import (?!type)[^;]*from "\.\/(config|reader)"/);
    expect(read("src/lib/try-credits/invoice-credit.ts")).not.toContain('from "./config"');
  });
});
