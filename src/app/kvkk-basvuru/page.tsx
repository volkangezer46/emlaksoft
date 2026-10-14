import type { Metadata } from "next";
import { buildMetadata } from "@/lib/seo/store";
import { getSupportContact } from "@/lib/contact-info-server";
import { getSetting } from "@/lib/settings/read";
import { KVKK_SETTING_KEYS } from "@/lib/settings/registry/kvkk";
import { LegalPage, LegalSection } from "@/components/legal-page";
import { KvkkApplicationForm } from "./application-form";

/** Form ayarı ve destek iletişimi ayar defterinden: değişiklik en geç 5 dk'da yansır. */
export const revalidate = 300;

export async function generateMetadata(): Promise<Metadata> {
  return buildMetadata("/kvkk-basvuru");
}

/**
 * KVKK BAŞVURU FORMU (DG6): veri sahibinin KVKK m.11 haklarını kullanması için çevrim içi başvuru kanalı. Başvuru e-posta
 * doğrulama koduyla tamamlanır, EmlakSoft'un KVKK kuyruğuna düşer ve en geç 30 gün içinde sonuçlandırılır. Form ayarla
 * kapatılabilir (o durumda destek e-postası gösterilir; e-posta başvuru kanalı her zaman açıktır).
 */
export default async function KvkkBasvuruPage() {
  const [contact, enabled] = await Promise.all([
    getSupportContact(),
    getSetting<boolean>(KVKK_SETTING_KEYS.publicFormEnabled).catch(() => true),
  ]);
  return (
    <LegalPage
      title="KVKK Başvuru Formu"
      intro="6698 sayılı Kişisel Verilerin Korunması Kanunu'nun 11. maddesindeki haklarınızı kullanmak için bu formla EmlakSoft'a başvurabilirsiniz. Başvurular ücretsizdir ve en geç 30 gün içinde sonuçlandırılır."
      updated="14 Ekim 2026"
    >
      <LegalSection no="1." title="Başvuru nasıl işler?">
        <ol className="list-decimal space-y-1.5 pl-5">
          <li>Formu doldurun; e-posta adresinize 6 haneli doğrulama kodu gönderilir (30 dakika geçerli).</li>
          <li>Kodu girdiğinizde başvurunuz alınır ve size bir başvuru numarası verilir. Yasal 30 günlük süre bu anda başlar.</li>
          <li>Verilerinizi paylaşmadan ya da silmeden önce kimliğinizi teyit etmek için sizinle iletişime geçebiliriz.</li>
          <li>Sonuç, başvuruda yazdığınız e-posta adresine gönderilir.</li>
        </ol>
        <p>
          Bir emlak ofisinin sizinle ilgili tuttuğu müşteri kayıtları bakımından veri sorumlusu ilgili ofistir; EmlakSoft bu kayıtları ofis adına
          işler. Bu formla yapılan başvuruda o kayıtlar da taranır ve sonuç size bildirilir. Doğrulanmayan başvurular 7 gün içinde silinir.
        </p>
      </LegalSection>

      <LegalSection no="2." title="Başvuru">
        {enabled ? (
          <KvkkApplicationForm />
        ) : (
          <p>
            Çevrim içi başvuru formu şu an kapalı. Başvurunuzu{" "}
            <a className="font-semibold text-brand-600" href={contact.mailto}>
              {contact.email}
            </a>{" "}
            adresine iletebilirsiniz; başvurular en geç 30 gün içinde ücretsiz sonuçlandırılır.
          </p>
        )}
      </LegalSection>
    </LegalPage>
  );
}
