import Link from "@/components/ui/smart-link";
import { BarChart3, BellRing, Bookmark, Users } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { BarColumns } from "@/components/ui/viz/bar-columns";
import { reportChartFromTable } from "@/lib/report-center/chart";
import type { Personalization, ReportSubscriptionItem } from "@/lib/report-center/personal";
import { sameFilters } from "@/lib/report-center/saved-views";
import { DELIVERY_HOUR_LABEL, hasDateRange, isSchedulable } from "@/lib/report-center/schedule";
import { REPORT_FORMAT_LABELS, type Filters, type ReportDef, type ReportScope, type ReportTable } from "@/lib/report-center/types";
import { formatDateTimeTr } from "@/lib/report-center/values";
import { DeleteViewButton, SaveViewButton, SubscriptionActions, SubscriptionForm } from "./personal-forms";

/**
 * Rapor merkezi kişiselleştirme panelleri (SUNUCU, DG4): kayıtlı görünümler, zamanlanmış abonelikler, katalog
 * özeti ve önizleme grafiği. Formlar istemci adasıdır (`personal-forms.tsx`); grafik saf HTML/CSS (`BarColumns`,
 * istemci JS yok) ve kapalı `<details>` içinde: önizleme tablosundan türetilir, ek sorgu yapmaz.
 */

const STATUS: Record<string, { label: string; tone: "success" | "attention" | "neutral" }> = {
  sent: { label: "Gönderildi", tone: "success" },
  partial: { label: "Kısmen gönderildi", tone: "attention" },
  channel_disabled: { label: "E-posta kanalı kapalı", tone: "attention" },
  failed: { label: "Gönderilemedi", tone: "attention" },
  skipped: { label: "Atlandı", tone: "neutral" },
};

function SetupPending() {
  return <p className="text-xs text-text-muted">Bu özellik için veritabanı güncellemesi bekleniyor.</p>;
}

export function SavedViewsCard({ scope, def, filters, data }: { scope: ReportScope; def: ReportDef; filters: Filters; data: Personalization }) {
  const current = Object.fromEntries(Object.entries(filters).filter((e): e is [string, string] => Boolean(e[1])));
  return (
    <Card>
      <CardHeader>
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2"><Bookmark className="h-4 w-4 text-text-faint" aria-hidden />Kayıtlı görünümler</CardTitle>
          <CardDescription>Filtre setini adlandırıp kaydedin; açınca filtreler aynen gelir.</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {!data.ready ? (
          <SetupPending />
        ) : (
          <>
            {data.views.length === 0 ? (
              <p className="text-xs text-text-muted">Bu rapor için kayıtlı görünüm yok.</p>
            ) : (
              <ul className="flex flex-wrap gap-1.5" aria-label="Kayıtlı görünümler">
                {data.views.map((v) => {
                  const active = sameFilters(v.filters, filters);
                  return (
                    <li
                      key={v.id}
                      className={`inline-flex items-center rounded-full border text-xs font-semibold ${active ? "border-brand-300 bg-surface-selected text-brand-700" : "border-line bg-surface text-text-muted"}`}
                    >
                      <Link href={v.href} aria-current={active ? "page" : undefined} className="focus-ring inline-flex min-h-8 items-center gap-1 rounded-full pl-3 pr-2 hover:text-accent-text touch:min-h-11">
                        {v.name}
                        {v.shared ? <Users className="h-3 w-3" aria-label="Paylaşılan" /> : null}
                      </Link>
                      {v.mine ? <DeleteViewButton scope={scope} id={v.id} name={v.name} /> : null}
                    </li>
                  );
                })}
              </ul>
            )}
            <SaveViewButton
              scope={scope}
              reportId={def.id}
              filters={current}
              shareLabel={scope === "platform" ? "Tüm personelle paylaş" : "Ofisteki herkesle paylaş (yalnız bu rapora yetkisi olanlar görür)"}
            />
          </>
        )}
      </CardContent>
    </Card>
  );
}

function SubscriptionLine({ scope, s, showReport }: { scope: ReportScope; s: ReportSubscriptionItem; showReport?: boolean }) {
  const st = s.lastStatus ? STATUS[s.lastStatus] : null;
  return (
    <li className="space-y-1 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-text">{s.name}</span>
        {!s.active ? <StatusBadge tone="neutral">Durduruldu</StatusBadge> : null}
        {st ? <StatusBadge tone={st.tone}>{st.label}</StatusBadge> : null}
      </div>
      {showReport && s.reportHref ? (
        <Link href={s.reportHref} className="focus-ring text-xs font-semibold text-text-muted hover:text-accent-text">
          {s.reportTitle}
        </Link>
      ) : null}
      <p className="text-xs text-text-muted">
        {s.schedule} · {REPORT_FORMAT_LABELS[s.format]} · {s.recipients.join(", ")}
      </p>
      <p className="text-xs text-text-faint">
        {s.active ? `Sıradaki gönderim: ${formatDateTimeTr(s.nextRunAt).slice(0, 10)}` : "Gönderim durduruldu"}
        {s.lastRunAt ? ` · Son: ${formatDateTimeTr(s.lastRunAt)}` : ""}
        {s.lastError ? ` · ${s.lastError}` : ""}
      </p>
      <SubscriptionActions scope={scope} id={s.id} name={s.name} active={s.active} />
    </li>
  );
}

export function SubscriptionsCard({ scope, def, filters, data }: { scope: ReportScope; def: ReportDef; filters: Filters; data: Personalization }) {
  const current = Object.fromEntries(Object.entries(filters).filter((e): e is [string, string] => Boolean(e[1])));
  const schedulable = isSchedulable(def);
  return (
    <Card>
      <CardHeader>
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2"><BellRing className="h-4 w-4 text-text-faint" aria-hidden />Zamanlanmış gönderim</CardTitle>
          <CardDescription>Bu raporu günlük, haftalık ya da aylık e-posta eki olarak alın.</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {!data.ready ? (
          <SetupPending />
        ) : (
          <>
            {data.subscriptions.length > 0 ? (
              <ul className="divide-y divide-line">
                {data.subscriptions.map((s) => (
                  <SubscriptionLine key={s.id} scope={scope} s={s} />
                ))}
              </ul>
            ) : null}
            {schedulable ? (
              <SubscriptionForm
                scope={scope}
                reportId={def.id}
                reportTitle={def.title}
                filters={current}
                people={data.people}
                selfId={data.selfId}
                hasDateRange={hasDateRange(def)}
                deliveryHour={DELIVERY_HOUR_LABEL}
              />
            ) : (
              <p className="text-xs text-text-muted">Bu özet rapor zamanlanamaz; dosya olarak indirebilirsiniz.</p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** Katalog sayfasında kişisel özet: tüm kayıtlı görünümler ve abonelikler. Boşsa hiç çizilmez. */
export function PersonalOverview({ scope, data }: { scope: ReportScope; data: Personalization }) {
  if (!data.ready || (data.views.length === 0 && data.subscriptions.length === 0)) return null;
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2"><Bookmark className="h-4 w-4 text-text-faint" aria-hidden />Kayıtlı görünümler</CardTitle>
            <CardDescription>Kendi ve paylaşılan görünümler; tıklayınca rapor filtreleriyle açılır.</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {data.views.length === 0 ? (
            <EmptyState variant="inline" icon={Bookmark} title="Henüz kayıtlı görünüm yok" />
          ) : (
            <ul className="divide-y divide-line">
              {data.views.slice(0, 12).map((v) => (
                <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <Link href={v.href} className="focus-ring min-w-0 text-sm font-semibold text-text hover:text-accent-text">
                    {v.name}
                  </Link>
                  <span className="flex items-center gap-1.5 text-xs text-text-muted">
                    {v.reportTitle}
                    {v.shared ? <StatusBadge tone="neutral">Paylaşılan</StatusBadge> : null}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2"><BellRing className="h-4 w-4 text-text-faint" aria-hidden />Rapor abonelikleriniz</CardTitle>
            <CardDescription>E-postayla düzenli gelen raporlar.</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {data.subscriptions.length === 0 ? (
            <EmptyState variant="inline" icon={BellRing} title="Henüz abonelik yok" description="Bir raporu açıp “E-postayla düzenli gönder”i seçin." />
          ) : (
            <ul className="divide-y divide-line">
              {data.subscriptions.map((s) => (
                <SubscriptionLine key={s.id} scope={scope} s={s} showReport />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/** Önizleme grafiği: kapalı başlar (açılınca görünür), veri önizleme tablosundan. Anlamlı grafik yoksa hiç çizilmez. */
export function ReportChartPreview({ table }: { table: Pick<ReportTable, "columns" | "rows"> }) {
  const chart = reportChartFromTable(table);
  if (!chart) return null;
  return (
    <details className="group rounded-[var(--radius-card)] border border-line bg-surface shadow-[var(--elev-1)]">
      <summary className="focus-ring flex min-h-11 cursor-pointer list-none items-center gap-2 px-4 text-sm font-semibold text-text">
        <BarChart3 className="h-4 w-4 text-accent" aria-hidden />
        Grafik önizleme
        <span className="text-xs font-normal text-text-muted">
          {chart.valueLabel} · {chart.categoryLabel} (önizleme satırlarından)
        </span>
      </summary>
      <div className="px-4 pb-4">
        <BarColumns data={chart.bars} ariaLabel={`${chart.categoryLabel} için ${chart.valueLabel}`} height={200} format={chart.format} tone="brand" />
      </div>
    </details>
  );
}
