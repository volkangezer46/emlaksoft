import Link from "@/components/ui/smart-link";
import { ArrowLeft, ArrowUpRight, Columns3 } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { requireModulePage } from "@/lib/require-module-page";
import { hasOfficeWideDataScope } from "@/lib/permission-data-scope";
import { createClient } from "@/lib/supabase/server";
import { now, trDayKey } from "@/lib/clock";
import { formatDateTr } from "@/lib/format";
import { daysUntilOfferExpiry } from "@/lib/offer-expiry";
import {
  OFFER_BADGE_LABELS,
  OFFER_PAYMENT_LABELS,
  compareOfferBadges,
  pctOfList,
  readOfferTerms,
  type OfferTerms,
} from "@/lib/offer-terms";

export const metadata = { title: "Teklif karşılaştırma" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COMPARED_STATUSES = ["submitted", "countered", "accepted"] as const;

const STATUS_LABELS: Record<string, string> = { submitted: "Sunuldu", countered: "Karşı teklif", accepted: "Kabul edildi" };
const STATUS_STYLE: Record<string, string> = {
  accepted: "bg-mint-50 text-mint-700 ring-mint-600/20",
  submitted: "bg-brand-50 text-brand-700 ring-brand-600/20",
  countered: "bg-amber-50 text-amber-700 ring-amber-600/20",
};

const money = (n: number | null) =>
  n == null ? "—" : new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 }).format(n);
const dayLabel = (iso: string | null) =>
  iso ? formatDateTr(iso, { day: "numeric", month: "long", year: "numeric" }) : null;

type Row = {
  id: string;
  amount: number;
  counter_amount: number | null;
  status: string;
  valid_until: string | null;
  created_by: string | null;
  customer: { id: string; full_name: string } | null;
  terms: OfferTerms;
};

/**
 * Yan yana teklif karşılaştırma (SP2): bir portföyün değerlendirmedeki ve kabul edilmiş teklifleri. Masaüstünde sütunlar,
 * mobilde yatay kaydırmalı kartlar (snap). Rozetler olgusaldır (en yüksek tutar/kapora, en erken tapu, kredi şartı yok);
 * puan uydurulmaz. Her kart teklif detayına gider.
 */
export default async function OfferComparePage({ searchParams }: { searchParams?: Promise<{ portfoy?: string }> }) {
  const [{ role, userId, tenantId }, sp] = await Promise.all([requireModulePage("offers", "/app/teklifler"), searchParams]);
  const propertyId = sp?.portfoy && UUID_RE.test(sp.portfoy) ? sp.portfoy : null;

  const back = (
    <Link href="/app/teklifler" className="inline-flex items-center gap-1.5 text-sm font-semibold text-text-muted transition hover:text-brand-600">
      <ArrowLeft className="h-4 w-4" /> Teklifler
    </Link>
  );
  if (!propertyId) {
    return (
      <div className="space-y-6">
        {back}
        <EmptyState
          variant="full"
          icon={Columns3}
          title="Karşılaştırılacak portföy seçilmedi"
          description="Bir teklifin detayındaki “teklifi karşılaştır” bağlantısıyla, aynı portföyün tekliflerini yan yana görürsünüz."
        />
      </div>
    );
  }

  const supabase = await createClient();
  let offersQuery = supabase
    .from("offers")
    .select("id, amount, counter_amount, status, valid_until, created_by, customer:customers!offers_customer_id_fkey(id, full_name)")
    .eq("property_id", propertyId)
    .eq("tenant_id", tenantId ?? "")
    .in("status", [...COMPARED_STATUSES])
    .order("amount", { ascending: false })
    .limit(12);
  // Ofis geneli kapsamı olmayan roller yalnız kendi tekliflerini karşılaştırır (detay sayfasıyla aynı kural).
  if (!hasOfficeWideDataScope(role)) offersQuery = offersQuery.eq("created_by", userId);

  const [propRes, offersRes, termsRes] = await Promise.all([
    supabase.from("properties").select("id, title, property_code, list_price").eq("id", propertyId).maybeSingle(),
    offersQuery,
    // SP2 koşulları ayrı okunur: sütunlar yoksa (migration bekliyor) karşılaştırma tutar/geçerlilikle sürer.
    supabase
      .from("offers")
      .select("id, payment_method, deposit_amount, proposed_deed_date, credit_contingency, swap_note")
      .eq("property_id", propertyId)
      .eq("tenant_id", tenantId ?? "")
      .in("status", [...COMPARED_STATUSES])
      .limit(50),
  ]);
  const property = propRes.data as { id: string; title: string | null; property_code: string; list_price: number | null } | null;
  const termsById = new Map<string, OfferTerms>(
    termsRes.error ? [] : ((termsRes.data ?? []) as Record<string, unknown>[]).map((r) => [String(r.id), readOfferTerms(r)]),
  );
  const rows: Row[] = ((offersRes.data ?? []) as unknown as (Omit<Row, "terms" | "customer"> & {
    customer: Row["customer"] | Row["customer"][];
  })[]).map((r) => ({
    ...r,
    amount: Number(r.amount),
    counter_amount: r.counter_amount != null ? Number(r.counter_amount) : null,
    customer: Array.isArray(r.customer) ? (r.customer[0] ?? null) : r.customer,
    terms: termsById.get(r.id) ?? readOfferTerms(null),
  }));

  const listPrice = property?.list_price != null ? Number(property.list_price) : null;
  const badges = compareOfferBadges(
    rows.filter((r) => r.status !== "accepted").map((r) => ({ id: r.id, amount: r.amount, status: r.status, valid_until: r.valid_until, terms: r.terms })),
  );
  const todayKey = trDayKey(now());

  return (
    <div className="space-y-6">
      {back}
      <PageHeader
        eyebrow="Teklif karşılaştırma"
        title={property ? (property.title ?? property.property_code) : "Portföy"}
        description={
          property ? (
            <span>
              {property.property_code} · Liste fiyatı <span className="font-semibold text-ink-950">{money(listPrice)}</span> · {rows.length} teklif
            </span>
          ) : undefined
        }
      />

      {rows.length === 0 ? (
        <EmptyState
          variant="full"
          icon={Columns3}
          title="Bu portföyde değerlendirmede teklif yok"
          description="Sunulan, karşı teklif verilen ve kabul edilen teklifler burada yan yana görünür."
        />
      ) : (
        <>
          {rows.length > 1 ? (
            <p className="text-xs text-text-muted lg:hidden">Teklifler arasında yana kaydırın.</p>
          ) : null}
          <ol
            aria-label="Teklifler yan yana"
            className="-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0 lg:grid lg:snap-none lg:grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] lg:overflow-visible"
          >
            {rows.map((r) => {
              const pct = pctOfList(r.amount, listPrice);
              const left = r.status === "accepted" ? null : daysUntilOfferExpiry(r.valid_until, todayKey);
              const rowBadges = badges.get(r.id) ?? [];
              const t = r.terms;
              return (
                <li key={r.id} className="w-[85%] shrink-0 snap-start sm:w-80 lg:w-auto">
                  <article className="flex h-full flex-col rounded-[var(--radius-panel)] border border-line bg-surface p-4 shadow-[var(--shadow-xs)]">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="numeric font-display text-xl font-extrabold text-ink-950">{money(r.amount)}</p>
                        {pct != null ? (
                          <p className={`text-xs font-semibold ${pct < 0 ? "text-amber-700" : "text-mint-700"}`}>
                            İlan fiyatına göre {pct > 0 ? "+" : ""}
                            {new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 1 }).format(pct)}%
                          </p>
                        ) : null}
                      </div>
                      <span className={`shrink-0 rounded-md px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${STATUS_STYLE[r.status] ?? ""}`}>
                        {STATUS_LABELS[r.status] ?? r.status}
                      </span>
                    </div>
                    {rowBadges.length > 0 ? (
                      <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Öne çıkan">
                        {rowBadges.map((b) => (
                          <li key={b} className="rounded-full bg-mint-500/12 px-2 py-0.5 text-xs font-bold text-mint-700">
                            {OFFER_BADGE_LABELS[b]}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    <dl className="mt-3 flex-1 divide-y divide-line text-sm">
                      {[
                        ["Müşteri", r.customer?.full_name ?? "—"],
                        ["Karşı teklif", r.counter_amount != null ? money(r.counter_amount) : "—"],
                        ["Ödeme şekli", t.payment_method ? OFFER_PAYMENT_LABELS[t.payment_method] : "Belirtilmedi"],
                        ["Kapora", t.deposit_amount != null ? money(t.deposit_amount) : "Belirtilmedi"],
                        ["Tapu tarihi", dayLabel(t.proposed_deed_date) ?? "Belirtilmedi"],
                        ["Kredi şartı", t.credit_contingency ? "Kredi onayına bağlı" : t.payment_method ? "Yok" : "—"],
                        [
                          "Geçerlilik",
                          left == null
                            ? (dayLabel(r.valid_until) ?? (r.status === "accepted" ? "—" : "Süresiz"))
                            : left < 0
                              ? "Süresi doldu"
                              : left === 0
                                ? "Bugün bitiyor"
                                : `${left} gün (${dayLabel(r.valid_until)})`,
                        ],
                      ].map(([label, value]) => (
                        <div key={label} className="flex items-baseline justify-between gap-3 py-1.5">
                          <dt className="text-xs text-text-muted">{label}</dt>
                          <dd className="min-w-0 truncate text-right font-medium text-ink-950">{value}</dd>
                        </div>
                      ))}
                    </dl>
                    {t.swap_note ? <p className="mt-2 line-clamp-3 text-xs text-text-muted">Takas: {t.swap_note}</p> : null}
                    <Link
                      href={`/app/teklifler/${r.id}`}
                      className="focus-ring press mt-3 inline-flex min-h-11 items-center justify-center gap-1.5 rounded-[var(--radius-control)] border border-line text-sm font-semibold text-brand-700 transition hover:border-brand-300"
                    >
                      Teklifi aç <ArrowUpRight className="h-4 w-4" aria-hidden />
                    </Link>
                  </article>
                </li>
              );
            })}
          </ol>
          <p className="text-xs text-text-faint">
            Etiketler yalnız girilen koşulları karşılaştırır; bir teklifi “daha iyi” ilan etmez. Karar malik ve danışmanındır.
          </p>
        </>
      )}
    </div>
  );
}
