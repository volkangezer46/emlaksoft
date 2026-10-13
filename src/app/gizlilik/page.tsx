import { SUPPORT_EMAIL, SUPPORT_MAILTO } from "@/lib/contact-info";
import type { Metadata } from "next";
import { buildMetadata } from "@/lib/seo/store";
import Link from "next/link";
import { LegalPage, LegalSection } from "@/components/legal-page";

/**
 * Eklenti 0.6.0 form öğrenmesi eki (mağaza gizlilik metni "privacy C"). Metin `docs/runbooks/ILAN_KONTROL_EKLENTI_YAYIN.md` §5'te
 * BİREBİR aynıdır (sözleşme testi kilitler); değiştirirken iki yeri birlikte güncelleyin.
 */
const EXTENSION_LEARNING_TITLE = "Form eşleştirmesini iyileştirme (0.6.0, isteğe bağlı):";
const EXTENSION_LEARNING_TEXT =
  "Yalnız eklenti penceresinde açıkça izin verirseniz (varsayılan kapalı), eklenti doldurduğu portal formunun yapısını EmlakSoft'a gönderir: alana bağlı etiket, alan türü, portalın kendi seçenek metinleri, zorunlu işareti, alanın doldurulup doldurulmadığı ve yayından önce değiştirip değiştirmediğiniz (değişmedi, biçimi değişti, yeniden yazıldı, boşaltıldı ya da seçtiğiniz portal seçeneği). Alanlara yazılan değerler (başlık, açıklama, fiyat, adres), telefon, e-posta, ad soyad ve iletişim alanları hiçbir zaman gönderilmez; rakam dizisi, e-posta ya da bağlantı içeren etiket ve seçenekler eklentide ve sunucuda ayrıca ayıklanır. Bu bilgi yalnız portal formlarının doğru doldurulması için ve ofisler arasında toplu olarak kullanılır; iyileştirilen eşleştirme kuralları eklentiye EmlakSoft imzalı veri olarak döner, uzaktan kod indirilmez. Platform yöneticisi istediğinde, en az iki ofiste görülen ve henüz eşleşmeyen alan etiketleri ile seçenekleri (kullanıcı değeri olmadan, kişisel veri maskelenerek) eşleştirme önerisi üretmek için alt işleyenimiz OpenAI'ye iletilir. İzni eklenti penceresinden istediğiniz an geri alabilirsiniz; geri aldığınızda gönderilmeyi bekleyen kayıtlar tarayıcınızdan silinir. Sunucudaki alan gözlemleri en çok 180 gün, form raporları en çok 90 gün saklanır.";

export async function generateMetadata(): Promise<Metadata> {
  return buildMetadata("/gizlilik");
}

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

      <LegalSection no="5." title="EmlakSoft İlan Kontrol Tarayıcı Eklentisi">
        <p>
          Eklenti yalnız EmlakSoft hesabına bağlanan ofis kullanıcıları içindir ve yalnız aşağıdaki dört iş için veri işler:
        </p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            <b>İlan kontrolü:</b> Ofisinizin EmlakSoft&apos;taki portföy ilanlarının bağlantıları, sahibinden, Hepsiemlak ve
            Emlakjet sayfalarında sizin tarayıcınızda, düşük hızla açılır; ilanın yayında olup olmadığı, fiyatı ve başlığı
            okunup yalnız ofisinizin EmlakSoft hesabına gönderilir.
          </li>
          <li>
            <b>Sahibinden ilan kaydı:</b> Yalnız siz eklenti düğmesine bastığınızda, yalnız açık sekmedeki ilanın başlığı,
            fiyatı, metrekaresi, konumu ve ilanda görünen ilan sahibi adı okunur; size gösterilir, siz onaylayınca
            kaydedilir. Telefon numarası yalnız ilanda zaten görünüyorsa ve onay kutusunu işaretlerseniz eklenir; eklenti
            &quot;numarayı göster&quot; düğmesine basmaz.
          </li>
          <li>
            <b>Portala aktarma:</b> Yalnız siz EmlakSoft&apos;ta &quot;Portala aktar&quot; dediğinizde, portföyünüzün
            bilgileri ve fotoğrafları yalnız sizin açtığınız portal sekmesindeki forma yazılır. Eklenti portala hiçbir şey
            göndermez; &quot;Yayınla&quot; düğmesine siz basarsınız. Yayınlanan ilanın numarası ve bağlantısı EmlakSoft&apos;a
            geri yazılır. Fotoğraflar yalnız tarayıcı oturumunuzun belleğinde tutulur ve tarayıcıyı kapatınca silinir.
          </li>
          <li>
            <b>Portaldan ilan alma:</b> Yalnız siz portalın &quot;İlanlarım&quot; sayfasındayken eklenti düğmesine
            bastığınızda, görünen ilanların başlığı, fiyatı, oda sayısı, metrekaresi, konumu ve ilan numarası okunur; siz
            seçtiklerinizi EmlakSoft&apos;a taslak portföy olarak alırsınız. Telefon numarası ve kişi adı alınmaz.
          </li>
        </ul>
        <p>
          <b>{EXTENSION_LEARNING_TITLE}</b> {EXTENSION_LEARNING_TEXT}
        </p>
        <p>
          Eklenti tarama geçmişinizi, diğer sitelerdeki gezinmenizi, şifrelerinizi veya ödeme bilgilerinizi okumaz ve
          toplamaz. Tarayıcıda yalnız ayarlarınız, EmlakSoft bağlantı anahtarı, imzalı form kuralları ve bekleyen işler
          kuyruğu saklanır. Veriler yalnız EmlakSoft sunucularına (TLS ile) gönderilir; satılmaz, reklam için kullanılmaz
          ve yukarıda belirtilen alt işleyen dışında üçüncü taraflarla paylaşılmaz. Portföye dönüşmeyen sahibinden ilan kayıtlarındaki kişisel bilgiler ofisin belirlediği süre
          (varsayılan 90 gün) sonunda silinir; &quot;aranmasın&quot; listesinde yalnız telefon numarasının takma adlı özeti
          tutulur. Eklentiyi Chrome&apos;dan kaldırmanız veya EmlakSoft&apos;taki bağlantıyı kesmeniz veri akışını durdurur.
        </p>
      </LegalSection>

      <LegalSection no="6." title="İletişim">
        <p>
          Gizlilikle ilgili sorularınız için:{" "}
          <a className="font-semibold text-brand-600" href={SUPPORT_MAILTO}>{SUPPORT_EMAIL}</a>
        </p>
      </LegalSection>
    </LegalPage>
  );
}
