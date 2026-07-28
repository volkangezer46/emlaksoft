import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  ArrowUpRight,
  Building2,
  Calendar,
  CheckCircle2,
  Clock,
  FileSignature,
  Handshake,
  History,
  Mail,
  MessageCircle,
  Phone,
  Tag,
  User,
} from "lucide-react";
import { requireModulePage } from "@/lib/require-module-page";
import { getOffer, listOfferRounds, type OfferRound } from "@/app/actions/offers";
import { createClient } from "@/lib/supabase/server";
import { formatTurkishPhone, toTelHref, toWhatsAppLink } from "@/lib/phone";
import { ButtonLink } from "@/components/ui/button";
import { OfferStatusActions } from "./offer-status-actions";
import { OfferEditDialog } from "./offer-edit-dialog";
import { OfferRoundDialog } from "./offer-round-dialog";
import { ConvertToDealButton } from "./convert-to-deal-button";

const STATUS_LABELS: Record<string, string> = {
  draft: "Taslak",
  submitted: "Sunuldu",
  countered: "Karşı teklif",
  accepted: "Kabul edildi",
  rejected: "Reddedildi",
  withdrawn: "Geri çekildi",
};

/** Anlaşma aşama etiketleri — deal-board ile aynı. */
const DEAL_STAGE_LABELS: Record<string, string> = {
  new: "Yeni",
  qualified: "Nitelikli",
  negotiation: "Müzakere",
  won: "Kazanıldı",
  lost: "Kaybedildi",
};

const STATUS_STYLE: Record<string, string> = {
  accepted: "bg-mint-50 text-mint-700 ring-mint-600/20",
  rejected: "bg-red-50 text-red-700 ring-red-600/20",
  submitted: "bg-brand-50 text-brand-700 ring-brand-600/20",
  countered: "bg-amber-50 text-amber-700 ring-amber-600/20",
  draft: "bg-zinc-100 text-zinc-600 ring-zinc-500/10",
  withdrawn: "bg-zinc-50 text-zinc-500 ring-zinc-400/10",
};

function money(n: number | null) {
  if (!n) return "—";
  return new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 }).format(n);
}

/** İşaretli fark: +₺50.000 / −₺50.000 — money()'nin 0/null koruması olmadan. */
function diffMoney(n: number) {
  const abs = new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 }).format(Math.abs(n));
  return `${n > 0 ? "+" : n < 0 ? "−" : "±"}${abs}`;
}

const SIDE_LABELS: Record<string, string> = { buyer: "Alıcı", seller: "Satıcı" };

const SIDE_STYLE: Record<string, string> = {
  buyer: "bg-brand-50 text-brand-700 ring-brand-600/20",
  seller: "bg-amber-50 text-amber-700 ring-amber-600/20",
};

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

  const rounds = await listOfferRounds(id);

  const property = one(offer.property) as
    | { id: string; property_code: string; title: string | null; list_price: number | null; transaction_type: string | null; property_type: string | null }
    | null;
  const customer = one(offer.customer) as { id: string; full_name: string; phone: string | null; email: string | null } | null;

  /*
   * İlgili anlaşma: önce KESİN bağa bakılır (offers.deal_id — dönüştürme
   * akışında atanır; migration 20260726000069). Bağ yoksa eski yaklaşık
   * eşleştirme: aynı portföy + müşteri ikilisine bağlı en güncel anlaşma.
   */
  const supabase = await createClient();
  let relatedDeal: { id: string; stage: string } | null = null;
  let exactLink = false;
  // deal_id kolonu henüz yoksa sorgu hata döner → yok sayıp yaklaşık eşleşmeye düş
  const { data: linkRow } = await supabase
    .from("offers")
    .select("deal_id")
    .eq("id", offer.id)
    .maybeSingle();
  const linkedDealId = (linkRow as { deal_id?: string | null } | null)?.deal_id ?? null;
  if (linkedDealId) {
    const { data: linkedDeal } = await supabase
      .from("deals")
      .select("id, stage")
      .eq("id", linkedDealId)
      .maybeSingle();
    if (linkedDeal) {
      relatedDeal = linkedDeal as { id: string; stage: string };
      exactLink = true;
    }
  }
  if (!relatedDeal && offer.property_id && offer.customer_id) {
    const { data: dealRows } = await supabase
      .from("deals")
      .select("id, stage")
      .eq("property_id", offer.property_id)
      .eq("customer_id", offer.customer_id)
      .order("created_at", { ascending: false })
      .limit(1);
    relatedDeal = (dealRows?.[0] as { id: string; stage: string } | undefined) ?? null;
  }

  const listPrice = property?.list_price ?? null;
  const offerAmount = Number(offer.amount) || 0;
  const diffPct = listPrice ? Math.round(((offerAmount - listPrice) / listPrice) * 100) : null;
  const isClosed = ["accepted", "rejected", "withdrawn"].includes(offer.status);

  /*
   * Pazarlık zaman çizelgesi: offer_rounds kayıtları esas. Eski (tur kaydı
   * olmayan) tekliflerde veri kaybı / yanlış izlenim olmasın diye amount +
   * counter_amount ikilisinden SENTETİK görünüm üretilir ve etiketlenir.
   */
  const syntheticRounds = rounds.length === 0;
  const timelineRounds: OfferRound[] = syntheticRounds
    ? [
        ...(offerAmount > 0
          ? [{
              id: "synthetic-buyer",
              round_no: 1,
              side: "buyer" as const,
              amount: offerAmount,
              note: null,
              created_at: offer.submitted_at ?? offer.created_at,
            }]
          : []),
        ...(offer.counter_amount
          ? [{
              id: "synthetic-seller",
              round_no: 2,
              side: "seller" as const,
              amount: Number(offer.counter_amount),
              note: null,
              created_at: offer.responded_at ?? offer.updated_at,
            }]
          : []),
      ]
    : rounds;

  const lastRound = timelineRounds[timelineRounds.length - 1] ?? null;
  const lastAmount = lastRound ? Number(lastRound.amount) : null;
  const lastVsListDiff = listPrice && lastAmount !== null ? lastAmount - listPrice : null;
  const lastVsListPct =
    listPrice && lastVsListDiff !== null ? Math.round((lastVsListDiff / listPrice) * 1000) / 10 : null;

  const telHref = toTelHref(customer?.phone);
  const waHref = toWhatsAppLink(customer?.phone);
  // Sözleşme ön dolgusu: sozlesmeler sayfasındaki yeni sözleşme diyaloğu
  // ?customer= & ?property= paramlarını okuyup kayda bağlar.
  const contractParams = new URLSearchParams();
  if (offer.customer_id) contractParams.set("customer", offer.customer_id);
  if (offer.property_id) contractParams.set("property", offer.property_id);
  const contractQs = contractParams.toString();
  const contractHref = contractQs ? `/app/sozlesmeler?${contractQs}` : "/app/sozlesmeler";

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
              <p className="text-[11px] text-white/70">Liste fiyatı</p>
            </div>
            <div className="rounded-[14px] border border-white/12 bg-white/8 p-3 text-center">
              <p className="font-display text-lg font-extrabold text-white">{offer.counter_amount ? money(Number(offer.counter_amount)) : "—"}</p>
              <p className="text-[11px] text-white/70">Karşı teklif</p>
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
              /* Örtü link müşteri detayına; telefon/WhatsApp/e-posta z-10 ile
                 üstte kalır — iç içe <a> üretmemek için Link sarmalı bırakıldı. */
              <div className="group relative flex flex-wrap items-center justify-between gap-3 rounded-[12px] border border-line bg-canvas px-4 py-3 transition hover:border-brand-400 hover:bg-brand-600/[0.03]">
                <Link
                  href={`/app/musteriler/${customer.id}`}
                  className="focus-ring absolute inset-0 rounded-[12px]"
                  aria-label={`${customer.full_name} müşteri detayı`}
                />
                <p className="font-semibold text-ink-950 group-hover:text-brand-600">{customer.full_name}</p>
                <div className="relative z-10 flex flex-wrap items-center gap-3 text-xs text-text-muted">
                  {telHref ? (
                    <a href={telHref} className="focus-ring flex items-center gap-1 rounded-[6px] font-semibold transition hover:text-brand-600">
                      <Phone className="h-3.5 w-3.5" /> {formatTurkishPhone(customer.phone)}
                    </a>
                  ) : null}
                  {waHref ? (
                    <a
                      href={waHref}
                      target="_blank"
                      rel="noreferrer"
                      className="focus-ring flex items-center gap-1 rounded-[6px] font-semibold text-mint-600 transition hover:underline"
                    >
                      <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
                    </a>
                  ) : null}
                  {customer.email ? (
                    <a href={`mailto:${customer.email}`} className="focus-ring flex items-center gap-1 rounded-[6px] transition hover:text-brand-600">
                      <Mail className="h-3.5 w-3.5" /> {customer.email}
                    </a>
                  ) : null}
                </div>
              </div>
            ) : (
              <p className="text-sm text-text-muted">Müşteri bilgisi yok.</p>
            )}
          </section>

          {/* Pazarlık geçmişi */}
          <section className="rounded-[18px] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="flex items-center gap-2 text-sm font-bold text-ink-950">
                <History className="h-4 w-4 text-brand-600" /> Pazarlık geçmişi
              </h2>
              {canEdit && !isClosed ? <OfferRoundDialog offerId={offer.id} /> : null}
            </div>

            {/* Özet: liste fiyatı vs son teklif */}
            <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-1.5 rounded-[12px] border border-line bg-canvas px-4 py-3 text-sm">
              <span className="text-text-muted">
                Liste fiyatı: <span className="font-semibold text-ink-950">{money(listPrice)}</span>
              </span>
              <span className="text-text-muted">
                Son teklif: <span className="font-semibold text-ink-950">{money(lastAmount)}</span>
              </span>
              {lastVsListDiff !== null ? (
                <span className={`font-semibold ${lastVsListDiff < 0 ? "text-mint-600" : lastVsListDiff > 0 ? "text-amber-600" : "text-text-muted"}`}>
                  Fark: {diffMoney(lastVsListDiff)} ({lastVsListPct !== null && lastVsListPct > 0 ? "+" : ""}{lastVsListPct}%)
                </span>
              ) : null}
            </div>

            {syntheticRounds && timelineRounds.length > 0 ? (
              <p className="mb-3 text-xs text-text-faint">
                Kayıtlı tur yok — mevcut teklif değerlerinden görünüm.
              </p>
            ) : null}

            {timelineRounds.length === 0 ? (
              <p className="text-sm text-text-muted">Henüz pazarlık turu kaydı yok.</p>
            ) : (
              <ol className="relative space-y-4 border-l border-line pl-5">
                {timelineRounds.map((round, i) => {
                  const prev = i > 0 ? Number(timelineRounds[i - 1].amount) : null;
                  const cur = Number(round.amount);
                  const roundDiff = prev !== null ? cur - prev : null;
                  const roundPct =
                    prev !== null && prev > 0 ? Math.round(((cur - prev) / prev) * 1000) / 10 : null;
                  return (
                    <li key={round.id} className="relative">
                      <span
                        className={`absolute -left-[26px] top-1.5 h-2.5 w-2.5 rounded-full ${round.side === "buyer" ? "bg-brand-600" : "bg-amber-500"}`}
                        aria-hidden
                      />
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${SIDE_STYLE[round.side]}`}>
                          {SIDE_LABELS[round.side]}
                        </span>
                        <span className="font-semibold text-ink-950">{money(cur)}</span>
                        {roundDiff !== null ? (
                          <span className={`text-xs font-semibold ${roundDiff < 0 ? "text-mint-600" : roundDiff > 0 ? "text-amber-600" : "text-text-muted"}`}>
                            {diffMoney(roundDiff)}
                            {roundPct !== null ? ` (${roundPct > 0 ? "+" : ""}${roundPct}%)` : ""}
                          </span>
                        ) : null}
                      </div>
                      {round.note ? (
                        <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-ink-800">{round.note}</p>
                      ) : null}
                      <p className="mt-0.5 text-xs text-text-muted">
                        Tur {round.round_no} · {dateTime(round.created_at)}
                      </p>
                    </li>
                  );
                })}
              </ol>
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
          {offer.status === "accepted" ? (
            <section className="rounded-[18px] border border-mint-500/30 bg-mint-500/[0.06] p-5">
              <h2 className="flex items-center gap-2 text-sm font-bold text-mint-700">
                <FileSignature className="h-4 w-4" /> Sonraki adım
              </h2>
              <p className="mt-1 text-xs text-text-muted">
                Teklif kabul edildi — anlaşmayı pipeline&apos;a taşıyın, sözleşme taslağını başlatın.
              </p>
              {canEdit && !exactLink ? (
                <div className="mt-3">
                  <ConvertToDealButton offerId={offer.id} />
                </div>
              ) : null}
              <ButtonLink href={contractHref} size="sm" variant="secondary" className="mt-3 w-full">
                Sözleşme taslağı oluştur
              </ButtonLink>
            </section>
          ) : null}

          {relatedDeal ? (
            <section className="rounded-[18px] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-ink-950">
                <Handshake className="h-4 w-4 text-brand-600" /> İlgili anlaşma
              </h2>
              <Link
                href={`/app/anlasmalar/${relatedDeal.id}`}
                className="focus-ring group flex items-center justify-between gap-3 rounded-[12px] border border-line bg-canvas px-4 py-3 transition hover:border-brand-400"
              >
                <span className="text-sm font-semibold text-ink-950 group-hover:text-brand-600">
                  Anlaşma detayını aç
                </span>
                <span className="flex shrink-0 items-center gap-1.5 text-xs text-text-muted">
                  {DEAL_STAGE_LABELS[relatedDeal.stage] ?? relatedDeal.stage}
                  <ArrowUpRight className="h-3.5 w-3.5" />
                </span>
              </Link>
              <p className="mt-2 text-[11px] text-text-faint">
                {exactLink
                  ? "Bu teklif anlaşmaya doğrudan bağlı."
                  : "Aynı portföy + müşteri ikilisine bağlı anlaşma."}
              </p>
            </section>
          ) : null}

          <section className="rounded-[18px] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
            <h2 className="mb-3 text-sm font-bold text-ink-950">Zaman çizelgesi</h2>
            <ul className="space-y-3 text-sm">
              <li className="flex items-start gap-2.5">
                <Clock className="mt-0.5 h-4 w-4 text-brand-600" />
                <div><p className="font-medium text-ink-950">Oluşturuldu</p><p className="text-xs text-text-muted">{dateTime(offer.created_at)}</p></div>
              </li>
              {offer.submitted_at ? (
                <li className="flex items-start gap-2.5">
                  <Tag className="mt-0.5 h-4 w-4 text-brand-600" />
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
