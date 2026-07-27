import Link from "next/link";
import {
  AlarmClock,
  ArrowUpRight,
  Clock3,
  Crosshair,
  MapPin,
  Sparkles,
  Target,
  Users,
  Wallet,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { msSince } from "@/lib/clock";
import {
  fetchTenantMatchingWeights,
  scoreDemandProperty,
  type MatchDemand,
  type MatchProperty,
} from "@/lib/matching";
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
  province_id: string | null;
  district_id: string | null;
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

/** Talebin kaç gündür açık olduğu (tam gün). */
function ageDays(iso: string) {
  return Math.floor(msSince(iso) / 86_400_000);
}

/** Talep yaşı — kartta "kaç gündür açık" göstergesi. */
function demandAge(iso: string, status: string) {
  const days = ageDays(iso);
  if (status === "closed") return days <= 0 ? "Bugün açıldı" : `${days} gün önce açıldı`;
  if (days <= 0) return "Bugün açıldı";
  if (days === 1) return "1 gündür açık";
  return `${days} gündür açık`;
}

/** Yaşlanan talep eşiği (gün) — uyarı şeridi + ?yas= filtresi. */
const AGING_DAYS = 30;

// ── Bütçe segmentasyon bantları (bütçe üst sınırı, yoksa alt sınır esas) ────
const BUDGET_BANDS = [
  { key: "2m", label: "≤ 2 Mn ₺", min: 0, max: 2_000_000 },
  { key: "5m", label: "2–5 Mn ₺", min: 2_000_000, max: 5_000_000 },
  { key: "10m", label: "5–10 Mn ₺", min: 5_000_000, max: 10_000_000 },
  { key: "10m+", label: "10 Mn ₺ üzeri", min: 10_000_000, max: Infinity },
] as const;
type BandKey = (typeof BUDGET_BANDS)[number]["key"];

function bandOf(d: DemandRow): BandKey | null {
  const v = d.budget_max ?? d.budget_min;
  if (v == null) return null;
  const n = Number(v);
  const band = BUDGET_BANDS.find((b) => n > b.min && n <= b.max) ?? (n === 0 ? BUDGET_BANDS[0] : null);
  return band?.key ?? null;
}

export default async function DemandsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; aciliyet?: string; yas?: string; il?: string; butce?: string }>;
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
      "id, transaction_type, property_type, budget_min, budget_max, rooms, min_sqm, urgency, status, created_at, province_id, district_id, customer:customers(id, full_name), province:geo_provinces(name)",
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
  // Eşleşme potansiyeli rozetleri için yayındaki portföyler + ofis ağırlıkları
  // aynı turda çekilir (eşleştirme motorunun aday havuzu deseni, dar select).
  const [{ data, count: demandTotal }, { data: customersData }, { data: provincesData }, { data: propsData }, weights] =
    await Promise.all([
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
      supabase
        .from("properties")
        .select("id, property_code, title, transaction_type, property_type, status, list_price, province_id, district_id, features")
        .is("deleted_at", null)
        .in("status", ["live", "draft", "reserved", "Yayında"])
        .order("created_at", { ascending: false })
        .limit(300),
      fetchTenantMatchingWeights(supabase),
    ]);
  const rows = (data ?? []) as DemandRow[];
  const dialogCustomers = customersData ?? [];
  const dialogProvinces = provincesData ?? [];

  // ── Eşleşme potansiyeli: her açık talep, portföy havuzuna karşı skorlanır ──
  // Gerçek eşleştirme motorundaki formül (lib/matching, ofis ağırlıklarıyla);
  // güçlü ≥ 75 · iyi 55–74. Kapalı talepler skorlanmaz.
  const matchProps = (propsData ?? []).map((p) => ({
    ...p,
    list_price: p.list_price != null ? Number(p.list_price) : null,
    features: (p.features ?? {}) as MatchProperty["features"],
  })) as MatchProperty[];
  const matchByDemand = new Map<string, { strong: number; good: number; best: number }>();
  for (const d of rows) {
    if (d.status === "closed") continue;
    let strong = 0;
    let good = 0;
    let best = 0;
    for (const p of matchProps) {
      const res = scoreDemandProperty(d as unknown as MatchDemand, p, weights);
      if (res.score > best) best = res.score;
      if (res.score >= 75) strong += 1;
      else if (res.score >= 55) good += 1;
    }
    matchByDemand.set(d.id, { strong, good, best });
  }

  // ── Bellek filtreleri: ?il= ?butce= ?yas= (DB filtresi status/aciliyet üstüne) ──
  const ilF = (sp.il ?? "").trim();
  const butceF = BUDGET_BANDS.some((b) => b.key === sp.butce) ? (sp.butce as BandKey) : "";
  const yasF = sp.yas === String(AGING_DAYS);
  let view = rows;
  if (ilF) view = view.filter((d) => relOne<{ name: string }>(d.province)?.name === ilF);
  if (butceF) view = view.filter((d) => bandOf(d) === butceF);
  if (yasF) view = view.filter((d) => d.status !== "closed" && ageDays(d.created_at) >= AGING_DAYS);

  const openCount = view.filter((r) => r.status !== "closed").length;
  const urgentCount = view.filter((r) => r.urgency === "urgent" || r.urgency === "high").length;
  const matchReadyCount = view.filter((r) => (matchByDemand.get(r.id)?.strong ?? 0) > 0).length;

  // Yaşlanan talepler: tüm listelenen kayıtlar üzerinden (filtre öncesi) uyarı.
  const agingCount = rows.filter((d) => d.status !== "closed" && ageDays(d.created_at) >= AGING_DAYS).length;

  // ── Segmentasyon şeridi verisi: bütçe bantları + en yoğun 5 il ────────────
  const bandCounts = new Map<BandKey, number>();
  const provinceCounts = new Map<string, number>();
  for (const d of rows) {
    if (d.status === "closed") continue;
    const b = bandOf(d);
    if (b) bandCounts.set(b, (bandCounts.get(b) ?? 0) + 1);
    const pn = relOne<{ name: string }>(d.province)?.name;
    if (pn) provinceCounts.set(pn, (provinceCounts.get(pn) ?? 0) + 1);
  }
  const topProvinces = [...provinceCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);

  // Filtre linkleri diğer parametreleri korur (status ⇄ aciliyet ⇄ il ⇄ bütçe ⇄ yaş).
  const demandHref = (patch: { status?: string; aciliyet?: string; il?: string; butce?: string; yas?: string }) => {
    const status = patch.status !== undefined ? patch.status : (sp.status ?? "");
    const aciliyet = patch.aciliyet !== undefined ? patch.aciliyet : aciliyetF;
    const il = patch.il !== undefined ? patch.il : ilF;
    const butce = patch.butce !== undefined ? patch.butce : butceF;
    const yas = patch.yas !== undefined ? patch.yas : (yasF ? String(AGING_DAYS) : "");
    const q = new URLSearchParams();
    if (status) q.set("status", status);
    if (aciliyet) q.set("aciliyet", aciliyet);
    if (il) q.set("il", il);
    if (butce) q.set("butce", butce);
    if (yas) q.set("yas", yas);
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
            {/* Eşleşme hazır: portföy havuzunda en az 1 güçlü eşleşmesi olan talepler */}
            <Link
              href="/app/eslestirme"
              className="focus-ring press lift group block rounded-[14px] border border-mint-500/25 bg-mint-500/10 px-4 py-3 text-center transition hover:border-mint-400/60"
            >
              <p className="flex items-center justify-center gap-1 font-display text-2xl font-extrabold text-mint-300">
                {matchReadyCount}
                <ArrowUpRight className="hover-action h-4 w-4 text-text-faint opacity-0 transition group-hover:text-mint-300 group-hover:opacity-100" />
              </p>
              <p className="text-[11px] text-white/50">Eşleşme hazır</p>
            </Link>
          </div>
        </div>
      </section>

      {/* ── Yaşlanan talepler uyarısı — 30+ gündür açık, hâlâ kapanmamış ────── */}
      {agingCount > 0 && !yasF ? (
        <Link
          href={demandHref({ yas: String(AGING_DAYS) })}
          className="focus-ring press group flex min-h-[44px] items-center gap-3 rounded-[16px] border border-amber-400/40 bg-amber-400/10 px-4 py-3 transition hover:border-amber-500/60"
        >
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[11px] bg-amber-400/20 text-amber-600">
            <AlarmClock className="h-4.5 w-4.5" />
          </span>
          <span className="min-w-0 flex-1 text-sm">
            <span className="font-bold text-ink-950">{agingCount} talep {AGING_DAYS}+ gündür açık.</span>{" "}
            <span className="text-text-muted">Yaşlanan talepte müşteri soğur — arayıp kriterleri tazeleyin veya kapatın.</span>
          </span>
          <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-amber-600">
            Yaşlananları göster <ArrowUpRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
          </span>
        </Link>
      ) : null}
      {yasF ? (
        <p className="flex flex-wrap items-center gap-2 rounded-[14px] border border-amber-400/40 bg-amber-400/10 px-4 py-2.5 text-xs font-semibold text-amber-700">
          <AlarmClock className="h-3.5 w-3.5" /> Yalnız {AGING_DAYS}+ gündür açık talepler gösteriliyor.
          <Link href={demandHref({ yas: "" })} className="focus-ring rounded-full underline-offset-2 hover:underline">
            Filtreyi kaldır ✕
          </Link>
        </p>
      ) : null}

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

      {/* ── Segmentasyon şeridi: bütçe bantları + en yoğun iller (açık talepler) ── */}
      {bandCounts.size > 0 || topProvinces.length > 0 ? (
        <section className="dashboard-panel rounded-[18px] border border-line bg-surface px-4 py-3.5">
          <div className="flex flex-col gap-2.5">
            {bandCounts.size > 0 ? (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="mr-1 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-text-faint">
                  <Wallet className="h-3.5 w-3.5 text-brand-600" /> Bütçe
                </span>
                {BUDGET_BANDS.filter((b) => (bandCounts.get(b.key) ?? 0) > 0).map((b) => {
                  const active = butceF === b.key;
                  return (
                    <Link
                      key={b.key}
                      href={demandHref({ butce: active ? "" : b.key })}
                      aria-current={active ? "page" : undefined}
                      className={`focus-ring press inline-flex min-h-[32px] items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                        active
                          ? "bg-brand-600 text-white"
                          : "border border-line bg-canvas/60 text-text-muted hover:border-brand-400 hover:text-brand-600"
                      }`}
                    >
                      {b.label}
                      <span className={`numeric rounded-full px-1.5 text-[10px] font-bold ${active ? "bg-white/20" : "bg-brand-600/10 text-brand-700"}`}>
                        {bandCounts.get(b.key)}
                      </span>
                    </Link>
                  );
                })}
              </div>
            ) : null}
            {topProvinces.length > 0 ? (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="mr-1 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-text-faint">
                  <MapPin className="h-3.5 w-3.5 text-mint-600" /> Bölge
                </span>
                {topProvinces.map(([name, count]) => {
                  const active = ilF === name;
                  return (
                    <Link
                      key={name}
                      href={demandHref({ il: active ? "" : name })}
                      aria-current={active ? "page" : undefined}
                      className={`focus-ring press inline-flex min-h-[32px] items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                        active
                          ? "bg-mint-600 text-white"
                          : "border border-line bg-canvas/60 text-text-muted hover:border-mint-500 hover:text-mint-600"
                      }`}
                    >
                      {name}
                      <span className={`numeric rounded-full px-1.5 text-[10px] font-bold ${active ? "bg-white/20" : "bg-mint-500/12 text-mint-700"}`}>
                        {count}
                      </span>
                    </Link>
                  );
                })}
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      {view.length === 0 ? (
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
          {view.map((d) => {
            const customer = relOne<{ id: string; full_name: string }>(d.customer);
            const province = relOne<{ name: string }>(d.province);
            const match = d.status !== "closed" ? matchByDemand.get(d.id) : undefined;
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
                      {/* Eşleşme potansiyeli — gerçek skor motorundan (lib/matching) */}
                      {match && (match.strong > 0 || match.good > 0) ? (
                        <Link
                          href={`/app/eslestirme?demand=${d.id}`}
                          title={`En iyi skor ${match.best} · eşleştirmede aç`}
                          className={`relative z-10 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold transition ${
                            match.strong > 0
                              ? "bg-mint-500/12 text-mint-600 hover:bg-mint-500/25"
                              : "bg-brand-600/10 text-brand-600 hover:bg-brand-600/20"
                          }`}
                        >
                          <Sparkles className="h-3 w-3" />
                          {match.strong > 0
                            ? `${match.strong} güçlü eşleşme`
                            : `${match.good} iyi eşleşme`}
                        </Link>
                      ) : match ? (
                        <span className="rounded-full bg-canvas px-2 py-0.5 text-[11px] font-semibold text-text-faint" title="Portföy havuzunda skor ≥ 55 aday yok">
                          Eşleşme adayı yok
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
