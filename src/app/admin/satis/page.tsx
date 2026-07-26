import Link from "next/link";
import { ArrowUpRight, Handshake, Search, Sparkles, Target, TrendingUp, Users } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePlatformModule } from "@/lib/platform";
import { orIlike } from "@/lib/pgrst";
import { CountUp } from "@/components/admin/count-up";
import { ExportButton } from "@/components/admin/export-button";
import { Input } from "@/components/ui/input";
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

export default async function AdminSalesPage({
  searchParams,
}: {
  searchParams: Promise<{ durum?: string; q?: string }>;
}) {
  await requirePlatformModule("sales");
  const sp = await searchParams;
  const filter = sp.durum && FILTERS.some((f) => f.key === sp.durum) ? sp.durum : "all";
  const q = (sp.q ?? "").trim();

  const admin = createAdminClient();
  const [{ data: all }, { data: staff }, searchRes] = await Promise.all([
    admin.from("demo_requests").select(DEMO_SELECT).order("created_at", { ascending: false }).limit(300),
    admin.from("platform_staff").select("id, full_name").eq("is_active", true),
    // Arama sunucu tarafında ilike ile daraltılır; KPI/huni sayıları tüm kayıtlardan gelmeye devam eder
    q
      ? admin
          .from("demo_requests")
          .select(DEMO_SELECT)
          .or(orIlike(["full_name", "phone", "company"], q))
          .order("created_at", { ascending: false })
          .limit(300)
      : Promise.resolve(null),
  ]);

  const rows = (all ?? []) as DemoRow[];
  const listRows = q ? ((searchRes?.data ?? []) as DemoRow[]) : rows;
  const staffList = staff ?? [];

  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();
  const newCount = rows.filter((r) => r.status === "new").length;
  const contacted = rows.filter((r) => r.status === "contacted").length;
  const qualified = rows.filter((r) => r.status === "qualified").length;
  const wonMonth = rows.filter((r) => r.status === "won" && new Date(r.created_at).getTime() >= monthStart).length;
  const wonTotal = rows.filter((r) => r.status === "won").length;
  const conversion = rows.length ? Math.round((wonTotal / rows.length) * 100) : 0;

  const visible = filter === "all" ? listRows : listRows.filter((r) => r.status === filter);

  // Filtre bağlantıları aktif aramayı korur
  const filterHref = (key: string) => {
    const params = new URLSearchParams();
    if (key !== "all") params.set("durum", key);
    if (q) params.set("q", q);
    const qs = params.toString();
    return qs ? `/admin/satis?${qs}` : "/admin/satis";
  };

  // pipeline funnel
  const funnel = [
    { label: "Yeni", href: "/admin/satis?durum=new", value: newCount, tone: "bg-brand-500" },
    { label: "İletişim", href: "/admin/satis?durum=contacted", value: contacted, tone: "bg-cyan-400" },
    { label: "Nitelikli", href: "/admin/satis?durum=qualified", value: qualified, tone: "bg-amber-400" },
    { label: "Kazanıldı", href: "/admin/satis?durum=won", value: wonTotal, tone: "bg-mint-500" },
  ];
  const funnelMax = Math.max(1, ...funnel.map((f) => f.value));

  const kpis = [
    { label: "Yeni talep", href: "/admin/satis?durum=new", value: newCount, icon: Sparkles, tone: "text-brand-400" },
    { label: "Nitelikli", href: "/admin/satis?durum=qualified", value: qualified, icon: Target, tone: "text-amber-400" },
    { label: "Bu ay kazanılan", href: "/admin/satis?durum=won", value: wonMonth, icon: Handshake, tone: "text-mint-400" },
    { label: "Dönüşüm", href: "/admin/satis?durum=won", value: conversion, suffix: "%", icon: TrendingUp, tone: "text-cyan-400" },
  ];

  return (
    <div className="space-y-5">
      <section className="theme-dark relative overflow-hidden rounded-[20px] bg-[image:var(--grad-ink)] p-6 text-white">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-30" />
        <div className="pointer-events-none absolute -right-14 -top-14 h-52 w-52 rounded-full bg-mint-500/20 blur-[90px]" />
        <div className="relative">
          <span className="flex items-center gap-2 text-xs font-semibold text-mint-400">
            <Handshake className="h-4 w-4" /> EmlakSoft · Satış hunisi
          </span>
          <h1 className="mt-2 font-display text-2xl font-extrabold text-white md:text-3xl">Demo talepleri & aday yönetimi</h1>
          <p className="mt-1 max-w-lg text-sm text-white/75">
            Tanıtım formundan gelen talepleri niteleyin, atayın ve aboneliğe dönüştürün.
          </p>
          <div className="mt-4">
            <ExportButton action={exportDemoRequestsCsv} label="Excel'e aktar" />
          </div>
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {kpis.map((k) => (
              <Link key={k.label} href={k.href} className="focus-ring group relative block rounded-[14px] border border-white/12 bg-white/8 p-3 backdrop-blur transition hover:border-white/25 hover:bg-white/12">
                <k.icon className={`h-4 w-4 ${k.tone}`} />
                <p className="mt-2 font-display text-xl font-extrabold text-white">
                  <CountUp value={k.value} suffix={k.suffix} />
                </p>
                <p className="text-[11px] text-white/70">{k.label}</p>
                <ArrowUpRight className="hover-action absolute right-2.5 top-2.5 h-3.5 w-3.5 text-white/40 opacity-0 transition group-hover:opacity-100" />
              </Link>
            ))}
          </div>
        </div>
      </section>

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
          const count =
            f.key === "all" ? listRows.length : listRows.filter((r) => r.status === f.key).length;
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
        <div className="dashboard-panel rounded-[18px] border border-line bg-surface py-16 text-center">
          <Users className="mx-auto h-8 w-8 text-text-faint" />
          <p className="mt-3 text-sm font-semibold text-ink-950">{q ? "Aramayla eşleşen talep yok" : "Bu filtrede talep yok"}</p>
          <p className="mt-1 text-xs text-text-muted">{q ? "Arama terimini değiştirip tekrar deneyin." : "Yeni demo talepleri buraya otomatik düşer."}</p>
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {visible.map((row) => (
            <DemoCard key={row.id} row={row} staff={staffList} />
          ))}
        </div>
      )}
    </div>
  );
}
