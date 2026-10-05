import type { Metadata } from "next";
import { buildMetadata } from "@/lib/seo/store";
import { LegalPage, LegalSection } from "@/components/legal-page";

export async function generateMetadata(): Promise<Metadata> {
  return buildMetadata("/kvkk-aydinlatma");
}

// AVUKAT ONAYI GEREKİR: alıcı/yurt dışı aktarım satırları ve veri sorumlusu ünvan/adres (VERBİS) alanları hukuki incelemeye tabidir.
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
          <li><b>Hesap &amp; işlem:</b> abonelik planı, fatura bilgileri, ödeme kayıtları. Kart bilgileri (kart numarası, son kullanma tarihi, kart güvenlik kodu) Platform&apos;da saklanmaz; ödeme kuruluşu iyzico tarafından işlenir ve saklanır. Platform yalnızca kartın saklama anahtarını, son 4 hanesini ve markasını tutar; kart yalnızca açık rızanızla kaydedilir.</li>
          <li><b>Davet programı:</b> davet bağlantısı üzerinden gelen kayıtlarda davet eden ofis ile davet edilen ofis arasındaki ilişki (davet kodu, kayıt ve ödül durumu). Davet eden ofisin adı, kayıt ekranında davet edilene gösterilir.</li>
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
          satış veya pazarlama amaçlı aktarım yapılmaz. Alıcı grupları ve hizmet sağlayıcılar aşağıdadır:
        </p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li><b>iyzico (ödeme kuruluşu):</b> abonelik ödemelerinin tahsili, kartın saklanması (açık rızanızla) ve iade işlemleri.</li>
          <li><b>Supabase (veritabanı ve kimlik doğrulama altyapısı):</b> hesap ve ofis verilerinin barındırılması; Avrupa bölgesi.</li>
          <li><b>Vercel (uygulama barındırma):</b> uygulamanın sunulması; hizmet sağlayıcının altyapısı Türkiye dışındadır.</li>
          <li><b>Netgsm (SMS gönderim sağlayıcısı):</b> işlemsel ve izinli SMS iletilerinin iletilmesi (telefon numarası ve ileti metni).</li>
          <li><b>OpenAI (yapay zekâ asistanı):</b> yapay zekâ özellikleri kullanıldığında, istem metni gönderilmeden önce telefon, T.C. kimlik no, e-posta, IBAN ve kart bilgileri maskelenir; Türkiye dışındaki (ABD) sunucularda işlenir.</li>
        </ul>
        <p>
          <b>Yurt dışına aktarım:</b> Yukarıdaki sağlayıcılardan Vercel ve OpenAI ile bazı hâllerde diğerlerinin
          alt hizmet sağlayıcıları, verilerin Türkiye dışında işlenmesine yol açabilir. Bu aktarımlar KVKK m.9 ve
          Kişisel Verileri Koruma Kurulu&apos;nun yurt dışına aktarım düzenlemelerine uygun güvencelerle (açık rıza,
          standart sözleşme veya yeterli koruma kararı) yapılır; ayrıntılı bilgi için bize başvurabilirsiniz.
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
