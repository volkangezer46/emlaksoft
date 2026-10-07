import type { RowValidation } from "@/lib/ui/row-draft";

/**
 * Ofisler tablosu satır içi düzenleme kuralları (saf; vitest). Satır içi kaydetme standardının
 * `validate` ve `risk` girdileri. Sunucu (`updateTenantPlanStatus` → RPC + plan kapasite tetikleyicisi)
 * kendi kurallarını yine uygular; buradaki kurallar yalnız erken ve açıklayıcı geri bildirimdir.
 */

export type TenantRowDraft = { status: string; plan: string };

const LOCKED = new Set(["suspended", "cancelled"]);

/**
 * Geçersiz seçimler:
 *  - Askıdaki/iptal edilmiş (ya da bu kayıtta askıya alınan/iptal edilen) ofiste paket değiştirilmez:
 *    erişimi kapalı ofise paket atamak faturalama tutarını sessizce değiştirir. Önce durum etkinleştirilir.
 */
export function validateTenantRow(draft: TenantRowDraft, saved: TenantRowDraft): RowValidation {
  if (draft.plan !== saved.plan && LOCKED.has(draft.status)) {
    return {
      ok: false,
      reason: `${draft.status === "cancelled" ? "İptal edilmiş" : "Askıdaki"} ofise paket atanamaz; önce durumu etkinleştirip kaydedin.`,
    };
  }
  return { ok: true };
}

/**
 * Riskli değişiklik → satır içi onay adımı (null = risk yok).
 * Askıya alma / iptal erişimi keser; paket düşürme kullanıcı ve modül sınırlarını azaltır.
 * `planOrder`: katalog sırası (küçük = alt paket).
 */
export function tenantRowRisk(draft: TenantRowDraft, saved: TenantRowDraft, planOrder: Record<string, number>, planName: (id: string) => string): string | null {
  if (draft.status !== saved.status && draft.status === "suspended") return "Ofisin panel erişimi anında kesilecek.";
  if (draft.status !== saved.status && draft.status === "cancelled") return "Ofis iptal edilecek: erişim kapanır, veri silinmez.";
  const from = planOrder[saved.plan];
  const to = planOrder[draft.plan];
  if (draft.plan !== saved.plan && from !== undefined && to !== undefined && to < from) {
    return `Paket düşürülüyor (${planName(saved.plan)} → ${planName(draft.plan)}); kullanıcı ve modül sınırları azalır.`;
  }
  return null;
}
