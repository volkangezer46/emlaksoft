import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  Building2,
  Calendar,
  CheckCircle2,
  Clock,
  Mail,
  Phone,
  Tag,
  User,
} from "lucide-react";
import { requireModulePage } from "@/lib/require-module-page";
import { getOffer } from "@/app/actions/offers";
import { formatTurkishPhone } from "@/lib/phone";
import { OfferStatusActions } from "./offer-status-actions";
import { OfferEditDialog } from "./offer-edit-dialog";

const STATUS_LABELS: Record<string, string> = {
  draft: "Taslak",
  submitted: "Sunuldu",
  countered: "Karşı teklif",
  accepted: "Kabul edildi",
  rejected: "Reddedildi",
  withdrawn: "Geri çekildi",
};

const STATUS_STYLE: Record<string, string> = {
  accepted: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  rejected: "bg-red-50 text-red-700 ring-red-600/20",
  submitted: "bg-blue-50 text-blue-700 ring-blue-600/20",
  countered: "bg-amber-50 text-amber-700 ring-amber-600/20",
  draft: "bg-zinc-100 text-zinc-600 ring-zinc-500/10",
  withdrawn: "bg-zinc-50 text-zinc-500 ring-zinc-400/10",
};

function money(n: number | null) {
  if (!n) return "—";
  return new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 }).format(n);
}

function dateTime(iso: string | null) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("tr-TR", { day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

function one<T>(v: T | T[] | null): T | null {
  if (!v) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

export default async function OfferDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { perms } = await requireModulePage("offers");
  const canEdit = (perms.offers ?? perms.commissions ?? []).includes("edit");
  const { id } = await params;

  const offer = await getOffer(id);
  if (!offer) notFound();

  const property = one(offer.property) as
    | { id: string; property_code: string; title: string | null; list_price: number | null; transaction_type: string | null; property_type: string | null }
    | null;
  const customer = one(offer.customer) as { id: string; full_name: string; phone: string | null; email: string | null } | null;

  const listPrice = property?.list_price ?? null;
  const offerAmount = Number(offer.amount) || 0;
  const diffPct = listPrice ? Math.round(((offerAmount - listPrice) / listPrice) * 100) : null;

  return (
    <div className="space-y-6">
      <Link href="/app/teklifler" className="inline-flex items-center gap-1.5 text-sm font-semibold text-text-muted transition hover:text-brand-600">
        <ArrowLeft className="h-4 w-4" /> Teklifler
      </Link>

      {/* Hero */}
      <section className="theme-dark relative overflow-hidden rounded-[22px] bg-[image:var(--grad-ink)] p-6 text-white">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-30" />
        <div className="pointer-events-none absolute -right-14 -top-16 h-56 w-56 rounded-full bg-brand-600/30 blur-[70px]" />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div>
            <span className="flex items-center gap-2 text-xs font-semibold text-brand-300">
              <Tag className="h-4 w-4" /> Teklif detayı
            </span>
            <h1 className="mt-2 font-display text-3xl font-extrabold text-white md:text-4xl">{money(offerAmount)}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <span className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${STATUS_STYLE[offer.status] ?? STATUS_STYLE.draft}`}>
                {STATUS_LABELS[offer.status] ?? offer.status}
              </span>
              {diffPct !== null ? (
                <span className={`text-sm font-semibold ${diffPct < 0 ? "text-mint-300" : diffPct > 0 ? "text-amber-300" : "text-white/70"}`}>
                  Liste fiyatına göre {diffPct > 0 ? "+" : ""}{diffPct}%
                </span>
              ) : null}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-[14px] border border-white/12 bg-white/8 p-3 text-center">
              <p className="font-display text-lg font-extrabold text-white">{money(listPrice)}</p>
              <p className="text-[10px] text-white/70">Liste fiyatı</p>
            </div>
            <div className="rounded-[14px] border border-white/12 bg-white/8 p-3 text-center">
              <p className="font-display text-lg font-extrabold text-white">{offer.counter_amount ? money(Number(offer.counter_amount)) : "—"}</p>
              <p className="text-[10px] text-white/70">Karşı teklif</p>
            </div>
          </div>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Sol: ilişkili kayıtlar + detaylar */}
        <div className="space-y-6 lg:col-span-2">
          {/* İlişkili portföy */}
          <section className="rounded-[18px] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-ink-950"><Building2 className="h-4 w-4 text-brand-600" /> Portföy</h2>
            {property ? (
              <Link href={`/app/portfoyler/${property.id}`} className="group flex items-center justify-between rounded-[12px] border border-line bg-canvas px-4 py-3 transition hover:border-brand-400 hover:bg-brand-600/[0.03]">
                <div>
                  <p className="font-semibold text-ink-950 group-hover:text-brand-600">{property.title ?? property.property_code}</p>
                  <p className="mt-0.5 text-xs text-text-muted">{property.property_code} · {property.property_type ?? "—"} · {property.transaction_type ?? "—"}</p>
                </div>
                <span className="text-sm font-semibold text-brand-600">{money(property.list_price)}</span>
              </Link>
            ) : (
              <p className="text-sm text-text-muted">Portföy bilgisi yok.</p>
            )}
          </section>

          {/* İlişkili müşteri */}
          <section className="rounded-[18px] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-ink-950"><User className="h-4 w-4 text-brand-600" /> Müşteri</h2>
            {customer ? (
              <Link href={`/app/musteriler/${customer.id}`} className="group flex flex-wrap items-center justify-between gap-3 rounded-[12px] border border-line bg-canvas px-4 py-3 transition hover:border-brand-400 hover:bg-brand-600/[0.03]">
                <p className="font-semibold text-ink-950 group-hover:text-brand-600">{customer.full_name}</p>
                <div className="flex flex-wrap items-center gap-3 text-xs text-text-muted">
                  {customer.phone ? <span className="flex items-center gap-1"><Phone className="h-3.5 w-3.5" /> {formatTurkishPhone(customer.phone)}</span> : null}
                  {customer.email ? <span className="flex items-center gap-1"><Mail className="h-3.5 w-3.5" /> {customer.email}</span> : null}
                </div>
              </Link>
            ) : (
              <p className="text-sm text-text-muted">Müşteri bilgisi yok.</p>
            )}
          </section>

          {/* Not */}
          {offer.notes ? (
            <section className="rounded-[18px] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
              <h2 className="mb-2 text-sm font-bold text-ink-950">Not</h2>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-800">{offer.notes}</p>
            </section>
          ) : null}
        </div>

        {/* Sağ: zaman çizelgesi + aksiyonlar */}
        <div className="space-y-6">
          <section className="rounded-[18px] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
            <h2 className="mb-3 text-sm font-bold text-ink-950">Zaman çizelgesi</h2>
            <ul className="space-y-3 text-sm">
              <li className="flex items-start gap-2.5">
                <Clock className="mt-0.5 h-4 w-4 text-brand-600" />
                <div><p className="font-medium text-ink-950">Oluşturuldu</p><p className="text-xs text-text-muted">{dateTime(offer.created_at)}</p></div>
              </li>
              {offer.submitted_at ? (
                <li className="flex items-start gap-2.5">
                  <Tag className="mt-0.5 h-4 w-4 text-blue-600" />
                  <div><p className="font-medium text-ink-950">Sunuldu</p><p className="text-xs text-text-muted">{dateTime(offer.submitted_at)}</p></div>
                </li>
              ) : null}
              {offer.responded_at ? (
                <li className="flex items-start gap-2.5">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 text-mint-600" />
                  <div><p className="font-medium text-ink-950">Yanıtlandı</p><p className="text-xs text-text-muted">{dateTime(offer.responded_at)}</p></div>
                </li>
              ) : null}
              {offer.valid_until ? (
                <li className="flex items-start gap-2.5">
                  <Calendar className="mt-0.5 h-4 w-4 text-amber-500" />
                  <div><p className="font-medium text-ink-950">Geçerlilik</p><p className="text-xs text-text-muted">{dateTime(offer.valid_until)}</p></div>
                </li>
              ) : null}
            </ul>
          </section>

          {canEdit ? (
            <section className="rounded-[18px] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
              <h2 className="mb-3 text-sm font-bold text-ink-950">İşlemler</h2>
              <OfferStatusActions offerId={offer.id} status={offer.status} />
              {!["accepted", "rejected", "withdrawn"].includes(offer.status) ? (
                <div className="mt-3 border-t border-line pt-3">
                  <OfferEditDialog offer={{ id: offer.id, amount: offerAmount, valid_until: offer.valid_until, notes: offer.notes }} />
                </div>
              ) : null}
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}
