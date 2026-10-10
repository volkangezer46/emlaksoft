"use client";

import Link from "@/components/ui/smart-link";
import { AlertTriangle, CheckCircle2, ExternalLink, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ExtensionStatusView } from "@/lib/listing-control/worker/extension-status-view";
import { PORTAL_LABEL } from "@/lib/listing-control/worker/extension-labels";
import {
  PORTAL_HOME,
  PORTAL_HOST_LABEL,
  hasReadResult,
  scanProgressText,
  type ScanRunPortal,
  type ScanRunState,
} from "@/lib/listing-control/worker/scan-run-view";

/**
 * "Anında kanıt" paneli: bağlama sonrası ilk tarama canlı ilerler ("İlanların okunuyor… 3/5 sayfa"), bitince sonuç kartı gelir.
 * Her sayı filtreli hedefe gider (sıfır çıkmaz metrik). Okunamayan/engellenen portal ASLA "ilan yok" demez: "kontrol edilemedi".
 */

export type ScanSummary = {
  found: number | null;
  matched: number;
  pending: number;
  links: { found: string; matched: string; pending: string };
};

const chip = "focus-ring rounded-[var(--radius-control)] border border-line bg-surface px-3 py-1.5 text-sm font-semibold text-text hover:bg-surface-hover";

function PortalNotice({ p }: { p: ScanRunPortal }) {
  const host = PORTAL_HOST_LABEL[p.id] ?? PORTAL_LABEL[p.id] ?? p.id;
  const home = PORTAL_HOME[p.id];
  if (p.result === "blocked") {
    return (
      <li className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-text">
        <AlertTriangle aria-hidden="true" className="h-4 w-4 text-amber-600" />
        <span>
          {host}&apos;da oturum açık değil — oturum açıp tekrar dene. <span className="text-text-muted">(Portal doğrulama istemiş de olabilir.)</span>
        </span>
        {home ? (
          <a href={home} target="_blank" rel="noreferrer noopener" className="focus-ring inline-flex items-center gap-1 rounded font-semibold text-accent-text hover:underline">
            {host}&apos;u aç <ExternalLink aria-hidden="true" className="h-3.5 w-3.5" />
          </a>
        ) : null}
      </li>
    );
  }
  if (p.result === "unreadable" || p.read === 0) {
    return (
      <li className="flex items-center gap-2 text-sm text-text">
        <AlertTriangle aria-hidden="true" className="h-4 w-4 text-amber-600" />
        <span>{host}: kontrol edilemedi (liste okunamadı). Bu, ilanınız olmadığı anlamına gelmez.</span>
      </li>
    );
  }
  if (p.result === "partial") {
    return (
      <li className="flex items-center gap-2 text-sm text-text-muted">
        <AlertTriangle aria-hidden="true" className="h-4 w-4 text-amber-600" />
        <span>{host}: {p.read} ilan okundu{p.expected ? ` (portal ${p.expected} gösteriyor)` : ""}; liste tam okunamadı.</span>
      </li>
    );
  }
  return null;
}

export function SyncScanPanel({
  state,
  scan,
  startNote,
  summary,
  summaryFresh,
  onDismiss,
  onRetry,
}: {
  state: ScanRunState;
  scan: ExtensionStatusView["scan"] | undefined;
  /** Tarama henüz başlamadıysa dürüst neden ("çalışma saati dışında" gibi) ya da null. */
  startNote: string | null;
  summary: ScanSummary;
  /** Sunucu verisi tarama sonrası yenilendi mi (eski sayı gösterilmesin). */
  summaryFresh: boolean;
  onDismiss: () => void;
  onRetry: () => void;
}) {
  if (state.phase === "idle") {
    return (
      <div role="status" className="flex flex-wrap items-center gap-3 rounded-[var(--radius-card)] border border-line bg-surface px-4 py-3 text-sm shadow-[var(--shadow-xs)]">
        <RefreshCw aria-hidden="true" className="h-4 w-4 animate-spin text-text-muted" />
        <span className="font-semibold text-text">{startNote ?? "Tarama başlatılıyor…"}</span>
        {startNote ? <Button type="button" size="sm" variant="outline" onClick={onRetry}>Tekrar dene</Button> : null}
      </div>
    );
  }
  if (state.phase === "running") {
    return (
      <div role="status" aria-live="polite" className="flex flex-wrap items-center gap-3 rounded-[var(--radius-card)] border border-accent bg-surface px-4 py-3 text-sm shadow-[var(--shadow-xs)]">
        <RefreshCw aria-hidden="true" className="h-4 w-4 animate-spin text-accent-text" />
        <span className="font-semibold text-text">{scanProgressText(scan)}</span>
        {scan?.activePortal ? <span className="text-text-muted">{PORTAL_HOST_LABEL[scan.activePortal] ?? scan.activePortal}</span> : null}
      </div>
    );
  }
  if (state.phase === "uploading") {
    return (
      <div role="status" className="flex items-center gap-3 rounded-[var(--radius-card)] border border-line bg-surface px-4 py-3 text-sm shadow-[var(--shadow-xs)]">
        <RefreshCw aria-hidden="true" className="h-4 w-4 animate-spin text-text-muted" />
        <span className="font-semibold text-text">İlanlar EmlakSoft&apos;a aktarılıyor…</span>
      </div>
    );
  }

  const read = hasReadResult(state.portals);
  const notices = state.portals.filter((p) => p.result === "blocked" || p.result === "unreadable" || p.result === "partial" || p.read === 0);
  return (
    <section aria-label="Tarama sonucu" className="space-y-3 rounded-[var(--radius-card)] border border-line bg-surface p-4 shadow-[var(--shadow-xs)]">
      {read ? (
        summaryFresh && summary.found !== null ? (
          <div className="space-y-2">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-text">
              <CheckCircle2 aria-hidden="true" className="h-4 w-4 text-mint-600" /> İlk tarama tamam
            </h3>
            <div className="flex flex-wrap gap-2">
              <Link href={summary.links.found} className={chip}>{summary.found} ilan bulundu</Link>
              <Link href={summary.links.matched} className={chip}>Portföyünle eşleşen: {summary.matched}</Link>
              <Link href={summary.links.pending} className={chip}>Onay bekleyen: {summary.pending}</Link>
            </div>
          </div>
        ) : (
          <p role="status" className="flex items-center gap-2 text-sm font-semibold text-text">
            <RefreshCw aria-hidden="true" className="h-4 w-4 animate-spin text-text-muted" /> Sonuçlar hazırlanıyor…
          </p>
        )
      ) : (
        <h3 className="flex items-center gap-2 text-sm font-semibold text-text">
          <AlertTriangle aria-hidden="true" className="h-4 w-4 text-amber-600" /> İlanlar okunamadı
        </h3>
      )}
      {notices.length > 0 ? (
        <ul className="space-y-1.5">
          {notices.map((p) => (
            <PortalNotice key={p.id} p={p} />
          ))}
        </ul>
      ) : null}
      <div className="flex gap-2">
        {read ? null : <Button type="button" size="sm" variant="outline" icon={RefreshCw} onClick={onRetry}>Tekrar dene</Button>}
        <Button type="button" size="sm" variant="ghost" onClick={onDismiss}>Tamam</Button>
      </div>
    </section>
  );
}
