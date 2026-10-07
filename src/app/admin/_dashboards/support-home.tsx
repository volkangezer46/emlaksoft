import Link from "@/components/ui/smart-link";
import { CheckCircle2, Clock, Inbox, LifeBuoy, Siren } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { EmptyState } from "@/components/ui/empty-state";
import { DashboardHero } from "@/components/ui/dashboard-hero";
import { KpiCard, KpiGrid } from "@/components/ui/kpi-card";
import { ChartCard } from "@/components/ui/chart-frame";
import { AttentionList, type AttentionLevel } from "@/components/ui/attention-list";
import { Ring } from "@/components/ui/console/ring";
import { DataFreshness } from "@/components/ui/data-freshness";
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

/** Destek önceliği → dikkat listesi önem düzeyi (Acil/Yüksek/Orta/Düşük). */
const priorityLevel: Record<string, AttentionLevel> = { urgent: "acil", high: "yuksek", normal: "orta", low: "dusuk" };
const priorityTone: Record<string, string> = { urgent: "danger", high: "warn", normal: "brand", low: "neutral" };

type Rel = { name?: string } | { name?: string }[] | null;
function nameOf(v: Rel) {
  if (!v) return "—";
  return Array.isArray(v) ? (v[0]?.name ?? "—") : (v.name ?? "—");
}

/** Destek rolünün açılış paneli (tasarım sistemi v4: DashboardHero + KpiGrid + AttentionList + ChartCard). */
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

  const nowMs = now();
  const tp = trParts(nowMs);
  const monthStart = Date.UTC(tp.year, tp.month, 1) - TR_OFFSET_MS;
  const resolvedThisMonth = rows.filter((t) => ["resolved", "closed"].includes(t.status) && new Date(t.created_at).getTime() >= monthStart).length;

  const waitingQueue = [...openRows].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  const resolvedTotal = rows.filter((t) => ["resolved", "closed"].includes(t.status)).length;

  const priorities = ["urgent", "high", "normal", "low"].map((p) => ({
    key: p,
    label: priorityLabel[p],
    count: openRows.filter((t) => t.priority === p).length,
  }));
  const maxPr = Math.max(1, ...priorities.map((p) => p.count));
  const oldest = waitingQueue[0];

  return (
    <div className="space-y-5">
      <DashboardHero
        eyebrow={adminEyebrow(nowMs, "Destek")}
        title={`${adminGreeting(nowMs)}${firstNameOf(staffName) ? `, ${firstNameOf(staffName)}` : ""}`}
        summary={
          oldest ? (
            <p>
              Önce en uzun bekleyeni yanıtlayın:{" "}
              <Link href={`/admin/tickets/${oldest.id}`} className="focus-ring rounded-sm font-semibold text-accent-text hover:underline">
                {oldest.subject}
              </Link>
              .
            </p>
          ) : (
            <p>Kuyruk temiz: açık destek talebi yok.</p>
          )
        }
        freshness={<DataFreshness asOf={nowMs} />}
      />

      <KpiGrid label="Destek özet göstergeleri">
        <KpiCard layout="inline" label="Açık talep" value={open} href="/admin/tickets?durum=open" icon={Inbox} tone="brand" hint="Yeni, ilk yanıt bekleyen" />
        <KpiCard layout="inline" label="İşleniyor" value={inProgress} href="/admin/tickets?durum=in_progress" icon={Clock} tone="neutral" hint="Ekipte çalışılan" />
        <KpiCard layout="inline" label="Yanıt bekliyor" value={waiting} href="/admin/tickets?durum=waiting" icon={LifeBuoy} tone="warn" hint="Müşteri yanıtı bekleniyor" />
        <KpiCard
          layout="inline"
          tinted={urgent > 0}
          label="Acil"
          value={urgent}
          href="/admin/tickets?oncelik=urgent"
          icon={Siren}
          tone={urgent > 0 ? "danger" : "success"}
          attention={urgent > 0}
          hint={urgent > 0 ? "Hemen yanıt gerekli" : "Acil talep yok"}
        />
        <KpiCard layout="inline" label="Bu ay çözülen" value={resolvedThisMonth} href="/admin/tickets?durum=resolved" icon={CheckCircle2} tone="success" hint="Çözüldü veya kapatıldı" />
      </KpiGrid>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-6 xl:grid-cols-12">
        <div className="min-w-0 md:col-span-6 xl:col-span-7">
          <AttentionList
            title="En uzun bekleyen açık talepler"
            subtitle="Bekleme süresine göre; önem öncelikten gelir."
            items={waitingQueue.slice(0, 7).map((t) => {
              const days = Math.floor(msSince(t.created_at) / DAY_MS);
              return {
                id: t.id,
                label: t.subject,
                hint: `${nameOf(t.tenant as Rel)} · ${statusLabel[t.status] ?? t.status} · ${days > 0 ? `${days} gündür açık` : "bugün açıldı"}`,
                href: `/admin/tickets/${t.id}`,
                level: priorityLevel[t.priority] ?? "orta",
              };
            })}
            emptyTitle="Bekleyen talep yok"
            emptyDescription="Açık talep geldiğinde en uzun bekleyen başa gelir."
          />
        </div>
        <div className="grid min-w-0 gap-4 md:col-span-6 xl:col-span-5">
          <ChartCard as="h2" title="Çözüm durumu" subtitle={`Son ${rows.length} talep`} icon={CheckCircle2} tone="success" height={0}>
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
                </div>
              </div>
            ) : (
              <EmptyState variant="compact" illustration="gelenKutusu" title="Henüz destek talebi yok" description="Talepler geldikçe çözüm oranı burada görünür." />
            )}
          </ChartCard>
          <ChartCard as="h2" title="Öncelik dağılımı" subtitle="Açık kuyruk" icon={Siren} tone="warn" height={0}>
            <ul className="space-y-3">
              {priorities.map((p) => (
                <li key={p.key}>
                  <Link href={`/admin/tickets?oncelik=${p.key}`} className="focus-ring group block rounded-[var(--radius-control)]">
                    <span className="flex items-center justify-between text-sm">
                      <span className="font-medium text-text group-hover:text-accent-text">{p.label}</span>
                      <span className="ds-num text-sm">{p.count}</span>
                    </span>
                    <span className={`ds-bar pm-t-${priorityTone[p.key]} mt-1.5`}>
                      <span className="motion-progress-fill" style={{ width: `${Math.max((p.count / maxPr) * 100, p.count > 0 ? 3 : 0)}%` }} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </ChartCard>
        </div>
      </div>
    </div>
  );
}
