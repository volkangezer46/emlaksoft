"use client";

import { useMemo, useState, type MouseEvent } from "react";
import { Monitor, Smartphone } from "lucide-react";
import { Brand } from "@/components/brand/brand";
import { MobileSheetBody, SiteHeaderClient, type ClientGroup } from "@/components/site-menu/mega-menu";
import { now } from "@/lib/clock";
import { renderMenuIcon } from "@/lib/site-menu/icon-node";
import { toPublicMenu } from "@/lib/site-menu/public";
import type { SiteMenuConfig } from "@/lib/site-menu/schema";
import { btn } from "./editor-ui";
import "@/app/marketing.css";
import "@/app/marketing-sections.css";

/**
 * Canlı önizleme: herkese açık sitede çalışan GERÇEK bileşenler (SiteHeaderClient, MobileSheetBody) taslakla çizilir.
 * Bağlantılar önizlemede gezinmez. Masaüstü: üzerine gelin veya tıklayıp mega paneli açın. Mobil: akordeon gövdesi.
 */
export function MenuPreview({ cfg }: { cfg: SiteMenuConfig }) {
  const [mode, setMode] = useState<"desktop" | "mobile">("desktop");
  const menu = useMemo(() => toPublicMenu(cfg, now()), [cfg]);
  const groups: ClientGroup[] = useMemo(
    () => menu.groups.map((g) => ({ ...g, items: g.items.map(({ icon, ...it }) => ({ ...it, iconNode: renderMenuIcon(icon) })) })),
    [menu],
  );
  const ann = menu.announcement;

  const block = (e: MouseEvent) => {
    const a = (e.target as HTMLElement).closest("a");
    if (a) e.preventDefault();
  };

  return (
    <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-4" aria-label="Canlı önizleme">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-display text-base font-extrabold text-ink-950">Canlı önizleme</h2>
          <p className="text-xs text-text-muted">Sitedeki gerçek menü bileşeni, kaydedilmemiş değişikliklerinizle. Bağlantılar burada açılmaz.</p>
        </div>
        <div role="group" aria-label="Önizleme boyutu" className="flex gap-1.5">
          <button type="button" className={btn} aria-pressed={mode === "desktop"} onClick={() => setMode("desktop")}>
            <Monitor className="h-3.5 w-3.5" aria-hidden="true" /> Masaüstü
          </button>
          <button type="button" className={btn} aria-pressed={mode === "mobile"} onClick={() => setMode("mobile")}>
            <Smartphone className="h-3.5 w-3.5" aria-hidden="true" /> Mobil
          </button>
        </div>
      </div>

      {/* Önizleme alanı açık temadır (herkese açık site her zaman açık tema). */}
      <div onClickCapture={block} className="mk mk-preview mt-3 overflow-visible rounded-[var(--radius-card)] border border-line" style={{ minHeight: mode === "desktop" ? "30rem" : undefined }}>
        {mode === "desktop" ? (
          <SiteHeaderClient
            groups={groups}
            logo={<Brand variant="horizontal" tone="light" height={34} alt="" />}
            top={
              ann ? (
                <div className="mk-ann" role="region" aria-label="Duyuru (önizleme)">
                  <p>
                    {ann.text}
                    {ann.href ? <> <a href={ann.href}>{ann.linkLabel}</a></> : null}
                  </p>
                </div>
              ) : undefined
            }
          />
        ) : (
          <div className="mk-preview-sheet mx-auto w-[22.5rem] max-w-full p-3">
            <nav aria-label="Mobil menü önizlemesi" className="mk-sheet">
              <MobileSheetBody groups={groups} close={() => {}} />
            </nav>
          </div>
        )}
      </div>
    </section>
  );
}
