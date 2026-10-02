import Link from "next/link";
import { daysAgoIso, daysFromNowIso } from "@/lib/clock";
import { notFound } from "next/navigation";
import { ArrowLeft, Banknote, Building2, CalendarClock, StickyNote, TrendingUp, User, Wrench } from "lucide-react";
import { ContactActions, DetailTabs, NextActionCard, resolveTab, type DetailTabDef } from "@/components/app/detail-tabs";
import { EmptyStateV3 } from "@/components/ui/empty-state-v3";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { DepositReturnControl } from "./deposit-return";
import { Badge } from "@/components/ui/badge";
import { ChargesPanel } from "./charges-panel";
import { MaintenancePanel } from "./maintenance-panel";
import { EndRentalButton } from "./end-rental-button";

import { PageHeader } from "@/components/ui/page-header";
export const metadata = { title: "Kira detayı" };

function money(n: number) {
  return new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 }).format(n);
}
function dateLabel(iso: string) {
  return new Intl.DateTimeFormat("tr-TR", { dateStyle: "long" }).format(new Date(`${iso.slice(0, 10)}T00:00:00`));
}

type Rel<T> = T | T[] | null;
function rel<T>(v: Rel<T>): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

const RENTAL_TAB_IDS = ["tahakkuk", "bakim", "notlar"] as const;

export default async function KiraDetayPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { perms } = await requireModulePage("rentals", "/app/kiralama");
  const canCreate = perms.rentals?.includes("create") ?? false;
  const canEdit = perms.rentals?.includes("edit") ?? false;
  const { id } = await params;
  // Seçili sekme sunucuda çözülür; yalnız aktif sekmenin paneli çizilir
  const tab = resolveTab(await searchParams, RENTAL_TAB_IDS, "tahakkuk", { bakım: "bakim" });

  const supabase = await createClient();
  const { data: rental } = await supabase
    .from("rentals")
    .select(
      "id, monthly_rent, due_day, start_date, end_date, deposit, deposit_returned, deposit_returned_at, status, notes, created_at, property:properties!rentals_property_id_fkey(id, property_code, title), renter:customers!rentals_renter_customer_id_fkey(id, full_name, phone), charges:rent_charges!rent_charges_rental_id_fkey(id, period, amount, status, paid_at), maintenance:maintenance_requests!maintenance_requests_rental_id_fkey(id, title, description, status, cost, created_at)",
    )
    .eq("id", id)
    .maybeSingle();

  if (!rental) notFound();

  const prop = rel(rental.property);
  const renter = rel(rental.renter);
  const charges = (Array.isArray(rental.charges) ? rental.charges : [])
    .map((c) => ({ ...c, period: String(c.period).slice(0, 10) }))
    .sort((a, b) => (a.period < b.period ? 1 : -1));
  const maintenance = (Array.isArray(rental.maintenance) ? rental.maintenance : []).sort((a, b) =>
    a.created_at < b.created_at ? 1 : -1,
  );

  const active = rental.status === "active";
  const today = daysAgoIso(0).slice(0, 10);
  const in30 = daysFromNowIso(30).slice(0, 10);
  const endingSoon = active && rental.end_date && rental.end_date >= today && rental.end_date <= in30;
  const ended = rental.end_date && rental.end_date < today;
  const daysToEnd = rental.end_date
    ? Math.ceil((new Date(`${rental.end_date}T00:00:00`).getTime() - new Date(`${today}T00:00:00`).getTime()) / 86_400_000)
    : null;

  const overdueCount = charges.filter((c) => c.status === "overdue").length;
  const pendingCount = charges.filter((c) => c.status === "pending").length;
  const openMaintenance = maintenance.filter((m) => m.status !== "done").length;
  const sekmeHref = (t: string) => `/app/kiralama/${rental.id}?sekme=${t}`;

  /** Sağ sütun — tek "sonraki en iyi eylem". */
  const nba: { title: string; reason: string; href: string | null; label: string } =
    active && ended
      ? { title: "Süresi dolan kaydı sonlandırın", reason: `Bitiş tarihi (${dateLabel(rental.end_date!)}) geçti.`, href: null, label: "" }
      : overdueCount > 0
        ? { title: `${overdueCount} geciken tahakkuk`, reason: "Kiracıyla görüşüp ödemeyi işaretleyin.", href: sekmeHref("tahakkuk"), label: "Tahakkuklara git" }
        : endingSoon
          ? { title: "Kira artışını hesaplayın", reason: `Sözleşme ${daysToEnd === 0 ? "bugün" : `${daysToEnd} gün içinde`} bitiyor.`, href: "/app/kira-artis", label: "Kira artışı" }
          : openMaintenance > 0
            ? { title: `${openMaintenance} açık bakım talebi`, reason: "Bekleyen talepleri takip edin.", href: sekmeHref("bakim"), label: "Bakım taleplerine git" }
            : pendingCount > 0
              ? { title: `${pendingCount} bekleyen tahakkuk`, reason: "Vadesi gelen kiraları tahsil edildi olarak işaretleyin.", href: sekmeHref("tahakkuk"), label: "Tahakkuklara git" }
              : { title: "Her şey yolunda", reason: "Geciken tahakkuk, açık bakım veya yaklaşan bitiş yok.", href: null, label: "" };

  const tabDefs: DetailTabDef[] = [
    { id: "tahakkuk", label: "Tahakkuklar", icon: Banknote, count: charges.length },
    { id: "bakim", label: "Bakım talepleri", icon: Wrench, count: maintenance.length },
    { id: "notlar", label: "Notlar & araçlar", icon: StickyNote },
  ];

  return (
    <div className="space-y-6">
      <Link
        href="/app/kiralama"
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-text-muted transition hover:text-brand-600"
      >
        <ArrowLeft className="h-4 w-4" /> Kiralama
      </Link>

      {/* Hero — kira künyesi */}
      <PageHeader title={prop?.title ?? prop?.property_code ?? "Portföy"} eyebrow="Kira kaydı" description={`Başlangıç: ${dateLabel(rental.start_date)}${rental.end_date ? ` · Bitiş: ${dateLabel(rental.end_date)}` : " · Süresiz"}`} actions={
<div className="theme-dark flex flex-wrap items-center gap-2 rounded-[var(--radius-card)] bg-[image:var(--grad-ink)] p-2"><div className="flex items-center gap-2">
            <Badge variant={active ? "success" : "outline"} className={active ? "" : "text-white/70 ring-white/25"}>
              {active ? "Aktif" : "Bitti"}
            </Badge>
            {canEdit && active ? <EndRentalButton rentalId={rental.id} /> : null}
          </div></div>
} />
<section className="theme-dark relative overflow-hidden rounded-[var(--radius-panel)] bg-[image:var(--grad-ink)] p-6 text-white">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-30" />
        

        {/* Künye kartları — portföy + kiracı LİNKLİ */}
        <div className="relative mt-5 flex flex-wrap gap-4">
          {prop ? (
            <div className="flex items-center gap-2 rounded-[var(--radius-card)] border border-white/10 bg-white/5 px-3 py-2 text-sm">
              <Building2 className="h-4 w-4 text-cyan-400" />
              <span className="text-white/80">Portföy:</span>
              <Link href={`/app/portfoyler/${prop.id}`} className="focus-ring rounded-[var(--radius-control)] font-semibold text-white hover:underline">
                {prop.title ?? prop.property_code}
              </Link>
            </div>
          ) : null}
          {renter ? (
            <div className="flex items-center gap-2 rounded-[var(--radius-card)] border border-white/10 bg-white/5 px-3 py-2 text-sm">
              <User className="h-4 w-4 text-mint-400" />
              <span className="text-white/80">Kiracı:</span>
              <Link href={`/app/musteriler/${renter.id}`} className="focus-ring rounded-[var(--radius-control)] font-semibold text-white hover:underline">
                {renter.full_name ?? "İsimsiz"}
              </Link>
              {renter.phone ? <span className="text-white/50">{renter.phone}</span> : null}
            </div>
          ) : null}
          <div className="flex items-center gap-2 rounded-[var(--radius-card)] border border-white/10 bg-white/5 px-3 py-2 text-sm">
            <CalendarClock className="h-4 w-4 text-amber-400" />
            <span className="text-white/80">Aylık kira:</span>
            <span className="numeric font-semibold text-white">{money(Number(rental.monthly_rent))}</span>
            <span className="text-white/50">· her ayın {rental.due_day}. günü</span>
          </div>
          {rental.deposit != null ? (
            <div className="flex flex-wrap items-center gap-2 rounded-[var(--radius-card)] border border-white/10 bg-white/5 px-3 py-2 text-sm">
              <span className="text-white/80">Depozito:</span>
              <span className="numeric font-semibold text-white">{money(Number(rental.deposit))}</span>
              <DepositReturnControl
                rentalId={rental.id}
                returned={Boolean(rental.deposit_returned)}
                returnedAt={rental.deposit_returned_at ?? null}
              />
            </div>
          ) : null}
        </div>
      </section>

      {/* Sözleşme bitiş uyarısı — 30 gün kala amber */}
      {endingSoon ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-card)] border border-amber-400/40 bg-amber-400/[0.08] px-4 py-3 text-sm">
          <p className="flex items-center gap-2 font-semibold text-amber-700">
            <CalendarClock className="h-4 w-4" />
            Sözleşme {daysToEnd === 0 ? "bugün" : `${daysToEnd} gün içinde`} bitiyor ({dateLabel(rental.end_date!)}).
          </p>
          <Link
            href="/app/kira-artis"
            className="focus-ring press inline-flex items-center gap-1.5 rounded-[var(--radius-control)] bg-amber-400/20 px-3 py-1.5 text-xs font-bold text-amber-700 transition hover:bg-amber-400/30"
          >
            <TrendingUp className="h-3.5 w-3.5" /> Kira artışını hesapla
          </Link>
        </div>
      ) : active && ended ? (
        <div className="rounded-[var(--radius-card)] border border-danger-500/35 bg-danger-500/[0.06] px-4 py-3 text-sm font-semibold text-danger-600">
          Sözleşme bitiş tarihi ({dateLabel(rental.end_date!)}) geçti — kaydı sonlandırın ya da yenileyin.
        </div>
      ) : null}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-4">
          <DetailTabs basePath={`/app/kiralama/${rental.id}`} tabs={tabDefs} active={tab} label="Kira sekmeleri" />

          {tab === "tahakkuk" ? (
            <div className="space-y-4">
              {/* Tahakkuklar */}
              <ChargesPanel rentalId={rental.id} charges={charges} canCreate={canCreate} canEdit={canEdit} />
            </div>
          ) : null}

          {tab === "bakim" ? (
            <div className="space-y-4">
              {/* Bakım talepleri */}
              <MaintenancePanel rentalId={rental.id} requests={maintenance} canCreate={canCreate} canEdit={canEdit} />
            </div>
          ) : null}

          {tab === "notlar" ? (
            <div className="space-y-4">
              <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
                <h2 className="font-display text-sm font-bold text-ink-950">Notlar</h2>
                {rental.notes ? (
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-text-muted">{rental.notes}</p>
                ) : (
                  <EmptyStateV3
                    variant="compact"
                    title="Bu kira kaydına not eklenmemiş."
                    description="Kiracıyla ilgili notlar kayıt oluşturulurken girilir."
                  />
                )}
              </section>

              {/* Kira artış hesaplayıcı kısayolu */}
              <Link
                href="/app/kira-artis"
                className="focus-ring press lift group flex items-center gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-4 transition hover:border-brand-300"
              >
                <span className="grid h-10 w-10 place-items-center rounded-[var(--radius-card)] bg-brand-600/10 text-brand-600">
                  <TrendingUp className="h-5 w-5" />
                </span>
                <span>
                  <span className="block text-sm font-bold text-ink-950">Kira artış hesaplayıcı</span>
                  <span className="block text-xs text-text-muted">TÜFE bazlı yasal artış oranıyla yeni kirayı hesaplayın.</span>
                </span>
              </Link>
            </div>
          ) : null}
        </div>

        {/* Sağ sütun — her sekmede görünür */}
        <aside aria-label="Özet ve sonraki eylem" className="space-y-4 lg:sticky lg:top-4">
          <NextActionCard title={nba.title} reason={nba.reason} href={nba.href} label={nba.label} />
          <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-4 shadow-[var(--shadow-xs)]">
            <p className="text-xs font-bold uppercase tracking-[0.08em] text-text-muted">
              {renter?.full_name ?? "Kiracı bağlı değil"}
            </p>
            <div className="mt-3">
              <ContactActions
                phone={renter?.phone}
                name={renter?.full_name}
                appointmentHref={renter?.id ? `/app/randevular?customer=${renter.id}${prop?.id ? `&property=${prop.id}` : ""}` : null}
                noteHref={`/app/kiralama/${rental.id}?sekme=notlar`}
              />
            </div>
            <dl className="mt-4 space-y-1.5 border-t border-line pt-3 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-text-muted">Geciken / bekleyen</dt>
                <dd className="font-semibold text-ink-950">{overdueCount} / {pendingCount}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-text-muted">Açık bakım</dt>
                <dd className="font-semibold text-ink-950">{openMaintenance}</dd>
              </div>
            </dl>
          </section>
        </aside>
      </div>
    </div>
  );
}
