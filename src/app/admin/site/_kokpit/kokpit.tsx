import Link from "@/components/ui/smart-link";
import { ArrowUpRight, Gauge, Info, ListChecks, Plug, Sparkles } from "lucide-react";
import { toTrLocalInput } from "@/lib/clock";
import { AUTOPILOT_KIND_LABEL, type AutopilotSettings } from "@/lib/site-issues/autopilot";
import { formatScore } from "@/lib/site-issues/score";
import { STATUS_LABEL } from "@/lib/site-issues/state";
import type { IssueArea } from "@/lib/site-issues/types";
import { AuditButton, AutopilotSwitch, IssueRowActions, PublishAllButton, SafeFixesButton } from "./kokpit-actions";
import type { AutopilotSummary, KokpitModel, QueueRow } from "./model";

/**
 * BÜYÜME KOKPİTİ görünümü (sunucu bileşeni; yalnız hazır model). Üst satır: Site notu + "şunu düzeltirseniz";
 * 4 kutucuk (SEO, Hız, Ölçüm, Reklam); eylemler; kuyruk. Görünen her sayı tıklanır ve süzülmüş kuyruğa gider.
 */

const fmt = (iso: string) => toTrLocalInput(iso).replace("T", " ");

const SEV: Record<QueueRow["severity"], { text: string; cls: string }> = {
  kritik: { text: "Acil", cls: "bg-danger-500/10 text-danger-700" },
  uyari: { text: "Önemli", cls: "bg-amber-100 text-amber-900" },
  bilgi: { text: "Bilgi", cls: "bg-brand-600/10 text-brand-700" },
};

const AREA_LABEL: Record<IssueArea, string> = { seo: "SEO", hiz: "Hız", olcum: "Ölçüm", reklam: "Reklam", icerik: "İçerik" };

const LINK_CLS = "focus-ring inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-control)] border border-line px-3 text-xs font-bold text-ink-950 transition hover:border-brand-400 touch:h-11";

function QueueItem({ row, canAct }: { row: QueueRow; canAct: boolean }) {
  const sev = SEV[row.severity];
  return (
    <li className="flex flex-col gap-2 p-4 md:flex-row md:items-start md:justify-between">
      <div className="min-w-0 space-y-1">
        <p className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${sev.cls}`}>{sev.text}</span>
          <span className="font-bold text-ink-950">{row.title}</span>
        </p>
        <p className="text-xs text-text-muted">
          <code className="font-semibold text-ink-950">{row.url}</code> · {AREA_LABEL[row.area]} · {STATUS_LABEL[row.status]}
          {row.manual_only ? " · elle düzeltilir" : ""}
        </p>
        {row.explain ? <p className="text-sm text-text-muted">{row.explain}</p> : null}
        {row.proposal?.summary ? <p className="text-xs font-semibold text-brand-700">Öneri: {row.proposal.summary}</p> : null}
        {row.status === "yoksayildi" && row.ignored_reason ? <p className="text-xs text-text-faint">Gerekçe: {row.ignored_reason}</p> : null}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-1.5">
        {row.href ? (
          <Link href={row.href} className={LINK_CLS}>
            Düzelt <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        ) : null}
        {row.fallback && row.fallback.href !== row.href ? (
          <Link href={row.fallback.href} className="text-xs font-semibold text-brand-700 hover:underline">
            Bu düzeltme için ekran: {row.fallback.label}
          </Link>
        ) : null}
        {canAct && row.status !== "yoksayildi" ? <IssueRowActions id={row.id} canDraft={row.canDraft} title={row.title} /> : null}
      </div>
    </li>
  );
}

export function Kokpit({
  model,
  role,
  autopilot,
  autopilotRun,
}: {
  model: KokpitModel;
  role: string;
  autopilot: AutopilotSettings;
  autopilotRun: AutopilotSummary;
}) {
  const isSuper = role === "super_admin";
  if (!model.available) {
    return (
      <section aria-labelledby="kokpit" className="rounded-[var(--radius-panel)] border border-dashed border-line bg-surface p-5">
        <h2 id="kokpit" className="flex items-center gap-2 font-display text-lg font-extrabold text-ink-950">
          <Gauge className="h-5 w-5 text-brand-600" aria-hidden="true" /> Büyüme kokpiti · kurulum bekliyor
        </h2>
        <p className="mt-2 text-sm text-text-muted">
          Öneri kuyruğu için veritabanı güncellemesi (site_issues) henüz uygulanmadı. Uygulandığında Site notu, kutucuklar ve Otopilot burada görünür; Yayın masası aşağıda çalışmaya devam eder.
        </p>
      </section>
    );
  }

  const kinds = autopilot.kinds.map((k) => ({ id: k, label: AUTOPILOT_KIND_LABEL[k as keyof typeof AUTOPILOT_KIND_LABEL] ?? k }));
  return (
    <section aria-labelledby="kokpit" className="space-y-4">
      <h2 id="kokpit" className="flex items-center gap-2 font-display text-lg font-extrabold text-ink-950">
        <Gauge className="h-5 w-5 text-brand-600" aria-hidden="true" /> Büyüme kokpiti
      </h2>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <Link href="/admin/site#kuyruk" className="focus-ring group flex flex-col gap-2 rounded-[var(--radius-panel)] border border-line bg-surface p-5 transition hover:border-brand-400">
          <span className="text-xs font-bold uppercase tracking-wide text-text-faint">Site notu</span>
          {model.score === null ? (
            <span className="text-sm text-text-muted">Veri birikiyor: ilk denetimden sonra not hesaplanır.</span>
          ) : (
            <span className="font-display text-5xl font-extrabold text-ink-950">
              {formatScore(model.score)}
              <span className="text-xl font-bold text-text-faint"> / 100</span>
            </span>
          )}
          <span className="text-xs text-text-faint">{model.lastSyncAt ? `Son denetim ${fmt(model.lastSyncAt)}` : "Henüz denetim yapılmadı"}</span>
        </Link>
        <div className="rounded-[var(--radius-panel)] border border-line bg-surface p-5">
          <p className="flex items-center gap-2 text-sm font-extrabold text-ink-950">
            <Sparkles className="h-4 w-4 text-brand-600" aria-hidden="true" />
            {model.gainPicks.length && model.gain > 0 ? `Şunu düzeltirseniz +${formatScore(model.gain)}` : "Şu an öncelikli düzeltme yok"}
          </p>
          {model.gainPicks.length ? (
            <ol className="mt-2 space-y-1.5 text-sm">
              {model.gainPicks.map((p) => (
                <li key={p.id}>
                  <Link href={p.href ?? "/admin/site#kuyruk"} className="font-semibold text-brand-700 hover:underline">
                    {p.title}
                  </Link>
                  <span className="text-text-muted"> · {p.url}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-2 text-sm text-text-muted">{model.hasData ? "Açık bulgu yok; düzenli denetim sürüyor." : "İlk denetimden sonra en çok puan kazandıracak 3 düzeltme burada listelenir."}</p>
          )}
        </div>
      </div>

      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Alanlar">
        {model.tiles.map((t) => (
          <li key={t.area}>
            <Link
              href={t.connected ? t.href : t.setupHref}
              className="focus-ring group flex h-full flex-col gap-1.5 rounded-[var(--radius-panel)] border border-line bg-surface p-4 transition hover:border-brand-400"
            >
              <span className="flex items-center justify-between gap-2">
                <span className="font-display text-base font-extrabold text-ink-950">{t.label}</span>
                {t.score !== null ? <span className="text-sm font-bold text-ink-950">{formatScore(t.score)}</span> : null}
              </span>
              <span className={`text-sm ${t.connected && t.hasData ? "text-ink-950" : "text-text-muted"}`}>
                {!t.connected ? <Plug className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" /> : null}
                {t.sentence}
              </span>
              <span className="mt-auto text-xs text-text-faint">
                {!t.connected ? `Kurulum: ${t.setupLabel}` : t.hasData ? `${t.open} açık bulgu${t.secondary ? ` · ${t.secondary}` : ""}` : "İlk sonuç bekleniyor"}
              </span>
            </Link>
          </li>
        ))}
      </ul>

      <div className="flex flex-col gap-4 rounded-[var(--radius-panel)] border border-line bg-surface p-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex flex-wrap items-start gap-2">
          <AuditButton collectors={model.collectorIds} />
          <SafeFixesButton />
          {isSuper ? <PublishAllButton /> : null}
        </div>
        <div className="space-y-1 text-sm lg:max-w-sm">
          <p className="flex items-center gap-2 font-extrabold text-ink-950">
            {isSuper ? <AutopilotSwitch enabled={autopilot.enabled} publish={autopilot.publish} kinds={kinds} /> : null}
            Otopilot {autopilot.enabled ? "açık" : "kapalı"}
          </p>
          <p className="text-xs text-text-muted">
            {autopilotRun ? (
              <>
                Son gece {autopilotRun.prepared} düzeltme hazırladı{autopilotRun.published ? `, ${autopilotRun.published} yüzey yayınladı` : ""}
                {autopilotRun.failed ? ` (${autopilotRun.failed} yapılamadı)` : ""} ·{" "}
                <Link href="/admin/site#yayin-masasi" className="font-semibold text-brand-700 hover:underline">
                  geri al
                </Link>
              </>
            ) : autopilot.enabled ? (
              "Henüz gece çalışması yok."
            ) : (
              "Açıldığında her gece yalnız güvenli düzeltmeleri hazırlar."
            )}
          </p>
        </div>
      </div>

      <section id="kuyruk" aria-labelledby="kuyruk-baslik" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id="kuyruk-baslik" className="flex items-center gap-2 text-sm font-extrabold text-ink-950">
            <ListChecks className="h-4 w-4 text-brand-600" aria-hidden="true" /> Öneri kuyruğu
          </h3>
          <nav aria-label="Alan süzgeci" className="flex flex-wrap gap-1.5">
            <Link href="/admin/site#kuyruk" aria-current={model.filter === null ? "page" : undefined} className={`rounded-full px-3 py-1 text-xs font-bold touch:min-h-11 ${model.filter === null ? "bg-brand-600 text-white" : "bg-surface-hover text-ink-950"}`}>
              Tümü
            </Link>
            {(Object.keys(AREA_LABEL) as IssueArea[]).map((a) => (
              <Link
                key={a}
                href={`/admin/site?alan=${a}#kuyruk`}
                aria-current={model.filter === a ? "page" : undefined}
                className={`rounded-full px-3 py-1 text-xs font-bold touch:min-h-11 ${model.filter === a ? "bg-brand-600 text-white" : "bg-surface-hover text-ink-950"}`}
              >
                {AREA_LABEL[a]} ({model.counts[a]})
              </Link>
            ))}
          </nav>
        </div>
        {model.queue.length ? (
          <ul className="divide-y divide-line rounded-[var(--radius-panel)] border border-line bg-surface" aria-label="Bulgular">
            {model.queue.slice(0, 100).map((r) => (
              <QueueItem key={r.id} row={r} canAct />
            ))}
          </ul>
        ) : (
          <p className="flex gap-2 rounded-[var(--radius-panel)] border border-line bg-surface p-4 text-sm text-text-muted">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" aria-hidden="true" />
            {model.hasData ? "Bu süzgeçte açık bulgu yok." : "Henüz bulgu yok. \"Siteyi şimdi denetle\" ile ilk denetimi başlatın."}
          </p>
        )}
        {model.queue.length > 100 ? <p className="text-xs text-text-muted">İlk 100 bulgu gösteriliyor; alan süzgeciyle daraltın.</p> : null}
        {model.ignored.length ? (
          <details className="rounded-[var(--radius-panel)] border border-line bg-surface">
            <summary className="cursor-pointer p-3 text-sm font-semibold text-ink-950">Yoksayılanlar ({model.ignored.length})</summary>
            <ul className="divide-y divide-line border-t border-line">
              {model.ignored.slice(0, 50).map((r) => (
                <QueueItem key={r.id} row={r} canAct={false} />
              ))}
            </ul>
          </details>
        ) : null}
      </section>
    </section>
  );
}
