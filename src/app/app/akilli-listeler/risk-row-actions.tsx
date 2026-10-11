import Link from "@/components/ui/smart-link";
import { AlarmClock, ArrowUpRight, ClipboardPlus, MessageCircle, Phone, PhoneCall } from "lucide-react";
import { toTelHref, toWhatsAppLink } from "@/lib/phone";
import { dismissRiskFromSmartList } from "./actions";

/**
 * "Kaybedilme riski yüksek" satır eylemleri (eski Riskli müşteriler sayfasından taşındı):
 * Ara, WhatsApp, Arandı (30 gün listeden düşer; isteğe bağlı çağrı kaydı), 1 hafta ertele, görev, kart.
 */
export function RiskRowActions({ customerId, name, phone }: { customerId: string; name: string; phone: string | null }) {
  return (
    <div className="flex w-full flex-wrap items-center gap-1.5 sm:w-auto sm:shrink-0">
      {phone ? (
        <>
          <a
            href={toTelHref(phone) ?? "#"}
            aria-label={`${name} ara`}
            title="Ara"
            className="focus-ring grid h-8 w-8 place-items-center rounded-[var(--radius-control)] border border-line text-mint-600 transition hover:bg-mint-500/10 touch:min-h-11 touch:min-w-11"
          >
            <Phone className="h-3.5 w-3.5" />
          </a>
          <a
            href={toWhatsAppLink(phone) ?? "#"}
            target="_blank"
            rel="noreferrer"
            aria-label={`${name} WhatsApp`}
            title="WhatsApp"
            className="focus-ring grid h-8 w-8 place-items-center rounded-[var(--radius-control)] border border-line text-mint-600 transition hover:bg-mint-500/10 touch:min-h-11 touch:min-w-11"
          >
            <MessageCircle className="h-3.5 w-3.5" />
          </a>
        </>
      ) : null}
      {/* Arandı: 30 gün listeden düşer. Kutu işaretliyse çağrı kaydı da atılır (müşteri zaman tüneline düşer). */}
      <form action={dismissRiskFromSmartList} className="flex items-center gap-1.5">
        <input type="hidden" name="customer_id" value={customerId} />
        <input type="hidden" name="reason" value="called" />
        {phone ? (
          <>
            <input type="hidden" name="phone" value={phone} />
            <label
              className="flex cursor-pointer items-center gap-1 text-xs text-text-muted"
              title="İşaretliyse görüşme, çağrı geçmişine ve müşteri zaman tüneline de yazılır"
            >
              <input type="checkbox" name="log_call" value="1" defaultChecked className="h-3.5 w-3.5 rounded border-line accent-brand-600" />
              Çağrı olarak da kaydet
            </label>
          </>
        ) : null}
        <button
          type="submit"
          className="focus-ring press inline-flex items-center gap-1 rounded-[var(--radius-control)] border border-line bg-surface px-2.5 py-1.5 text-xs font-semibold text-mint-600 transition hover:bg-mint-500/10 touch:min-h-11"
          title="Arandı olarak işaretle (30 gün listeden düşer)"
        >
          <PhoneCall className="h-3.5 w-3.5" /> Arandı
        </button>
      </form>
      <form action={dismissRiskFromSmartList}>
        <input type="hidden" name="customer_id" value={customerId} />
        <input type="hidden" name="reason" value="snoozed" />
        <button
          type="submit"
          className="focus-ring press inline-flex items-center gap-1 rounded-[var(--radius-control)] border border-line bg-surface px-2.5 py-1.5 text-xs font-semibold text-amber-600 transition hover:bg-amber-50 touch:min-h-11"
          title="1 hafta sonra tekrar hatırlat"
        >
          <AlarmClock className="h-3.5 w-3.5" /> 1 hafta ertele
        </button>
      </form>
      <Link
        href="/app/gorevler/yeni"
        className="focus-ring press inline-flex items-center gap-1 rounded-[var(--radius-control)] border border-line bg-surface px-2.5 py-1.5 text-xs font-semibold text-text-muted transition hover:bg-canvas hover:text-ink-950 touch:min-h-11"
        title="Takip görevi oluştur"
      >
        <ClipboardPlus className="h-3.5 w-3.5" /> Görev
      </Link>
      <Link
        href={`/app/musteriler/${customerId}`}
        className="focus-ring inline-flex items-center gap-1 rounded-[var(--radius-control)] border border-line px-2.5 py-1.5 text-xs font-semibold text-text-muted transition hover:border-brand-300 hover:text-brand-600 touch:min-h-11"
      >
        Kart <ArrowUpRight className="h-3.5 w-3.5" />
      </Link>
    </div>
  );
}
