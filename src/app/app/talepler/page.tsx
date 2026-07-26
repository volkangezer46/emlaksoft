import Link from "next/link";
import {
  ArrowUpRight,
  Clock3,
  Crosshair,
  Target,
  Users,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { ListLimitNotice } from "@/components/app/list-limit-notice";
import { NewDemandListDialog } from "./new-demand-list-dialog";

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

const URGENCY_VALUES = Object.keys(urgencyLabel);

/** Talep yaşı — kartta "kaç gündür açık" göstergesi. */
function demandAge(iso: string, status: string) {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (status === "closed") return days <= 0 ? "Bugün açıldı" : `${days} gün önce açıldı`;
  if (days <= 0) return "Bugün açıldı";
  if (days === 1) return "1 gündür açık";
  return `${days} gündür açık`;
}

export default async function DemandsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; aciliyet?: string }>;
}) {
  const { perms } = await requireModulePage("demands");
  const canCreate = (perms.demands ?? []).includes("create");
  const sp = await searchParams;
  const supabase = await createClient();

  // ?aciliyet= virgülle birden çok değer alır (örn. "Acil / yüksek" KPI'sı
  // high,urgent gönderir) — yalnızca DB'de geçen değerler kabul edilir.
  const aciliyetValues = (sp.aciliyet ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter((v) => URGENCY_VALUES.includes(v));
  const aciliyetF = aciliyetValues.join(",");

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
  if (aciliyetValues.length > 0) {
    query = query.in("urgency", aciliyetValues);
  }

  // "Yeni talep" dialogu için müşteri + il listesi — yalnız create yetkisi varken çekilir.
  const [{ data, count: demandTotal }, { data: customersData }, { data: provincesData }] = await Promise.all([
    query,
    canCreate
      ? supabase
          .from("customers")
          .select("id, full_name")
          .is("deleted_at", null)
          .order("created_at", { ascending: false })
          .limit(300)
      : Promise.resolve({ data: [] as { id: string; full_name: string }[] }),
    canCreate
      ? supabase.from("geo_provinces").select("id, name").order("name", { ascending: true })
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ]);
  const rows = (data ?? []) as DemandRow[];
  const dialogCustomers = customersData ?? [];
  const dialogProvinces = provincesData ?? [];

  const openCount = rows.filter((r) => r.status !== "closed").length;
  const urgentCount = rows.filter((r) => r.urgency === "urgent" || r.urgency === "high").length;

  // Filtre linkleri diğer parametreyi korur (status ⇄ aciliyet bağımsız).
  const demandHref = (patch: { status?: string; aciliyet?: string }) => {
    const status = patch.status !== undefined ? patch.status : (sp.status ?? "");
    const aciliyet = patch.aciliyet !== undefined ? patch.aciliyet : aciliyetF;
    const q = new URLSearchParams();
    if (status) q.set("status", status);
    if (aciliyet) q.set("aciliyet", aciliyet);
    const s = q.toString();
    return s ? `/app/talepler?${s}` : "/app/talepler";
  };

  const filters = [
    { key: "", label: "Açık" },
    { key: "all", label: "Tümü" },
    { key: "new", label: "Yeni" },
    { key: "active", label: "Aktif" },
    { key: "matched", label: "Eşleşti" },
    { key: "closed", label: "Kapalı" },
  ];

  const urgencyFilters = [
    { key: "urgent", label: "Acil" },
    { key: "high", label: "Yüksek" },
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
          <div className="flex flex-wrap gap-3">
            <Link
              href="/app/talepler"
              className="focus-ring press lift group block rounded-[14px] border border-white/10 bg-white/5 px-4 py-3 text-center transition hover:border-brand-300"
            >
              <p className="flex items-center justify-center gap-1 font-display text-2xl font-extrabold">
                {openCount}
                <ArrowUpRight className="hover-action h-4 w-4 text-text-faint opacity-0 transition group-hover:text-brand-600 group-hover:opacity-100" />
              </p>
              <p className="text-[11px] text-white/50">Listelenen</p>
            </Link>
            <Link
              href={demandHref({ aciliyet: "high,urgent" })}
              className="focus-ring press lift group block rounded-[14px] border border-white/10 bg-white/5 px-4 py-3 text-center transition hover:border-brand-300"
            >
              <p className="flex items-center justify-center gap-1 font-display text-2xl font-extrabold text-amber-300">
                {urgentCount}
                <ArrowUpRight className="hover-action h-4 w-4 text-text-faint opacity-0 transition group-hover:text-brand-600 group-hover:opacity-100" />
              </p>
              <p className="text-[11px] text-white/50">Acil / yüksek</p>
            </Link>
          </div>
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-2">
        {filters.map((f) => {
          const active = (sp.status ?? "") === f.key || (!sp.status && f.key === "");
          return (
            <Link
              key={f.key || "open"}
              href={demandHref({ status: f.key })}
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
        <span className="mx-1 hidden h-4 w-px bg-line sm:block" aria-hidden />
        {urgencyFilters.map((f) => {
          const active = aciliyetValues.length === 1 && aciliyetValues[0] === f.key;
          return (
            <Link
              key={f.key}
              href={demandHref({ aciliyet: active ? "" : f.key })}
              className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
                active
                  ? "bg-amber-500 text-white"
                  : "border border-line bg-surface text-text-muted hover:border-amber-400 hover:text-amber-600"
              }`}
            >
              {f.label}
            </Link>
          );
        })}
        {aciliyetValues.length > 1 ? (
          <Link
            href={demandHref({ aciliyet: "" })}
            className="rounded-full bg-amber-500 px-3.5 py-1.5 text-xs font-semibold text-white"
            title="Aciliyet filtresini kaldır"
          >
            Acil + Yüksek ✕
          </Link>
        ) : null}
        <div className="ml-auto flex items-center gap-2">
          <Link
            href="/app/eslestirme"
            className="inline-flex items-center gap-1.5 rounded-[10px] border border-line bg-surface px-3.5 py-2 text-xs font-semibold text-ink-950 transition hover:border-brand-400"
          >
            <Crosshair className="h-3.5 w-3.5 text-brand-600" /> Eşleştirme motoru
          </Link>
          {canCreate ? (
            <NewDemandListDialog customers={dialogCustomers} provinces={dialogProvinces} />
          ) : null}
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-[20px] border border-dashed border-line-strong bg-surface px-6 py-16 text-center">
          <Target className="mx-auto h-8 w-8 text-text-faint" />
          <p className="mt-3 font-display text-lg font-bold text-ink-950">Bu filtrede talep yok</p>
          <p className="mt-1 text-sm text-text-muted">
            {canCreate ? "Buradan veya müşteri detayından yeni talep ekleyebilirsiniz." : "Müşteri detayından yeni talep ekleyebilirsiniz."}
          </p>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
            {canCreate ? <NewDemandListDialog customers={dialogCustomers} provinces={dialogProvinces} /> : null}
            <Link href="/app/musteriler" className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-600 hover:underline">
              <Users className="h-4 w-4" /> Müşterilere git
            </Link>
          </div>
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
                {/* Kart artık talebin KENDİ detayına gider; müşteri linki ikincil (z-10) kalır. */}
                <Link href={`/app/talepler/${d.id}`} className="absolute inset-0 rounded-[18px]" aria-label={customer ? `${customer.full_name} talebinin detayını aç` : "Talep detayını aç"} />
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-brand-600">
                        {d.transaction_type}{d.property_type ? ` · ${d.property_type}` : ""}
                      </span>
                      <span className="rounded-full bg-mint-500/10 px-2 py-0.5 text-[11px] font-bold text-mint-600">
                        {statusLabel[d.status] ?? d.status}
                      </span>
                      {d.urgency ? (
                        <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-bold text-amber-600">
                          {urgencyLabel[d.urgency] ?? d.urgency}
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-2 font-display text-xl font-extrabold text-ink-950">
                      {budgetLabel(d.budget_min, d.budget_max)}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-muted">
                      {customer ? (
                        <Link href={`/app/musteriler/${customer.id}`} className="relative z-10 font-semibold text-ink-950 hover:text-brand-600">
                          {customer.full_name}
                        </Link>
                      ) : null}
                      {province?.name ? <span>{province.name}</span> : null}
                      {d.rooms ? <span>{d.rooms}</span> : null}
                      {d.min_sqm ? <span>≥ {d.min_sqm} m²</span> : null}
                      <span className={`flex items-center gap-1 ${d.status !== "closed" && d.urgency === "urgent" ? "font-semibold text-amber-600" : "text-text-faint"}`}>
                        <Clock3 className="h-3 w-3" /> {demandAge(d.created_at, d.status)}
                      </span>
                    </div>
                  </div>
                  <div className="relative z-10 flex flex-wrap gap-2">
                    {customer ? (
                      <Link
                        href={`/app/musteriler/${customer.id}`}
                        className="inline-flex items-center gap-1.5 rounded-[10px] border border-line bg-surface px-3 py-2 text-xs font-semibold text-text-muted transition hover:border-brand-400 hover:text-brand-600"
                      >
                        <Users className="h-3.5 w-3.5" /> Müşteri kartı
                      </Link>
                    ) : null}
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
