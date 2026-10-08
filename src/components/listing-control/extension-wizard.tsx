"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Circle, Copy, Download, PlugZap, Puzzle, ShieldCheck } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { now } from "@/lib/clock";
import {
  BRIDGE_RESPONSE_SOURCE,
  bridgeConnected,
  bridgeInstalled,
  bridgePaused,
  bridgeVersion,
  parseBridgeMessage,
  requestConnect,
  requestStatus,
} from "@/lib/listing-control/worker/bridge";
import { CLASSIFICATION_LABEL, HEALTH_LABEL, PORTAL_LABEL, RUN_STATE_LABEL, reasonLabel } from "@/lib/listing-control/worker/extension-labels";
import { parseStatusView, type ExtensionStatusView } from "@/lib/listing-control/worker/extension-status-view";
import { wizardView } from "@/lib/listing-control/worker/extension-wizard";

/**
 * KURULUM SİHİRBAZI + CANLI DURUM (istemci). Eklentiyi OTOMATİK ALGILAR (kurulu mu, sürümü güncel mi, bağlı mı) ve üç adımı
 * görsel gösterir: indir → tarayıcıya yükle → bağla. "Eklentiyi bağla" YALNIZ bu düğmenin tıklamasından gider (eklenti gerçek
 * kullanıcı etkinliği arar). Bağlandıktan sonra eklentinin durum görünümü (köprü `status-response`) canlı kartta gösterilir.
 * Sayfa hiçbir portal verisi/token tutmaz.
 */

export type ExtensionWizardProps = {
  latestVersion: string;
  /** Sürümlü ZIP indirme adresi; paket derlenmemişse null (düğme yerine açıklama gösterilir). */
  downloadHref: string | null;
  downloadBytes: number | null;
  chromeStoreUrl: string | null;
  edgeStoreUrl: string | null;
  hosts: string[];
};

type Live = { installed: boolean; version: string | null; connected: boolean; paused: boolean };

function readLive(): Live {
  return { installed: bridgeInstalled(), version: bridgeVersion(), connected: bridgeConnected(), paused: bridgePaused() };
}

function ago(ms: number | null, nowMs: number): string {
  if (!ms) return "henüz yok";
  const s = Math.max(0, Math.round((nowMs - ms) / 1000));
  if (s < 60) return `${s} sn önce`;
  if (s < 3600) return `${Math.round(s / 60)} dk önce`;
  return new Date(ms).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
}

const LEVEL_DOT: Record<string, string> = { green: "bg-mint-500", yellow: "bg-amber-500", red: "bg-danger-500", idle: "bg-line" };

function StepBadge({ n, done, active }: { n: number; done: boolean; active: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid h-8 w-8 shrink-0 place-items-center rounded-full text-sm font-bold transition-colors",
        done ? "tone-success" : active ? "bg-accent text-white" : "tone-neutral",
      )}
    >
      {done ? <CheckCircle2 className="h-4 w-4" /> : n}
    </span>
  );
}

export function ExtensionWizard({ latestVersion, downloadHref, downloadBytes, chromeStoreUrl, edgeStoreUrl, hosts }: ExtensionWizardProps) {
  const [live, setLive] = useState<Live>({ installed: false, version: null, connected: false, paused: false });
  const [status, setStatus] = useState<ExtensionStatusView | null>(null);
  const [nowMs, setNowMs] = useState(0);
  const [connecting, setConnecting] = useState(false);
  const [connectFailed, setConnectFailed] = useState(false);
  const [copied, setCopied] = useState(false);

  const refresh = useCallback(async () => {
    const l = readLive();
    setLive(l);
    setNowMs(now());
    if (l.installed) setStatus(parseStatusView(await requestStatus()));
    else setStatus(null);
  }, []);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window || event.origin !== window.location.origin) return;
      if ((event.data as { source?: string } | null)?.source !== BRIDGE_RESPONSE_SOURCE) return;
      if (parseBridgeMessage(event.data)?.type === "ready") void refresh();
    };
    window.addEventListener("message", onMessage);
    const first = window.setTimeout(() => void refresh(), 0);
    const timer = window.setInterval(() => void refresh(), 4_000);
    return () => {
      window.removeEventListener("message", onMessage);
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [refresh]);

  const view = wizardView({ installed: live.installed, installedVersion: live.version, connected: live.connected, paused: live.paused, latestVersion });
  const stage = view.stage;

  const connect = async () => {
    setConnecting(true);
    setConnectFailed(false);
    const ok = await requestConnect();
    setConnecting(false);
    setConnectFailed(!ok);
    await refresh();
  };

  const copyAddress = async () => {
    try {
      await navigator.clipboard.writeText("chrome://extensions");
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2_000);
    } catch {
      setCopied(false);
    }
  };

  const sizeLabel = downloadBytes ? ` · ${Math.max(1, Math.round(downloadBytes / 1024))} KB` : "";
  const hasStore = Boolean(chromeStoreUrl || edgeStoreUrl);

  const banner =
    stage === "install"
      ? { tone: "tone-neutral", text: "Bu tarayıcıda eklenti bulunamadı. Aşağıdaki 3 adımla kurun; kurulunca bu sayfa kendiliğinden algılar." }
      : stage === "update"
        ? { tone: "tone-warning", text: `Eklenti kurulu (sürüm ${live.version}) ama yeni sürüm var (${latestVersion}). Güncelleyin.` }
        : stage === "connect"
          ? { tone: "tone-warning", text: `Eklenti kurulu (sürüm ${live.version}) ama henüz bağlı değil: bağlanana kadar hiçbir ilan kontrol edilmez.` }
          : stage === "paused"
            ? { tone: "tone-warning", text: "Eklenti bağlı ama duraklatılmış. Araç çubuğundaki eklenti simgesinden anahtarı açın." }
            : { tone: "tone-success", text: `Eklenti bağlı ve çalışıyor (sürüm ${live.version}). EmlakSoft açıkken ilanlarınız otomatik kontrol edilir.` };

  return (
    <div className="space-y-5">
      <p role="status" className={cn("flex items-start gap-2 rounded-[var(--radius-control)] px-3 py-2 text-sm", banner.tone)}>
        {stage === "ready" ? <CheckCircle2 aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" /> : <Puzzle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />}
        {banner.text}
      </p>

      {stage !== "ready" && stage !== "paused" ? (
        <ol className="grid gap-3 md:grid-cols-3" aria-label="Kurulum adımları">
          <li className={cn("rounded-[var(--radius-card)] border bg-surface p-4", stage === "install" || stage === "update" ? "border-accent" : "border-line")}>
            <div className="flex items-center gap-3">
              <StepBadge n={1} done={view.steps.download && !view.outdated} active={stage === "install" || stage === "update"} />
              <h3 className="text-sm font-semibold text-text">{stage === "update" ? "Yeni sürümü indir" : "İndir"}</h3>
            </div>
            <div className="mt-3 space-y-2">
              {chromeStoreUrl ? (
                <ButtonLink href={chromeStoreUrl} target="_blank" rel="noreferrer noopener" icon={Puzzle} className="w-full">
                  Chrome&apos;a ekle
                </ButtonLink>
              ) : null}
              {edgeStoreUrl ? (
                <ButtonLink href={edgeStoreUrl} target="_blank" rel="noreferrer noopener" variant="outline" icon={Puzzle} className="w-full">
                  Edge&apos;e ekle
                </ButtonLink>
              ) : null}
              {downloadHref ? (
                <ButtonLink href={downloadHref} variant={hasStore ? "outline" : "primary"} icon={Download} className="w-full" prefetch={false}>
                  Eklentiyi indir (ZIP{sizeLabel})
                </ButtonLink>
              ) : (
                <p className="text-sm text-text-muted">Eklenti paketi bu sürümde henüz hazır değil. Sistem yöneticiniz paketi yayına aldığında burada indirme düğmesi görünür.</p>
              )}
              <p className="text-xs text-text-muted">Sürüm {latestVersion}. Chrome ve Edge (Chromium 116+) desteklenir.</p>
            </div>
          </li>

          <li className={cn("rounded-[var(--radius-card)] border bg-surface p-4", "border-line")}>
            <div className="flex items-center gap-3">
              <StepBadge n={2} done={view.steps.load && !view.outdated} active={false} />
              <h3 className="text-sm font-semibold text-text">Tarayıcıya yükle</h3>
            </div>
            {hasStore ? (
              <p className="mt-3 text-sm text-text">Mağaza sayfasında &quot;Ekle&quot;ye basın; başka bir işlem gerekmez.</p>
            ) : (
              <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm text-text">
                <li>ZIP dosyasını bir klasöre çıkarın.</li>
                <li>
                  Adres çubuğuna <code className="font-mono">chrome://extensions</code> yazın (Edge: <code className="font-mono">edge://extensions</code>).{" "}
                  <button type="button" onClick={copyAddress} className="focus-ring inline-flex items-center gap-1 rounded text-accent-text hover:underline">
                    <Copy aria-hidden="true" className="h-3 w-3" /> {copied ? "Kopyalandı" : "Kopyala"}
                  </button>
                </li>
                <li>Sağ üstte &quot;Geliştirici modu&quot;nu açın.</li>
                <li>&quot;Paketlenmemiş öğe yükle&quot;ye basıp çıkardığınız klasörü seçin.</li>
              </ol>
            )}
          </li>

          <li className={cn("rounded-[var(--radius-card)] border bg-surface p-4", stage === "connect" ? "border-accent" : "border-line")}>
            <div className="flex items-center gap-3">
              <StepBadge n={3} done={view.steps.connect} active={stage === "connect"} />
              <h3 className="text-sm font-semibold text-text">Bağla</h3>
            </div>
            <div className="mt-3 space-y-2">
              <Button icon={PlugZap} onClick={() => void connect()} loading={connecting} disabled={!live.installed || view.outdated || live.connected} className="w-full">
                {live.connected ? "Bağlandı" : "Eklentiyi bağla"}
              </Button>
              {connectFailed ? (
                <p role="alert" className="flex items-start gap-1.5 text-sm text-danger-text">
                  <AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" /> Eklenti yanıt vermedi. Sayfayı yenileyip tekrar deneyin; olmazsa eklenti simgesinden &quot;Bağlan&quot;a basın.
                </p>
              ) : null}
              <p className="text-xs text-text-muted">
                Bağlanana kadar eklenti hiçbir ilanı kontrol etmez. Oturum anahtarınız eklentiye verilmez; eklenti yalnız bu sayfadaki açık oturumunuzla konuşur.
              </p>
            </div>
          </li>
        </ol>
      ) : null}

      {live.installed && status ? <LiveCard status={status} nowMs={nowMs} /> : null}

      <p className="flex items-start gap-2 text-xs text-text-muted">
        <ShieldCheck aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>Erişilen portal alanları yalnız: {hosts.join(", ")}.</span>
      </p>
    </div>
  );
}

function LiveCard({ status, nowMs }: { status: ExtensionStatusView; nowMs: number }) {
  const stateLabel = RUN_STATE_LABEL[status.state];
  const tone = status.state === "running" ? "tone-success" : status.state === "cooldown" ? "tone-danger" : status.state === "disconnected" ? "tone-neutral" : "tone-warning";
  const hourPct = status.hourCap > 0 ? (status.hourUsed / status.hourCap) * 100 : 0;
  const dayPct = status.dayCap > 0 ? (status.today / status.dayCap) * 100 : 0;
  return (
    <section aria-label="Canlı durum" className="rounded-[var(--radius-card)] border border-line bg-surface p-4 shadow-[var(--shadow-xs)] sm:p-5">
      <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-text">Canlı durum</h2>
        <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold", tone)}>{stateLabel}</span>
      </header>
      <dl className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
        <div>
          <dt className="text-text-muted">Son kontrol</dt>
          <dd className="font-semibold text-text">
            {ago(status.lastAt, nowMs)}
            {status.lastKind ? <span className="block text-xs font-normal text-text-muted">{CLASSIFICATION_LABEL[status.lastKind]}</span> : null}
          </dd>
        </div>
        <div>
          <dt className="text-text-muted">Bugün / son 7 gün</dt>
          <dd className="font-semibold text-text tabular-nums">
            {status.today} / {status.week}
          </dd>
        </div>
        <div>
          <dt className="text-text-muted">Gönderilmeyi bekleyen sonuç</dt>
          <dd className="font-semibold text-text tabular-nums">{status.outboxCount}</dd>
        </div>
        <div>
          <dt className="text-text-muted">Çalışma saatleri</dt>
          <dd className="font-semibold text-text">{status.workingHours}</dd>
        </div>
      </dl>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <div>
          <div className="mb-1 flex justify-between text-xs text-text-muted">
            <span>Saatlik hız limiti</span>
            <span className="tabular-nums">
              {status.hourUsed} / {status.hourCap}
            </span>
          </div>
          <Progress value={hourPct} label="Saatlik kontrol sayısı" tone={hourPct >= 80 ? "warning" : "accent"} />
        </div>
        <div>
          <div className="mb-1 flex justify-between text-xs text-text-muted">
            <span>Günlük limit</span>
            <span className="tabular-nums">
              {status.today} / {status.dayCap}
            </span>
          </div>
          <Progress value={dayPct} label="Günlük kontrol sayısı" tone={dayPct >= 80 ? "warning" : "accent"} />
        </div>
      </div>
      <h3 className="mb-1 mt-4 text-sm font-semibold text-text">Portal sağlığı</h3>
      <ul className="divide-y divide-line text-sm">
        {status.portals.map((p) => (
          <li key={p.id} className="flex items-center gap-2 py-2">
            <span aria-hidden="true" className={cn("h-2.5 w-2.5 shrink-0 rounded-full", p.enabled ? (LEVEL_DOT[p.level] ?? "bg-line") : "bg-line")} />
            <span className="font-medium text-text">{PORTAL_LABEL[p.id] ?? p.id}</span>
            <span className="ml-auto text-text-muted">
              {!p.enabled ? "Kapalı" : p.total === 0 ? HEALTH_LABEL.idle : `${HEALTH_LABEL[p.level]} · son ${p.total} kontrolde ${p.unreadable} okunamadı`}
            </span>
          </li>
        ))}
      </ul>
      {status.reasons.length > 0 ? (
        <>
          <h3 className="mb-1 mt-4 text-sm font-semibold text-text">&quot;Kontrol edilemedi&quot; nedenleri</h3>
          <ul className="list-disc space-y-0.5 pl-5 text-sm text-text">
            {status.reasons.map((r) => (
              <li key={r.code}>
                {reasonLabel(r.code)} <span className="text-text-muted">({r.count}×)</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <p className="mt-4 flex items-center gap-1.5 text-xs text-text-muted">
        <Circle aria-hidden="true" className="h-3 w-3" /> Ayrıştırıcı sürümü {status.parserVersion}. Ayarları (portal aç/kapa, çalışma saatleri, günlük sınır) tarayıcı araç çubuğundaki eklenti simgesinden değiştirebilirsiniz.
      </p>
    </section>
  );
}
