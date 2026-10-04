/** Kayıt formuna atıf kodu ve UTM etiketlerini gizli alan olarak taşır (kişisel veri içermez; değerler sunucuda yeniden doğrulanır). */
export type SignupAttributionFields = {
  ref?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
};

const NAMES = ["ref", "utm_source", "utm_medium", "utm_campaign"] as const;

export function AttributionFields({ attribution }: { attribution?: SignupAttributionFields }) {
  if (!attribution) return null;
  return (
    <>
      {NAMES.map((n) => (attribution[n] ? <input key={n} type="hidden" name={n} value={attribution[n]} /> : null))}
    </>
  );
}
