"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "@/components/ui/smart-link";
import { Copy, Download, Puzzle } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/button";
import { detectBrowser, modKey, pickInstallAction, type BrowserInfo } from "@/lib/listing-control/worker/browser-detect";

/**
 * KURULUM KARTI (istemci): tarayıcıyı ve işletim sistemini algılar, TEK büyük birincil düğme gösterir:
 * Chromium (Chrome, Brave, Arc, Opera...) → "Chrome'a ekle"; Edge → "Edge'e ekle"; Safari/Firefox/mobil → "bilgisayarda Chrome veya Edge".
 * Mağaza adresi tanımlı değilse ZIP + yerel kurulum yönergesine düşer. Sunucuda nötr iskelet çizilir (yerleşim kayması yok).
 */

type UaData = { brands?: { brand: string }[]; mobile?: boolean; platform?: string };

let cached: BrowserInfo | null = null;
function readBrowser(): BrowserInfo {
  if (cached) return cached;
  const nav = navigator as Navigator & { userAgentData?: UaData };
  cached = detectBrowser({
    ua: nav.userAgent,
    platform: nav.userAgentData?.platform ?? nav.platform,
    brands: nav.userAgentData?.brands?.map((b) => b.brand) ?? null,
    mobile: nav.userAgentData?.mobile ?? null,
    touchPoints: nav.maxTouchPoints,
  });
  return cached;
}
const subscribeNone = () => () => undefined;

export function useBrowserInfo(): BrowserInfo | null {
  return useSyncExternalStore(subscribeNone, readBrowser, () => null);
}

export function SyncInstallStep({ chromeStoreUrl, edgeStoreUrl, downloadHref }: { chromeStoreUrl: string | null; edgeStoreUrl: string | null; downloadHref: string | null }) {
  const browser = useBrowserInfo();
  const [copied, setCopied] = useState(false);

  if (!browser) {
    return <div aria-hidden="true" className="h-10 touch:h-11 w-full animate-pulse rounded-[var(--radius-control)] bg-surface-hover" />;
  }

  const action = pickInstallAction(browser, { chrome: chromeStoreUrl, edge: edgeStoreUrl, zip: downloadHref });
  const mod = modKey(browser.os);

  if (action.kind === "unsupported") {
    const copy = async () => {
      try {
        await navigator.clipboard.writeText(window.location.href);
        setCopied(true);
      } catch {
        setCopied(false);
      }
    };
    return (
      <div className="space-y-2">
        <p className="text-sm font-semibold text-text">Bu özellik bilgisayarda Chrome veya Edge ile çalışır.</p>
        <p className="text-xs text-text-muted">
          {browser.mobile ? "Telefon ve tabletlerde kurulamaz." : `${browser.name} şimdilik desteklenmiyor.`} Bağlantıyı kopyalayıp bilgisayarınızdaki Chrome veya Edge&apos;de açın ({mod}+V ile yapıştırın).
        </p>
        <Button type="button" variant="outline" icon={Copy} onClick={() => void copy()} className="w-full">
          {copied ? "Bağlantı kopyalandı" : "Sayfa bağlantısını kopyala"}
        </Button>
      </div>
    );
  }

  if (action.kind === "store") {
    return (
      <ButtonLink href={action.href} target="_blank" rel="noreferrer noopener" size="lg" icon={Puzzle} className="w-full">
        {action.label}
      </ButtonLink>
    );
  }

  const extPage = browser.family === "edge" ? "edge://extensions" : "chrome://extensions";
  return (
    <div className="space-y-2">
      {action.kind === "zip" ? (
        <ButtonLink href={action.href} size="lg" icon={Download} className="w-full" prefetch={false}>Eklentiyi indir</ButtonLink>
      ) : null}
      <p className="text-xs text-text-muted">
        Mağaza adresi henüz tanımlı değil. İndirip ZIP&apos;i bir klasöre çıkarın; adres çubuğuna ({mod}+L) <code className="font-mono">{extPage}</code> yazın, &quot;Geliştirici modu&quot;nu açın, &quot;Paketlenmemiş öğe yükle&quot; ile klasörü seçin.{" "}
        <Link href="/app/ilan-kontrol/eklenti" className="focus-ring rounded text-accent-text hover:underline">Ayrıntılı yönerge</Link>
      </p>
    </div>
  );
}
