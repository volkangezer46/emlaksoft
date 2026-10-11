/** Anlaşma türü etiketi (TEK KAYNAK). Kod değeri `rent` değişmez; kullanıcıya "Kiralık" gösterilir (portföy işlem türüyle tutarlı). */
export function dealTypeLabel(dealType: string | null | undefined): string {
  return dealType === "rent" ? "Kiralık" : "Satış";
}
