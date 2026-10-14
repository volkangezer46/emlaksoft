import type { EffectivePermissions } from "@/lib/permissions-effective";

/**
 * Müşteri kartındaki (customer-360-tabs) bağlantı ve "oluştur" düğmelerinin izinleri. Kural: hedef sayfanın kendi kapısıyla
 * AYNI — kullanıcıyı açamayacağı sayfaya (ve oradan ?yetki=yok şeridine) götüren CTA çizilmez.
 * Varsayılan hepsi false (fail-closed); `customer-cta-contract.test.ts` kartta kapısız CTA bırakılmadığını kilitler.
 */
export type CustomerCtaPermissions = {
  demandsCreate: boolean;
  dealsView: boolean;
  dealsCreate: boolean;
  offersView: boolean;
  offersCreate: boolean;
  contractsView: boolean;
  contractsCreate: boolean;
  appointmentsCreate: boolean;
};

export const NO_CUSTOMER_CTAS: CustomerCtaPermissions = {
  demandsCreate: false,
  dealsView: false,
  dealsCreate: false,
  offersView: false,
  offersCreate: false,
  contractsView: false,
  contractsCreate: false,
  appointmentsCreate: false,
};

export function customerCtaPermissions(perms: EffectivePermissions): CustomerCtaPermissions {
  const has = (mod: keyof EffectivePermissions, action: "view" | "create") => (perms[mod] ?? []).includes(action);
  const offersView = has("offers", "view");
  return {
    demandsCreate: has("demands", "create"),
    dealsView: has("commissions", "view"),
    dealsCreate: has("commissions", "view") && has("commissions", "create"),
    offersView,
    // /app/teklifler/yeni ile aynı: modül kapısı offers görme; oluşturma offers create (yoksa anlaşma create).
    offersCreate: offersView && (perms.offers?.includes("create") ?? has("commissions", "create")),
    contractsView: has("contracts", "view"),
    contractsCreate: has("contracts", "view") && has("contracts", "create"),
    appointmentsCreate: has("appointments", "view") && has("appointments", "create"),
  };
}
