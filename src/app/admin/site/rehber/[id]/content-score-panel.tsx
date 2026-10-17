"use client";

import { useMemo } from "react";
import type { GuideContent } from "@/lib/guides/defaults";
import { scoreContent } from "@/lib/seo/content-score";

/**
 * Rehber İÇERİK PUANI paneli (tembel ada: editör `next/dynamic` ile boşta yükler). Hesap SAF ve tarayıcıda canlıdır
 * (`src/lib/seo/content-score.ts`); sunucuya hiçbir şey göndermez. Puan rehberdir, yayını engellemez.
 */
export default function ContentScorePanel({ cfg, titleTemplate, minWords }: { cfg: GuideContent; titleTemplate: string; minWords: number }) {
  const r = useMemo(
    () =>
      scoreContent({
        title: cfg.title,
        seoTitle: cfg.seo.title,
        seoDescription: cfg.seo.description,
        body: cfg.body,
        focusKeyword: cfg.seo.focusKeyword ?? null,
        titleTemplate,
        minWords,
      }),
    [cfg, titleTemplate, minWords],
  );
  const tone = r.total >= 80 ? "text-mint-700" : r.total >= 55 ? "text-amber-700" : "text-danger-600";
  const failing = r.checks.filter((c) => c.ratio < 1).sort((a, b) => b.weight * (1 - b.ratio) - a.weight * (1 - a.ratio));
  return (
    <div className="rounded-[var(--radius-panel)] border border-line bg-canvas p-3" aria-live="polite">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className={`font-display text-3xl font-extrabold tabular-nums ${tone}`}>{r.total}</span>
        <span className="text-sm font-semibold text-ink-950">/ 100 içerik puanı</span>
        <span className="text-xs text-text-muted">
          {r.words} sözcük{r.readability ? ` · okunabilirlik ${r.readability.score} (${r.readability.label})` : ""}
          {r.density !== null ? ` · odak kelime yoğunluğu %${r.density.toLocaleString("tr-TR")}` : " · odak kelime girilmedi"}
        </span>
      </div>
      {failing.length === 0 ? (
        <p className="mt-2 text-sm text-mint-700">Tüm içerik kontrolleri geçti.</p>
      ) : (
        <ul className="mt-2 space-y-1.5 text-xs">
          {failing.map((c) => (
            <li key={c.id} className="flex flex-wrap gap-x-2">
              <span className="font-semibold text-ink-950">{c.label}</span>
              <span className="text-text-muted">{c.detail}</span>
              <span className="basis-full text-text-muted">→ {c.fix}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-xs text-text-faint">Rehber puanıdır; anahtar kelime doldurma ödüllendirilmez (yoğunluk %3 üstü ceza alır).</p>
    </div>
  );
}
