import { Globe2 } from "lucide-react";

/**
 * KVKK yurt dışı aktarım hatırlatma kartı. Hukuki iddia İÇERMEZ: ürünün hangi özelliklerinde verinin yurt dışındaki
 * bir sağlayıcıya gidebileceğini dürüstçe listeler ve değerlendirmeyi ofisin avukatına bırakır.
 * Sağlayıcı durumu yalnız sunucuda ortam değişkeninin VARLIĞINDAN okunur (anahtar değeri gösterilmez).
 */
export function KvkkTransferCard() {
  const providers: { name: string; feature: string; active: boolean | null; note: string }[] = [
    {
      name: "OpenAI (ABD)",
      feature: "AI asistan, ilan metni, çağrı özeti, çeviri, belge okuma",
      active: Boolean(process.env.OPENAI_API_KEY),
      note: "Telefon, TC kimlik, e-posta, IBAN ve kart numarası gönderilmeden maskelenir; ad ve serbest metin gidebilir.",
    },
    {
      name: "Meta WhatsApp Cloud API",
      feature: "WhatsApp şablon/yanıt mesajları (ofisin kendi hesabı bağlıysa)",
      active: null,
      note: "Mesaj içeriği ve alıcı numarası sağlayıcıya iletilir.",
    },
    {
      name: "Resend (e-posta)",
      feature: "İşlemsel e-postalar (sağlayıcı anahtarı tanımlıysa)",
      active: Boolean(process.env.RESEND_API_KEY),
      note: "Alıcı e-posta adresi ve e-posta gövdesi sağlayıcıya iletilir.",
    },
  ];

  return (
    <section
      id="kvkk-yurt-disi"
      aria-labelledby="kvkk-yurt-disi-baslik"
      className="rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]"
    >
      <p className="flex items-center gap-2 text-xs font-semibold text-brand-600">
        <Globe2 className="h-4 w-4" aria-hidden /> KVKK hatırlatması
      </p>
      <h2 id="kvkk-yurt-disi-baslik" className="mt-1 font-display font-bold text-ink-950">
        Yurt dışındaki hizmet sağlayıcılara veri aktarımı
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-text-muted">
        Aşağıdaki özellikler açıkken müşteri/portföy verisinin bir kısmı yurt dışında bulunan sağlayıcılara iletilebilir.
        Bu aktarımlar için gereken hukuki dayanağı (ör. standart sözleşme ve gerekli bildirimler), aydınlatma metninizi ve
        veri sorumluları siciline ilişkin yükümlülüklerinizi <strong className="text-ink-950">avukatınıza danışarak</strong> değerlendirin.
      </p>
      <ul className="mt-3 space-y-2">
        {providers.map((p) => (
          <li key={p.name} className="rounded-[var(--radius-card)] border border-line bg-canvas px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold text-ink-950">{p.name}</p>
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${p.active ? "bg-amber-400/15 text-amber-700" : "bg-surface text-text-muted"}`}>
                {p.active === null ? "Ofis entegrasyonuna bağlı" : p.active ? "Platformda yapılandırılmış" : "Yapılandırılmamış"}
              </span>
            </div>
            <p className="mt-1 text-xs text-text-muted">{p.feature}</p>
            <p className="mt-0.5 text-xs text-text-faint">{p.note}</p>
          </li>
        ))}
      </ul>
      <p className="mt-3 border-t border-line pt-3 text-xs leading-relaxed text-text-faint">
        Bu kart hukuki danışmanlık değildir; yalnız ürünün veri akışını listeler. Barındırma ve veritabanı sağlayıcısının
        bölgesini sözleşmenizden ve platform yöneticisinden teyit edin.
      </p>
    </section>
  );
}
