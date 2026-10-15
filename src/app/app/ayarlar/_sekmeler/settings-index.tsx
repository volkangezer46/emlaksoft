"use client";

import { useDeferredValue, useId, useState } from "react";
import Link from "@/components/ui/smart-link";
import { Button } from "@/components/ui/button";
import { ArrowUpRight, Bot, Building2, Database, MessageSquare, Search, ShieldCheck, SlidersHorizontal, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { matchesSettingsQuery, type SettingsDirCategoryId } from "./settings-directory";

export type SettingsIndexItem = {
  href: string;
  label: string;
  description: string;
  keywords: readonly string[];
  status?: { text: string; tone: "neutral" | "warning" | "brand" } | null;
};
export type SettingsIndexCategory = { id: SettingsDirCategoryId; label: string; description: string; items: SettingsIndexItem[] };

const ICONS: Record<SettingsDirCategoryId, LucideIcon> = {
  ofis: Building2,
  ekip: ShieldCheck,
  satis: SlidersHorizontal,
  iletisim: MessageSquare,
  otomasyon: Bot,
  veri: Database,
};

const TONE: Record<NonNullable<SettingsIndexItem["status"]>["tone"], string> = {
  neutral: "bg-ink-950/[0.06] text-text-muted",
  warning: "bg-amber-400/15 text-amber-700",
  brand: "bg-brand-600/10 text-brand-700",
};

/**
 * Ayarlar dizini (OA13): arama kutusu + kategorili kart ızgarası. Süzgeç istemcide ve anlık (veri yok, yalnız ~25 kart);
 * arama Türkçe karakter/şapka duyarsızdır. Mobilde tek sütun, her kart en az 44 px dokunma hedefi.
 */
export function SettingsIndex({ categories }: { categories: SettingsIndexCategory[] }) {
  const [query, setQuery] = useState("");
  const q = useDeferredValue(query);
  const inputId = useId();
  const shown = categories
    .map((c) => ({ ...c, items: c.items.filter((i) => matchesSettingsQuery(i, q)) }))
    .filter((c) => c.items.length > 0);
  const total = shown.reduce((n, c) => n + c.items.length, 0);

  return (
    <div className="space-y-6">
      <div className="max-w-xl">
        <label htmlFor={inputId} className="sr-only">
          Ayarlarda ara
        </label>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-faint" aria-hidden />
          <input className="w-full rounded-[var(--radius-control)] border border-line bg-canvas py-2.5 pl-9 pr-11 text-sm outline-none transition focus:border-brand-400 focus:bg-surface touch:min-h-11 touch:text-base"
            id={inputId}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Ayarlarda ara (ör. logo, 2FA, şablon, onay)"
            autoComplete="off"
            enterKeyHint="search"
          />
          {query ? (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              icon={X}
              onClick={() => setQuery("")}
              className="absolute right-1 top-1/2 -translate-y-1/2"
              aria-label="Aramayı temizle"
            />
          ) : null}
        </div>
        <p className="mt-1.5 text-xs text-text-faint" role="status" aria-live="polite">
          {q ? `${total} ayar ekranı bulundu.` : `${categories.reduce((n, c) => n + c.items.length, 0)} ayar ekranı, ${categories.length} başlıkta.`}
          {q ? (
            <>
              {" "}
              Tek tek kurallar için{" "}
              <Link href={`/app/ayarlar/merkez?ara=${encodeURIComponent(q)}`} className="font-semibold text-brand-600 hover:underline">
                Kurallar ve varsayılanlar içinde arayın
              </Link>
              .
            </>
          ) : null}
        </p>
      </div>

      {shown.length === 0 ? (
        <p className="rounded-[var(--radius-card)] border border-dashed border-line px-4 py-10 text-center text-sm text-text-muted">
          “{q}” için ayar ekranı bulunamadı. Farklı bir sözcük deneyin.
        </p>
      ) : (
        shown.map((c) => {
          const Icon = ICONS[c.id];
          return (
            <section key={c.id} aria-labelledby={`ayar-kategori-${c.id}`} className="space-y-3">
              <div className="flex items-start gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius-control)] bg-brand-600/10 text-brand-600">
                  <Icon className="h-4 w-4" aria-hidden />
                </span>
                <div className="min-w-0">
                  <h2 id={`ayar-kategori-${c.id}`} className="font-display text-base font-bold text-ink-950">
                    {c.label}
                  </h2>
                  <p className="text-xs text-text-muted">{c.description}</p>
                </div>
              </div>
              <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {c.items.map((i) => (
                  <li key={i.href}>
                    <Link
                      href={i.href}
                      className="focus-ring lift group flex h-full min-h-11 items-start gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-3.5 transition hover:border-brand-300"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="text-sm font-semibold text-ink-950">{i.label}</span>
                          {i.status ? (
                            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${TONE[i.status.tone]}`}>{i.status.text}</span>
                          ) : null}
                        </span>
                        <span className="mt-0.5 block text-xs text-text-muted">{i.description}</span>
                      </span>
                      <ArrowUpRight className="mt-0.5 h-4 w-4 shrink-0 text-text-faint transition group-hover:text-brand-600" aria-hidden />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          );
        })
      )}
    </div>
  );
}
