import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage, LegalSection } from "@/components/legal-page";

export const metadata: Metadata = {
  title: "Kullanım Şartları | EmlakSoft",
  description: "EmlakSoft üyelik ve kullanım şartları.",
  alternates: { canonical: "/kullanim-sartlari" },
};

export default function KullanimSartlariPage() {
  return (
    <LegalPage
      title="Kullanım Şartları"
      intro="Bu şartlar, EmlakSoft platformuna üye olan ve kullanan tüm ofisler ve kullanıcılar için geçerli üyelik sözleşmesidir. Kayıt olarak bu şartları kabul etmiş sayılırsınız."
    >
      <LegalSection no="1." title="Hizmetin Kapsamı">
        <p>
          EmlakSoft; emlak ofisleri için müşteri, portföy, komisyon, portal takibi, randevu, sözleşme ve raporlama
          modüllerini içeren abonelik tabanlı bir bulut yazılımıdır. Plan kapsamları ve limitler{" "}
          <Link className="font-semibold text-brand-600" href="/#fiyat">fiyatlandırma</Link> sayfasında ilan edilir;
          makul kullanım ilkeleri uygulanır.
        </p>
      </LegalSection>

      <LegalSection no="2." title="Hesap ve Güvenlik">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>Kayıt bilgilerinizin doğru ve güncel olmasından siz sorumlusunuz.</li>
          <li>Hesap kimlik bilgilerinizin gizliliği size aittir; hesabınız üzerinden yapılan işlemler sizin adınıza hüküm doğurur.</li>
          <li>Ofis içi kullanıcı rolleri ve yetkileri ofis yöneticisi tarafından atanır; yetkilendirme sorumluluğu ofise aittir.</li>
        </ul>
      </LegalSection>

      <LegalSection no="3." title="Kabul Edilebilir Kullanım">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>Platform yalnızca hukuka uygun amaçlarla kullanılabilir; izinsiz ticari ileti (spam) gönderimi yasaktır.</li>
          <li>Platforma giren kişisel verilerin (müşterileriniz) hukuka uygun elde edilmesinden ofisiniz sorumludur.</li>
          <li>Tersine mühendislik, güvenlik testlerini izinsiz çalıştırma, hizmeti aşırı yükleyerek kötüye kullanma yasaktır.</li>
        </ul>
      </LegalSection>

      <LegalSection no="4." title="Abonelik, Ücretlendirme ve Fesih">
        <p>
          Abonelik dönemsel olarak ücretlendirilir ve iptal edilmedikçe yenilenir. İptal ve iade koşulları{" "}
          <Link className="font-semibold text-brand-600" href="/iptal-iade">İptal &amp; İade Politikası</Link>&apos;nda,
          satış koşulları <Link className="font-semibold text-brand-600" href="/mesafeli-satis">Mesafeli Satış Sözleşmesi</Link>&apos;nde
          düzenlenir. Şartların ağır ihlali hâlinde hesap askıya alınabilir; askıya alma öncesinde makul bildirim yapılır.
        </p>
      </LegalSection>

      <LegalSection no="5." title="Fikri Mülkiyet">
        <p>
          Platformun yazılımı, tasarımı ve markası EmlakSoft&apos;a aittir. Ofisinizin platforma girdiği veriler ise
          size aittir; EmlakSoft bu verileri yalnızca hizmeti sunmak için işler.
        </p>
      </LegalSection>

      <LegalSection no="6." title="Sorumluluk Sınırı">
        <p>
          Hizmet &quot;olduğu gibi&quot; sunulur; kesintisizlik hedeflenir ancak internet altyapısından kaynaklanan
          kesintiler garanti kapsamında değildir. EmlakSoft&apos;un sorumluluğu, ilgili olayın gerçekleştiği dönemde
          ödenen abonelik bedeliyle sınırlıdır. Dolaylı zararlar, veri kaybına karşı ofis tarafından alınmayan
          yedek önlemleri ve üçüncü taraf hizmet kesintileri kapsam dışıdır.
        </p>
      </LegalSection>

      <LegalSection no="7." title="Değişiklikler ve Uygulanacak Hukuk">
        <p>
          Şartlar güncellenebilir; önemli değişiklikler panelden ve e-posta ile duyurulur. Bu sözleşme Türkiye
          Cumhuriyeti hukukuna tabidir; tüketici işlemleri bakımından Tüketici Hakem Heyetleri ve Tüketici
          Mahkemeleri yetkilidir.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
