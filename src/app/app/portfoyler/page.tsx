import Link from "next/link";
import {
  ArrowUpRight,
  Building2,
  CircleCheck,
  FileCheck2,
  Gauge,
  MapPin,
  Radio,
  Search,
  Siren,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { getDefinitions } from "@/lib/definitions";
import { NewPropertyDialog } from "./new-property-dialog";
import { PropertyBulkActions } from "./property-bulk-actions";

type PropertyRow = {
  id: string;
  property_code: string;
  title: string | null;
  transaction_type: string;
  property_type: string;
  status: string;
  list_price: number | null;
  price_health: string | null;
  features: Record<string, unknown> | null;
  created_at: string;
  province: { name: string } | { name: string }[] | null;
  portal_listings: { portal_name: string; status: string; last_confirmed_at: string | null }[] | null;
};

function provinceName(value: PropertyRow["province"]) {
  if (!value) return "Konum belirtilmedi";
  return Array.isArray(value) ? (value[0]?.name ?? "Konum belirtilmedi") : value.name;
}

function formatPrice(value: number | null, transaction: string) {
  if (value === null) return "Fiyat girilmedi";
  const price = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 }).format(value);
  return `${price} ₺${transaction === "rent" || transaction === "Kiralık" ? "/ay" : ""}`;
}

const STATUS_FILTERS = [
  { label: "Tümü", value: "all" },
  { label: "Yayında", value: "live" },
  { label: "Teyit", value: "pending" },
  { label: "Taslak", value: "draft" },
] as const;

function matchesStatusFilter(status: string, filter: string) {
  if (filter === "all") return true;
  const normalized = status.toLowerCase();
  if (filter === "live") return normalized === "live" || normalized === "yayında";
  if (filter === "pending") return normalized === "pending" || normalized === "teyit" || normalized === "confirming";
  if (filter === "draft") return normalized === "draft" || normalized === "taslak";
  return true;
}

export default async function PropertiesPage({
  searchParams,
}: {
  searchParams?: Promise<{ q?: string; status?: string }>;
}) {
  const { perms } = await requireModulePage("properties");
  const canCreate = (perms.properties ?? []).includes("create");
  const params = (await searchParams) ?? {};
  const q = (params.q ?? "").trim();
  const statusFilter = params.status ?? "all";
  const supabase = await createClient();

  // Sunucu tarafı arama — q varsa ilike ile filtrele, yoksa tam listeyi çek
  let query = supabase
    .from("properties")
    .select("id, property_code, title, transaction_type, property_type, status, list_price, price_health, features, created_at, province:geo_provinces(name), portal_listings(portal_name,status,last_confirmed_at)")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(200);

  if (q) {
    // Tam metin: property_code OR title OR address_line ile ilike
    query = query.or(
      `property_code.ilike.%${q}%,title.ilike.%${q}%`
    );
  }

  const [{ data }, { data: provinces }, { data: branches }, propertyTypeDefs, transactionTypeDefs] = await Promise.all([
    query,
    supabase.from("geo_provinces").select("id, name").order("name", { ascending: true }),
    supabase.from("branches").select("id, name").eq("is_active", true).order("name"),
    getDefinitions("property_type"),
    getDefinitions("transaction_type"),
  ]);

  const allProperties = (data ?? []) as PropertyRow[];
  const provinceList = provinces ?? [];
  const branchList = branches ?? [];
  const propertyTypeOptions = propertyTypeDefs.length ? propertyTypeDefs.map((d) => d.value) : undefined;
  const transactionTypeOptions = transactionTypeDefs.length ? transactionTypeDefs.map((d) => d.value) : undefined;

  let properties = allProperties;

  if (q) {
    const needle = q.toLocaleLowerCase("tr-TR");
    properties = properties.filter((property) => {
      const haystack = [
        property.property_code,
        property.title ?? "",
        provinceName(property.province),
        ...(property.portal_listings?.map((p) => p.portal_name) ?? []),
      ]
        .join(" ")
        .toLocaleLowerCase("tr-TR");
      return haystack.includes(needle);
    });
  }

  if (statusFilter !== "all") {
    properties = properties.filter((property) => matchesStatusFilter(property.status, statusFilter));
  }
  const liveCount = allProperties.filter((property) => property.status === "live" || property.status === "Yayında").length;
  const portalCount = allProperties.reduce((total, property) => total + (property.portal_listings?.filter((portal) => portal.status === "live").length ?? 0), 0);
  const warningCount = allProperties.filter((property) => property.price_health === "yellow" || property.price_health === "red" || property.price_health === "Sarı").length;

  const greenCount = allProperties.filter((p) => p.price_health === "green" || p.price_health === "Yeşil").length;
  const yellowCount = allProperties.filter((p) => p.price_health === "yellow" || p.price_health === "Sarı").length;
  const redCount = allProperties.filter((p) => p.price_health === "red" || p.price_health === "Kırmızı").length;
  const healthTotal = Math.max(1, greenCount + yellowCount + redCount);
  const healthSegments = [
    { label: "İyi", count: greenCount, bar: "bg-mint-500", dot: "bg-mint-400", text: "text-mint-400", delay: "0s" },
    { label: "İzle", count: yellowCount, bar: "bg-amber-400", dot: "bg-amber-400", text: "text-amber-300", delay: "0.12s" },
    { label: "Riskli", count: redCount, bar: "bg-danger-500", dot: "bg-danger-500", text: "text-danger-400", delay: "0.24s" },
  ];

  return (
    <div className="space-y-6">
      <section className="theme-dark relative overflow-hidden rounded-[22px] bg-[image:var(--grad-ink)] p-6 text-white">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-35" />
        <div className="pointer-events-none absolute -right-12 -top-20 h-60 w-60 rounded-full bg-mint-500/25 blur-[80px]" />
        <div className="relative flex flex-wrap items-start justify-between gap-5">
          <div>
            <span className="flex items-center gap-2 text-xs font-semibold text-mint-400"><Radio className="h-3.5 w-3.5" /> Portföy ağı canlı</span>
            <h1 className="mt-2 font-display text-2xl font-extrabold text-white md:text-3xl">Portföy operasyonu</h1>
            <p className="mt-1 text-sm text-white/60">Fiyat sağlığı, portal teyidi ve yetki durumu tek merkezde.</p>
          </div>
          {canCreate ? <NewPropertyDialog provinces={provinceList} branches={branchList} propertyTypes={propertyTypeOptions} transactionTypes={transactionTypeOptions} /> : null}
        </div>
        <div className="relative mt-6 grid gap-4 lg:grid-cols-[1fr_1fr]">
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "Aktif portföy", value: liveCount, icon: Building2 },
              { label: "Canlı portal", value: portalCount, icon: CircleCheck },
              { label: "Fiyat uyarısı", value: warningCount, icon: Siren },
            ].map((item) => (
              <div key={item.label} className="rounded-[14px] border border-white/10 bg-white/5 p-3 backdrop-blur">
                <item.icon className="h-4 w-4 text-mint-400" />
                <p className="mt-2 font-display text-xl font-extrabold text-white">{item.value}</p>
                <p className="text-[10px] text-white/45 sm:text-xs">{item.label}</p>
              </div>
            ))}
          </div>
          <div className="rounded-[16px] border border-white/10 bg-white/[0.04] p-4 backdrop-blur">
            <div className="flex items-center justify-between">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-white/75"><Gauge className="h-3.5 w-3.5 text-mint-400" /> Fiyat sağlığı dağılımı</p>
              <span className="text-[10px] text-white/45">{allProperties.length} portföy</span>
            </div>
            <div className="mt-4 flex h-3 gap-0.5 overflow-hidden rounded-full bg-white/10">
              {healthSegments.map((s) => (
                <div key={s.label} className={`pipeline-fill h-full ${s.bar}`} style={{ width: `${(s.count / healthTotal) * 100}%`, animationDelay: s.delay }} />
              ))}
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2">
              {healthSegments.map((s) => (
                <div key={s.label} className="rounded-[10px] border border-white/8 bg-white/[0.03] px-2 py-2 text-center">
                  <span className={`mx-auto block h-1.5 w-1.5 rounded-full ${s.dot}`} />
                  <p className={`mt-1.5 font-display text-lg font-extrabold ${s.text}`}>{s.count}</p>
                  <p className="text-[9px] text-white/45">{s.label}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <form className="flex flex-wrap items-center justify-between gap-3 rounded-[16px] border border-line bg-surface p-3 shadow-[var(--shadow-xs)]" action="/app/portfoyler">
        <div className="relative min-w-[240px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-faint" />
          <input
            name="q"
            defaultValue={q}
            placeholder="Kod, başlık, portal veya konum ara…"
            className="w-full rounded-[11px] border border-line bg-canvas py-2.5 pl-10 pr-4 text-sm outline-none transition focus:border-brand-400 focus:bg-surface"
          />
        </div>
        <div className="flex gap-2">
          {STATUS_FILTERS.map((filter) => (
            <button
              key={filter.value}
              type="submit"
              name="status"
              value={filter.value}
              className={`hidden rounded-[9px] px-3 py-2 text-xs font-semibold transition sm:block ${statusFilter === filter.value ? "bg-ink-950 text-white" : "border border-line text-text-muted hover:text-ink-950"}`}
            >
              {filter.label}
            </button>
          ))}
        </div>
      </form>
      {(q || statusFilter !== "all") && (
        <p className="flex items-center gap-2 text-xs text-text-muted">
          <span className="rounded-full bg-brand-600/10 px-2.5 py-1 font-semibold text-brand-600">{properties.length} sonuç</span>
          {q && <span>“{q}” için filtrelendi</span>}
          <Link href="/app/portfoyler" className="font-semibold text-brand-600 hover:underline">Filtreyi temizle</Link>
        </p>
      )}

      {allProperties.length === 0 ? (
        <div className="grid place-items-center overflow-hidden rounded-[20px] border border-dashed border-line-strong bg-surface px-6 py-16 text-center">
          <div className="relative">
            <span className="grid h-16 w-16 place-items-center rounded-[18px] bg-brand-600/10 text-brand-600"><Building2 className="h-8 w-8" /></span>
            <span className="status-pulse absolute -right-1 -top-1 h-3 w-3 rounded-full border-2 border-white bg-mint-500" />
          </div>
          <h2 className="mt-5 font-display text-xl font-bold text-ink-950">Portföy merkezinizi kurun</h2>
          <p className="mt-2 max-w-md text-sm leading-relaxed text-text-muted">İlk portföyünüzü ekleyin; fiyat sağlığı, portal teyidi ve yetki süresi otomatik izlenmeye başlasın.</p>
          {canCreate ? (
            <div className="mt-5 [&>button]:bg-brand-600 [&>button]:text-white">
              <NewPropertyDialog provinces={provinceList} branches={branchList} propertyTypes={propertyTypeOptions} transactionTypes={transactionTypeOptions} />
            </div>
          ) : null}
        </div>
      ) : properties.length === 0 ? (
        <div className="grid place-items-center rounded-[20px] border border-dashed border-line-strong bg-surface px-6 py-16 text-center">
          <span className="grid h-16 w-16 place-items-center rounded-[18px] bg-canvas text-text-faint"><Search className="h-8 w-8" /></span>
          <h2 className="mt-5 font-display text-xl font-bold text-ink-950">Sonuç bulunamadı</h2>
          <p className="mt-2 max-w-md text-sm leading-relaxed text-text-muted">Arama veya filtre kriterlerinize uyan portföy yok. Filtreyi temizleyip tekrar deneyin.</p>
          <Link href="/app/portfoyler" className="mt-5 rounded-[10px] bg-ink-950 px-4 py-2.5 text-sm font-semibold text-white">Filtreyi temizle</Link>
        </div>
      ) : (
        <>
        {/* Toplu düzenleme bölümü */}
        <details className="group rounded-[16px] border border-line bg-surface">
          <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-semibold text-text-muted transition hover:text-ink-950 [&::-webkit-details-marker]:hidden">
            <span>Toplu durum güncelle</span>
            <span className="rounded-full bg-canvas px-2 py-0.5 text-xs text-text-faint group-open:hidden">{properties.length} portföy</span>
            <span className="hidden rounded-full bg-brand-600/10 px-2 py-0.5 text-xs text-brand-600 group-open:block">Kapat</span>
          </summary>
          <div className="border-t border-line px-4 pb-4 pt-3">
            <PropertyBulkActions
              properties={properties.map((p) => ({
                id: p.id,
                property_code: p.property_code,
                title: p.title,
                status: p.status,
              }))}
            />
          </div>
        </details>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {properties.map((property) => {
            const portals = property.portal_listings ?? [];
            const healthGood = property.price_health === "green" || property.price_health === "Yeşil";
            return (
              <Link
                key={property.id}
                href={`/app/portfoyler/${property.id}`}
                className="group overflow-hidden rounded-[20px] border border-line bg-surface shadow-[var(--shadow-xs)] transition hover:-translate-y-1 hover:border-brand-300 hover:shadow-[var(--shadow-card)]"
              >
                <div className="relative flex h-36 items-center justify-center overflow-hidden bg-[image:var(--grad-brand-soft)]">
                  <div className="pointer-events-none absolute inset-0 dot-overlay opacity-60" />
                  <Building2 className="h-12 w-12 text-brand-600/35 transition duration-500 group-hover:scale-110" />
                  <span className="absolute left-4 top-4 rounded-full bg-white/85 px-2.5 py-1 text-[10px] font-bold text-ink-950 shadow-[var(--shadow-xs)] backdrop-blur">{property.property_code}</span>
                  <span className={`absolute right-4 top-4 rounded-full px-2.5 py-1 text-[10px] font-bold ${healthGood ? "bg-mint-500/15 text-mint-600" : "bg-amber-400/20 text-amber-500"}`}>
                    Fiyat {property.price_health ?? "bekliyor"}
                  </span>
                </div>
                <div className="p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-brand-600">{property.transaction_type} · {property.property_type}</p>
                      <h2 className="mt-1 font-display text-lg font-bold text-ink-950">{property.title ?? property.property_code}</h2>
                      <p className="mt-1 flex items-center gap-1.5 text-xs text-text-muted"><MapPin className="h-3.5 w-3.5" />{provinceName(property.province)}</p>
                    </div>
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[9px] bg-canvas text-text-faint transition group-hover:bg-brand-600/10 group-hover:text-brand-600" aria-hidden><ArrowUpRight className="h-4 w-4" /></span>
                  </div>
                  <p className="mt-4 font-display text-2xl font-extrabold text-ink-950">{formatPrice(property.list_price, property.transaction_type)}</p>
                  <div className="mt-4 grid grid-cols-2 gap-2 border-t border-line pt-4">
                    <span className="flex items-center gap-2 text-xs text-text-muted"><FileCheck2 className="h-4 w-4 text-mint-600" />{property.status}</span>
                    <span className="flex items-center justify-end gap-2 text-xs text-text-muted"><Gauge className="h-4 w-4 text-brand-600" />{portals.length} portal</span>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
        </>
      )}
    </div>
  );
}
