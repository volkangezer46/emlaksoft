import Link from "next/link";
import { ArrowUpRight, Clock, Inbox, LifeBuoy, Siren, Users } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { CountUp } from "@/components/admin/count-up";

const statusLabel: Record<string, string> = {
  open: "Açık",
  in_progress: "İşleniyor",
  waiting: "Yanıt bekliyor",
  resolved: "Çözüldü",
  closed: "Kapalı",
};

const priorityLabel: Record<string, string> = {
  low: "Düşük",
  normal: "Normal",
  high: "Yüksek",
  urgent: "Acil",
};

const priorityChip: Record<string, string> = {
  low: "bg-ink-950/5 text-text-muted",
  normal: "bg-brand-600/10 text-brand-600",
  high: "bg-amber-400/15 text-amber-600",
  urgent: "bg-danger-500/10 text-danger-500",
};

type Rel = { name?: string } | { name?: string }[] | null;
function nameOf(v: Rel) {
  if (!v) return "—";
  return Array.isArray(v) ? (v[0]?.name ?? "—") : (v.name ?? "—");
}

export async function SupportHome({ staffName }: { staffName: string }) {
  const admin = createAdminClient();

  const { data } = await admin
    .from("support_tickets")
    .select("id, subject, priority, status, created_at, tenant:tenants(name)")
    .order("created_at", { ascending: false })
    .limit(200);

  const rows = data ?? [];
  const openRows = rows.filter((t) => ["open", "in_progress", "waiting"].includes(t.status));
  const open = rows.filter((t) => t.status === "open").length;
  const inProgress = rows.filter((t) => t.status === "in_progress").length;
  const waiting = rows.filter((t) => t.status === "waiting").length;
  const urgent = openRows.filter((t) => t.priority === "urgent").length;

  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();
  const resolvedThisMonth = rows.filter(
    (t) => ["resolved", "closed"].includes(t.status) && new Date(t.created_at).getTime() >= monthStart,
  ).length;

  const priorities = ["urgent", "high", "normal", "low"].map((p) => ({
    key: p,
    label: priorityLabel[p],
    count: openRows.filter((t) => t.priority === p).length,
  }));
  const maxPr = Math.max(1, ...priorities.map((p) => p.count));

  const kpis = [
    { label: "Açık talep", href: "/admin/tickets?durum=open", value: open, icon: Inbox, tone: "text-brand-400" },
    { label: "İşleniyor", href: "/admin/tickets?durum=in_progress", value: inProgress, icon: Clock, tone: "text-cyan-400" },
    { label: "Yanıt bekliyor", href: "/admin/tickets?durum=waiting", value: waiting, icon: LifeBuoy, tone: "text-amber-400" },
    { label: "Acil", href: "/admin/tickets?oncelik=urgent", value: urgent, icon: Siren, tone: "text-danger-400" },
  ];

  return (
    <div className="space-y-6">
      <section className="theme-dark relative overflow-hidden rounded-[22px] bg-[image:var(--grad-ink)] p-6 text-white">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-35" />
        <div className="pointer-events-none absolute -right-14 -top-16 h-64 w-64 rounded-full bg-brand-500/25 blur-[90px]" />
        <div className="relative">
          <span className="flex items-center gap-2 text-xs font-semibold text-brand-300">
            <span className="status-pulse h-2 w-2 rounded-full bg-brand-400" /> EmlakSoft · Müşteri temsilcisi
          </span>
          <h1 className="mt-2 font-display text-2xl font-extrabold text-white md:text-3xl">Destek kontrol paneli</h1>
          <p className="mt-1 max-w-lg text-sm text-white/75">
            Merhaba {staffName}. Açık talepleri önceliklendirin ve müşterilere hızlı dönün.
          </p>
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {kpis.map((k) => (
              <Link key={k.label} href={k.href} className="focus-ring group relative block rounded-[14px] border border-white/12 bg-white/8 p-3 backdrop-blur transition hover:border-white/25 hover:bg-white/12">
                <k.icon className={`h-4 w-4 ${k.tone}`} />
                <p className="mt-2 font-display text-xl font-extrabold text-white"><CountUp value={k.value} /></p>
                <p className="text-[11px] text-white/70">{k.label}</p>
                <ArrowUpRight className="hover-action absolute right-2.5 top-2.5 h-3.5 w-3.5 text-white/40 opacity-0 transition group-hover:opacity-100" />
              </Link>
            ))}
          </div>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-[1fr_1.3fr]">
        {/* Öncelik dağılımı */}
        <section className="dashboard-panel rounded-[20px] border border-line bg-surface p-5">
          <p className="flex items-center gap-2 text-xs font-semibold text-brand-600">
            <Siren className="h-4 w-4" /> Açık kuyruk önceliği
          </p>
          <h2 className="mt-1 font-display font-bold text-ink-950">Öncelik dağılımı</h2>
          <div className="mt-5 space-y-3">
            {priorities.map((p, i) => (
              <Link key={p.key} href={`/admin/tickets?oncelik=${p.key}`} className="focus-ring group block rounded-[8px]">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-ink-950 transition group-hover:text-brand-600">{p.label}</span>
                  <span className="tabular-nums text-text-muted">{p.count}</span>
                </div>
                <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-ink-950/5">
                  <div
                    className={`bar-live h-full rounded-full transition group-hover:brightness-110 ${p.key === "urgent" ? "bg-danger-500" : p.key === "high" ? "bg-amber-400" : "bg-brand-500"}`}
                    style={{ width: `${Math.max((p.count / maxPr) * 100, 3)}%`, animationDelay: `${i * 0.08}s` }}
                  />
                </div>
              </Link>
            ))}
          </div>
          <Link href="/admin/tickets?durum=resolved" className="focus-ring group mt-5 flex items-center justify-between border-t border-line pt-4">
            <span className="text-xs text-text-muted transition group-hover:text-brand-600">Bu ay çözülen</span>
            <span className="flex items-center gap-1 font-display text-lg font-extrabold text-mint-600">
              {resolvedThisMonth}
              <ArrowUpRight className="hover-action h-3.5 w-3.5 text-text-faint opacity-0 transition group-hover:text-brand-600 group-hover:opacity-100" />
            </span>
          </Link>
        </section>

        {/* Açık talepler */}
        <section className="dashboard-panel rounded-[20px] border border-line bg-surface p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="flex items-center gap-2 text-xs font-semibold text-mint-600">
                <Inbox className="h-4 w-4" /> Bekleyen kuyruk
              </p>
              <h2 className="mt-1 font-display font-bold text-ink-950">Açık talepler</h2>
            </div>
            <Link href="/admin/tickets" className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600">
              Tümü <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          </div>
          <div className="mt-4 space-y-2">
            {openRows.slice(0, 8).map((t) => (
              <Link
                key={t.id}
                href={`/admin/tickets/${t.id}`}
                className="flex items-center justify-between gap-3 rounded-[12px] border border-line bg-canvas/60 px-3 py-2.5 transition hover:border-brand-300"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-ink-950">{t.subject}</p>
                  <p className="text-[11px] text-text-faint">
                    {nameOf(t.tenant as Rel)} · {statusLabel[t.status] ?? t.status} · {new Date(t.created_at).toLocaleDateString("tr-TR")}
                  </p>
                </div>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${priorityChip[t.priority] ?? "bg-ink-950/5 text-text-muted"}`}>
                  {priorityLabel[t.priority] ?? t.priority}
                </span>
              </Link>
            ))}
            {openRows.length === 0 ? <p className="py-6 text-center text-sm text-text-muted">Açık talep yok. 🎉</p> : null}
          </div>
        </section>
      </div>

      <section className="grid gap-3 sm:grid-cols-2">
        {[
          { href: "/admin/tickets", title: "Destek kuyruğu", desc: `${openRows.length} açık talep`, icon: LifeBuoy, tone: "bg-mint-500/12 text-mint-600" },
          { href: "/admin/members", title: "Kullanıcılar", desc: "Tüm ofis kullanıcıları", icon: Users, tone: "bg-brand-600/10 text-brand-600" },
        ].map((card) => (
          <Link key={card.title} href={card.href} className="lift group relative overflow-hidden rounded-[16px] border border-line bg-surface p-4 transition hover:border-brand-300">
            <span className={`grid h-10 w-10 place-items-center rounded-[12px] ${card.tone}`}>
              <card.icon className="h-5 w-5" />
            </span>
            <p className="mt-3 font-display font-bold text-ink-950">{card.title}</p>
            <p className="mt-0.5 text-xs text-text-muted">{card.desc}</p>
            <ArrowUpRight className="absolute right-4 top-4 h-4 w-4 text-text-faint transition group-hover:text-brand-600" />
          </Link>
        ))}
      </section>
    </div>
  );
}
