import Link from "next/link";
import {
  Crosshair,
  Target,
  Users,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { ListLimitNotice } from "@/components/app/list-limit-notice";

type Rel = { id?: string; full_name?: string; name?: string } | { id?: string; full_name?: string; name?: string }[] | null;

type DemandRow = {
  id: string;
  transaction_type: string;
  property_type: string | null;
  budget_min: number | null;
  budget_max: number | null;
  rooms: string | null;
  min_sqm: number | null;
  urgency: string | null;
  status: string;
  created_at: string;
  customer: Rel;
  province: Rel;
};

function relOne<T extends { full_name?: string; name?: string; id?: string }>(value: Rel): T | null {
  if (!value) return null;
  return (Array.isArray(value) ? value[0] : value) as T;
}

function money(value: number | null) {
  if (value === null) return null;
  return new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 }).format(value) + " ₺";
}

function budgetLabel(min: number | null, max: number | null) {
  if (min && max) return `${money(min)} – ${money(max)}`;
  if (max) return `≤ ${money(max)}`;
  if (min) return `≥ ${money(min)}`;
  return "Bütçe yok";
}

const statusLabel: Record<string, string> = {
  new: "Yeni",
  active: "Aktif",
  matched: "Eşleşti",
  closed: "Kapalı",
};

const urgencyLabel: Record<string, string> = {
  low: "Düşük",
  normal: "Normal",
  high: "Yüksek",
  urgent: "Acil",
};

export default async function DemandsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  await requireModulePage("demands");
  const sp = await searchParams;
  const supabase = await createClient();

  let query = supabase
    .from("customer_demands")
    // `count: "exact"`: liste 200 ile sınırlı, kullanıcıya kaç kaydın
    // dışarıda kaldığını söyleyebilmek için gerçek toplam lazım.
    .select(
      "id, transaction_type, property_type, budget_min, budget_max, rooms, min_sqm, urgency, status, created_at, customer:customers(id, full_name), province:geo_provinces(name)",
      { count: "exact" },
    )
    .order("created_at", { ascending: false })
    .limit(200);

  if (sp.status && sp.status !== "all") {
    query = query.eq("status", sp.status);
  } else if (!sp.status) {
    query = query.in("status", ["new", "active", "matched"]);
  }

  const { data, count: demandTotal } = await query;
  const rows = (data ?? []) as DemandRow[];

  const openCount = rows.filter((r) => r.status !== "closed").length;
  const urgentCount = rows.filter((r) => r.urgency === "urgent" || r.urgency === "high").length;

  const filters = [
    { key: "", label: "Açık" },
    { key: "all", label: "Tümü" },
    { key: "active", label: "Aktif" },
    { key: "matched", label: "Eşleşti" },
    { key: "closed", label: "Kapalı" },
  ];

  return (
    <div className="space-y-6">
      <section className="theme-dark relative overflow-hidden rounded-[22px] bg-[image:var(--grad-ink)] p-6 text-white">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-35" />
        <div className="pointer-events-none absolute -right-12 -top-16 h-56 w-56 rounded-full bg-brand-600/25 blur-[80px]" />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em] text-cyan-400">
              <Target className="h-3.5 w-3.5" /> Talep merkezi
            </p>
            <h1 className="mt-2 font-display text-3xl font-extrabold text-white">Müşteri talepleri</h1>
            <p className="mt-2 max-w-xl text-sm text-white/60">
              Açık talepleri yönetin, bütçe ve konum kriterlerini eşleştirme motoruna bağlayın.
            </p>
          </div>
          <div className="flex gap-3">
            <div className="rounded-[14px] border border-white/10 bg-white/5 px-4 py-3 text-center">
              <p className="font-display text-2xl font-extrabold">{openCount}</p>
              <p className="text-[10px] text-white/50">Listelenen</p>
            </div>
            <div className="rounded-[14px] border border-white/10 bg-white/5 px-4 py-3 text-center">
              <p className="font-display text-2xl font-extrabold text-amber-300">{urgentCount}</p>
              <p className="text-[10px] text-white/50">Acil / yüksek</p>
            </div>
          </div>
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-2">
        {filters.map((f) => {
          const active = (sp.status ?? "") === f.key || (!sp.status && f.key === "");
          const href = f.key ? `/app/talepler?status=${f.key}` : "/app/talepler";
          return (
            <Link
              key={f.key || "open"}
              href={href}
              className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
                active
                  ? "bg-brand-600 text-white"
                  : "border border-line bg-surface text-text-muted hover:border-brand-400 hover:text-brand-600"
              }`}
            >
              {f.label}
            </Link>
          );
        })}
        <Link
          href="/app/eslestirme"
          className="ml-auto inline-flex items-center gap-1.5 rounded-[10px] border border-line bg-surface px-3.5 py-2 text-xs font-semibold text-ink-950 transition hover:border-brand-400"
        >
          <Crosshair className="h-3.5 w-3.5 text-brand-600" /> Eşleştirme motoru
        </Link>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-[20px] border border-dashed border-line-strong bg-surface px-6 py-16 text-center">
          <Target className="mx-auto h-8 w-8 text-text-faint" />
          <p className="mt-3 font-display text-lg font-bold text-ink-950">Bu filtrede talep yok</p>
          <p className="mt-1 text-sm text-text-muted">Müşteri detayından yeni talep ekleyebilirsiniz.</p>
          <Link href="/app/musteriler" className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-600 hover:underline">
            <Users className="h-4 w-4" /> Müşterilere git
          </Link>
        </div>
      ) : (
        <div className="grid gap-3">
          <ListLimitNotice shown={rows.length} total={demandTotal} />
          {rows.map((d) => {
            const customer = relOne<{ id: string; full_name: string }>(d.customer);
            const province = relOne<{ name: string }>(d.province);
            return (
              <article
                key={d.id}
                className="group relative rounded-[18px] border border-line bg-surface p-5 shadow-[var(--shadow-xs)] transition hover:border-brand-400/40 hover:shadow-[var(--shadow-sm)]"
              >
                {customer ? (
                  <Link href={`/app/musteriler/${customer.id}`} className="absolute inset-0 rounded-[18px]" aria-label={`${customer.full_name} müşteri detayı`} />
                ) : null}
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-brand-600">
                        {d.transaction_type}{d.property_type ? ` · ${d.property_type}` : ""}
                      </span>
                      <span className="rounded-full bg-mint-500/10 px-2 py-0.5 text-[10px] font-bold text-mint-600">
                        {statusLabel[d.status] ?? d.status}
                      </span>
                      {d.urgency ? (
                        <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold text-amber-600">
                          {urgencyLabel[d.urgency] ?? d.urgency}
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-2 font-display text-xl font-extrabold text-ink-950">
                      {budgetLabel(d.budget_min, d.budget_max)}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-muted">
                      {customer ? (
                        <Link href={`/app/musteriler/${customer.id}`} className="font-semibold text-ink-950 hover:text-brand-600">
                          {customer.full_name}
                        </Link>
                      ) : null}
                      {province?.name ? <span>{province.name}</span> : null}
                      {d.rooms ? <span>{d.rooms}</span> : null}
                      {d.min_sqm ? <span>≥ {d.min_sqm} m²</span> : null}
                    </div>
                  </div>
                  <div className="relative z-10 flex flex-wrap gap-2">
                    <Link
                      href={`/app/eslestirme?demand=${d.id}`}
                      className="inline-flex items-center gap-1.5 rounded-[10px] bg-brand-600 px-3 py-2 text-xs font-semibold text-white hover:bg-brand-700"
                    >
                      <Crosshair className="h-3.5 w-3.5" /> Eşleştir
                    </Link>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
