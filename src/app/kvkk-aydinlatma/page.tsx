import type { Metadata } from "next";
import { LegalPage, LegalSection } from "@/components/legal-page";

export const metadata: Metadata = {
  title: "KVKK Aydınlatma Metni | EmlakSoft",
  description: "6698 sayılı Kişisel Verilerin Korunması Kanunu kapsamında aydınlatma metni.",
  alternates: { canonical: "/kvkk-aydinlatma" },
};

export default function KvkkAydinlatmaPage() {
  return (
    <LegalPage
      title="KVKK Aydınlatma Metni"
      intro="6698 sayılı Kişisel Verilerin Korunması Kanunu (KVKK) uyarınca, EmlakSoft platformunu kullanan kişilerin kişisel verilerinin işlenmesine ilişkin aydınlatma metnidir."
    >
      <LegalSection no="1." title="Veri Sorumlusu">
        <p>
          Kişisel verileriniz, veri sorumlusu sıfatıyla EmlakSoft (&quot;Platform&quot;) tarafından aşağıda açıklanan
          kapsamda işlenmektedir. İletişim: <a className="font-semibold text-brand-600" href="mailto:destek@emlaksoft.app">destek@emlaksoft.app</a>
        </p>
      </LegalSection>

      <LegalSection no="2." title="İşlenen Kişisel Veriler">
        <ul className="list-disc space-y-1.5 pl-5">
          <li><b>Kimlik &amp; iletişim:</b> ad soyad, e-posta, telefon numarası, firma adı.</li>
          <li><b>Hesap &amp; işlem:</b> abonelik planı, fatura bilgileri, ödeme kayıtları (kart verileri Platform&apos;da saklanmaz; ödeme kuruluşu üzerinden işlenir).</li>
          <li><b>Kullanım:</b> oturum kayıtları, IP adresi, işlem günlükleri (audit log), cihaz/tarayıcı bilgisi.</li>
          <li><b>Müşteri verileri:</b> Ofisinizin Platform&apos;a girdiği müşteri/portföy kayıtları bakımından ofisiniz veri sorumlusu, EmlakSoft veri işleyendir.</li>
        </ul>
      </LegalSection>

      <LegalSection no="3." title="İşleme Amaçları ve Hukuki Sebepler">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>Üyelik sözleşmesinin kurulması ve ifası (KVKK m.5/2-c),</li>
          <li>Yasal yükümlülüklerin yerine getirilmesi — fatura, e-ticaret ve vergi mevzuatı (m.5/2-ç),</li>
          <li>Meşru menfaat kapsamında hizmet güvenliği, dolandırıcılık önleme ve ürün geliştirme (m.5/2-f),</li>
          <li>Açık rıza bulunması hâlinde ticari elektronik ileti gönderimi (İYS kayıtlı).</li>
        </ul>
      </LegalSection>

      <LegalSection no="4." title="Verilerin Aktarılması">
        <p>
          Verileriniz; barındırma ve altyapı hizmeti aldığımız sunucu sağlayıcılarına (veriler Avrupa bölgesi —
          eu-central-1 — veri merkezlerinde tutulur), ödeme kuruluşlarına, SMS/e-posta gönderim sağlayıcılarına ve
          yasal zorunluluk hâlinde yetkili kamu kurumlarına, amaçla sınırlı olarak aktarılabilir. Üçüncü kişilere
          satış veya pazarlama amaçlı aktarım yapılmaz.
        </p>
      </LegalSection>

      <LegalSection no="5." title="Saklama Süreleri">
        <p>
          Hesap verileri üyelik süresince; fatura ve işlem kayıtları ilgili mevzuattaki asgari süreler boyunca
          (ör. 10 yıl) saklanır. Üyeliğin sona ermesi hâlinde veriler, yasal saklama süreleri saklı kalmak kaydıyla
          silinir, yok edilir veya anonim hâle getirilir. Ofis verinizin dışa aktarımı (offboarding paketi) talep üzerine sağlanır.
        </p>
      </LegalSection>

      <LegalSection no="6." title="KVKK m.11 Kapsamındaki Haklarınız">
        <p>
          Kişisel verilerinizin işlenip işlenmediğini öğrenme, bilgi talep etme, düzeltme, silinmesini/yok edilmesini
          isteme, aktarıldığı üçüncü kişileri bilme, otomatik sistemlerle analiz sonucuna itiraz etme ve zarara
          uğramanız hâlinde giderim talep etme haklarına sahipsiniz. Taleplerinizi{" "}
          <a className="font-semibold text-brand-600" href="mailto:destek@emlaksoft.app">destek@emlaksoft.app</a>{" "}
          adresine iletebilirsiniz; başvurular en geç 30 gün içinde ücretsiz sonuçlandırılır.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
