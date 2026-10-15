"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { ArrowDownCircle, ArrowLeftRight, ArrowUpCircle, FileText, Rows3, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import {
  ENTRY_TAB_LABEL,
  directionTab,
  entryTabsFor,
  isEntryTab,
  lastTabKey,
  tabDirection,
  type EntryPrefill,
  type EntryTab,
} from "@/lib/finance/entry-workspace";
import { cn } from "@/lib/utils";
import type { EntryDirection } from "../../quick-entry";
import { BulkEntry } from "./bulk-entry";
import { DocumentTab, type ReceiptUse } from "./document-tab";
import { EntryForm, type EntryFormContext, type EntrySeed } from "./entry-form";

/**
 * Muhasebe kayıt çalışma alanı (`/app/giderler/kayit`): üstte sekmeler (Gider · Gelir · Transfer · Fatura/Belge · Toplu giriş),
 * altta seçili sekmenin gövdesi. Sekme `?tur=` sorgusunda tutulur (sığ: `history.replaceState`, sayfa yeniden yüklenmez);
 * adres sekme vermezse kullanıcının son kullandığı sekme açılır (yerel tercih). Alt+1…5 sekme değiştirir.
 * Gider/Gelir/Transfer aynı formu paylaşır (yazılan değerler sekme değişince korunur); belge ve toplu giriş ayrı panellerdir.
 */

const TAB_ICON: Record<EntryTab, LucideIcon> = {
  gider: ArrowUpCircle,
  gelir: ArrowDownCircle,
  transfer: ArrowLeftRight,
  belge: FileText,
  toplu: Rows3,
};

const noopSubscribe = () => () => undefined;

function readStoredTab(key: string): EntryTab | null {
  try {
    const v = window.localStorage.getItem(key);
    return isEntryTab(v) ? v : null;
  } catch {
    return null;
  }
}

function seedFromPrefill(p: EntryPrefill): EntrySeed {
  return {
    amount: p.amount,
    partyId: p.partyId,
    partyName: p.partyName,
    accountId: p.accountId,
    openItemId: p.openItemId,
    attachmentId: p.attachmentId,
    text: p.text,
    date: p.date,
    vatRate: p.vatRate,
    category: p.category,
    title: p.title,
  };
}

const EMPTY_SEED: EntrySeed = { amount: null, partyId: null, partyName: null, accountId: null, openItemId: null, attachmentId: null, text: null, date: null, vatRate: null, category: null, title: null };

export function EntryWorkspace({
  ctx,
  prefill,
  canInvoice,
  ocrEnabled,
}: {
  ctx: EntryFormContext;
  prefill: EntryPrefill;
  canInvoice: boolean;
  ocrEnabled: boolean;
}) {
  const tabs = entryTabsFor(ctx.personal || !ctx.office);
  const storeKey = lastTabKey(ctx.userId, ctx.personal);
  // Adres sekme vermediyse son kullanılan sekme (yerel; sunucu çiziminde yok → hidrasyon uyumsuzluğu olmaz).
  const stored = useSyncExternalStore(noopSubscribe, () => readStoredTab(storeKey), () => null);
  const [chosen, setChosen] = useState<EntryTab | null>(prefill.tab && tabs.includes(prefill.tab) ? prefill.tab : null);
  const tab: EntryTab = chosen ?? (stored && tabs.includes(stored) ? stored : "gider");
  // Gider/Gelir/Transfer formunun yönü; belge/toplu sekmesindeyken son tek kayıt yönü korunur.
  const [lastDirection, setLastDirection] = useState<EntryDirection>(tabDirection(tab) ?? "out");
  const direction = tabDirection(tab) ?? lastDirection;
  const [seed, setSeed] = useState<EntrySeed>(() => seedFromPrefill(prefill));
  const [formKey, setFormKey] = useState(0);

  function select(next: EntryTab) {
    setChosen(next);
    const d = tabDirection(next);
    if (d) setLastDirection(d);
    try {
      window.localStorage.setItem(storeKey, next);
    } catch {
      /* tercih saklanamadı */
    }
    // Sığ adres güncellemesi: sunucu turu yok; yenileyince/paylaşınca aynı sekme açılır.
    const url = new URL(window.location.href);
    url.searchParams.set("tur", next);
    window.history.replaceState(window.history.state, "", url.toString());
  }

  // Alt+1…5: sekmeler (yazı alanındayken de çalışır; Alt+rakam metin girişinde kullanılmaz).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.repeat) return;
      const n = Number(e.code.startsWith("Digit") ? e.code.slice(5) : e.key);
      if (!Number.isInteger(n) || n < 1 || n > tabs.length) return;
      if (document.querySelector("[role='dialog']")) return;
      e.preventDefault();
      select(tabs[n - 1]!);
      requestAnimationFrame(() => document.getElementById(`ew-tab-${tabs[n - 1]}`)?.focus());
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabs.length, storeKey]);

  function onTabKeyDown(e: React.KeyboardEvent<HTMLButtonElement>, i: number) {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft" && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    const nextIndex = e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : (i + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    const next = tabs[nextIndex]!;
    select(next);
    document.getElementById(`ew-tab-${next}`)?.focus();
  }

  function applyReceipt(r: ReceiptUse) {
    setSeed({ ...EMPTY_SEED, amount: r.amount, attachmentId: r.attachmentId, attachmentName: r.attachmentName, date: r.date, vatRate: r.vatRate, partyName: r.vendor });
    setFormKey((k) => k + 1);
    select(directionTab(r.direction));
  }

  const single = tabDirection(tab) !== null;

  return (
    <div className="grid gap-4">
      <div className="no-print strip-fade -mx-1 overflow-x-auto px-1 py-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div role="tablist" aria-label="Kayıt türü" className="inline-flex min-w-max items-center gap-1 rounded-full border border-line bg-canvas p-1">
          {tabs.map((t, i) => {
            const Icon = TAB_ICON[t];
            const on = t === tab;
            return (
              <Button
                key={t}
                id={`ew-tab-${t}`}
                variant="ghost"
                size="lg"
                icon={Icon}
                role="tab"
                aria-selected={on}
                aria-controls={`ew-panel-${tabDirection(t) ? "form" : t}`}
                aria-keyshortcuts={`Alt+${i + 1}`}
                tabIndex={on ? 0 : -1}
                onClick={() => select(t)}
                onKeyDown={(e) => onTabKeyDown(e, i)}
                className={cn(
                  "min-h-11 gap-1.5 whitespace-nowrap rounded-full px-4 font-semibold",
                  on
                    ? t === "gelir"
                      ? "bg-mint-600 text-white shadow-[var(--shadow-xs)] hover:bg-mint-600 hover:text-white"
                      : t === "gider"
                        ? "bg-ink-950 text-white shadow-[var(--shadow-xs)] hover:bg-ink-950 hover:text-white"
                        : "bg-surface text-ink-950 shadow-[var(--shadow-xs)] hover:bg-surface"
                    : "text-text-muted hover:text-ink-950",
                )}
              >
                {ENTRY_TAB_LABEL[t]}
                <span className="kbd-hint hidden lg:inline">
                  <Kbd className={cn("ml-0.5 opacity-70", on && (t === "gelir" || t === "gider") && "border-white/40 text-white")}>{`Alt ${i + 1}`}</Kbd>
                </span>
              </Button>
            );
          })}
        </div>
      </div>

      <div id="ew-panel-form" role="tabpanel" aria-labelledby={`ew-tab-${directionTab(direction)}`} hidden={!single}>
        <EntryForm
          key={formKey}
          direction={direction}
          onDirectionChange={(d) => select(directionTab(d))}
          seed={seed}
          ctx={ctx}
          hidden={!single}
          onSavedNew={(keep) => {
            setSeed({ ...EMPTY_SEED, accountId: keep.accountId, date: keep.date });
            setFormKey((k) => k + 1);
            requestAnimationFrame(() => document.getElementById("ew-amount")?.focus());
          }}
        />
      </div>
      {tabs.includes("belge") ? (
        <div id="ew-panel-belge" role="tabpanel" aria-labelledby="ew-tab-belge" hidden={tab !== "belge"}>
          <DocumentTab canInvoice={canInvoice} ocrEnabled={ocrEnabled} onUse={applyReceipt} />
        </div>
      ) : null}
      <div id="ew-panel-toplu" role="tabpanel" aria-labelledby="ew-tab-toplu" hidden={tab !== "toplu"}>
        <BulkEntry ctx={ctx} />
      </div>
    </div>
  );
}
