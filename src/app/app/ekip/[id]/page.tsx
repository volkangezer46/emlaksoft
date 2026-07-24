import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  ArrowUpRight,
  Building2,
  CalendarDays,
  Phone,
  PhoneCall,
  Target,
  Users,
  Wallet,
} from "lucide-react";
import { requireModulePage } from "@/lib/require-module-page";
import { createClient } from "@/lib/supabase/server";
import { formatTurkishPhone } from "@/lib/phone";

const ROLE_LABELS: Record<string, string> = {
  owner: "Ofis sahibi",
  gm: "Genel müdür",
  branch_manager: "Şube müdürü",
  team_lead: "Takım lideri",
  advisor: "Danışman",
  readonly: "Salt okunur",
};

function money(n: number) {
  return new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 }).format(n);
}
function relName(v: unknown): string | null {
  if (!v) return null;
  const o = Array.isArray(v) ? v[0] : v;
  return (o as { name?: string } | null)?.name ?? null;
}
function initials(name: string) {
  return name.split(/\s+/).map((p) => p[0] ?? "").join("").slice(0, 2).toUpperCase();
}

export default async function TeamMemberDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireModulePage("team");
  const { id } = await params;
  const supabase = await createClient();

  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const [
    { data: member },
    { count: customerCount },
    { data: customers },
    { count: propertyCount },
    { data: properties },
    { data: commissions },
    { count: apptCount },
    { count: callCount },
  ] = await Promise.all([
    supabase.from("profiles").select("id, full_name, phone, role, is_active, created_at, branch:branches(name)").eq("id", id).maybeSingle(),
    supabase.from("customers").select("id", { count: "exact", head: true }).eq("assigned_to", id).is("deleted_at", null),
    supabase.from("customers").select("id, full_name, phone, customer_types, created_at").eq("assigned_to", id).is("deleted_at", null).order("created_at", { ascending: false }).limit(8),
    supabase.from("properties").select("id", { count: "exact", head: true }).eq("assigned_to", id).is("deleted_at", null),
    supabase.from("properties").select("id, property_code, title, status, list_price").eq("assigned_to", id).is("deleted_at", null).order("created_at", { ascending: false }).limit(8),
    supabase.from("commissions").select("gross_amount, status, deal:deals(assigned_to)").gte("created_at", monthStart.toISOString()).limit(500),
    supabase.from("appointments").select("id", { count: "exact", head: true }).eq("assigned_to", id).gte("scheduled_at", monthStart.toISOString()),
    supabase.from("calls").select("id", { count: "exact", head: true }).eq("handled_by", id).gte("started_at", monthStart.toISOString()),
  ]);

  if (!member) notFound();

  // Bu danışmana ait komisyonlar (deal.assigned_to eşleşmesi)
  const myCommission = (commissions ?? []).reduce((sum, c) => {
    const deal = Array.isArray(c.deal) ? c.deal[0] : c.deal;
    return deal?.assigned_to === id ? sum + Number(c.gross_amount || 0) : sum;
  }, 0);

  const branch = relName(member.branch);
  const cust = customers ?? [];
  const props = properties ?? [];

  const stats = [
    { label: "Müşteri", value: customerCount ?? 0, icon: Users, tone: "text-brand-600" },
    { label: "Portföy", value: propertyCount ?? 0, icon: Building2, tone: "text-mint-600" },
    { label: "Randevu (ay)", value: apptCount ?? 0, icon: CalendarDays, tone: "text-cyan-600" },
    { label: "Çağrı (ay)", value: callCount ?? 0, icon: PhoneCall, tone: "text-amber-500" },
  ];

  return (
    <div className="space-y-6">
      <Link href="/app/ekip" className="inline-flex items-center gap-1.5 text-sm font-semibold text-text-muted transition hover:text-brand-600">
        <ArrowLeft className="h-4 w-4" /> Ekip
      </Link>

      <section className="theme-dark relative overflow-hidden rounded-[22px] bg-[image:var(--grad-ink)] p-6 text-white">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-30" />
        <div className="pointer-events-none absolute -right-14 -top-16 h-56 w-56 rounded-full bg-brand-600/30 blur-[70px]" />
        <div className="relative flex flex-wrap items-center justify-between gap-5">
          <div className="flex items-center gap-4">
            <span className="grid h-16 w-16 shrink-0 place-items-center rounded-[20px] bg-[image:var(--grad-brand)] font-display text-xl font-extrabold text-white shadow-[var(--shadow-glow-brand)]">
              {initials(member.full_name)}
            </span>
            <div>
              <h1 className="font-display text-2xl font-extrabold text-white md:text-3xl">{member.full_name}</h1>
              <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-white/70">
                <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-[11px] font-semibold">{ROLE_LABELS[member.role] ?? member.role}</span>
                {branch ? <span>{branch}</span> : null}
                {!member.is_active ? <span className="rounded-full bg-danger-500/20 px-2 py-0.5 text-[10px] font-bold text-danger-400">Pasif</span> : null}
              </p>
              {member.phone ? (
                <a href={`tel:${member.phone}`} className="mt-2 inline-flex items-center gap-1.5 text-sm text-white/70 hover:text-mint-300">
                  <Phone className="h-3.5 w-3.5" /> {formatTurkishPhone(member.phone)}
                </a>
              ) : null}
            </div>
          </div>
          <div className="rounded-[16px] border border-white/12 bg-white/8 px-5 py-4 text-center">
            <p className="flex items-center justify-center gap-1.5 text-[11px] text-white/60"><Wallet className="h-3.5 w-3.5" /> Bu ay komisyon</p>
            <p className="mt-1 font-display text-2xl font-extrabold text-mint-300">{money(myCommission)}</p>
          </div>
        </div>
      </section>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="rounded-[16px] border border-line bg-surface p-4 shadow-[var(--shadow-xs)]">
            <s.icon className={`h-4 w-4 ${s.tone}`} />
            <p className="mt-2 font-display text-2xl font-extrabold text-ink-950">{s.value}</p>
            <p className="text-xs text-text-muted">{s.label}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Müşteriler */}
        <section className="rounded-[18px] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-ink-950"><Users className="h-4 w-4 text-brand-600" /> Müşteriler <span className="ml-auto text-xs text-text-muted">{customerCount ?? 0}</span></h2>
          {cust.length === 0 ? (
            <p className="py-8 text-center text-sm text-text-muted">Atanmış müşteri yok.</p>
          ) : (
            <ul className="space-y-1.5">
              {cust.map((c) => (
                <li key={c.id}>
                  <Link href={`/app/musteriler/${c.id}`} className="group flex items-center justify-between rounded-[10px] border border-line bg-canvas px-3 py-2 text-sm transition hover:border-brand-400 hover:bg-brand-600/[0.03]">
                    <span className="font-medium text-ink-950 group-hover:text-brand-600">{c.full_name}</span>
                    <span className="flex items-center gap-2 text-xs text-text-muted">
                      {c.phone ? formatTurkishPhone(c.phone) : "—"} <ArrowUpRight className="h-3.5 w-3.5 opacity-0 transition group-hover:opacity-100" />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Portföyler */}
        <section className="rounded-[18px] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-ink-950"><Building2 className="h-4 w-4 text-mint-600" /> Portföyler <span className="ml-auto text-xs text-text-muted">{propertyCount ?? 0}</span></h2>
          {props.length === 0 ? (
            <p className="py-8 text-center text-sm text-text-muted">Atanmış portföy yok.</p>
          ) : (
            <ul className="space-y-1.5">
              {props.map((p) => (
                <li key={p.id}>
                  <Link href={`/app/portfoyler/${p.id}`} className="group flex items-center justify-between rounded-[10px] border border-line bg-canvas px-3 py-2 text-sm transition hover:border-brand-400 hover:bg-brand-600/[0.03]">
                    <span className="min-w-0 truncate font-medium text-ink-950 group-hover:text-brand-600">{p.title ?? p.property_code}</span>
                    <span className="flex shrink-0 items-center gap-2 text-xs text-text-muted">
                      {p.list_price ? money(Number(p.list_price)) : "—"} <ArrowUpRight className="h-3.5 w-3.5 opacity-0 transition group-hover:opacity-100" />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
