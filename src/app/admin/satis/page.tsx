import Link from "next/link";
import { Handshake, Search, Sparkles, Target, TrendingUp, Users } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePlatformModule } from "@/lib/platform";
import { orIlike } from "@/lib/pgrst";
import { ExportButton } from "@/components/admin/export-button";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { AdminStatCard, AdminStatGrid } from "@/components/admin/admin-stat-card";
import { AdminEmpty } from "@/components/admin/admin-table";
import { Input } from "@/components/ui/input";
import { Pagination, pageRange, parsePage } from "@/app/admin/_components/pagination";
import { exportDemoRequestsCsv } from "@/app/actions/platform-export";
import { DemoCard, type DemoRow } from "./demo-card";

const FILTERS: { key: string; label: string }[] = [
  { key: "all", label: "Tümü" },
  { key: "new", label: "Yeni" },
  { key: "contacted", label: "İletişimde" },
  { key: "qualified", label: "Nitelikli" },
  { key: "won", label: "Kazanıldı" },
  { key: "lost", label: "Kaybedildi" },
];

const DEMO_SELECT =
  "id, full_name, phone, email, company, city, team_size, message, status, assigned_to, notes, converted_tenant_id, created_at";

/** Filtre + arama + sayfa numarasını tek yerde birleştirir. */
function salesHref(p: { durum?: string; q?: string; sayfa?: number }) {
  const params = new URLSearchParams();
  if (p.durum && p.durum !== "all") params.set("durum", p.durum);
  if (p.q) params.set("q", p.q);
  if (p.sayfa && p.sayfa > 1) params.set("sayfa", String(p.sayfa));
  const qs = params.toString();
  return qs ? `/admin/satis?${qs}` : "/admin/satis";
}

export default async function AdminSalesPage({
  searchParams,
}: {
  searchParams: Promise<{ durum?: string; q?: string; sayfa?: string }>;
}) {
  await requirePlatformModule("sales");
  const sp = await searchParams;
  const filter = sp.durum && FILTERS.some((f) => f.key === sp.durum) ? sp.durum : "all";
  const q = (sp.q ?? "").trim();
  const page = parsePage(sp.sayfa);

  const admin = createAdminClient();

  /*
   * ÖNCEDEN: 300 kayıt çekilip durum filtresi ve sayfalama bellekte yapılıyordu —
   * 300. kayıttan sonrası hiç görünmüyordu ve "Kaybedildi" gibi eski durumlar
   * listede eksik kalıyordu. Artık filtre de sayfalama da sorguda.
   * Huni/KPI sayıları filtreden bağımsız: kova sayıları her zaman tüm hunidir.
   */
  let listQuery = admin
    .from("demo_requests")
    .select(DEMO_SELECT, { count: "exact" })
    .order("created_at", { ascending: false })
    .range(...pageRange(page));
  if (filter !== "all") listQuery = listQuery.eq("status", filter);
  if (q) listQuery = listQuery.or(orIlike(["full_name", "phone", "company"], q));

  const [{ data: list, count: listTotal }, { data: staff }, { data: statRows }] = await Promise.all([
    listQuery,
    admin.from("platform_staff").select("id, full_name").eq("is_active", true),
    admin.from("demo_requests").select("status, created_at").limit(5000),
  ]);

  const visible = (list ?? []) as DemoRow[];
  const stats = statRows ?? [];
  const staffList = staff ?? [];

  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();
  const newCount = stats.filter((r) => r.status === "new").length;
  const contacted = stats.filter((r) => r.status === "contacted").length;
  const qualified = stats.filter((r) => r.status === "qualified").length;
  const wonMonth = stats.filter((r) => r.status === "won" && new Date(r.created_at).getTime() >= monthStart).length;
  const wonTotal = stats.filter((r) => r.status === "won").length;
  const conversion = stats.length ? Math.round((wonTotal / stats.length) * 100) : 0;
  const hasData = stats.length > 0;

  const filterHref = (key: string) => salesHref({ durum: key, q });

  // pipeline funnel
  const funnel = [
    { label: "Yeni", href: "/admin/satis?durum=new", value: newCount, tone: "bg-brand-500" },
    { label: "İletişim", href: "/admin/satis?durum=contacted", value: contacted, tone: "bg-cyan-400" },
    { label: "Nitelikli", href: "/admin/satis?durum=qualified", value: qualified, tone: "bg-amber-400" },
    { label: "Kazanıldı", href: "/admin/satis?durum=won", value: wonTotal, tone: "bg-mint-500" },
  ];
  const funnelMax = Math.max(1, ...funnel.map((f) => f.value));

  const kpis: { label: string; href: string; value: number | null; suffix?: string; icon: typeof Sparkles; accent: string; hint?: string }[] = [
    { label: "Yeni talep", href: salesHref({ durum: "new" }), value: hasData ? newCount : null, icon: Sparkles, accent: "text-brand-300", hint: "yanıt bekliyor" },
    { label: "Nitelikli", href: salesHref({ durum: "qualified" }), value: hasData ? qualified : null, icon: Target, accent: "text-amber-300", hint: "teklif aşamasında" },
    { label: "Bu ay kazanılan", href: salesHref({ durum: "won" }), value: hasData ? wonMonth : null, icon: Handshake, accent: "text-mint-400", hint: `toplam ${wonTotal}` },
    { label: "Dönüşüm", href: salesHref({ durum: "won" }), value: hasData ? conversion : null, suffix: "%", icon: TrendingUp, accent: "text-cyan-300", hint: "kazanılan / tüm talep" },
  ];

  return (
    <div className="space-y-5">
      <AdminPageHeader
        eyebrow="EmlakSoft · Satış hunisi"
        icon={Handshake}
        title="Demo talepleri & aday yönetimi"
        description="Tanıtım formundan gelen talepleri niteleyin, atayın ve aboneliğe dönüştürün."
        glow="mint"
        actions={<ExportButton action={exportDemoRequestsCsv} label="Excel'e aktar" />}
      >
        <AdminStatGrid className="mt-6">
          {kpis.map((k) => (
            <AdminStatCard
              key={k.label}
              tone="dark"
              label={k.label}
              value={k.value}
              href={hasData ? k.href : undefined}
              icon={k.icon}
              accent={k.accent}
              suffix={k.suffix}
              hint={k.hint}
              emptyHint="Henüz demo talebi yok"
            />
          ))}
        </AdminStatGrid>
      </AdminPageHeader>

      {/* pipeline */}
      <section className="dashboard-panel rounded-[18px] border border-line bg-surface p-5">
        <p className="flex items-center gap-2 text-xs font-semibold text-brand-600"><TrendingUp className="h-4 w-4" /> Satış hunisi</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-4">
          {funnel.map((f, i) => (
            <Link key={f.label} href={f.href} className="focus-ring group block rounded-[8px]">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-ink-950 transition group-hover:text-brand-600">{f.label}</span>
                <span className="tabular-nums text-text-muted">{f.value}</span>
              </div>
              <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-ink-950/5">
                <div className={`bar-live h-full rounded-full transition group-hover:brightness-110 ${f.tone}`} style={{ width: `${Math.max((f.value / funnelMax) * 100, 4)}%`, animationDelay: `${i * 0.08}s` }} />
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* filters + search */}
      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => {
          const active = f.key === filter;
          // Sayaçlar tüm huniden gelir; sayfa dilimine göre değişmez.
          const count = f.key === "all" ? stats.length : stats.filter((r) => r.status === f.key).length;
          return (
            <Link
              key={f.key}
              href={filterHref(f.key)}
              className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
                active ? "bg-ink-950 text-white" : "border border-line bg-surface text-text-muted hover:border-brand-300"
              }`}
            >
              {f.label}
              <span className={`rounded-full px-1.5 text-[11px] ${active ? "bg-white/20" : "bg-canvas text-text-faint"}`}>{count}</span>
            </Link>
          );
        })}
        <form action="/admin/satis" className="relative w-full max-w-xs sm:ml-auto">
          {filter !== "all" ? <input type="hidden" name="durum" value={filter} /> : null}
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-faint" />
          <Input type="search" name="q" defaultValue={q} placeholder="Ad, telefon veya şirket ara…" className="py-2 pl-8 pr-3 text-xs" />
        </form>
      </div>

      {/* list */}
      {visible.length === 0 ? (
        <div className="dashboard-panel rounded-[18px] border border-line bg-surface">
          <AdminEmpty
            icon={Users}
            title={q ? "Aramayla eşleşen talep yok" : filter === "all" ? "Henüz demo talebi yok" : "Bu filtrede talep yok"}
            description={
              q
                ? "Arama terimini değiştirip tekrar deneyin — ad, telefon ve şirket alanları taranır."
                : filter === "all"
                  ? "Tanıtım sayfasındaki formdan gelen talepler buraya otomatik düşer."
                  : "Başka bir durum sekmesine geçip hunideki diğer adaylara bakabilirsiniz."
            }
            action={
              q || filter !== "all" ? (
                <Link
                  href="/admin/satis"
                  className="focus-ring press inline-flex rounded-[10px] border border-line px-3 py-2 text-xs font-semibold text-brand-600 transition hover:border-brand-400"
                >
                  Filtreleri temizle
                </Link>
              ) : null
            }
          />
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {visible.map((row) => (
            <DemoCard key={row.id} row={row} staff={staffList} />
          ))}
        </div>
      )}

      <Pagination page={page} total={listTotal ?? 0} hrefFor={(p) => salesHref({ durum: filter, q, sayfa: p })} />
    </div>
  );
}
