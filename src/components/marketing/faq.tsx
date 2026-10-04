import { PLANS, type PlanDef } from "@/lib/billing/plans";
import { yearlyOffer } from "@/lib/marketing-copy";
import { Em, SectionHeading } from "./section-heading";

/**
 * Görünen SSS; FAQPage JSON-LD yalnız bu listeden üretilir (landing-jsonld.tsx).
 * Deneme günü ve yıllık teklif admin paket tanımlarından (getPublicPricing) gelir; sabit yazılmaz.
 */
export function buildHomeFaqs({ trialDays, plans }: { trialDays?: number; plans: readonly PlanDef[] }): { q: string; a: string }[] {
  const offer = yearlyOffer(plans);
  const yearlyText = offer
    ? `Yıllık ödemede ${offer.label} (${offer.gift} ay hediye).`
    : "Yıllık ödeme seçeneği ve avantajı fiyat bölümünde paket paket yazar.";
  return [
    { q: "Deneme için kredi kartı gerekir mi?", a: `Hayır. Kayıt ${trialDays ? `${trialDays} gün ` : ""}ücretsiz denemeyle başlar ve kart bilgisi istemez. Deneme boyunca tüm özellikler açıktır; süre sonunda size uygun paketi seçersiniz.` },
    { q: "Kurulum ne kadar sürer?", a: "Kayıttan sonra kurulum sihirbazı ofis bilgilerinizi, ekibinizi ve ilk verilerinizi adım adım hazırlar. Süre; kullanıcı sayınıza ve içeri aktaracağınız veriye göre değişir." },
    { q: "Verilerim nerede saklanıyor?", a: "Ana uygulama veritabanı seçili Supabase projesinin Avrupa (Frankfurt / eu-central-1) bölgesinde tutulur. Dosya depolama ve etkinleştirdiğiniz dış hizmetler kendi veri işleme koşullarına tabidir. Yetkilendirme, denetim ve veri yaşam döngüsü araçları sunulur; dilediğiniz an dışa aktarabilirsiniz." },
    { q: "Portal ilanlarımı otomatik çekiyor veya yayınlıyor musunuz?", a: "Hayır. Portallardan izinsiz veri kazımıyoruz ve ilanlarınızı portallara otomatik yayınlamıyoruz. İlan numarası/URL ekliyorsunuz; sistem periyodik teyit ister ve ilan düştüğünde kapanış formuyla kaçağı ölçer." },
    { q: "Dijital imza e-imza mıdır?", a: "Hayır. Sözleşmeler SMS ile doğrulanan dijital imza akışıyla onaylanır; bu bir nitelikli elektronik imza (e-imza) değildir." },
    { q: "Sözleşme veya taahhüt var mı?", a: `Taahhüt yok. Aylık kullanın, istediğiniz an iptal edin. ${yearlyText}` },
    { q: "Hangi paketi seçmeliyim, modülleri kapatabilir miyim?", a: "Paketler kullanıcı sayısı ve kapsama göre ayrılır; güncel fiyat ve limitler fiyat bölümünde ve Fiyatlar sayfasındadır. Ofis yöneticisi kullanmadığı modülleri ayarlardan kapatıp yeniden açabilir; çekirdek alanlar kapatılamaz." },
    { q: "Mevcut CRM’den geçiş yapabilir miyim?", a: "Evet. Müşteri ve portföylerinizi Excel/CSV ile içeri aktarabilirsiniz. Özel entegrasyon ihtiyaçları teknik değerlendirme sonrasında planlanır." },
  ];
}

/** Yönetim SEO önizlemesi ve sözleşme testi için varsayılan (plans.ts, deneme günü sayısız) SSS; ana sayfa buildHomeFaqs ile canlı veriyle üretir. */
export const FAQS: readonly { q: string; a: string }[] = buildHomeFaqs({ plans: PLANS });

export function Faq({ items }: { items: readonly { q: string; a: string }[] }) {
  return (
    <section id="sss" className="mk-section mk-alt" aria-labelledby="sss-baslik">
      <div className="mk-wrap" style={{ maxWidth: "52rem" }}>
        <SectionHeading center eyebrow="Sık sorulan sorular" title={<span id="sss-baslik">Aklınızdaki sorular, <Em>net cevaplar.</Em></span>} />
        <div className="mk-faq mk-stagger" style={{ marginTop: "2.5rem" }}>
          {items.map((f, i) => (
            <details key={f.q} className="motion-details" style={{ "--i": i } as React.CSSProperties}>
              <summary>
                {f.q}
                <i aria-hidden="true" />
              </summary>
              <p>{f.a}</p>
            </details>
          ))}
        </div>
        <p style={{ marginTop: "1.5rem", textAlign: "center", fontSize: "0.9375rem", color: "var(--mk-muted)" }}>
          Sorunuz hâlâ mı var? <a href="mailto:destek@emlaksoft.com.tr" style={{ color: "var(--mk-accent-text)", fontWeight: 600 }}>destek@emlaksoft.com.tr</a>
        </p>
      </div>
    </section>
  );
}
