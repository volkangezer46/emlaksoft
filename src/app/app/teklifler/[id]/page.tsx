import { PageHeader } from "@/components/ui/page-header";
import Link from "@/components/ui/smart-link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  ArrowLeftRight,
  ArrowUpRight,
  Banknote,
  Building2,
  Columns3,
  KeyRound,
  FileSignature,
  Handshake,
  History,
  Mail,
  MessageCircle,
  Phone,
  User,
} from "lucide-react";
import { requireModulePage } from "@/lib/require-module-page";
import { getStageLabels } from "@/lib/definitions";
import { stageLabelMap } from "@/lib/deal-stage-labels";
import { getOffer, listOfferRounds, type OfferRound } from "@/app/actions/offers";
import { createClient } from "@/lib/supabase/server";
import { formatTurkishPhone, toTelHref, toWhatsAppLink } from "@/lib/phone";
import { ButtonLink } from "@/components/ui/button";
import { OfferStatusActions } from "./offer-status-actions";
import { OfferEditDialog } from "./offer-edit-dialog";
import { OfferRoundDialog } from "./offer-round-dialog";
import { ConvertToDealButton } from "./convert-to-deal-button";
import { ActivityTimeline } from "@/components/ui/activity-timeline";
import { now, trDayKey } from "@/lib/clock";
import { daysUntilOfferExpiry } from "@/lib/offer-expiry";
import { buildOfferEvents } from "./offer-events";
import { MobileActionBar } from "@/components/ui/mobile-action-bar";
import { formatDateTr } from "@/lib/format";
import { DealContractCta, dealContractHref } from "@/app/app/sozlesmeler/_components/deal-contract-cta";
import { OFFER_PAYMENT_LABELS, hasAnyOfferTerm } from "@/lib/offer-terms";

export const metadata = { title: "Teklif" };

const STATUS_LABELS: Record<string, string> = {
  draft: "Taslak",
  submitted: "Sunuldu",
  countered: "Karşı teklif",
  accepted: "Kabul edildi",
  rejected: "Reddedildi",
  withdrawn: "Geri çekildi",
};


const STATUS_STYLE: Record<string, string> = {
  accepted: "bg-mint-50 text-mint-700 ring-mint-600/20",
  rejected: "bg-danger-50 text-danger-700 ring-danger-600/20",
  submitted: "bg-brand-50 text-brand-700 ring-brand-600/20",
  countered: "bg-amber-50 text-amber-700 ring-amber-600/20",
  draft: "bg-surface-sunken text-text-muted ring-line",
  withdrawn: "bg-surface-sunken text-text-muted ring-line",
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

const CONTRACT_STATUS_LABELS: Record<string, string> = { draft: "Taslak", sent: "İmzada", signed: "İmzalandı", rejected: "Reddedildi", cancelled: "İptal" };

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
  const { perms } = await requireModulePage("offers", "/app/teklifler");
  const canEdit = (perms.offers ?? perms.commissions ?? []).includes("edit");
  const { id } = await params;
  const supabase = await createClient();

  // Hepsi yalnız `id`'ye bağlı → tek turda (önceden 4 sıralı tur). deal_id kolonu henüz yoksa sorgu hata döner → yok sayılır.
  const [stageLabels, offer, rounds, { data: linkRow }, contractsRes] = await Promise.all([
    getStageLabels(),
    getOffer(id),
    listOfferRounds(id),
    supabase.from("offers").select("deal_id").eq("id", id).maybeSingle(),
    // SP3: bu tekliften hazırlanan sözleşmeler (contracts.offer_id yoksa hata → liste çizilmez).
    (perms.contracts ?? []).includes("view")
      ? supabase.from("contracts").select("id, title, status").eq("offer_id", id).order("created_at", { ascending: false }).limit(10)
      : Promise.resolve({ data: null, error: null }),
  ]);
  const stageNames = stageLabelMap(stageLabels);
  if (!offer) notFound();

  const property = one(offer.property) as
    | { id: string; property_code: string; title: string | null; list_price: number | null; transaction_type: string | null; property_type: string | null }
    | null;
  const customer = one(offer.customer) as { id: string; full_name: string; phone: string | null; email: string | null } | null;

  /*
   * İlgili anlaşma: önce KESİN bağa bakılır (offers.deal_id — dönüştürme
   * akışında atanır; migration 20260726000069). Bağ yoksa eski yaklaşık
   * eşleştirme: aynı portföy + müşteri ikilisine bağlı en güncel anlaşma.
   */
  let relatedDeal: { id: string; stage: string } | null = null;
  let exactLink = false;
  const linkedDealId = (linkRow as { deal_id?: string | null } | null)?.deal_id ?? null;
  // Kesin bağ + yaklaşık eşleşme AYNI turda (yedek sorgu yalnız kesin bağ yoksa/bulunamazsa kullanılır).
  const [{ data: linkedDeal }, { data: dealRows }, openOffersRes] = await Promise.all([
    linkedDealId
      ? supabase.from("deals").select("id, stage").eq("id", linkedDealId).maybeSingle()
      : Promise.resolve({ data: null }),
    offer.property_id && offer.customer_id
      ? supabase
          .from("deals")
          .select("id, stage")
          .eq("property_id", offer.property_id)
          .eq("customer_id", offer.customer_id)
          .order("created_at", { ascending: false })
          .limit(1)
      : Promise.resolve({ data: null }),
    // Aynı portföyde değerlendirmedeki teklif sayısı (yan yana karşılaştırma bağlantısı ≥2 iken).
    supabase
      .from("offers")
      .select("id", { count: "exact", head: true })
      .eq("property_id", offer.property_id)
      .in("status", ["submitted", "countered"]),
  ]);
  const openOfferCount = openOffersRes.error ? 0 : (openOffersRes.count ?? 0);
  const linkedContracts = (contractsRes.error ? [] : ((contractsRes.data ?? []) as { id: string; title: string; status: string }[]));
  if (linkedDeal) {
    relatedDeal = linkedDeal as { id: string; stage: string };
    exactLink = true;
  } else {
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

  const todayKey = trDayKey(now());
  const timelineEvents = buildOfferEvents({
    offer: {
      id: offer.id,
      status: offer.status,
      created_at: offer.created_at,
      submitted_at: offer.submitted_at ?? null,
      responded_at: offer.responded_at ?? null,
      valid_until: offer.valid_until ?? null,
    },
    rounds,
    statusLabel: STATUS_LABELS[offer.status] ?? offer.status,
    money,
    todayKey,
    deal: relatedDeal ? { id: relatedDeal.id, stageLabel: stageNames[relatedDeal.stage] ?? relatedDeal.stage } : null,
  });
  const expiryLeft = isClosed ? null : daysUntilOfferExpiry(offer.valid_until, todayKey);

  const telHref = toTelHref(customer?.phone);
  const waHref = toWhatsAppLink(customer?.phone);
  const canCreateContract = (perms.contracts ?? []).includes("create");
  const canCreateRental = (perms.rentals ?? []).includes("create");
  const isRentalOffer = /kiral/i.test(property?.transaction_type ?? "");
  const exactDealId = exactLink && relatedDeal ? relatedDeal.id : null;
  // Kiralık kabul: kira kaydı formu portföy + kiracı + aylık kira ile dolu açılır (SP4).
  const rentalQs = new URLSearchParams();
  if (offer.property_id) rentalQs.set("portfoy", offer.property_id);
  if (offer.customer_id) rentalQs.set("musteri", offer.customer_id);
  rentalQs.set("tutar", String(Math.round(Number(offer.counter_amount ?? offer.amount) || 0)));
  if (exactDealId) rentalQs.set("anlasma", exactDealId);
  const rentalHref = `/app/kiralama/yeni?${rentalQs.toString()}`;

  const terms = offer.terms;
  const ownerCounter = offer.ownerCounter;
  const lastRoundAt = rounds.length > 0 ? rounds[rounds.length - 1].created_at : null;
  // Malik karşı teklifi, ondan SONRA tur eklenmediyse "değerlendirme bekliyor" sayılır.
  const ownerCounterPending = Boolean(ownerCounter && !isClosed && (!lastRoundAt || lastRoundAt < ownerCounter.at));

  const nba: { title: string; label: string; href: string | null } = ownerCounterPending
    ? { title: "Malik karşı teklif önerdi", label: "İncele", href: "#pazarlik" }
    : offer.status === "accepted"
      ? canCreateContract
        ? { title: "Kapora sözleşmesini hazırlayın", label: "Hazırla", href: dealContractHref({ dealId: exactDealId, offerId: offer.id, kind: "kapora" }) }
        : { title: "Teklif kabul edildi", label: "Sonraki adım", href: "#sonraki-adim" }
      : isClosed
        ? { title: `Teklif ${STATUS_LABELS[offer.status]?.toLocaleLowerCase("tr-TR") ?? "kapandı"}`, label: "", href: null }
        : expiryLeft != null && expiryLeft <= 2
          ? { title: expiryLeft < 0 ? "Geçerlilik süresi doldu" : "Geçerlilik bitiyor", label: "İşlemler", href: "#islemler" }
          : { title: "Pazarlığı sürdürün", label: "Tur ekle", href: "#pazarlik" };

  return (
    <div className="space-y-6">
      <Link href="/app/teklifler" className="inline-flex items-center gap-1.5 text-sm font-semibold text-text-muted transition hover:text-brand-600">
        <ArrowLeft className="h-4 w-4" /> Teklifler
      </Link>

      {/* Hero */}
      <PageHeader
        eyebrow="Teklif detayı"
        title={money(offerAmount)}
        meta={
          <span className="inline-flex flex-wrap items-center gap-2">
            <span className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${STATUS_STYLE[offer.status] ?? STATUS_STYLE.draft}`}>
              {STATUS_LABELS[offer.status] ?? offer.status}
            </span>
            {expiryLeft != null && expiryLeft <= 2 ? (
              <span className={`inline-flex items-center rounded-md px-2.5 py-1 text-xs font-semibold ${expiryLeft < 0 ? "bg-danger-500/10 text-danger-600" : "bg-amber-400/15 text-amber-700"}`}>
                {expiryLeft < 0 ? "Geçerlilik süresi doldu" : expiryLeft === 0 ? "Geçerlilik bugün bitiyor" : `Geçerliliğe ${expiryLeft} gün`}
              </span>
            ) : null}
          </span>
        }
        description={
          diffPct !== null ? (
            <span className={`font-semibold ${diffPct < 0 ? "text-mint-700" : diffPct > 0 ? "text-amber-700" : "text-text-muted"}`}>
              Liste fiyatına göre {diffPct > 0 ? "+" : ""}{diffPct}%
            </span>
          ) : undefined
        }
      />
      <div className="mb-6 grid max-w-md grid-cols-2 gap-3">
        <div className="rounded-[var(--radius-card)] border border-line bg-surface p-3 shadow-[var(--shadow-xs)]">
          <p className="numeric font-display text-lg font-extrabold text-text">{money(listPrice)}</p>
          <p className="text-xs text-text-muted">Liste fiyatı</p>
        </div>
        <div className="rounded-[var(--radius-card)] border border-line bg-surface p-3 shadow-[var(--shadow-xs)]">
          <p className="numeric font-display text-lg font-extrabold text-text">{offer.counter_amount ? money(Number(offer.counter_amount)) : "—"}</p>
          <p className="text-xs text-text-muted">Karşı teklif</p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Sol: ilişkili kayıtlar + detaylar */}
        <div className="space-y-6 lg:col-span-2">
          {/* İlişkili portföy */}
          <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-ink-950"><Building2 className="h-4 w-4 text-brand-600" /> Portföy</h2>
            {property ? (
              <Link href={`/app/portfoyler/${property.id}`} className="group flex items-center justify-between rounded-[var(--radius-card)] border border-line bg-canvas px-4 py-3 transition hover:border-brand-400 hover:bg-brand-600/[0.03]">
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
          <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-ink-950"><User className="h-4 w-4 text-brand-600" /> Müşteri</h2>
            {customer ? (
              /* Örtü link müşteri detayına; telefon/WhatsApp/e-posta z-10 ile
                 üstte kalır — iç içe <a> üretmemek için Link sarmalı bırakıldı. */
              <div className="group relative flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-card)] border border-line bg-canvas px-4 py-3 transition hover:border-brand-400 hover:bg-brand-600/[0.03]">
                <Link
                  href={`/app/musteriler/${customer.id}`}
                  className="focus-ring absolute inset-0 rounded-[var(--radius-card)]"
                  aria-label={`${customer.full_name} müşteri detayı`}
                />
                <p className="font-semibold text-ink-950 group-hover:text-brand-600">{customer.full_name}</p>
                <div className="relative z-10 flex flex-wrap items-center gap-3 text-xs text-text-muted">
                  {telHref ? (
                    <a href={telHref} className="focus-ring flex items-center gap-1 rounded-[var(--radius-control)] font-semibold transition hover:text-brand-600">
                      <Phone className="h-3.5 w-3.5" /> {formatTurkishPhone(customer.phone)}
                    </a>
                  ) : null}
                  {waHref ? (
                    <a
                      href={waHref}
                      target="_blank"
                      rel="noreferrer"
                      className="focus-ring flex items-center gap-1 rounded-[var(--radius-control)] font-semibold text-mint-600 transition hover:underline"
                    >
                      <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
                    </a>
                  ) : null}
                  {customer.email ? (
                    <a href={`mailto:${customer.email}`} className="focus-ring flex items-center gap-1 rounded-[var(--radius-control)] transition hover:text-brand-600">
                      <Mail className="h-3.5 w-3.5" /> {customer.email}
                    </a>
                  ) : null}
                </div>
              </div>
            ) : (
              <p className="text-sm text-text-muted">Müşteri bilgisi yok.</p>
            )}
          </section>

          {/* Ödeme ve tapu koşulları (SP2) */}
          {offer.termsAvailable ? (
            <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 className="flex items-center gap-2 text-sm font-bold text-ink-950">
                  <Banknote className="h-4 w-4 text-brand-600" /> Ödeme ve tapu koşulları
                </h2>
                {openOfferCount >= 2 ? (
                  <Link
                    href={`/app/teklifler/karsilastir?portfoy=${offer.property_id}`}
                    className="focus-ring press inline-flex min-h-11 items-center gap-1.5 rounded-[var(--radius-control)] border border-line px-3 text-xs font-semibold text-brand-700 transition hover:border-brand-300 sm:min-h-9"
                  >
                    <Columns3 className="h-3.5 w-3.5" aria-hidden /> {openOfferCount} teklifi karşılaştır
                  </Link>
                ) : null}
              </div>
              {hasAnyOfferTerm(terms) ? (
                <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                  <div className="flex justify-between gap-3 sm:block">
                    <dt className="text-xs text-text-muted">Ödeme şekli</dt>
                    <dd className="font-semibold text-ink-950">{terms.payment_method ? OFFER_PAYMENT_LABELS[terms.payment_method] : "Belirtilmedi"}</dd>
                  </div>
                  <div className="flex justify-between gap-3 sm:block">
                    <dt className="text-xs text-text-muted">Kapora</dt>
                    <dd className="numeric font-semibold text-ink-950">{terms.deposit_amount != null ? money(terms.deposit_amount) : "Belirtilmedi"}</dd>
                  </div>
                  <div className="flex justify-between gap-3 sm:block">
                    <dt className="text-xs text-text-muted">Önerilen tapu tarihi</dt>
                    <dd className="font-semibold text-ink-950">
                      {terms.proposed_deed_date
                        ? formatDateTr(terms.proposed_deed_date, { day: "numeric", month: "long", year: "numeric" })
                        : "Belirtilmedi"}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3 sm:block">
                    <dt className="text-xs text-text-muted">Kredi şartı</dt>
                    <dd className={`font-semibold ${terms.credit_contingency ? "text-amber-700" : "text-ink-950"}`}>
                      {terms.credit_contingency ? "Kredi onayına bağlı" : "Yok"}
                    </dd>
                  </div>
                  {terms.swap_note ? (
                    <div className="sm:col-span-2">
                      <dt className="text-xs text-text-muted">Takas</dt>
                      <dd className="whitespace-pre-wrap text-ink-800">{terms.swap_note}</dd>
                    </div>
                  ) : null}
                </dl>
              ) : (
                <p className="text-sm text-text-muted">
                  Ödeme şekli, kapora ve tapu tarihi girilmemiş.{canEdit && !isClosed ? " “Teklifi düzenle” > Ödeme ve tapu sekmesinden ekleyebilirsiniz." : ""}
                </p>
              )}
            </section>
          ) : null}

          {/* Pazarlık geçmişi */}
          <section id="pazarlik" className="scroll-mt-20 rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="flex items-center gap-2 text-sm font-bold text-ink-950">
                <History className="h-4 w-4 text-brand-600" /> Pazarlık geçmişi
              </h2>
              {canEdit && !isClosed ? <OfferRoundDialog offerId={offer.id} /> : null}
            </div>

            {ownerCounter && ownerCounterPending ? (
              <div className="mb-4 rounded-[var(--radius-card)] border border-amber-400/45 bg-amber-400/[0.08] p-4">
                <p className="flex items-center gap-2 text-sm font-bold text-amber-800">
                  <ArrowLeftRight className="h-4 w-4" aria-hidden /> Malik portalından karşı teklif: {money(ownerCounter.amount)}
                </p>
                {ownerCounter.note ? <p className="mt-1 whitespace-pre-wrap text-sm text-ink-800">“{ownerCounter.note}”</p> : null}
                <p className="mt-1 text-xs text-text-muted">
                  {dateTime(ownerCounter.at)} · Alıcıya otomatik iletilmedi. Uygunsa satıcı turu olarak ekleyip alıcıya sunun.
                </p>
                {canEdit ? (
                  <div className="mt-3">
                    <OfferRoundDialog
                      offerId={offer.id}
                      defaultSide="seller"
                      defaultAmount={ownerCounter.amount}
                      defaultNote={ownerCounter.note ? `Malik karşı teklifi: ${ownerCounter.note}` : "Malik karşı teklifi (portal)"}
                      triggerLabel="Satıcı turu olarak ekle"
                      triggerClassName="focus-ring press inline-flex min-h-11 items-center gap-1.5 rounded-[var(--radius-control)] bg-amber-500 px-4 text-sm font-semibold text-white transition hover:bg-amber-600"
                    />
                  </div>
                ) : null}
              </div>
            ) : null}

            {/* Özet: liste fiyatı vs son teklif */}
            <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-1.5 rounded-[var(--radius-card)] border border-line bg-canvas px-4 py-3 text-sm">
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
                        <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${SIDE_STYLE[round.side]}`}>
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
            <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
              <h2 className="mb-2 text-sm font-bold text-ink-950">Not</h2>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-800">{offer.notes}</p>
            </section>
          ) : null}
        </div>

        {/* Sağ: zaman çizelgesi + aksiyonlar */}
        <div className="space-y-6">
          {offer.status === "accepted" ? (
            <section id="sonraki-adim" className="scroll-mt-20 rounded-[var(--radius-panel)] border border-mint-500/30 bg-mint-500/[0.06] p-5">
              <h2 className="flex items-center gap-2 text-sm font-bold text-mint-700">
                <FileSignature className="h-4 w-4" /> Sonraki adım
              </h2>
              <p className="mt-1 text-xs text-text-muted">
                Teklif kabul edildi — anlaşmayı pipeline&apos;a taşıyın; {isRentalOffer ? "kira kaydını açın ve " : ""}sözleşmeyi teklif bilgileriyle dolu başlatın.
              </p>
              {canEdit && !exactLink ? (
                <div className="mt-3">
                  <ConvertToDealButton offerId={offer.id} />
                </div>
              ) : null}
              {isRentalOffer && canCreateRental ? (
                <ButtonLink href={rentalHref} size="sm" variant="secondary" icon={KeyRound} className="mt-3 min-h-11 w-full sm:min-h-0">
                  Kira kaydı oluştur
                </ButtonLink>
              ) : null}
              {canCreateContract ? <DealContractCta dealId={exactDealId} offerId={offer.id} className="mt-3 grid gap-2" /> : null}
              {linkedContracts.length > 0 ? (
                <ul className="mt-3 space-y-1.5 border-t border-mint-500/20 pt-3">
                  {linkedContracts.map((c) => (
                    <li key={c.id}>
                      <Link
                        href={`/app/sozlesmeler/${c.id}`}
                        className="focus-ring flex min-h-11 items-center justify-between gap-2 rounded-[var(--radius-control)] text-sm font-semibold text-ink-950 hover:text-brand-600 sm:min-h-0"
                      >
                        <span className="truncate">{c.title}</span>
                        <span className="shrink-0 text-xs font-medium text-text-muted">{CONTRACT_STATUS_LABELS[c.status] ?? c.status}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          ) : null}

          {relatedDeal ? (
            <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-ink-950">
                <Handshake className="h-4 w-4 text-brand-600" /> İlgili anlaşma
              </h2>
              <Link
                href={`/app/anlasmalar/${relatedDeal.id}`}
                className="focus-ring group flex items-center justify-between gap-3 rounded-[var(--radius-card)] border border-line bg-canvas px-4 py-3 transition hover:border-brand-400"
              >
                <span className="text-sm font-semibold text-ink-950 group-hover:text-brand-600">
                  Anlaşma detayını aç
                </span>
                <span className="flex shrink-0 items-center gap-1.5 text-xs text-text-muted">
                  {stageNames[relatedDeal.stage] ?? relatedDeal.stage}
                  <ArrowUpRight className="h-3.5 w-3.5" />
                </span>
              </Link>
              <p className="mt-2 text-xs text-text-faint">
                {exactLink
                  ? "Bu teklif anlaşmaya doğrudan bağlı."
                  : "Aynı portföy + müşteri ikilisine bağlı anlaşma."}
              </p>
            </section>
          ) : null}

          <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
            <h2 className="mb-3 text-sm font-bold text-ink-950">Zaman çizelgesi</h2>
            <ActivityTimeline
              events={timelineEvents}
              emptyTitle="Henüz olay yok."
              emptyHint="Sunum, pazarlık turları ve yanıt oluştukça burada listelenir."
            />
          </section>

          {canEdit ? (
            <section id="islemler" className="scroll-mt-20 rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
              <h2 className="mb-3 text-sm font-bold text-ink-950">İşlemler</h2>
              <OfferStatusActions offerId={offer.id} status={offer.status} />
              {!["accepted", "rejected", "withdrawn"].includes(offer.status) ? (
                <div className="mt-3 border-t border-line pt-3">
                  <OfferEditDialog
                    offer={{
                      id: offer.id,
                      amount: offerAmount,
                      valid_until: offer.valid_until,
                      notes: offer.notes,
                      owner_visible_note: offer.owner_visible_note,
                      terms: offer.termsAvailable ? offer.terms : null,
                    }}
                  />
                </div>
              ) : null}
            </section>
          ) : null}
        </div>
      </div>

      <MobileActionBar primary={nba} phone={customer?.phone} contactName={customer?.full_name} />
    </div>
  );
}
