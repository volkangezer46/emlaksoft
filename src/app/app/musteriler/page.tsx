import Link from "next/link";
import {
  ArrowUpRight,
  Cake,
  Clock3,
  Gift,
  Mail,
  MapPin,
  Phone,
  Search,
  TrendingUp,
  UserCheck,
  Users,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { exportCustomersCsv } from "@/app/actions/export";
import { ExportCsvButton } from "@/components/app/export-csv-button";
import { NewCustomerDialog } from "./new-customer-dialog";
import { CustomerRowDelete } from "./customer-row-delete";
import { formatTurkishPhone } from "@/lib/phone";

type CustomerRow = {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  customer_types: string[] | null;
  source: string | null;
  notes: string | null;
  blacklist: boolean | null;
  assigned_to: string | null;
  created_at: string;
  birth_date: string | null;
  anniversary_date: string | null;
  anniversary_note: string | null;
  province: { name: string } | { name: string }[] | null;
};

const SOURCE_LABELS: Record<string, string> = {
  referral:    "Referans",
  web:         "Web sitesi",
  social:      "Sosyal medya",
  walk_in:     "Elden geldi",
  phone:       "Telefon",
  portal:      "Portal",
  other:       "Diğer",
};

const CUSTOMER_TYPES = [
  "Alıcı", "Satıcı", "Kiracı", "Mülk sahibi", "Yatırımcı",
];

function relativeAdded(iso: string) {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "Bugün eklendi";
  if (days === 1) return "Dün eklendi";
  if (days < 30) return `${days} gün önce eklendi`;
  if (days < 365) return `${Math.floor(days / 30)} ay önce eklendi`;
  return `${Math.floor(days / 365)} yıl önce eklendi`;
}

/** Yıllık tekrar eden bir tarihin (doğum günü/yıldönümü) bugüne kaç gün kaldığını döndürür (0 = bugün). Geçersiz/boş ise null. */
function daysUntilAnnual(iso: string | null): number | null {
  if (!iso) return null;
  const src = new Date(iso);
  if (Number.isNaN(src.getTime())) return null;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let next = new Date(today.getFullYear(), src.getMonth(), src.getDate());
  if (next < today) next = new Date(today.getFullYear() + 1, src.getMonth(), src.getDate());
  return Math.round((next.getTime() - today.getTime()) / 86_400_000);
}

function occasionLabel(days: number): string {
  if (days === 0) return "bugün";
  if (days === 1) return "yarın";
  return `${days} gün sonra`;
}

function provinceName(p: CustomerRow["province"]) {
  if (!p) return "—";
  return Array.isArray(p) ? (p[0]?.name ?? "—") : p.name;
}

function formatDate(iso: string) {
  return new Intl.DateTimeFormat("tr-TR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(iso));
}

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; type?: string; source?: string; from?: string; to?: string; assigned?: string }>;
}) {
  const { perms } = await requireModulePage("customers");
  const canCreate = (perms.customers ?? []).includes("create");
  const canDelete = (perms.customers ?? []).includes("delete");
  const supabase = await createClient();
  const sp = await searchParams;
  const q        = sp.q        ?? "";
  const typeF    = sp.type     ?? "";
  const sourceF  = sp.source   ?? "";
  const fromF    = sp.from     ?? "";
  const toF      = sp.to       ?? "";
  const assignedF = sp.assigned ?? "";

  const [{ data: customers }, { data: provinces }, { data: branches }, { data: advisors }] = await Promise.all([
    supabase
      .from("customers")
      .select(
        "id, full_name, phone, email, customer_types, source, notes, blacklist, assigned_to, created_at, birth_date, anniversary_date, anniversary_note, province:geo_provinces(name)",
      )
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(500),
    supabase.from("geo_provinces").select("id, name").order("name", { ascending: true }),
    supabase.from("branches").select("id, name").eq("is_active", true).order("name"),
    supabase.from("profiles").select("id, full_name").eq("is_active", true).order("full_name"),
  ]);

  let allRows = (customers ?? []) as CustomerRow[];

  // Sunucu tarafı filtreler
  if (typeF)    allRows = allRows.filter((c) => c.customer_types?.includes(typeF));
  if (sourceF)  allRows = allRows.filter((c) => c.source === sourceF);
  if (assignedF) allRows = allRows.filter((c) => c.assigned_to === assignedF);
  if (fromF)    allRows = allRows.filter((c) => c.created_at >= fromF);
  if (toF)      allRows = allRows.filter((c) => c.created_at <= toF + "T23:59:59");

  const needle = q.trim().toLocaleLowerCase("tr-TR");
  const rows = needle
    ? allRows.filter((customer) =>
        [customer.full_name, customer.phone, customer.email, provinceName(customer.province)]
          .filter(Boolean)
          .some((value) => String(value).toLocaleLowerCase("tr-TR").includes(needle)),
      )
    : allRows;
  const provinceList = provinces ?? [];
  const branchList = branches ?? [];
  const advisorList = advisors ?? [];

  // Yaklaşan doğum günü / yıldönümü (önümüzdeki 7 gün) — ekstra sorgu yok, mevcut listeden hesaplanır
  const WINDOW_DAYS = 7;
  type Occasion = { id: string; name: string; kind: "birthday" | "anniversary"; days: number; note: string | null };
  const occasions: Occasion[] = [];
  for (const row of allRows) {
    const bd = daysUntilAnnual(row.birth_date);
    if (bd !== null && bd <= WINDOW_DAYS) occasions.push({ id: row.id, name: row.full_name, kind: "birthday", days: bd, note: null });
    const ad = daysUntilAnnual(row.anniversary_date);
    if (ad !== null && ad <= WINDOW_DAYS) occasions.push({ id: row.id, name: row.full_name, kind: "anniversary", days: ad, note: row.anniversary_note });
  }
  occasions.sort((a, b) => a.days - b.days);

  const activeFilters = [typeF, sourceF, fromF, toF, assignedF].filter(Boolean).length;
  const ownerCount = allRows.filter((row) => row.customer_types?.includes("Mülk sahibi")).length;
  const buyerCount = allRows.filter((row) => row.customer_types?.includes("Alıcı")).length;

  const weekMs = 7 * 86_400_000;
  const nowMs = new Date().getTime();
  const buckets = Array.from({ length: 8 }, () => 0);
  allRows.forEach((row) => {
    const idx = 7 - Math.floor((nowMs - new Date(row.created_at).getTime()) / weekMs);
    if (idx >= 0 && idx < 8) buckets[idx] += 1;
  });
  const maxBucket = Math.max(1, ...buckets);
  const growthPts = buckets.map((b, i) => ({ x: (i / 7) * 200, y: 56 - (b / maxBucket) * 44 - 6 }));
  const growthLine = growthPts.map((p) => `${p.x},${p.y}`).join(" ");
  const growthArea = `0,60 ${growthLine} 200,60`;
  const growthLast = growthPts[growthPts.length - 1];

  return (
    <div className="space-y-6">
      <section className="theme-dark relative overflow-hidden rounded-[22px] bg-[image:var(--grad-ink)] p-6 text-white">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-35" />
        <div className="pointer-events-none absolute -right-14 -top-16 h-56 w-56 rounded-full bg-brand-600/35 blur-[70px]" />
        <div className="relative flex flex-wrap items-start justify-between gap-5">
          <div>
            <span className="flex items-center gap-2 text-xs font-semibold text-mint-400">
              <span className="status-pulse h-2 w-2 rounded-full bg-mint-400" /> CRM canlı
            </span>
            <h1 className="mt-2 font-display text-2xl font-extrabold text-white md:text-3xl">Müşteri merkezi</h1>
            <p className="mt-1 text-sm text-white/60">Talep, iletişim ve müşteri yolculuğu tek operasyon ekranında.</p>
          </div>
          {canCreate ? <NewCustomerDialog provinces={provinceList} branches={branchList} /> : null}
        </div>
        <div className="relative mt-6 grid gap-4 lg:grid-cols-[1fr_1fr]">
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "Toplam kayıt", value: allRows.length, icon: Users },
              { label: "Aktif alıcı", value: buyerCount, icon: UserCheck },
              { label: "Mülk sahibi", value: ownerCount, icon: MapPin },
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
              <p className="flex items-center gap-1.5 text-xs font-semibold text-white/75"><TrendingUp className="h-3.5 w-3.5 text-cyan-400" /> Yeni müşteri · son 8 hafta</p>
              <span className="rounded-full bg-brand-500/20 px-2 py-0.5 text-[10px] font-bold text-cyan-300">{buckets[7]} bu hafta</span>
            </div>
            <svg viewBox="0 0 200 60" className="mt-3 h-20 w-full overflow-visible" preserveAspectRatio="none">
              <defs>
                <linearGradient id="custGrowth" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--cyan-400)" stopOpacity="0.32" />
                  <stop offset="100%" stopColor="var(--cyan-400)" stopOpacity="0" />
                </linearGradient>
              </defs>
              <polygon points={growthArea} fill="url(#custGrowth)" />
              <polyline
                className="chart-draw"
                style={{ "--len": 320 } as React.CSSProperties}
                points={growthLine}
                fill="none"
                stroke="var(--cyan-400)"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <circle cx={growthLast.x} cy={growthLast.y} r="3" fill="var(--cyan-400)" opacity="0.4" className="glow-halo" />
              <circle cx={growthLast.x} cy={growthLast.y} r="2.6" fill="#fff" />
            </svg>
          </div>
        </div>
      </section>

      {/* Yaklaşan doğum günü / yıldönümü hatırlatma */}
      {occasions.length > 0 ? (
        <section className="overflow-hidden rounded-[16px] border border-amber-300/60 bg-gradient-to-r from-amber-50 to-rose-50/60 p-4 shadow-[var(--shadow-xs)] dark:border-amber-400/25 dark:from-amber-500/[0.08] dark:to-rose-500/[0.06]">
          <div className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-full bg-amber-400/20 text-amber-600 dark:text-amber-400">
              <Gift className="h-4 w-4" />
            </span>
            <p className="text-sm font-bold text-ink-950">
              Yaklaşan özel günler
              <span className="ml-1.5 font-medium text-text-muted">· önümüzdeki {WINDOW_DAYS} gün</span>
            </p>
          </div>
          <ul className="mt-3 flex flex-wrap gap-2">
            {occasions.slice(0, 12).map((o) => (
              <li key={`${o.id}-${o.kind}`}>
                <Link
                  href={`/app/musteriler/${o.id}`}
                  className="group inline-flex items-center gap-2 rounded-full border border-line bg-surface/80 px-3 py-1.5 text-xs font-semibold text-ink-950 transition hover:border-amber-300 hover:bg-amber-50 dark:hover:bg-amber-500/10"
                  title={o.note ?? undefined}
                >
                  {o.kind === "birthday" ? (
                    <Cake className="h-3.5 w-3.5 text-rose-500" />
                  ) : (
                    <Gift className="h-3.5 w-3.5 text-amber-500" />
                  )}
                  <span>{o.name}</span>
                  <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${o.days === 0 ? "bg-rose-500 text-white" : "bg-amber-400/20 text-amber-700 dark:text-amber-300"}`}>
                    {o.kind === "birthday" ? "🎂" : "🎉"} {occasionLabel(o.days)}
                  </span>
                </Link>
              </li>
            ))}
            {occasions.length > 12 ? (
              <li className="self-center text-xs font-medium text-text-muted">+{occasions.length - 12} daha</li>
            ) : null}
          </ul>
        </section>
      ) : null}

      {/* Filtre toolbar */}
      <form className="rounded-[16px] border border-line bg-surface p-4 shadow-[var(--shadow-xs)] space-y-3" action="/app/musteriler">
        <div className="flex flex-wrap gap-3">
          {/* Arama */}
          <div className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-faint" />
            <input
              name="q"
              defaultValue={q}
              placeholder="Ad, telefon, e-posta ara…"
              className="w-full rounded-[11px] border border-line bg-canvas py-2.5 pl-10 pr-4 text-sm outline-none transition focus:border-brand-400 focus:bg-surface"
            />
          </div>
          {/* Müşteri tipi */}
          <select
            name="type"
            defaultValue={typeF}
            className="rounded-[11px] border border-line bg-canvas px-3 py-2.5 text-sm outline-none focus:border-brand-400"
          >
            <option value="">Tüm tipler</option>
            {CUSTOMER_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          {/* Kaynak */}
          <select
            name="source"
            defaultValue={sourceF}
            className="rounded-[11px] border border-line bg-canvas px-3 py-2.5 text-sm outline-none focus:border-brand-400"
          >
            <option value="">Tüm kaynaklar</option>
            {Object.entries(SOURCE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          {/* Danışman */}
          {advisorList.length > 0 && (
            <select
              name="assigned"
              defaultValue={assignedF}
              className="rounded-[11px] border border-line bg-canvas px-3 py-2.5 text-sm outline-none focus:border-brand-400"
            >
              <option value="">Tüm danışmanlar</option>
              {advisorList.map((a) => <option key={a.id} value={a.id}>{a.full_name as string}</option>)}
            </select>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {/* Tarih aralığı */}
          <div className="flex items-center gap-2 text-sm text-text-muted">
            <span className="text-xs font-medium">Eklenme:</span>
            <input
              name="from"
              type="date"
              defaultValue={fromF}
              className="rounded-[9px] border border-line bg-canvas px-2.5 py-1.5 text-sm outline-none focus:border-brand-400"
            />
            <span>—</span>
            <input
              name="to"
              type="date"
              defaultValue={toF}
              className="rounded-[9px] border border-line bg-canvas px-2.5 py-1.5 text-sm outline-none focus:border-brand-400"
            />
          </div>
          <button type="submit" className="rounded-[10px] bg-brand-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-brand-700">
            Filtrele
          </button>
          {(activeFilters > 0 || q) && (
            <Link href="/app/musteriler" className="text-xs font-semibold text-text-muted hover:text-danger-500">
              Temizle
            </Link>
          )}
          <span className="ml-auto rounded-full bg-brand-600/10 px-3 py-1.5 text-xs font-semibold text-brand-600">
            {rows.length} sonuç
          </span>
        </div>
      </form>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span />
        </div>
        <div className="flex items-center gap-2">
          <ExportCsvButton action={exportCustomersCsv} iconOnly label="Müşterileri CSV indir" />
        </div>
      </div>

      {allRows.length === 0 ? (
        <div className="grid place-items-center rounded-[16px] border border-dashed border-line-strong bg-surface px-6 py-16 text-center">
          <div className="grid h-14 w-14 place-items-center rounded-full bg-brand-600/10">
            <Users className="h-7 w-7 text-brand-600" />
          </div>
          <h2 className="mt-4 font-display text-lg font-bold text-ink-950">
            Henüz müşteri yok
          </h2>
          <p className="mt-1 max-w-sm text-sm text-text-muted">
            İlk müşterinizi ekleyin. Arayan, mülk sahibi ve yatırımcıları tek
            yerde toplayın; hiçbir talebi kaçırmayın.
          </p>
          {canCreate ? (
            <div className="mt-5">
              <NewCustomerDialog provinces={provinceList} branches={branchList} />
            </div>
          ) : null}
        </div>
      ) : rows.length === 0 ? (
        <div className="grid place-items-center rounded-[18px] border border-dashed border-line-strong bg-surface px-6 py-14 text-center">
          <Search className="h-8 w-8 text-text-faint" />
          <h2 className="mt-3 font-display text-lg font-bold text-ink-950">Eşleşen müşteri bulunamadı</h2>
          <p className="mt-1 text-sm text-text-muted">Arama ifadenizi değiştirip tekrar deneyin.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-[18px] border border-line bg-surface shadow-[var(--shadow-xs)]">
          <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="border-b border-line bg-canvas/80 text-text-muted">
              <tr>
                <th className="px-5 py-3.5 font-medium">Müşteri</th>
                <th className="px-4 py-3 font-medium">Tür</th>
                <th className="px-4 py-3 font-medium">İletişim</th>
                <th className="px-4 py-3 font-medium">Konum</th>
                <th className="px-4 py-3 font-medium">Son durum</th>
                <th className="w-24 px-4 py-3"><span className="sr-only">İşlemler</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr
                  key={c.id}
                  className="group relative cursor-pointer border-b border-line transition last:border-0 hover:bg-brand-600/[0.025]"
                >
                  <td className="px-5 py-4">
                    <Link href={`/app/musteriler/${c.id}`} className="absolute inset-0" aria-label={`${c.full_name} detayları`} />
                    <div className="flex items-center gap-3">
                      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[image:var(--grad-brand)] text-xs font-bold text-white shadow-[var(--shadow-xs)]">
                        {c.full_name.split(/\s+/).map((part) => part[0] ?? "").join("").slice(0, 2).toUpperCase()}
                      </span>
                      <div>
                        <p className="font-semibold text-ink-950">{c.full_name}</p>
                        {c.blacklist ? (
                          <p className="mt-0.5 flex items-center gap-1 text-[11px] font-semibold text-danger-500"><span className="h-1.5 w-1.5 rounded-full bg-danger-500" /> Kara liste</p>
                        ) : (
                          <p className="mt-0.5 flex items-center gap-1 text-[11px] text-text-faint"><Clock3 className="h-3 w-3" /> {relativeAdded(c.created_at)}</p>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {c.customer_types && c.customer_types.length > 0 ? (
                      <span className="rounded-full bg-brand-600/10 px-2.5 py-1 text-xs font-medium text-brand-600">
                        {c.customer_types[0]}
                      </span>
                    ) : (
                      <span className="text-text-faint">—</span>
                    )}
                  </td>
                  <td className="px-4 py-4">
                    <p className="flex items-center gap-2 tabular-nums text-text-muted"><Phone className="h-3.5 w-3.5 text-brand-600" />{c.phone ? formatTurkishPhone(c.phone) : "—"}</p>
                    {c.email ? <p className="mt-1 flex items-center gap-2 text-xs text-text-faint"><Mail className="h-3.5 w-3.5" />{c.email}</p> : null}
                  </td>
                  <td className="px-4 py-4 text-text-muted">
                    <span className="flex items-center gap-2"><MapPin className="h-3.5 w-3.5 text-text-faint" />{provinceName(c.province)}</span>
                  </td>
                  <td className="px-4 py-4 text-text-muted">
                    <span className="flex items-center gap-2"><Clock3 className="h-3.5 w-3.5 text-text-faint" />{formatDate(c.created_at)}</span>
                  </td>
                  <td className="px-4 py-4">
                    <div className="relative z-10 flex items-center justify-end gap-1">
                      {canDelete ? <CustomerRowDelete customerId={c.id} name={c.full_name} /> : null}
                      <span className="grid h-8 w-8 place-items-center rounded-[9px] text-text-faint transition group-hover:bg-brand-600/10 group-hover:text-brand-600">
                        <ArrowUpRight className="h-4 w-4" />
                      </span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}
    </div>
  );
}
