import Link from "@/components/ui/smart-link";
import { Activity, ExternalLink, GitCommitHorizontal, Megaphone, Rocket, ShieldAlert } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { AdminPanel, AdminScrollArea } from "@/components/admin/admin-table";
import { KpiCard, KpiGrid } from "@/components/ui/kpi-card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { requirePlatformModule } from "@/lib/platform";
import { now as clockNow } from "@/lib/clock";
import { formatDateTimeTr } from "@/lib/format";
import { loadAdminStatus } from "@/lib/status-page/read";
import {
  dailyUptime,
  formatDuration,
  formatUptime,
  IMPACT_LABEL,
  IMPACTS,
  INCIDENT_STATUSES,
  isClosedStatus,
  KIND_LABEL,
  maintenanceOverdue,
  OVERALL_LABEL,
  overallStatus,
  overallUptime,
  STATUS_LABEL,
  statusesFor,
  UPTIME_DAYS,
} from "@/lib/status-page/model";
import { IncidentCreateForm, IncidentDeleteButton, IncidentUpdateForm } from "./status-page-controls";

const BASE = "/admin/sistem?sekme=durum";
const OUTCOME: Record<"ok" | "rolled_back" | "failed", { label: string; variant: "success" | "warning" | "danger" }> = {
  ok: { label: "Yayında", variant: "success" },
  rolled_back: { label: "Geri dönüldü", variant: "warning" },
  failed: { label: "Başarısız", variant: "danger" },
};

/**
 * Sistem > Durum sayfası: kamuya açık /durum'un yönetimi (olay ve planlı bakım aç/güncelle/kapat) + ölçülen
 * erişilebilirlik özeti + sürüm (deploy) geçmişi. Sürüm satırını scripts/sunucu/deploy.sh her yayın sonunda yazar;
 * "açık hata" sayısı error_logs.release eşleşmesidir ve hata listesine o sürüm süzgeciyle gider.
 */
export async function StatusPageView() {
  const staff = await requirePlatformModule("sistem");
  const nowMs = clockNow();
  const data = await loadAdminStatus(nowMs);
  const days = dailyUptime(data.outages, nowMs, UPTIME_DAYS);
  const uptime = data.outageReadable ? overallUptime(days) : null;
  const level = overallStatus({ incidents: data.incidents, outageOpen: data.outages.some((o) => o.end === null), nowMs, readable: data.outageReadable });
  const open = data.incidents.filter((i) => !isClosedStatus(i.status));
  const downSec = days.reduce((s, d) => s + d.downSec, 0);
  const last = data.releases[0] ?? null;
  const impactOpts = IMPACTS.map((v) => ({ value: v, label: IMPACT_LABEL[v] }));
  const incidentStatusOpts = INCIDENT_STATUSES.filter((s) => !isClosedStatus(s)).map((v) => ({ value: v, label: STATUS_LABEL[v] }));

  return (
    <div className="space-y-6">
      <AdminPageHeader
        eyebrow="Operasyon · iletişim"
        icon={Megaphone}
        title="Durum sayfası ve sürümler"
        description="Kamuya açık /durum sayfasında görünen olay ve planlı bakımlar, ölçülen erişilebilirlik ve yayın (deploy) geçmişi."
      >
        <KpiGrid label="Durum göstergeleri" className="lg:grid-cols-4 2xl:grid-cols-4">
          <KpiCard layout="inline" label="Genel durum" value={OVERALL_LABEL[level]} href="/durum" icon={Activity} tone={level === "operational" ? "success" : level === "maintenance" ? "brand" : "danger"} hint="kamu sayfasını aç" />
          <KpiCard layout="inline" label="Açık olay / bakım" value={open.length} href={`${BASE}#olaylar`} icon={ShieldAlert} tone={open.length ? "warn" : "success"} attention={open.length > 0} />
          <KpiCard
            layout="inline"
            label={`Erişilebilirlik · ${UPTIME_DAYS} gün`}
            value={formatUptime(uptime)}
            href="/admin/sistem?sekme=uyarilar&olay=tumu"
            icon={Activity}
            tone={downSec > 0 ? "warn" : "success"}
            hint={downSec > 0 ? `toplam kesinti ${formatDuration(downSec)}` : "ölçülen kesinti yok"}
          />
          <KpiCard
            layout="inline"
            label="Son sürüm"
            value={last ? last.sha.slice(0, 12) : "—"}
            href={`${BASE}#surumler`}
            icon={Rocket}
            tone={last && last.outcome !== "ok" ? "danger" : "brand"}
            hint={last ? `${OUTCOME[last.outcome].label} · ${formatDateTimeTr(last.finishedAt)}` : data.releasesPending ? "tablo kurulmadı" : "henüz kayıt yok"}
          />
        </KpiGrid>
      </AdminPageHeader>

      {data.setupPending ? (
        <p className="rounded-[var(--radius-card)] border border-dashed border-line-strong bg-surface px-5 py-4 text-sm text-text-muted">
          Durum sayfası tabloları henüz kurulmadı (migration <code>20261014005000_channel_roi_status_page.sql</code>). /durum şimdilik yalnız ölçülen
          erişilebilirliği gösterir.
        </p>
      ) : null}

      <AdminPanel
        title="Yeni olay ya da planlı bakım"
        icon={Megaphone}
        description="Yayınladığınız başlık ve metin /durum sayfasında herkese görünür; açık olay sayfanın en üstüne çıkar."
        actions={
          <Link href="/durum" className="focus-ring inline-flex touch:min-h-11 items-center gap-1 text-xs font-semibold text-brand-600 hover:underline">
            /durum <ExternalLink className="h-3 w-3" aria-hidden />
          </Link>
        }
      >
        <div className="p-5">
          <IncidentCreateForm impacts={impactOpts} incidentStatuses={incidentStatusOpts} disabled={data.setupPending} />
        </div>
      </AdminPanel>

      <AdminPanel title="Olaylar ve bakımlar" icon={ShieldAlert} description="Açık kayıtlar önce; son 60 kayıt.">
        <div id="olaylar" />
        {data.incidents.length === 0 ? (
          <EmptyState variant="compact" bare icon={ShieldAlert} tone="mint" title="Kayıt yok" description="Henüz olay ya da planlı bakım yayınlanmadı." />
        ) : (
          <ul className="divide-y divide-line">
            {data.incidents.map((i) => {
              const closed = isClosedStatus(i.status);
              const overdue = maintenanceOverdue(i, nowMs);
              return (
                <li key={i.id} className="space-y-3 px-5 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2 text-xs">
                        <Badge variant={i.kind === "maintenance" ? "info" : closed ? "neutral" : i.impact === "critical" ? "danger" : "warning"}>{KIND_LABEL[i.kind]}</Badge>
                        {i.kind === "incident" ? <span className="text-text-muted">{IMPACT_LABEL[i.impact]}</span> : null}
                        <span className="font-semibold text-ink-950">{STATUS_LABEL[i.status]}</span>
                        {overdue ? <Badge variant="warning">Pencere geçti · kapatılmayı bekliyor</Badge> : null}
                      </p>
                      <p className="mt-1 font-semibold text-ink-950">{i.title}</p>
                      <p className="text-xs text-text-muted">
                        {i.kind === "maintenance" && i.scheduledStart && i.scheduledEnd
                          ? `${formatDateTimeTr(i.scheduledStart)} – ${formatDateTimeTr(i.scheduledEnd)}`
                          : `Başlangıç ${formatDateTimeTr(i.startedAt)}`}
                        {i.resolvedAt ? ` · kapandı ${formatDateTimeTr(i.resolvedAt)}` : ""} · {i.updates.length} güncelleme
                      </p>
                    </div>
                    {staff.role === "super_admin" ? <IncidentDeleteButton id={i.id} title={i.title} /> : null}
                  </div>
                  {i.updates.length ? (
                    <ol className="space-y-1.5 border-l-2 border-line pl-3 text-xs">
                      {i.updates.slice(0, 4).map((u, idx) => (
                        <li key={`${u.at}-${idx}`}>
                          <span className="font-semibold text-ink-950">{STATUS_LABEL[u.status]}</span>{" "}
                          <span className="text-text-faint">{formatDateTimeTr(u.at)}</span>
                          <p className="whitespace-pre-line text-text-muted">{u.message}</p>
                        </li>
                      ))}
                    </ol>
                  ) : null}
                  <details className="rounded-[var(--radius-card)] border border-line bg-canvas">
                    <summary className="focus-ring cursor-pointer touch:min-h-11 px-3 py-2 text-xs font-semibold text-brand-600">{closed ? "Yeniden aç / not ekle" : "Güncelleme yayınla"}</summary>
                    <div className="border-t border-line p-3">
                      <IncidentUpdateForm
                        incidentId={i.id}
                        current={i.status}
                        statuses={statusesFor(i.kind).map((v) => ({ value: v, label: STATUS_LABEL[v] }))}
                        impacts={i.kind === "incident" ? impactOpts : undefined}
                        impact={i.impact}
                      />
                    </div>
                  </details>
                </li>
              );
            })}
          </ul>
        )}
      </AdminPanel>

      <AdminPanel
        title="Sürüm geçmişi"
        icon={GitCommitHorizontal}
        description="scripts/sunucu/deploy.sh her yayının sonunda bir satır yazar (sonuç, süre, son migration). Açık hata: bu sürümde görülen ve çözülmemiş hata türü."
      >
        <div id="surumler" />
        {data.releasesPending ? (
          <EmptyState variant="compact" bare icon={Rocket} title="Sürüm tablosu kurulmadı" description="Migration 20261014005000 uygulanınca bir sonraki yayından itibaren satırlar burada görünür." />
        ) : data.releases.length === 0 ? (
          <EmptyState variant="compact" bare icon={Rocket} title="Henüz sürüm kaydı yok" description="Bir sonraki deploy.sh çalışmasında ilk satır düşer." />
        ) : (
          <AdminScrollArea minWidth={820}>
            <Table>
              <THead>
                <TR>
                  <TH>Sürüm</TH>
                  <TH>Sonuç</TH>
                  <TH>Bitiş</TH>
                  <TH className="text-right">Süre</TH>
                  <TH>Son migration</TH>
                  <TH className="text-right">Açık hata</TH>
                </TR>
              </THead>
              <TBody>
                {data.releases.map((r) => (
                  <TR key={r.id}>
                    <TD>
                      <span className="numeric font-semibold text-ink-950">{r.sha.slice(0, 12)}</span>
                      {r.subject ? <p className="max-w-[22rem] truncate text-xs text-text-muted" title={r.subject}>{r.subject}</p> : null}
                      <p className="text-xs text-text-faint">{r.tag}{r.actor ? ` · ${r.actor}` : ""}</p>
                    </TD>
                    <TD>
                      <Badge variant={OUTCOME[r.outcome].variant}>{OUTCOME[r.outcome].label}</Badge>
                    </TD>
                    <TD className="text-xs text-text-muted">{formatDateTimeTr(r.finishedAt)}</TD>
                    <TD className="numeric text-right text-xs text-text-muted">{r.durationSec !== null ? formatDuration(r.durationSec) : "—"}</TD>
                    <TD className="max-w-[16rem] truncate text-xs text-text-muted" title={r.releaseMigration ?? undefined}>
                      {r.releaseMigration ?? "—"}
                    </TD>
                    <TD className="text-right">
                      <Link
                        href={`/admin/sistem?sekme=hatalar&yayin=${encodeURIComponent(r.sha.slice(0, 12))}`}
                        className={`focus-ring numeric font-semibold hover:underline ${r.openErrors ? "text-danger-600" : "text-text-muted"}`}
                      >
                        {r.openErrors === null ? "—" : r.openErrors}
                      </Link>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </AdminScrollArea>
        )}
      </AdminPanel>
    </div>
  );
}
