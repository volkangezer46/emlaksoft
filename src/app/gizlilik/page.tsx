import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage, LegalSection } from "@/components/legal-page";

export const metadata: Metadata = {
  title: "Gizlilik Politikası | EmlakSoft",
  description: "EmlakSoft gizlilik politikası — verileriniz nasıl korunur.",
  alternates: { canonical: "/gizlilik" },
};

export default function GizlilikPage() {
  return (
    <LegalPage
      title="Gizlilik Politikası"
      intro="Gizliliğiniz işimizin temelidir. Bu politika, EmlakSoft'un verilerinizi nasıl topladığını, kullandığını ve koruduğunu açıklar."
    >
      <LegalSection no="1." title="Topladığımız Veriler">
        <p>
          Hesap oluştururken verdiğiniz kimlik/iletişim bilgileri, abonelik ve fatura kayıtları, platform kullanım
          günlükleri ile ofisinizin platforma girdiği iş verileri (müşteri, portföy, işlem kayıtları). Ayrıntılı
          kategoriler ve hukuki sebepler için{" "}
          <Link className="font-semibold text-brand-600" href="/kvkk-aydinlatma">KVKK Aydınlatma Metni</Link>&apos;ne bakınız.
        </p>
      </LegalSection>

      <LegalSection no="2." title="Verileri Nasıl Kullanırız?">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>Hizmeti sunmak, hesabınızı ve aboneliğinizi yönetmek,</li>
          <li>Güvenliği sağlamak — şüpheli girişleri tespit etmek, kötüye kullanımı önlemek,</li>
          <li>Yasal yükümlülükleri (fatura, vergi, e-ticaret mevzuatı) yerine getirmek,</li>
          <li>Açık rızanızla ürün duyuruları göndermek (İYS kayıtlı; dilediğinizde çıkabilirsiniz).</li>
        </ul>
        <p><b>Verilerinizi asla satmayız</b> ve reklam ağlarıyla paylaşmayız.</p>
      </LegalSection>

      <LegalSection no="3." title="Veri Güvenliği">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>Tüm trafik TLS ile şifrelenir; veriler şifreli olarak saklanır.</li>
          <li>Veriler Avrupa bölgesi (eu-central-1) veri merkezlerinde barındırılır.</li>
          <li>Ofis verileri kiracı-izolasyonu (row-level security) ile ayrıştırılır; her ofis yalnızca kendi verisine erişir.</li>
          <li>Kritik işlemler denetim kaydına (audit log) yazılır; erişim rol bazlı yetkilendirmeyle sınırlanır.</li>
        </ul>
      </LegalSection>

      <LegalSection no="4." title="Veri Sahipliği ve Taşınabilirlik">
        <p>
          Platforma girdiğiniz iş verisinin sahibi sizsiniz. Dilediğiniz an dışa aktarım talep edebilir, ayrılırken
          offboarding paketiyle tüm verinizi alabilirsiniz. Silme talepleri, yasal saklama süreleri saklı kalmak
          kaydıyla yerine getirilir.
        </p>
      </LegalSection>

      <LegalSection no="5." title="İletişim">
        <p>
          Gizlilikle ilgili sorularınız için:{" "}
          <a className="font-semibold text-brand-600" href="mailto:destek@emlaksoft.app">destek@emlaksoft.app</a>
        </p>
      </LegalSection>
    </LegalPage>
  );
}
