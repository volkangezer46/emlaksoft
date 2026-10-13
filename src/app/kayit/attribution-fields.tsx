/**
 * Kayıt formuna atıf kodu, UTM etiketleri ve (atıf taşıma açıkken ölçüm istemcisinin eklediği) iniş yolu/yönlendiren
 * ana makineyi gizli alan olarak taşır. Kişisel veri içermez; değerler sunucuda yeniden doğrulanır.
 */
export type SignupAttributionFields = {
  ref?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_term?: string;
  utm_content?: string;
  src_host?: string;
  lp?: string;
};

const NAMES = ["ref", "utm_source", "utm_medium", "utm_campaign", "lp", "src_host", "utm_term", "utm_content"] as const;

export function AttributionFields({ attribution }: { attribution?: SignupAttributionFields }) {
  if (!attribution) return null;
  return (
    <>
      {NAMES.map((n) => (attribution[n] ? <input key={n} type="hidden" name={n} value={attribution[n]} /> : null))}
    </>
  );
}
