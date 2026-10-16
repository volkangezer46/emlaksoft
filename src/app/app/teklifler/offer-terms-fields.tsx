import { FormField, FormInput, FormSelect, FormTextarea } from "@/components/ui/form-controls";
import { Checkbox } from "@/components/ui/checkbox";
import { MoneyInput } from "@/components/ui/money-input";
import { OFFER_PAYMENT_METHODS, type OfferTerms } from "@/lib/offer-terms";

/**
 * Yapılandırılmış teklif koşulları (SP2) — yeni teklif formu ve düzenleme penceresi aynı alanları kullanır.
 * Alan adları `parseOfferTerms` ile birebir: payment_method, deposit_amount, proposed_deed_date, credit_contingency, swap_note.
 * Sunucu bileşeni olarak da çizilebilir (durum yok); istemci formların içinde kullanılır.
 */
export function OfferTermsFields({
  idPrefix,
  defaults,
  minDate,
}: {
  idPrefix: string;
  defaults?: Partial<OfferTerms> | null;
  /** Tapu tarihi alt sınırı (YYYY-MM-DD; sunucudan gelir, bileşende saat okunmaz). */
  minDate?: string;
}) {
  return (
    <>
      <FormField label="Ödeme şekli" htmlFor={`${idPrefix}-payment`} hint="Peşin, kredi, takas ya da karma.">
        <FormSelect id={`${idPrefix}-payment`} name="payment_method" defaultValue={defaults?.payment_method ?? ""} className="appearance-none">
          <option value="">Belirtilmedi</option>
          {OFFER_PAYMENT_METHODS.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </FormSelect>
      </FormField>
      <FormField label="Kapora (₺)" htmlFor={`${idPrefix}-deposit`} hint="Teklifle birlikte önerilen kapora.">
        <MoneyInput
          id={`${idPrefix}-deposit`}
          name="deposit_amount"
          placeholder="ör. 250.000"
          defaultValue={defaults?.deposit_amount ?? null}
        />
      </FormField>
      <FormField label="Önerilen tapu tarihi" htmlFor={`${idPrefix}-deed`}>
        <FormInput id={`${idPrefix}-deed`} name="proposed_deed_date" type="date" min={minDate} defaultValue={defaults?.proposed_deed_date ?? ""} />
      </FormField>
      <label
        htmlFor={`${idPrefix}-credit`}
        className="flex min-h-11 cursor-pointer items-start gap-2.5 self-end rounded-[var(--radius-control)] border border-line bg-canvas/60 px-3.5 py-2.5"
      >
        <Checkbox id={`${idPrefix}-credit`} name="credit_contingency" defaultChecked={defaults?.credit_contingency ?? false} className="mt-0.5" />
        <span>
          <span className="block text-sm font-semibold text-ink-950">Kredi onayına bağlı</span>
          <span className="block text-xs text-text-muted">Banka kredisi onaylanmazsa teklif düşer.</span>
        </span>
      </label>
      <FormField label="Takas açıklaması (varsa)" htmlFor={`${idPrefix}-swap`} className="sm:col-span-2">
        <FormTextarea
          id={`${idPrefix}-swap`}
          name="swap_note"
          rows={2}
          maxLength={1000}
          placeholder="ör. 2019 model araç, tahmini 900.000 ₺"
          defaultValue={defaults?.swap_note ?? ""}
        />
      </FormField>
    </>
  );
}
