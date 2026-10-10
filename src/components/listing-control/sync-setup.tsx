"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "@/components/ui/smart-link";
import { CheckCircle2, Circle, Download, PlugZap, Puzzle, RefreshCw } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/button";
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
  requestStatus,
} from "@/lib/listing-control/worker/bridge";
import { parseStatusView, type ExtensionStatusView } from "@/lib/listing-control/worker/extension-status-view";
import { isOutdated } from "@/lib/listing-control/worker/extension-release";

/**
 * DURUM ŞERİDİ + 3 ADIM (istemci): Kur → Bağla → Otomatik. Eklenti belge işaretinden ya da (kimlik biliniyorsa) siteden
 * `ping` ile algılanır. Bağlama YALNIZ "Hesabımı bağla" tıklamasıyla gider. Bağlıyken yalnız ince şerit görünür.
 */

export type SyncSetupProps = {
  latestVersion: string;
  chromeStoreUrl: string | null;
  edgeStoreUrl: string | null;
  downloadHref: string | null;
  extensionId: string | null;
  lastServerScan: { at: string; complete: boolean } | null;
};

type Live = { installed: boolean; pinged: boolean; version: string | null; connected: boolean; paused: boolean };

function when(ms: number | null, nowMs: number): string {
  if (!ms) return "henüz yok";
  const h = Math.floor((nowMs - ms) / 3_600_000);
  if (h < 1) return "az önce";
  if (h < 24) return `${h} saat önce`;
  return `${Math.floor(h / 24)} gün önce`;
}

export function SyncSetup({ latestVersion, chromeStoreUrl, edgeStoreUrl, downloadHref, extensionId, lastServerScan }: SyncSetupProps) {
  const [live, setLive] = useState<Live>({ installed: false, pinged: false, version: null, connected: false, paused: false });
  const [status, setStatus] = useState<ExtensionStatusView | null>(null);
  const [nowMs, setNowMs] = useState(0);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const refresh = useCallback(async () => {
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
    setStatus(installed ? parseStatusView(await requestStatus()) : null);
  }, [extensionId]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window || event.origin !== window.location.origin) return;
      if (parseBridgeMessage(event.data)?.type === "ready") void refresh();
    };
    window.addEventListener("message", onMessage);
    const first = window.setTimeout(() => void refresh(), 0);
    const timer = window.setInterval(() => void refresh(), 5_000);
    return () => {
      window.removeEventListener("message", onMessage);
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [refresh]);

  const present = live.installed || live.pinged;
  const outdated = present && isOutdated(live.version, latestVersion);
  const ready = live.installed && live.connected && !outdated;
  const extScan = status?.scan?.lastFullAt ?? null;
  const serverScan = lastServerScan ? Date.parse(lastServerScan.at) : null;
  const lastFull = Math.max(extScan ?? 0, lastServerScan?.complete ? (serverScan ?? 0) : 0) || null;

  const connect = async () => {
    setBusy(true);
    setFailed(false);
    const ok = await requestConnect();
    setBusy(false);
    setFailed(!ok);
    await refresh();
  };

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

  return (
    <section aria-label="Günlük ilan kontrolü" className="space-y-3">
      <div role="status" className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-[var(--radius-card)] border border-line bg-surface px-4 py-3 text-sm shadow-[var(--shadow-xs)]">
        <span className="inline-flex items-center gap-2 font-semibold text-text">
          <span aria-hidden="true" className={cn("h-2.5 w-2.5 rounded-full", dot)} />
          {stateText}
        </span>
        <span className="text-text-muted">Son tam tarama: {when(lastFull, nowMs || now())}</span>
        <span className="text-text-muted">Sonraki: tarayıcı açıkken günde en az bir kez</span>
        {status?.scan?.active ? <span className="inline-flex items-center gap-1 text-text-muted"><RefreshCw aria-hidden="true" className="h-3.5 w-3.5 animate-spin" /> Şu an taranıyor</span> : null}
      </div>

      {!ready ? (
        <ol className="grid gap-3 md:grid-cols-3" aria-label="Kurulum adımları">
          <li className={cn("rounded-[var(--radius-card)] border bg-surface p-4", !present ? "border-accent" : "border-line")}>
            <h3 className="flex items-center gap-2 text-sm font-semibold text-text">
              {present ? <CheckCircle2 aria-hidden="true" className="h-4 w-4 text-mint-600" /> : <Circle aria-hidden="true" className="h-4 w-4" />} 1. Eklentiyi ekle
            </h3>
            <p className="mt-1 text-xs text-text-muted">Tarayıcınızda ilanlarınızı sizin yerinize okur.</p>
            <div className="mt-3 space-y-2">
              {chromeStoreUrl ? <ButtonLink href={chromeStoreUrl} target="_blank" rel="noreferrer noopener" icon={Puzzle} className="w-full">Chrome&apos;a ekle</ButtonLink> : null}
              {edgeStoreUrl ? <ButtonLink href={edgeStoreUrl} target="_blank" rel="noreferrer noopener" variant="outline" icon={Puzzle} className="w-full">Edge&apos;e ekle</ButtonLink> : null}
              {!chromeStoreUrl && !edgeStoreUrl ? (
                <>
                  {downloadHref ? <ButtonLink href={downloadHref} icon={Download} className="w-full" prefetch={false}>Eklentiyi indir</ButtonLink> : null}
                  <p className="text-xs text-text-muted">
                    Mağaza adresi henüz tanımlı değil. İndirip adres çubuğuna <code className="font-mono">chrome://extensions</code> yazın, &quot;Geliştirici modu&quot;nu açın, &quot;Paketlenmemiş öğe yükle&quot; ile klasörü seçin.{" "}
                    <Link href="/app/ilan-kontrol/eklenti" className="focus-ring rounded text-accent-text hover:underline">Ayrıntılı yönerge</Link>
                  </p>
                </>
              ) : null}
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
                <Button variant="outline" icon={RefreshCw} onClick={() => window.location.reload()} className="w-full">Sayfayı yenile</Button>
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
