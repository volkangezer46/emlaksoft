import { AlertOctagon, Clock3, Inbox, PauseCircle, Workflow } from "lucide-react";
import Link from "@/components/ui/smart-link";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusPill } from "@/components/ui/list-kit/status-pill";
import { requirePlatformModule } from "@/lib/platform";
import { platformCan } from "@/lib/platform-access";
import { now } from "@/lib/clock";
import { relativeTimeTR } from "@/lib/admin-format";
import { CRON_JOBS } from "@/lib/cron-jobs";
import { QUEUE_STATE_LABEL, QUEUE_STATE_TONE, waitAgeLabel } from "@/lib/admin/ops/queue-health";
import { loadQueueHealth } from "@/lib/admin/ops/read";
import { OpsCard, OpsKpis, OpsList, OpsRow, num } from "../_components/ops-kit";
import { RequeueButton } from "./requeue-button";
import "@/app/app/_home/kurumsal/home.css";

export const metadata = { title: "Kuyruklar" };

const cronLabel = (job: string | null) => (job ? (CRON_JOBS.find((j) => j.job === job)?.label ?? job) : "Olay anında (istek sonrası)");

/**
 * ARKA PLAN KUYRUKLARI: platformun dayanıklı iş kuyrukları tek ekranda (envanter `queue-health.ts`). Kuyruk başına
 * bekleyen, kalıcı hatalı, en eski bekleyen işin yaşı ve durum kararı (akıyor / birikiyor / takıldı / kalıcı hata);
 * boşaltan zamanlanmış iş ve duraklatılmış cron'lar. Eylem: idempotent işçili kuyruklarda kalıcı hatalı işi yeniden
 * kuyruğa alma (tekil ya da toplu, en çok 100; süper admin + operasyon, denetim kaydı, hız sınırı). Cron çalıştırma ve
 * duraklatma Sistem durumu > Sağlık'tadır.
 */
export default async function QueuesPage() {
  const staff = await requirePlatformModule("sistem");
  const canWrite = (staff.role === "super_admin" || staff.role === "ops") && platformCan(staff, "sistem", "write");
  const d = await loadQueueHealth();
  const nowMs = now();
  const waiting = d.queues.reduce((s, q) => s + (q.counts.waiting ?? 0), 0);
  const failed = d.queues.reduce((s, q) => s + (q.counts.failed ?? 0), 0);
  const stuck = d.queues.filter((q) => q.state === "takildi").length;

  return (
    <div className="space-y-6">
      <AdminPageHeader
        art="layers"
        icon={Inbox}
        eyebrow="Sistem"
        title="Kuyruklar"
        description="Bildirim, dosya silme, webhook, duyuru, ilan doğrulama ve coğrafya kuyrukları: bekleyen iş, kalıcı hata ve takılma. Kalıcı hatalı iş buradan yeniden denenir."
      />

      <OpsKpis
        label="Kuyruk göstergeleri"
        items={[
          { key: "q", title: "Kuyruk", value: num(d.queues.length), href: "#kuyruklar", icon: Workflow, tone: "brand", caption: `${num(d.queues.filter((q) => q.state === "saglikli" || q.state === "bos").length)} sorunsuz` },
          { key: "w", title: "Bekleyen iş", value: num(waiting), href: "#kuyruklar", icon: Clock3, tone: "cyan", caption: "Tüm kuyruklarda" },
          { key: "f", title: "Kalıcı hata", value: num(failed), href: "#hatalar", icon: AlertOctagon, tone: failed ? "rose" : "slate", caption: failed ? "Yeniden denenebilir ya da incelenmeli" : "Yok" },
          { key: "s", title: "Takılan kuyruk", value: num(stuck), href: "#kuyruklar", icon: AlertOctagon, tone: stuck ? "rose" : "mint", caption: stuck ? "İşçi bekleyen işi almıyor" : "İşçiler akıyor" },
          { key: "p", title: "Duraklatılmış cron", value: num(d.pausedJobs.length), href: "/admin/sistem", icon: PauseCircle, tone: d.pausedJobs.length ? "amber" : "slate", caption: "Sistem durumu > Sağlık" },
        ]}
      />

      <OpsCard id="kuyruklar" icon={Workflow} tone="brand" title="Kuyruk durumu" sub="Takılma eşiği kuyruğun işçi temposuna göre; geri çekilmiş (ileri zamanlı) iş takılmış sayılmaz">
        <OpsList label="Kuyruklar">
          {d.queues.map((q) => {
            const age = waitAgeLabel(q.counts.oldestWaitingAt, nowMs);
            return (
              <OpsRow
                key={q.def.key}
                primary={q.def.label}
                href={q.def.href}
                secondary={`${q.def.description} · İşçi: ${cronLabel(q.def.cronJob)}`}
                right={
                  <>
                    <span className="numeric text-xs text-text-muted" title="Bekleyen · kalıcı hata · en eski bekleyen">
                      {num(q.counts.waiting)} bekliyor · {num(q.counts.failed)} hata{age ? ` · ${age}` : ""}
                    </span>
                    <StatusPill tone={QUEUE_STATE_TONE[q.state]}>{QUEUE_STATE_LABEL[q.state]}</StatusPill>
                  </>
                }
              />
            );
          })}
        </OpsList>
      </OpsCard>

      <div id="hatalar" className="grid grid-cols-1 items-stretch gap-4 lg:grid-cols-2">
        {d.queues
          .filter((q) => q.def.retryable)
          .map((q) => (
            <OpsCard
              key={q.def.key}
              id={q.def.key}
              icon={AlertOctagon}
              tone={q.failedItems.length ? "rose" : "mint"}
              title={`${q.def.label}: kalıcı hatalar`}
              sub={`${num(q.counts.failed)} iş deneme sınırını doldurdu; son 20 gösterilir`}
              right={canWrite && q.failedItems.length > 0 ? <RequeueButton queue={q.def.key} id="all" label="Tümünü yeniden dene" confirmText={`En çok 100 iş yeniden kuyruğa alınsın mı?`} /> : null}
            >
              {q.failedItems.length === 0 ? (
                <EmptyState variant="compact" bare icon={Inbox} title="Kalıcı hatalı iş yok" description="İşçi bir işi deneme sınırına kadar başaramazsa burada listelenir." />
              ) : (
                <OpsList label={`${q.def.label} kalıcı hatalar`}>
                  {q.failedItems.map((i) => (
                    <OpsRow
                      key={i.id}
                      primary={(i.tenantId && d.names.get(i.tenantId)) || "Ofis"}
                      href={i.tenantId ? `/admin/tenants/${i.tenantId}` : undefined}
                      secondary={`${num(i.attempts)} deneme · ${i.createdAt ? relativeTimeTR(i.createdAt) : "—"}${i.error ? ` · ${i.error}` : ""}`}
                      right={canWrite ? <RequeueButton queue={q.def.key} id={i.id} label="Yeniden dene" confirmText="Bu iş yeniden kuyruğa alınsın mı?" /> : null}
                    />
                  ))}
                </OpsList>
              )}
            </OpsCard>
          ))}
      </div>

      {d.pausedJobs.length > 0 ? (
        <OpsCard id="duraklatilan" icon={PauseCircle} tone="amber" title="Duraklatılmış zamanlanmış işler" sub="Duraklatılan iş kuyruğunu boşaltmaz; devam ettirmek için Sistem durumu > Sağlık" right={<Link href="/admin/sistem" className="kh-seeall focus-ring">Sağlık</Link>}>
          <OpsList label="Duraklatılmış işler">
            {d.pausedJobs.map((p) => (
              <OpsRow key={p.job} primary={cronLabel(p.job)} secondary={`${p.pausedAt ? relativeTimeTR(p.pausedAt) : "—"}${p.reason ? ` · ${p.reason}` : ""}`} right={<StatusPill tone="warning">Duraklatıldı</StatusPill>} />
            ))}
          </OpsList>
        </OpsCard>
      ) : null}
    </div>
  );
}
