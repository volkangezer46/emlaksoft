import { ArrowRight, BookOpen } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import Link from "@/components/ui/smart-link";
import { EidsForwardingGuide } from "@/components/eids/forwarding-guide";
import { EidsLegalNote } from "@/components/eids/legal-note";
import { EIDS_CALL_CENTER, EIDS_SENDER_ADDRESS } from "@/lib/eids/legal-text";
import { EIDS_HELP_HREF, LICENSE_SETTINGS_HREF } from "@/lib/eids/links";
import type { LegalValues } from "@/lib/legal-constants";

/**
 * İlan Kontrol > Yetki: kılavuzun kısa hali (kapalı başlar; kuyruk önde kalır). Bakanlık e-postasının ne olduğu, nereye
 * geldiği (DOĞRULANMADI etiketiyle), EmlakSoft'a iletme adımları (sağlayıcı sekmeleri) ve iptal/ceza notu. Tam metin
 * Yardım > Rehberler'de (`eids-bakanlik-epostalari`). `address` verilirse adımlar ofisin gerçek alma adresiyle dolar.
 */
export function EidsAuthorityGuidePanel({
  address = null,
  licenseMissing = false,
  legalValues = null,
}: {
  address?: string | null;
  licenseMissing?: boolean;
  /** O gün yürürlükteki mevzuat değerleri (sarmalayıcı `getEffectiveLegalValues()` okur). */
  legalValues?: LegalValues | null;
}) {
  return (
    <details className="group rounded-[var(--radius-card)] border border-line bg-surface px-4 shadow-[var(--shadow-xs)]">
      <summary className="focus-ring flex min-h-11 cursor-pointer items-center gap-2 py-2 text-sm font-semibold text-ink-950">
        <BookOpen className="h-4 w-4 text-brand-600" aria-hidden />
        Bakanlık (EİDS) e-postaları kılavuzu
        <span className="ml-auto text-xs font-normal text-text-muted group-open:hidden">Aç</span>
      </summary>
      <div className="space-y-4 pb-4 pt-1">
        <p className="text-sm text-text-muted">
          Malik e-Devlet&apos;te ofisinize yetki verince ya da iptal edince Bakanlık {EIDS_SENDER_ADDRESS} adresinden e-posta
          gönderebilir. E-posta her işlemde gelmeyebilir; yetki durumunu portföy ekranından ayrıca teyit edin.
        </p>
        <p className="text-sm text-text-muted">
          <span className="font-semibold text-ink-950">E-posta hangi adrese gelir?</span> Büyük olasılıkla MERSİS (şirket, şahıs tacir) ya da
          ESBİS (esnaf) kaydındaki işletme e-postasına.{" "}
          <Badge variant="warning" size="sm">
            Doğrulanmadı
          </Badge>{" "}
          Teyit için{" "}
          {EIDS_CALL_CENTER}.
        </p>
        {licenseMissing ? (
          <p className="text-sm text-text-muted">
            Ofisinizin yetki belgesi numarası girilmemiş; malikler yetkiyi bu numarayla verir.{" "}
            <Link href={LICENSE_SETTINGS_HREF} className="font-semibold text-brand-600 hover:underline">
              Numarayı girin
            </Link>
            .
          </p>
        ) : null}
        <EidsForwardingGuide address={address} />
        <EidsLegalNote values={legalValues} />
        <ButtonLink href={EIDS_HELP_HREF} variant="secondary" iconRight={ArrowRight}>
          Kılavuzun tamamı
        </ButtonLink>
      </div>
    </details>
  );
}
