import Link from "@/components/ui/smart-link";
import { AlertTriangle, CircleDollarSign, HandCoins, Percent, Receipt } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePlatformModule } from "@/lib/platform";
import { now as clockNow } from "@/lib/clock";
import { formatDateTimeTr, formatDateTr, formatTryAmount } from "@/lib/format";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { StatRow } from "@/components/ui/stat-row";
import { FilterChip } from "@/components/ui/filter-chip";
import { EmptyState } from "@/components/ui/empty-state";
import { RegistrySettings } from "@/components/settings/registry-settings";
import { DUNNING_KEYS, loadDunningPolicy } from "@/lib/billing/dunning-policy";
import { computeRecoveryReport, parseRecoveryList, RECOVERY_WINDOW_DAYS, type RecoveryList, type ReportInvoice } from "@/lib/billing/dunning-report";
import { BillingNav } from "../billing-nav";

export const metadata = { title: "Tahsilat" };

const LIST_LIMIT = 5000;
const DAY_MS = 86_400_000;

const LIST_LABEL: Record<RecoveryList, string> = {
  basarisiz: "Başarısız tahsilatlar",
  kurtarilan: "Kurtarılan ödemeler",
  kayip: "İstemsiz kayıp",
};

const RESULT_LABEL: Record<string, string> = {
  sent: "Gönderildi",
  channel_disabled: "Kanal kapalı",
  no_recipient: "Alıcı yok",
  failed: "Başarısız",
  pending: "Gönderiliyor",
  suspended: "Askı uygulandı",
};
const STAGE_LABEL: Record<string, string> = {
  stage1: "1. kademe",
  stage2: "2. kademe",
  stage3: "3. kademe",
  final_warning: "Son uyarı",
  suspend: "Otomatik askı",
  candidate: "Askı adayı",
};
const CHANNEL_LABEL: Record<string, string> = { in_app: "Uygulama içi", email: "E-posta", sms: "SMS", staff: "Personel", system: "Sistem" };

type EventRow = { id: number; tenant_id: string; invoice_id: string | null; stage: string; channel: string; result: string; detail: string | null; sent_at: string; tenant: unknown };

function tenantName(t: unknown): string {
  const v = (Array.isArray(t) ? t[0] : t) as { name?: string } | null;
  return v?.name ?? "—";
}

function pct(n: number | null): string {
  if (n === null) return "—";
  return `%${new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 1 }).format(n * 100)}`;
}

function href(p: { liste?: RecoveryList; sonuc?: string }) {
  const sp = new URLSearchParams();
  if (p.liste && p.liste !== "basarisiz") sp.set("liste", p.liste);
  if (p.sonuc) sp.set("sonuc", p.sonuc);
  const s = sp.toString();
  return s ? `/admin/billing/tahsilat?${s}` : "/admin/billing/tahsilat";
}

/**
 * Abonelik & fatura > Tahsilat: kurtarma raporu (son 90 gün, fatura verisinden; tanımlar `dunning-report.ts`),
 * tahsilat günlüğü (`dunning_events`) ve dunning politikası ayarları (tek düzenleme yeri).
 */
export default async function DunningPage({ searchParams }: { searchParams?: Promise<{ liste?: string; sonuc?: string }> }) {
  const staff = await requirePlatformModule("billing");
  const sp = (await searchParams) ?? {};
  const list = parseRecoveryList(sp.liste);
  const sonuc = sp.sonuc && RESULT_LABEL[sp.sonuc] ? sp.sonuc : undefined;
  const nowMs = clockNow();
  const since = new Date(nowMs - RECOVERY_WINDOW_DAYS * DAY_MS).toISOString();

  const admin = createAdminClient();
  let eventsQuery = admin
    .from("dunning_events")
    .select("id, tenant_id, invoice_id, stage, channel, result, detail, sent_at, tenant:tenants(name)")
    .gte("sent_at", since)
    .order("sent_at", { ascending: false })
    .limit(50);
  if (sonuc) eventsQuery = eventsQuery.eq("result", sonuc);

  const [policy, invRes, payingRes, eventsRes, resultRes] = await Promise.all([
    loadDunningPolicy(),
    admin
      .from("invoices")
      .select("id, tenant_id, invoice_no, status, total_try, due_at, paid_at, period_start, period_end, tenant:tenants(name)")
      .in("status", ["open", "paid", "uncollectible"])
      .not("due_at", "is", null)
      .or(`due_at.gte.${since},paid_at.gte.${since}`)
      .order("due_at", { ascending: false })
      .limit(LIST_LIMIT),
    admin.from("subscriptions").select("id", { count: "exact", head: true }).in("status", ["active", "past_due"]),
    eventsQuery,
    admin.from("dunning_events").select("result").gte("sent_at", since).limit(LIST_LIMIT),
  ]);

  const invoices = (invRes.data ?? []) as (ReportInvoice & { tenant: unknown })[];
  const lastStageDays = policy.stages[policy.stages.length - 1]?.days ?? 8;
  const lossThresholdDays = policy.autoSuspendDays > 0 ? Math.min(lastStageDays, policy.autoSuspendDays) : lastStageDays;
  const report = computeRecoveryReport({ invoices, payingTenants: payingRes.count ?? 0, lossThresholdDays, nowMs });
  const truncated = invoices.length >= LIST_LIMIT;
  const eventsMissing = Boolean(eventsRes.error);
  const events = (eventsRes.data ?? []) as EventRow[];
  const resultCounts = new Map<string, number>();
  for (const r of (resultRes.data ?? []) as { result: string }[]) resultCounts.set(r.result, (resultCounts.get(r.result) ?? 0) + 1);

  const rows = list === "kurtarilan" ? report.recovered : list === "kayip" ? report.lost : report.failed;
  const shown = rows.slice(0, 100) as (ReportInvoice & { tenant: unknown })[];

  return (
    <div className="space-y-6">
      <AdminPageHeader
        art="coins"
        icon={HandCoins}
        eyebrow="Faturalama · tahsilat"
        title="Tahsilat"
        description={`Gecikmiş ödemelerin takibi (dunning): son ${RECOVERY_WINDOW_DAYS} günün kurtarma raporu, gönderilen hatırlatmaların günlüğü ve tahsilat politikası. Kademeler şu an ${policy.stages.map((s) => s.days).join(" / ")}. gün; otomatik askı ${policy.autoSuspendDays > 0 ? `${policy.autoSuspendDays}. gün` : "kapalı"}.`}
      />
      <BillingNav active="tahsilat" />

      <StatRow
        label="Kurtarma raporu"
        items={[
          { label: "Başarısız tahsilat", value: report.failedCount, href: href({ liste: "basarisiz" }), hint: `son ${RECOVERY_WINDOW_DAYS} gün`, icon: <AlertTriangle className="h-4 w-4" />, attention: true },
          { label: "Kurtarılan tutar", value: formatTryAmount(report.recoveredAmount), href: href({ liste: "kurtarilan" }), hint: `${report.recoveredCount} fatura`, icon: <CircleDollarSign className="h-4 w-4" /> },
          { label: "Kurtarılan MRR", value: formatTryAmount(report.recoveredMrr), href: href({ liste: "kurtarilan" }), hint: "aylık karşılık", icon: <Receipt className="h-4 w-4" /> },
          {
            label: "İstemsiz kayıp oranı",
            value: pct(report.involuntaryChurnRate),
            href: href({ liste: "kayip" }),
            hint: `${report.lostTenants} / ${report.payingTenants} ücretli ofis`,
            icon: <Percent className="h-4 w-4" />,
            attention: report.lostTenants > 0,
          },
        ]}
      />
      <p className="text-xs text-text-muted">
        Başarısız tahsilat: vadesi son {RECOVERY_WINDOW_DAYS} günde geçen ve vadesinde ödenmeyen fatura. Kurtarılan: vadeden sonra ödenen,
        ödemesi son {RECOVERY_WINDOW_DAYS} günde alınan fatura (tutar fatura toplamıdır; MRR yıllık faturada ÷12). İstemsiz kayıp: {lossThresholdDays}
        gündür açık ya da tahsil edilemedi işaretli faturası olan ofis ÷ aktif + gecikmiş abonelikli ofis.
        {truncated ? ` Liste ${LIST_LIMIT} faturada kesildi; sayılar eksik olabilir.` : ""}
      </p>

      <section className="overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-4">
          <h2 className="font-display font-bold text-ink-950">
            {LIST_LABEL[list]} <span className="ml-1 rounded-full bg-brand-600/10 px-2.5 py-0.5 text-xs font-bold text-brand-600">{rows.length}</span>
          </h2>
          <nav aria-label="Rapor listesi" className="flex flex-wrap gap-1">
            {(Object.keys(LIST_LABEL) as RecoveryList[]).map((k) => (
              <FilterChip key={k} href={href({ liste: k, sonuc })} active={list === k}>
                {LIST_LABEL[k]}
              </FilterChip>
            ))}
          </nav>
        </div>
        {shown.length === 0 ? (
          <EmptyState variant="compact" bare icon={HandCoins} tone="mint" title="Bu listede fatura yok" description={`Son ${RECOVERY_WINDOW_DAYS} günde bu tanıma uyan fatura bulunmadı.`} />
        ) : (
          <ul className="divide-y divide-line">
            {shown.map((inv) => (
              <li key={inv.id}>
                <Link href={`/admin/billing/faturalar/${inv.id}`} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm hover:bg-surface-hover">
                  <span className="min-w-0">
                    <span className="font-semibold text-ink-950">{inv.invoice_no}</span>
                    <span className="ml-2 text-text-muted">{tenantName(inv.tenant)}</span>
                  </span>
                  <span className="flex flex-wrap items-center gap-3 text-xs text-text-muted">
                    <span>Vade {inv.due_at ? formatDateTr(inv.due_at) : "—"}</span>
                    <span>{inv.paid_at ? `Ödendi ${formatDateTr(inv.paid_at)}` : inv.status === "uncollectible" ? "Tahsil edilemedi" : "Açık"}</span>
                    <span className="font-semibold text-ink-950">{formatTryAmount(Number(inv.total_try ?? 0))}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {rows.length > shown.length ? <p className="border-t border-line px-5 py-3 text-xs text-text-muted">İlk {shown.length} fatura gösteriliyor.</p> : null}
      </section>

      <section className="overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-4">
          <h2 className="font-display font-bold text-ink-950">Tahsilat günlüğü</h2>
          {!eventsMissing ? (
            <nav aria-label="Günlük sonucu" className="flex flex-wrap gap-1">
              <FilterChip href={href({ liste: list })} active={!sonuc}>
                Tümü
              </FilterChip>
              {Object.keys(RESULT_LABEL).map((k) => (
                <FilterChip key={k} href={href({ liste: list, sonuc: k })} active={sonuc === k}>
                  {RESULT_LABEL[k]} · {resultCounts.get(k) ?? 0}
                </FilterChip>
              ))}
            </nav>
          ) : null}
        </div>
        {eventsMissing ? (
          <EmptyState variant="compact" bare icon={Receipt} title="Tahsilat günlüğü kurulum bekliyor" description="dunning_events tablosu henüz yok (migration 20261013004200). Bu sürede yalnız uygulama içi hatırlatmalar gider." />
        ) : events.length === 0 ? (
          <EmptyState variant="compact" bare icon={Receipt} tone="mint" title="Günlükte kayıt yok" description={sonuc ? "Bu sonuçla kayıt bulunmadı." : `Son ${RECOVERY_WINDOW_DAYS} günde tahsilat hatırlatması gönderilmedi.`} />
        ) : (
          <ul className="divide-y divide-line">
            {events.map((e) => (
              <li key={e.id}>
                <Link href={`/admin/tenants/${e.tenant_id}?sekme=zaman`} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm hover:bg-surface-hover">
                  <span className="min-w-0">
                    <span className="font-semibold text-ink-950">{tenantName(e.tenant)}</span>
                    <span className="ml-2 text-text-muted">
                      {STAGE_LABEL[e.stage] ?? e.stage} · {CHANNEL_LABEL[e.channel] ?? e.channel}
                    </span>
                  </span>
                  <span className="flex flex-wrap items-center gap-3 text-xs text-text-muted">
                    <span className={e.result === "sent" || e.result === "suspended" ? "text-success-600" : "text-warn-600"}>{RESULT_LABEL[e.result] ?? e.result}</span>
                    {e.detail ? <span className="max-w-[18rem] truncate">{e.detail}</span> : null}
                    <span>{formatDateTimeTr(e.sent_at)}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <RegistrySettings
        title="Tahsilat politikası"
        description="Kademe günleri, kademe kanalları ve mesajları, otomatik askıya alma (varsayılan kapalı), askıdan önce son uyarı ve otomatik yenileme deneme sınırları. E-posta/SMS kanalı anahtar tanımlı değilken gönderim yapılmaz, günlüğe 'kanal kapalı' yazılır."
        keys={DUNNING_KEYS}
        canEdit={staff.role === "super_admin"}
      />
    </div>
  );
}
