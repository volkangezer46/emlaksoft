import type { Metadata } from "next";
import { LegalPage, LegalSection } from "@/components/legal-page";

export const metadata: Metadata = {
  title: "Çerez Politikası | EmlakSoft",
  description: "EmlakSoft'un kullandığı çerezler ve yönetim seçenekleri.",
  alternates: { canonical: "/cerez-politikasi" },
};

export default function CerezPolitikasiPage() {
  return (
    <LegalPage
      title="Çerez Politikası"
      intro="Bu politika, EmlakSoft web sitesi ve uygulamasında hangi çerezlerin (cookie) hangi amaçlarla kullanıldığını ve bunları nasıl yönetebileceğinizi açıklar."
    >
      <LegalSection no="1." title="Çerez Nedir?">
        <p>
          Çerezler, ziyaret ettiğiniz siteler tarafından tarayıcınıza kaydedilen küçük metin dosyalarıdır.
          Oturumunuzu açık tutmak, tercihlerinizi hatırlamak ve hizmet güvenliğini sağlamak için kullanılır.
        </p>
      </LegalSection>

      <LegalSection no="2." title="Kullandığımız Çerezler">
        <div className="overflow-x-auto rounded-[14px] border border-line">
          <table className="w-full min-w-[520px] text-left text-sm">
            <thead className="bg-canvas text-xs text-text-muted">
              <tr>
                <th className="px-4 py-3 font-semibold">Tür</th>
                <th className="px-4 py-3 font-semibold">Amaç</th>
                <th className="px-4 py-3 font-semibold">Süre</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              <tr>
                <td className="px-4 py-3 font-semibold text-ink-950">Zorunlu (oturum)</td>
                <td className="px-4 py-3">Giriş oturumunun sürdürülmesi, güvenli kimlik doğrulama (Supabase auth token)</td>
                <td className="px-4 py-3">Oturum / yenilemeli</td>
              </tr>
              <tr>
                <td className="px-4 py-3 font-semibold text-ink-950">Tercih</td>
                <td className="px-4 py-3">Tema, dil ve arayüz tercihlerinin hatırlanması</td>
                <td className="px-4 py-3">12 aya kadar</td>
              </tr>
              <tr>
                <td className="px-4 py-3 font-semibold text-ink-950">Güvenlik</td>
                <td className="px-4 py-3">Kötüye kullanım ve sahtecilik önleme (hız sınırı, CSRF koruması)</td>
                <td className="px-4 py-3">24 saate kadar</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          EmlakSoft, üçüncü taraf reklam/izleme çerezi <b>kullanmaz</b>. Zorunlu çerezler olmadan platforma güvenli
          giriş yapılamayacağı için bunlar açık rızaya tabi değildir.
        </p>
      </LegalSection>

      <LegalSection no="3." title="Çerezleri Yönetme">
        <p>
          Tarayıcınızın ayarlarından çerezleri silebilir veya engelleyebilirsiniz. Zorunlu çerezlerin engellenmesi
          hâlinde oturum açma ve panel kullanımı mümkün olmayabilir. Tarayıcı bazlı yönetim: Chrome, Safari, Firefox
          ve Edge&apos;in gizlilik ayarları bölümlerini kullanabilirsiniz.
        </p>
      </LegalSection>

      <LegalSection no="4." title="Değişiklikler">
        <p>
          Bu politika ihtiyaç hâlinde güncellenir; güncel sürüm her zaman bu sayfada yayınlanır. Önemli
          değişikliklerde panel içinden bilgilendirme yapılır.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
