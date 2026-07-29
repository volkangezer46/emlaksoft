import Link from "next/link";
import { daysAgoIso, daysFromNowIso } from "@/lib/clock";
import { notFound } from "next/navigation";
import { ArrowLeft, Building2, CalendarClock, KeyRound, TrendingUp, User } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { DepositReturnControl } from "./deposit-return";
import { Badge } from "@/components/ui/badge";
import { ChargesPanel } from "./charges-panel";
import { MaintenancePanel } from "./maintenance-panel";
import { EndRentalButton } from "./end-rental-button";

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

export default async function KiraDetayPage({ params }: { params: Promise<{ id: string }> }) {
  const { perms } = await requireModulePage("rentals");
  const canCreate = perms.rentals?.includes("create") ?? false;
  const canEdit = perms.rentals?.includes("edit") ?? false;
  const { id } = await params;

  const supabase = await createClient();
  const { data: rental } = await supabase
    .from("rentals")
    .select(
      "id, monthly_rent, due_day, start_date, end_date, deposit, deposit_returned, deposit_returned_at, status, notes, created_at, property:properties(id, property_code, title), renter:customers(id, full_name, phone), charges:rent_charges(id, period, amount, status, paid_at), maintenance:maintenance_requests(id, title, description, status, cost, created_at)",
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

  return (
    <div className="space-y-6">
      <Link
        href="/app/kiralama"
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-text-muted transition hover:text-brand-600"
      >
        <ArrowLeft className="h-4 w-4" /> Kiralama
      </Link>

      {/* Hero — kira künyesi */}
      <section className="theme-dark relative overflow-hidden rounded-[22px] bg-[image:var(--grad-ink)] p-6 text-white">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-30" />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em] text-cyan-300">
              <KeyRound className="h-3.5 w-3.5" /> Kira kaydı
            </p>
            <h1 className="mt-2 font-display text-2xl font-extrabold text-white md:text-3xl">
              {prop?.title ?? prop?.property_code ?? "Portföy"}
            </h1>
            <p className="mt-2 text-sm text-white/60">
              Başlangıç: {dateLabel(rental.start_date)}
              {rental.end_date ? ` · Bitiş: ${dateLabel(rental.end_date)}` : " · Süresiz"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={active ? "success" : "outline"} className={active ? "" : "text-white/70 ring-white/25"}>
              {active ? "Aktif" : "Bitti"}
            </Badge>
            {canEdit && active ? <EndRentalButton rentalId={rental.id} /> : null}
          </div>
        </div>

        {/* Künye kartları — portföy + kiracı LİNKLİ */}
        <div className="relative mt-5 flex flex-wrap gap-4">
          {prop ? (
            <div className="flex items-center gap-2 rounded-[12px] border border-white/10 bg-white/5 px-3 py-2 text-sm">
              <Building2 className="h-4 w-4 text-cyan-400" />
              <span className="text-white/80">Portföy:</span>
              <Link href={`/app/portfoyler/${prop.id}`} className="focus-ring rounded-[6px] font-semibold text-white hover:underline">
                {prop.title ?? prop.property_code}
              </Link>
            </div>
          ) : null}
          {renter ? (
            <div className="flex items-center gap-2 rounded-[12px] border border-white/10 bg-white/5 px-3 py-2 text-sm">
              <User className="h-4 w-4 text-mint-400" />
              <span className="text-white/80">Kiracı:</span>
              <Link href={`/app/musteriler/${renter.id}`} className="focus-ring rounded-[6px] font-semibold text-white hover:underline">
                {renter.full_name ?? "İsimsiz"}
              </Link>
              {renter.phone ? <span className="text-white/50">{renter.phone}</span> : null}
            </div>
          ) : null}
          <div className="flex items-center gap-2 rounded-[12px] border border-white/10 bg-white/5 px-3 py-2 text-sm">
            <CalendarClock className="h-4 w-4 text-amber-400" />
            <span className="text-white/80">Aylık kira:</span>
            <span className="numeric font-semibold text-white">{money(Number(rental.monthly_rent))}</span>
            <span className="text-white/50">· her ayın {rental.due_day}. günü</span>
          </div>
          {rental.deposit != null ? (
            <div className="flex flex-wrap items-center gap-2 rounded-[12px] border border-white/10 bg-white/5 px-3 py-2 text-sm">
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
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[14px] border border-amber-400/40 bg-amber-400/[0.08] px-4 py-3 text-sm">
          <p className="flex items-center gap-2 font-semibold text-amber-700">
            <CalendarClock className="h-4 w-4" />
            Sözleşme {daysToEnd === 0 ? "bugün" : `${daysToEnd} gün içinde`} bitiyor ({dateLabel(rental.end_date!)}).
          </p>
          <Link
            href="/app/kira-artis"
            className="focus-ring press inline-flex items-center gap-1.5 rounded-[9px] bg-amber-400/20 px-3 py-1.5 text-xs font-bold text-amber-700 transition hover:bg-amber-400/30"
          >
            <TrendingUp className="h-3.5 w-3.5" /> Kira artışını hesapla
          </Link>
        </div>
      ) : active && ended ? (
        <div className="rounded-[14px] border border-danger-500/35 bg-danger-500/[0.06] px-4 py-3 text-sm font-semibold text-danger-600">
          Sözleşme bitiş tarihi ({dateLabel(rental.end_date!)}) geçti — kaydı sonlandırın ya da yenileyin.
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-6">
          {/* Tahakkuklar */}
          <ChargesPanel rentalId={rental.id} charges={charges} canCreate={canCreate} canEdit={canEdit} />

          {rental.notes ? (
            <section className="rounded-[20px] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
              <h2 className="font-display text-sm font-bold text-ink-950">Notlar</h2>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-text-muted">{rental.notes}</p>
            </section>
          ) : null}
        </div>

        <div className="space-y-4">
          {/* Bakım talepleri */}
          <MaintenancePanel rentalId={rental.id} requests={maintenance} canCreate={canCreate} canEdit={canEdit} />

          {/* Kira artış hesaplayıcı kısayolu */}
          <Link
            href="/app/kira-artis"
            className="focus-ring press lift group flex items-center gap-3 rounded-[16px] border border-line bg-surface p-4 transition hover:border-brand-300"
          >
            <span className="grid h-10 w-10 place-items-center rounded-[12px] bg-brand-600/10 text-brand-600">
              <TrendingUp className="h-5 w-5" />
            </span>
            <span>
              <span className="block text-sm font-bold text-ink-950">Kira artış hesaplayıcı</span>
              <span className="block text-xs text-text-muted">TÜFE bazlı yasal artış oranıyla yeni kirayı hesaplayın.</span>
            </span>
          </Link>
        </div>
      </div>
    </div>
  );
}
