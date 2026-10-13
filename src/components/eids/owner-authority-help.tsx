"use client";

import { HelpCircle, MessageSquareText } from "lucide-react";
import Link from "@/components/ui/smart-link";
import { CopyTextButton } from "@/components/app/copy-text-button";
import { Alert } from "@/components/ui/alert";
import { LICENSE_SETTINGS_HREF } from "@/lib/eids/links";
import { PROPERTY_NO_WHERE, buildOwnerAuthorityMessage } from "@/lib/eids/owner-message";

const DETAILS = "rounded-[var(--radius-card)] border border-line bg-surface px-3";
const SUMMARY = "focus-ring flex min-h-11 cursor-pointer items-center gap-2 text-sm font-semibold text-ink-950";

/**
 * Portföy formu (İlan sahibi > Yetki sözleşmesi): "Taşınmaz no nerede?" açılır ipucu ve maliğe gönderilecek hazır EİDS
 * mesajı (e-Devlet yetkilendirme adımları + ofisin yetki belge numarası). Mesaj yalnız kopyalanır; sistem göndermez.
 */
export function OwnerAuthorityHelp({ officeName, licenseNo, ownerName }: { officeName: string; licenseNo: string | null; ownerName?: string | null }) {
  const message = buildOwnerAuthorityMessage({ officeName, licenseNo, ownerName });
  return (
    <div className="space-y-2 sm:col-span-2">
      <details className={DETAILS}>
        <summary className={SUMMARY}>
          <HelpCircle className="h-4 w-4 text-brand-600" aria-hidden /> Taşınmaz no nerede?
        </summary>
        <ul className="list-disc space-y-1 pb-3 pl-5 text-sm text-text-muted">
          {PROPERTY_NO_WHERE.map((t) => (
            <li key={t}>{t}</li>
          ))}
          <li>Taşınmaz no yalnız rakamdır; ada/parsel numarası değildir. Malik e-Devlet&apos;te yetki verirken aynı taşınmazı seçer.</li>
        </ul>
      </details>
      <details className={DETAILS}>
        <summary className={SUMMARY}>
          <MessageSquareText className="h-4 w-4 text-brand-600" aria-hidden /> Maliğe hazır yetki mesajı
        </summary>
        <div className="space-y-2 pb-3">
          {licenseNo?.trim() ? null : (
            <Alert tone="warning" title="Ofisin yetki belgesi no girilmemiş">
              Mesajda numaranın yerine yer tutucu yazar; malik yetkiyi bu numarayla verir. Numarayı{" "}
              <Link href={LICENSE_SETTINGS_HREF} className="font-semibold underline">
                Ayarlar &gt; Marka ve kimlik
              </Link>{" "}
              ekranından girin.
            </Alert>
          )}
          <p className="whitespace-pre-line rounded-[var(--radius-control)] border border-line bg-canvas p-3 text-sm text-text">{message}</p>
          <div className="flex flex-wrap items-center gap-2">
            <CopyTextButton text={message} label="Mesajı kopyala" doneMessage="Mesaj kopyalandı" />
            <span className="text-xs text-text-muted">Mesajı WhatsApp, SMS ya da e-postayla kendiniz gönderin.</span>
          </div>
        </div>
      </details>
    </div>
  );
}
