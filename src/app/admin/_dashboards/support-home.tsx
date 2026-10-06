import Link from "next/link";
import { ArrowUpRight, CheckCircle2, Clock, Inbox, LifeBuoy, Siren, Users } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { EmptyStateV3 } from "@/components/ui/empty-state-v3";
import { GlassKpi, HeroBanner, KpiCard } from "@/components/ui/premium";
import { Bento, Bx } from "@/components/ui/console/bento";
import { Ring } from "@/components/ui/console/ring";
import { DAY_MS, TR_OFFSET_MS, msSince, now, trParts } from "@/lib/clock";
import { adminEyebrow, adminGreeting, firstNameOf } from "./shared";

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

  const tp = trParts(now());
  const monthStart = Date.UTC(tp.year, tp.month, 1) - TR_OFFSET_MS;
  const resolvedThisMonth = rows.filter(
    (t) => ["resolved", "closed"].includes(t.status) && new Date(t.created_at).getTime() >= monthStart,
  ).length;

  const waitingQueue = [...openRows].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  const resolvedTotal = rows.filter((t) => ["resolved", "closed"].includes(t.status)).length;

  const priorities = ["urgent", "high", "normal", "low"].map((p) => ({
    key: p,
    label: priorityLabel[p],
    count: openRows.filter((t) => t.priority === p).length,
  }));
  const maxPr = Math.max(1, ...priorities.map((p) => p.count));

  const nowMs = now();
  const kpis = [
    { label: "Açık talep", href: "/admin/tickets?durum=open", value: open, sub: "Yeni, ilk yanıt bekleyen", subTone: undefined, icon: Inbox },
    { label: "İşleniyor", href: "/admin/tickets?durum=in_progress", value: inProgress, sub: "Ekipte çalışılan", subTone: undefined, icon: Clock },
    { label: "Yanıt bekliyor", href: "/admin/tickets?durum=waiting", value: waiting, sub: "Müşteri yanıtı bekleniyor", subTone: undefined, icon: LifeBuoy },
    { label: "Acil", href: "/admin/tickets?oncelik=urgent", value: urgent, sub: urgent > 0 ? "Hemen yanıt gerekli" : "Acil talep yok", subTone: urgent > 0 ? ("danger" as const) : undefined, icon: Siren },
  ];

  return (
    <div className="space-y-6">
      <HeroBanner
        eyebrow={adminEyebrow(nowMs, "Destek")}
        title={adminGreeting(nowMs)}
        highlight={firstNameOf(staffName)}
        summary={
          <p>
            {openRows.length > 0
              ? `${openRows.length} açık talep kuyrukta${urgent > 0 ? `, ${urgent} tanesi acil` : ""}.`
              : "Kuyrukta açık talep yok."}{" "}
            Bu ay {resolvedThisMonth} talep çözüldü.
          </p>
        }
      >
        {kpis.map((k) => (
          <GlassKpi
            key={k.label}
            label={k.label}
            value={k.value}
            sub={k.sub}
            subTone={k.subTone}
            href={k.href}
            icon={k.icon}
          />
        ))}
      </HeroBanner>

      <Bento>
        <Bx className="md:col-span-6 xl:col-span-7" eyebrow="Bekleme kuyruğu" icon={Clock} title="En uzun bekleyen açık talepler" href="/admin/tickets?durum=open">
          {waitingQueue.length === 0 ? (
            <EmptyStateV3 variant="compact" title="Bekleyen talep yok" description="Açık talep geldiğinde en uzun bekleyen başa gelir." />
          ) : (
            <ul className="-mx-1 space-y-0.5">
              {waitingQueue.slice(0, 6).map((t) => {
                const days = Math.floor(msSince(t.created_at) / DAY_MS);
                return (
                  <li key={t.id}>
                    <Link href={`/admin/tickets/${t.id}`} className="qrow focus-ring group">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-text">{t.subject}</span>
                        <span className="block truncate text-xs text-text-muted">{nameOf(t.tenant as Rel)} · {days > 0 ? `${days} gündür açık` : "bugün açıldı"}</span>
                      </span>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-bold ${priorityChip[t.priority] ?? "bg-ink-950/5 text-text-muted"}`}>
                        {priorityLabel[t.priority] ?? t.priority}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Bx>
        <Bx className="md:col-span-6 xl:col-span-5" eyebrow="Çözüm durumu" icon={CheckCircle2} title="Çözülen / toplam">
          {rows.length > 0 ? (
            <div className="flex flex-wrap items-center gap-5">
              <Ring value={resolvedTotal} max={rows.length} tone="success" size={104} ariaLabel={`Son ${rows.length} talebin ${resolvedTotal} tanesi çözüldü`}>
                <span>
                  <span className="num block text-xl text-text">%{Math.round((resolvedTotal / rows.length) * 100)}</span>
                  <span className="block text-xs text-text-muted">çözüldü</span>
                </span>
              </Ring>
              <div className="min-w-0 flex-1 basis-40 space-y-1">
                <Link href="/admin/tickets?durum=resolved" className="qrow focus-ring justify-between">
                  <span className="text-sm text-text-muted">Çözülen</span>
                  <span className="num text-sm text-text">{resolvedTotal}</span>
                </Link>
                <Link href="/admin/tickets?durum=open" className="qrow focus-ring justify-between">
                  <span className="text-sm text-text-muted">Açık kuyruk</span>
                  <span className="num text-sm text-text">{openRows.length}</span>
                </Link>
                <p className="px-3 text-xs text-text-faint">Son {rows.length} talep üzerinden</p>
              </div>
            </div>
          ) : (
            <EmptyStateV3 variant="compact" title="Henüz destek talebi yok" description="Talepler geldikçe çözüm oranı burada görünür." />
          )}
        </Bx>
      </Bento>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Bu ay çözülen" value={resolvedThisMonth} href="/admin/tickets?durum=resolved" icon={CheckCircle2} tone="success" hint="Çözüldü veya kapatıldı" />
        <KpiCard label="Açık kuyruk" value={openRows.length} href="/admin/tickets?durum=open" icon={LifeBuoy} tone="warn" hint="Açık, işleniyor ve yanıt bekleyen" />
        <KpiCard label="Acil talep" value={urgent} href="/admin/tickets?oncelik=urgent" icon={Siren} tone={urgent > 0 ? "danger" : "success"} attention={urgent > 0} hint={urgent > 0 ? "Hemen yanıt bekliyor" : "Acil talep yok"} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_1.3fr]">
        {/* Öncelik dağılımı */}
        <section className="dashboard-panel rounded-[var(--radius-panel)] border border-line bg-surface p-5">
          <p className="flex items-center gap-2 text-xs font-semibold text-brand-600">
            <Siren className="h-4 w-4" /> Açık kuyruk önceliği
          </p>
          <h2 className="mt-1 font-display font-bold text-ink-950">Öncelik dağılımı</h2>
          <div className="mt-5 space-y-3">
            {priorities.map((p, i) => (
              <Link key={p.key} href={`/admin/tickets?oncelik=${p.key}`} className="focus-ring group block rounded-[var(--radius-control)]">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-ink-950 transition group-hover:text-brand-600">{p.label}</span>
                  <span className="tabular-nums text-text-muted">{p.count}</span>
                </div>
                <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-ink-950/5">
                  <div
                    className={`h-full rounded-full transition group-hover:brightness-110 ${p.key === "urgent" ? "bg-danger-500" : p.key === "high" ? "bg-amber-400" : "bg-brand-500"}`}
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
        <section className="dashboard-panel rounded-[var(--radius-panel)] border border-line bg-surface p-5">
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
                className="flex items-center justify-between gap-3 rounded-[var(--radius-card)] border border-line bg-canvas/60 px-3 py-2.5 transition hover:border-brand-300"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-ink-950">{t.subject}</p>
                  <p className="text-xs text-text-faint">
                    {nameOf(t.tenant as Rel)} · {statusLabel[t.status] ?? t.status} · {new Date(t.created_at).toLocaleDateString("tr-TR")}
                  </p>
                </div>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-bold ${priorityChip[t.priority] ?? "bg-ink-950/5 text-text-muted"}`}>
                  {priorityLabel[t.priority] ?? t.priority}
                </span>
              </Link>
            ))}
            {openRows.length === 0 ? <EmptyStateV3 variant="compact" title="Açık talep yok" description="Kuyruk temiz; yeni talepler burada görünür." /> : null}
          </div>
        </section>
      </div>

      <section className="grid gap-3 sm:grid-cols-2">
        {[
          { href: "/admin/tickets", title: "Destek kuyruğu", desc: `${openRows.length} açık talep`, icon: LifeBuoy, tone: "bg-mint-500/12 text-mint-600" },
          { href: "/admin/members", title: "Kullanıcılar", desc: "Tüm ofis kullanıcıları", icon: Users, tone: "bg-brand-600/10 text-brand-600" },
        ].map((card) => (
          <Link key={card.title} href={card.href} className="lift group relative overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface p-4 transition hover:border-brand-300">
            <span className={`grid h-10 w-10 place-items-center rounded-[var(--radius-card)] ${card.tone}`}>
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
