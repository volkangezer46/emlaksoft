"use client";

import { useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarSync, Check, Copy, ExternalLink, RefreshCw } from "lucide-react";
import { regenerateCalendarToken } from "@/app/actions/appointments";
import { useToast } from "@/components/app/toast-provider";

// origin değişmez — abonelik gerekmez, boş unsubscribe döner.
function subscribeNoop() {
  return () => {};
}

/**
 * "Takvime abone ol" kartı — kullanıcının kişisel ICS feed linkini gösterir.
 * Google/Apple/Outlook bu linke abone olup randevuları otomatik senkronlar.
 * Link kişiye özeldir (calendar_token); "Linki yenile" yeni token üretir ve
 * eski abonelikler anında geçersiz olur.
 */
export function CalendarSubscribeCard({ token }: { token: string }) {
  const { push } = useToast();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [copied, setCopied] = useState<"https" | "webcal" | null>(null);
  // window.location.origin SSR'da yok — server snapshot null, client'ta gerçek
  // origin (hydration uyuşmazlığı olmadan, effect'te setState de gerekmeden).
  const origin = useSyncExternalStore(
    subscribeNoop,
    () => window.location.origin,
    () => null,
  );

  const httpsUrl = origin ? `${origin}/api/takvim/${token}` : null;
  const webcalUrl = httpsUrl ? httpsUrl.replace(/^https?:\/\//, "webcal://") : null;
  const googleUrl = webcalUrl
    ? `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcalUrl)}`
    : null;

  async function copy(url: string, kind: "https" | "webcal") {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(kind);
      push("Takvim linki kopyalandı", "ok");
      setTimeout(() => setCopied(null), 2000);
    } catch {
      push("Link panoya kopyalanamadı", "err");
    }
  }

  function regenerate() {
    startTransition(async () => {
      const res = await regenerateCalendarToken();
      if (res.ok) {
        push("Takvim linki yenilendi — eski link artık çalışmaz", "ok");
        router.refresh();
      } else {
        push(res.error ?? "Link yenilenemedi", "err");
      }
    });
  }

  return (
    <section className="dashboard-panel rounded-[20px] border border-line bg-surface p-5">
      <div className="flex items-center gap-2">
        <span className="grid h-9 w-9 place-items-center rounded-[11px] bg-brand-600/10 text-brand-600">
          <CalendarSync className="h-4 w-4" />
        </span>
        <div>
          <p className="text-xs font-semibold text-brand-600">Takvim aboneliği</p>
          <h2 className="font-display font-bold text-ink-950">Takvime abone ol</h2>
        </div>
      </div>
      <p className="mt-3 text-xs leading-relaxed text-text-muted">
        Randevularınız Google, Apple veya Outlook takviminizde otomatik güncellensin. Link size
        özeldir — kimseyle paylaşmayın.
      </p>

      {/* ICS linki + kopyala */}
      <div className="mt-4 flex items-center gap-2 rounded-[11px] border border-line bg-canvas px-3 py-2">
        <code className="min-w-0 flex-1 truncate text-[11px] text-text-muted" title={httpsUrl ?? undefined}>
          {httpsUrl ?? "…"}
        </code>
        <button
          type="button"
          disabled={!httpsUrl}
          onClick={() => httpsUrl && copy(httpsUrl, "https")}
          title="ICS linkini kopyala"
          className="focus-ring press inline-flex shrink-0 items-center gap-1 rounded-[8px] border border-line bg-surface px-2 py-1.5 text-[11px] font-semibold text-text-muted transition hover:border-brand-300 hover:text-brand-600 disabled:opacity-50"
        >
          {copied === "https" ? <Check className="h-3 w-3 text-mint-600" /> : <Copy className="h-3 w-3" />}
          Kopyala
        </button>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {/* webcal:// — Apple Takvim / Outlook masaüstü doğrudan abonelik açar */}
        <button
          type="button"
          disabled={!webcalUrl}
          onClick={() => webcalUrl && copy(webcalUrl, "webcal")}
          className="focus-ring press inline-flex items-center gap-1 rounded-[9px] border border-line bg-canvas px-2.5 py-1.5 text-[11px] font-semibold text-text-muted transition hover:border-brand-300 hover:text-brand-600 disabled:opacity-50"
        >
          {copied === "webcal" ? <Check className="h-3 w-3 text-mint-600" /> : <Copy className="h-3 w-3" />}
          webcal:// kopyala
        </button>
        {googleUrl ? (
          <a
            href={googleUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="focus-ring press inline-flex items-center gap-1 rounded-[9px] border border-line bg-canvas px-2.5 py-1.5 text-[11px] font-semibold text-text-muted transition hover:border-brand-300 hover:text-brand-600"
          >
            <ExternalLink className="h-3 w-3" /> Google Takvim&apos;e ekle
          </a>
        ) : null}
        <button
          type="button"
          onClick={regenerate}
          disabled={pending}
          title="Yeni link üretir; eski link artık çalışmaz"
          className="focus-ring press inline-flex items-center gap-1 rounded-[9px] border border-line bg-canvas px-2.5 py-1.5 text-[11px] font-semibold text-warn-500 transition hover:border-warn-500/40 disabled:opacity-50"
        >
          <RefreshCw className={`h-3 w-3 ${pending ? "animate-spin" : ""}`} />
          {pending ? "Yenileniyor…" : "Linki yenile"}
        </button>
      </div>
    </section>
  );
}
