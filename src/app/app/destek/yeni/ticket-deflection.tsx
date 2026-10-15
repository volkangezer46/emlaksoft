"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BookOpen, CheckCircle2, ExternalLink, HelpCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/app/toast-provider";
import { clearActiveFormDrafts } from "@/components/app/use-form-draft";
import { recordTicketDeflection, suggestTicketArticles } from "@/app/actions/support-deflection";
import type { ArticleSuggestion } from "@/lib/help-center/search";

const DEBOUNCE_MS = 400;

/**
 * PA-7: yeni talep konusu yazılırken (4+ karakter, 400 ms bekleme) ilgili en çok 3 yardım makalesi. Makale yeni sekmede
 * açılır (form taslağı korunur). "Bu sorunumu çözdü" ölçümü yazar, taslağı siler ve talep açmadan Destek'e döner.
 * Öneri yoksa hiçbir şey çizilmez (boş vaat yok).
 */
export function TicketDeflection({ subject }: { subject: string }) {
  const router = useRouter();
  const { push } = useToast();
  const [result, setResult] = useState<{ q: string; items: ArticleSuggestion[] }>({ q: "", items: [] });
  const [resolving, startResolve] = useTransition();
  const [busySlug, setBusySlug] = useState<string | null>(null);
  const q = subject.trim();

  useEffect(() => {
    if (q.length < 4) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void suggestTicketArticles(q)
        .then((r) => {
          if (!cancelled) setResult({ q, items: r.items });
        })
        .catch(() => undefined);
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [q]);

  const items = q.length >= 4 ? result.items : [];
  if (items.length === 0) return null;

  function resolved(item: ArticleSuggestion) {
    setBusySlug(item.slug);
    startResolve(async () => {
      const fd = new FormData();
      fd.set("kind", item.kind);
      fd.set("slug", item.slug);
      fd.set("q", q);
      const r = await recordTicketDeflection(fd);
      setBusySlug(null);
      if (r.error) {
        push(r.error, "err");
        return;
      }
      clearActiveFormDrafts();
      push("Sorununuz çözüldüğüne sevindik; talep açılmadı.", "ok");
      router.push("/app/destek");
    });
  }

  return (
    <section aria-label="Önerilen yardım makaleleri" className="sm:col-span-2 rounded-[var(--radius-card)] border border-brand-300/40 bg-brand-600/[0.04] p-3 sm:p-4">
      <p className="flex items-center gap-2 text-sm font-semibold text-ink-950">
        <HelpCircle className="h-4 w-4 text-brand-600" aria-hidden /> Bu makaleler sorununuzu çözebilir
      </p>
      <ul className="mt-2 space-y-2" aria-live="polite">
        {items.map((item) => (
          <li key={`${item.kind}:${item.slug}`} className="rounded-[var(--radius-control)] border border-line bg-surface p-3">
            <a
              href={item.href}
              target="_blank"
              rel="noopener"
              className="focus-ring flex min-h-11 items-start gap-2 rounded-[var(--radius-control)] text-sm font-semibold text-brand-700 hover:underline"
            >
              <BookOpen className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span className="min-w-0 flex-1">
                {item.title}
                <span className="ml-1 text-xs font-normal text-text-faint">{item.kind === "guide" ? "Rehber" : "SSS"}</span>
              </span>
              <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0 text-text-faint" aria-label="yeni sekmede açılır" />
            </a>
            {item.snippet ? <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-text-muted">{item.snippet}</p> : null}
            <div className="mt-2 flex justify-end">
              <Button type="button" size="sm" variant="secondary" icon={CheckCircle2} loading={resolving && busySlug === item.slug} disabled={resolving} onClick={() => resolved(item)} className="w-full sm:w-auto">
                Bu sorunumu çözdü
              </Button>
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-text-faint">Çözmediyse formu doldurmaya devam edin; talebiniz destek ekibine gider.</p>
    </section>
  );
}
