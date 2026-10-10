"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { CheckCircle2, Circle, PlugZap, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { now } from "@/lib/clock";
import {
  bridgeConnected,
  bridgeInstalled,
  bridgePaused,
  bridgeVersion,
  parseBridgeMessage,
  pingExtension,
  requestConnect,
  requestScanNow,
  requestStatus,
} from "@/lib/listing-control/worker/bridge";
import { parseStatusView, type ExtensionStatusView } from "@/lib/listing-control/worker/extension-status-view";
import { isOutdated } from "@/lib/listing-control/worker/extension-release";
import { hasReadResult, scanBaseline, scanRunState } from "@/lib/listing-control/worker/scan-run-view";
import { SyncInstallStep, useBrowserInfo } from "./sync-install-step";
import { SyncScanPanel, type ScanSummary } from "./sync-scan-panel";
import { modKey } from "@/lib/listing-control/worker/browser-detect";

/**
 * DURUM ŞERİDİ + 3 ADIM (istemci): Kur → Bağla → Otomatik. Eklenti belge işaretinden ya da (kimlik biliniyorsa) siteden
 * `ping` ile algılanır. Bağlama YALNIZ "Bağla" tıklamasıyla gider (eklenti kurulumdan sonra `?bagla=1` ile bu sayfayı açar;
 * düğme öne çıkar ama otomatik bağlanmaz). Bağlanınca eklentiye "şimdi tara" gider, ilerleme ve sonuç kartı burada görünür.
 */

export type SyncSetupProps = {
  latestVersion: string;
  chromeStoreUrl: string | null;
  edgeStoreUrl: string | null;
  downloadHref: string | null;
  extensionId: string | null;
  lastServerScan: { at: string; complete: boolean; read: number | null } | null;
  /** Sayfa `?bagla=1` ile (eklenti kurulumundan) açıldı. */
  bind: boolean;
  summary: ScanSummary;
};

type Live = { installed: boolean; pinged: boolean; version: string | null; connected: boolean; paused: boolean };
type Run = { baseline: number; importAt: string | null; ticks: number };

function when(ms: number | null, nowMs: number): string {
  if (!ms) return "henüz yok";
  const h = Math.floor((nowMs - ms) / 3_600_000);
  if (h < 1) return "az önce";
  if (h < 24) return `${h} saat önce`;
  return `${Math.floor(h / 24)} gün önce`;
}

/** Tarama başlamadıysa dürüst neden (eklenti durumundan). */
function startNoteFor(status: ExtensionStatusView | null, ticks: number): string | null {
  switch (status?.state) {
    case "outside_hours":
      return `Çalışma saatleri dışında (${status.workingHours}); o saatlerde otomatik başlar.`;
    case "day_cap":
      return "Bugünkü okuma sınırına ulaşıldı; yarın devam eder.";
    case "hour_cap":
      return "Saatlik okuma sınırına ulaşıldı; kısa süre sonra devam eder.";
    case "cooldown":
      return "Portal kısa süre beklemeye aldı; birazdan otomatik devam eder.";
    case "paused":
      return "Eklenti duraklatıldı; devam ettirince taranır.";
    case "login_required":
      return "EmlakSoft oturumu doğrulanamadı; sayfayı yenileyip tekrar deneyin.";
    default:
      return ticks >= 10 ? "Tarama başlamadı. Portal şu an okunamıyor olabilir; biraz sonra tekrar deneyin." : null;
  }
}

export function SyncSetup({ latestVersion, chromeStoreUrl, edgeStoreUrl, downloadHref, extensionId, lastServerScan, bind, summary }: SyncSetupProps) {
  const router = useRouter();
  const pathname = usePathname();
  const browser = useBrowserInfo();
  const [live, setLive] = useState<Live>({ installed: false, pinged: false, version: null, connected: false, paused: false });
  const [status, setStatus] = useState<ExtensionStatusView | null>(null);
  const [nowMs, setNowMs] = useState(0);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [bindDone, setBindDone] = useState(false);
  const [run, setRun] = useState<Run | null>(null);
  const running = run !== null;

  const refresh = useCallback(async (): Promise<ExtensionStatusView | null> => {
    const installed = bridgeInstalled();
    const ping = installed ? null : await pingExtension(extensionId);
    setLive({
      installed,
      pinged: ping !== null,
      version: installed ? bridgeVersion() : (ping?.version ?? null),
      connected: installed ? bridgeConnected() : (ping?.connected ?? false),
      paused: installed ? bridgePaused() : (ping?.paused ?? false),
    });
    setNowMs(now());
    const next = installed ? parseStatusView(await requestStatus()) : null;
    setStatus(next);
    // Başlamayan tarama için sayaç (saat değil, yoklama sayısı): "başlamadı" mesajı ancak ~15 sn sonra.
    setRun((r) => (r && !next?.scan?.active && (next?.scan?.pendingUploads ?? 0) === 0 ? { ...r, ticks: r.ticks + 1 } : r));
    return next;
  }, [extensionId]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window || event.origin !== window.location.origin) return;
      if (parseBridgeMessage(event.data)?.type === "ready") void refresh();
    };
    window.addEventListener("message", onMessage);
    const first = window.setTimeout(() => void refresh(), 0);
    const timer = window.setInterval(() => void refresh(), running ? 1_500 : 5_000);
    return () => {
      window.removeEventListener("message", onMessage);
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [refresh, running]);

  const present = live.installed || live.pinged;
  const outdated = present && isOutdated(live.version, latestVersion);
  const ready = live.installed && live.connected && !outdated;
  const extScan = status?.scan?.lastFullAt ?? null;
  const serverScan = lastServerScan ? Date.parse(lastServerScan.at) : null;
  const lastFull = Math.max(extScan ?? 0, lastServerScan?.complete ? (serverScan ?? 0) : 0) || null;

  const runState = run ? scanRunState(status?.scan, run.baseline) : null;
  const summaryFresh = !!run && !!lastServerScan && lastServerScan.at !== run.importAt;
  // Okunan ilan var ama sunucu özeti henüz yenilenmediyse: sayfa verisini yoklayarak tazele (sonuç gelince durur).
  const awaitingFresh = !!runState && runState.phase === "done" && hasReadResult(runState.portals) && !summaryFresh;
  useEffect(() => {
    if (!awaitingFresh) return;
    router.refresh();
    const t = window.setInterval(() => router.refresh(), 2_500);
    return () => window.clearInterval(t);
  }, [awaitingFresh, router]);

  const startScan = async (fresh?: ExtensionStatusView | null) => {
    const base = fresh === undefined ? status : fresh;
    setRun({ baseline: scanBaseline(base?.scan), importAt: lastServerScan?.at ?? null, ticks: 0 });
    const ok = await requestScanNow();
    if (!ok) setRun((r) => (r ? { ...r, ticks: 10 } : r));
  };

  const connect = async () => {
    setBusy(true);
    setFailed(false);
    const ok = await requestConnect();
    setBusy(false);
    setFailed(!ok);
    const next = await refresh();
    if (!ok) return;
    if (bind) {
      setBindDone(true);
      router.replace(pathname); // ?bagla=1 temizlenir
    }
    await startScan(next);
  };

  const showBind = bind && !bindDone && present && !live.connected && !outdated;

  const stateText = !present
    ? "Eklenti kurulu değil"
    : outdated
      ? "Eklenti güncellenmeli"
      : !live.connected
        ? "Eklenti kurulu, hesap bağlı değil"
        : live.paused
          ? "Eklenti duraklatıldı"
          : "Eklenti bağlı";
  const dot = ready && !live.paused ? "bg-mint-500" : present ? "bg-amber-500" : "bg-line";
  const mod = modKey(browser?.os ?? "other");

  return (
    <section aria-label="Günlük ilan kontrolü" className="space-y-3">
      <div role="status" className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-[var(--radius-card)] border border-line bg-surface px-4 py-3 text-sm shadow-[var(--shadow-xs)]">
        <span className="inline-flex items-center gap-2 font-semibold text-text">
          <span aria-hidden="true" className={cn("h-2.5 w-2.5 rounded-full", dot)} />
          {stateText}
        </span>
        <span className="text-text-muted">Son tam tarama: {when(lastFull, nowMs || now())}</span>
        <span className="text-text-muted">Sonraki: tarayıcı açıkken günde en az bir kez</span>
        {status?.scan?.active && !running ? <span className="inline-flex items-center gap-1 text-text-muted"><RefreshCw aria-hidden="true" className="h-3.5 w-3.5 animate-spin" /> Şu an taranıyor</span> : null}
        {ready && !running ? <Button type="button" size="sm" variant="outline" icon={RefreshCw} onClick={() => void startScan()} className="ml-auto">Şimdi tara</Button> : null}
      </div>

      {showBind ? (
        <div role="region" aria-label="Eklenti kuruldu" className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-accent bg-surface p-5 shadow-[var(--shadow-xs)] md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <h3 className="flex items-center gap-2 text-base font-semibold text-text"><CheckCircle2 aria-hidden="true" className="h-5 w-5 text-mint-600" /> Eklenti kuruldu. Son adım: hesabını bağla</h3>
            <p className="mt-1 text-sm text-text-muted">Tek tık yeter; portal şifreniz istenmez. Bağlanınca ilanlarınız hemen taranır.</p>
            {failed ? <p role="alert" className="mt-1 text-xs text-danger-text">Eklenti yanıt vermedi. Sayfayı yenileyip ({mod}+R) tekrar deneyin.</p> : null}
          </div>
          <Button size="lg" icon={PlugZap} onClick={() => void connect()} loading={busy} disabled={!live.installed} className="md:min-w-40">Bağla</Button>
        </div>
      ) : null}

      {runState ? (
        <SyncScanPanel
          state={runState}
          scan={status?.scan}
          startNote={startNoteFor(status, run?.ticks ?? 0)}
          summary={summary}
          summaryFresh={summaryFresh}
          onDismiss={() => setRun(null)}
          onRetry={() => void startScan()}
        />
      ) : null}

      {!ready && !showBind ? (
        <ol className="grid gap-3 md:grid-cols-3" aria-label="Kurulum adımları">
          <li className={cn("rounded-[var(--radius-card)] border bg-surface p-4", !present ? "border-accent" : "border-line")}>
            <h3 className="flex items-center gap-2 text-sm font-semibold text-text">
              {present ? <CheckCircle2 aria-hidden="true" className="h-4 w-4 text-mint-600" /> : <Circle aria-hidden="true" className="h-4 w-4" />} 1. Eklentiyi ekle
            </h3>
            <p className="mt-1 text-xs text-text-muted">Tarayıcınızda ilanlarınızı sizin yerinize okur.</p>
            <div className="mt-3">
              {present ? (
                <p className="text-sm font-medium text-text">Eklenti algılandı.</p>
              ) : (
                <SyncInstallStep chromeStoreUrl={chromeStoreUrl} edgeStoreUrl={edgeStoreUrl} downloadHref={downloadHref} />
              )}
            </div>
          </li>
          <li className={cn("rounded-[var(--radius-card)] border bg-surface p-4", present && !live.connected ? "border-accent" : "border-line")}>
            <h3 className="flex items-center gap-2 text-sm font-semibold text-text">
              {live.connected ? <CheckCircle2 aria-hidden="true" className="h-4 w-4 text-mint-600" /> : <Circle aria-hidden="true" className="h-4 w-4" />} 2. Hesabını bağla
            </h3>
            <p className="mt-1 text-xs text-text-muted">Tek tık. Portal şifreniz istenmez.</p>
            <div className="mt-3 space-y-2">
              <Button icon={PlugZap} onClick={() => void connect()} loading={busy} disabled={!live.installed || outdated || live.connected} className="w-full">
                {live.connected ? "Bağlandı" : "Hesabımı bağla"}
              </Button>
              {present && !live.installed ? (
                <Button variant="outline" icon={RefreshCw} onClick={() => window.location.reload()} className="w-full">Sayfayı yenile ({mod}+R)</Button>
              ) : null}
              {failed ? <p role="alert" className="text-xs text-danger-text">Eklenti yanıt vermedi. Sayfayı yenileyip tekrar deneyin.</p> : null}
            </div>
          </li>
          <li className="rounded-[var(--radius-card)] border border-line bg-surface p-4">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-text"><Circle aria-hidden="true" className="h-4 w-4" /> 3. Gerisi otomatik</h3>
            <p className="mt-1 text-xs text-text-muted">Her gün ilan listeniz portföyünüzle karşılaştırılır; farklar burada çıkar. Tarayıcı kapalıysa açılışta yapılır.</p>
          </li>
        </ol>
      ) : null}

      <details className="rounded-[var(--radius-card)] border border-line bg-surface px-4 py-3 text-sm">
        <summary className="cursor-pointer font-semibold text-text">Çok şubeli ofis: toplu kurulum rehberi</summary>
        <div className="mt-2 space-y-2 text-text-muted">
          <p>Tüm bilgisayarlara sessiz kurulum için BT yöneticiniz &quot;ExtensionInstallForcelist&quot; ilkesini kullanır (Google Yönetici &gt; Chrome &gt; Uygulamalar ve uzantılar &gt; Zorunlu yükle; Edge için GPO/Intune).</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>Eklenti kimliği: <code className="font-mono">{extensionId ?? "mağaza yayınından sonra verilir"}</code></li>
            <li>Chrome güncelleme adresi: <code className="font-mono">https://clients2.google.com/service/update2/crx</code></li>
            <li>Edge güncelleme adresi: <code className="font-mono">https://edge.microsoft.com/extensionwebstorebase/v1/crx</code></li>
          </ul>
          <p>Kurulumdan sonra her kullanıcı yine kendi hesabını bağlar (&quot;Hesabımı bağla&quot;); bağlamayı yönetici yapamaz.</p>
        </div>
      </details>
    </section>
  );
}
