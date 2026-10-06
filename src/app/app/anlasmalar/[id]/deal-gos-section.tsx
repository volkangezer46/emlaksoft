import Link from "next/link";
import { Landmark } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { isMissingDealGosColumn } from "@/lib/deal-gos";
import { GOS_NO_MONEY_NOTE, gosStatusLabel } from "@/lib/gos-info";
import { now, toTrLocalInput, trDayKey } from "@/lib/clock";
import { DealGosForm } from "./deal-gos-form";

/**
 * Satış anlaşmasında GÖS referans no + tapu randevu tarihi (20261007000300). Kolon yoksa bölüm "etkin değil" der.
 * Para/IBAN alanı YOK: ürün ödeme almaz, tutmaz, aktarmaz.
 */
export async function DealGosSection({ dealId, canEdit }: { dealId: string; canEdit: boolean }) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("deals")
    .select("gos_reference_no, title_deed_appointment_at")
    .eq("id", dealId)
    .maybeSingle();
  const missing = isMissingDealGosColumn(error);
  const status = gosStatusLabel(trDayKey(now()));
  const ref = (data?.gos_reference_no as string | null | undefined) ?? "";
  const at = (data?.title_deed_appointment_at as string | null | undefined) ?? null;

  return (
    <section className="surface-card rounded-[var(--radius-panel)] p-5" aria-labelledby="deal-gos-baslik">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="deal-gos-baslik" className="flex items-center gap-2 font-display font-bold text-ink-950">
          <Landmark className="h-4 w-4 text-brand-600" aria-hidden /> Güvenli Ödeme Sistemi ve tapu randevusu
        </h2>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${status.active ? "bg-danger-500/10 text-danger-600" : "bg-amber-400/15 text-amber-700"}`}>
          {status.label}
        </span>
      </div>
      <p className="mt-1 text-xs text-text-muted">
        Bankanın verdiği GÖS işlem referansını ve tapu randevu tarihini kaydedin; kapanış listesindeki GÖS adımlarıyla birlikte takip edilir.{" "}
        <Link href="/app/uyum#gos" className="font-semibold text-brand-600 hover:underline">
          GÖS bilgi kartı
        </Link>
      </p>
      {missing ? (
        <p className="mt-3 rounded-[var(--radius-card)] border border-dashed border-line-strong px-4 py-3 text-sm text-text-muted">
          Bu alanlar henüz etkin değil (veritabanı güncellemesi bekleniyor).
        </p>
      ) : (
        <DealGosForm dealId={dealId} canEdit={canEdit} referenceNo={ref} titleDeedLocal={at ? toTrLocalInput(at) : ""} />
      )}
      <p className="mt-3 text-xs text-text-faint">{GOS_NO_MONEY_NOTE}</p>
    </section>
  );
}
