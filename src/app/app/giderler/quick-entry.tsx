"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { ArrowDownCircle, ArrowUpCircle, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { runWhenIdle } from "@/lib/idle";
import type { RuleSuggestion } from "@/lib/finance/ledger/types";

/**
 * "Yeni kayıt": eski iki popup (Gelir ekle / Gider ekle) yerine TEK pencere (Gelir / Gider / Transfer).
 * API GERİYE UYUMLU: Kasam (`/app/hesabim?sekme=kasam`) `QuickEntryButtons accounts defaultDate canSalary` ile aynen çalışır
 * (kişisel hesap → eski `recordCashEntry` yolu). Muhasebe sayfası `office` + `hotkeys` ile cari, vade, KDV, ek, komut çubuğu
 * ve klavye kısayollarını (M komut çubuğu, G, E, T) açar. Ctrl/⌘K burada da genel komut paletidir (her yerde aynı anlam).
 *
 * HIZ: pencere ve komut çubuğu `next/dynamic` ile yalnız gerektiğinde iner (boşta / üzerine gelince önceden ısıtılır);
 * tıklama anında yükleme yer tutucusu aynı karede çizilir.
 */

export type AccountOption = { id: string; name: string; kind: string; currency: string; scope: "office" | "user" };

/** Pencerenin kategori çipleri: sistem (`CASH_CATEGORIES`) + ofisin kendi kategorileri (`x_…`). */
export type EntryCategoryOption = {
  value: string;
  label: string;
  direction: "in" | "out";
  custom?: boolean;
  vatRate?: number | null;
  withholdingRate?: number | null;
  /** Ofis gideri kaydında `expenses.category` (FinanceCategory.expenseCategory); yoksa sistem eşlemesi kullanılır. */
  expenseCategory?: string | null;
};

export type EntryDirection = "in" | "out" | "transfer";

/** Ortak istemci olayı: `window.dispatchEvent(new CustomEvent("finance:new-entry", { detail }))` pencereyi önceden doldurulmuş açar. */
export const NEW_ENTRY_EVENT = "finance:new-entry";
export type NewEntryDetail = {
  direction?: EntryDirection;
  partyId?: string;
  /** `partyId` verilirse carinin adı (seçicide "Cari seçin" yerine görünür; ek arama yapılmaz). */
  partyName?: string;
  openItemId?: string;
  attachmentId?: string;
  amount?: number;
  /** Komut çubuğundan gelen tek satır akıllı giriş metni. */
  text?: string;
};

export function openNewEntry(detail: NewEntryDetail = {}): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<NewEntryDetail>(NEW_ENTRY_EVENT, { detail }));
}

/** Sunucu bileşenlerinden (boş durum, kartlar) "Yeni kayıt" penceresini açan küçük düğme; sayfadaki tek pencereyi olayla açar. */
export function NewEntryButton({ detail, children, variant = "primary" }: { detail?: NewEntryDetail; children: ReactNode; variant?: "primary" | "outline" }) {
  return (
    <Button variant={variant} icon={Plus} onClick={() => openNewEntry(detail ?? {})} onPointerEnter={warmDialog} onFocus={warmDialog}>
      {children}
    </Button>
  );
}

/** Kural önerisi (finance_rule_suggest) — sunucu eylemi olarak sayfadan gelir. */
export type { RuleSuggestion };
export type RuleSuggestFn = (input: { text: string; amount: number | null; direction: "in" | "out" }) => Promise<RuleSuggestion | null>;

export type CommandTab = { id: string; label: string; hint: string; href: string };

const loadDialog = () => import("./_components/entry-dialog");
const loadCommandBar = () => import("./_components/command-bar");

function OpeningPlaceholder() {
  return (
    <div className="fixed inset-0 z-50 grid place-items-end bg-ink-950/40 backdrop-blur-sm sm:place-items-center" role="status" aria-live="polite">
      <div className="w-full rounded-t-[var(--radius-panel)] bg-surface p-6 shadow-[var(--shadow-lg)] sm:max-w-lg sm:rounded-[var(--radius-panel)]">
        <div className="skeleton h-6 w-40 rounded" />
        <div className="skeleton mt-4 h-11 w-full rounded-[var(--radius-control)]" />
        <div className="skeleton mt-3 h-24 w-full rounded-[var(--radius-control)]" />
        <span className="sr-only">Yeni kayıt penceresi açılıyor</span>
      </div>
    </div>
  );
}

const EntryDialog = dynamic(() => loadDialog().then((m) => m.EntryDialog), { ssr: false, loading: OpeningPlaceholder });
const CommandBar = dynamic(() => loadCommandBar().then((m) => m.CommandBar), { ssr: false, loading: OpeningPlaceholder });

function warmDialog() {
  loadDialog().catch(() => undefined);
}

/** Yazı alanında, değiştirici tuşla ya da açık bir pencere varken tek harf kısayolu devreye girmez. */
function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || typeof el.tagName !== "string") return false;
  const tag = el.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    el.isContentEditable === true ||
    el.getAttribute?.("role") === "combobox" ||
    el.closest?.("[role='dialog'], [role='listbox'], [role='menu']") != null
  );
}

export function QuickEntryButtons({
  accounts,
  defaultDate,
  canSalary,
  office = false,
  categories,
  suggestRule,
  hotkeys = false,
  commandTabs,
}: {
  accounts: readonly AccountOption[];
  /** Bugün (YYYY-MM-DD, İstanbul); sunucudan gelir — istemci saati kullanılmaz. */
  defaultDate: string;
  canSalary: boolean;
  /** Ofis kipi: cari, vadeli, KDV/stopaj, portföy, ek ve kural önerisi alanları (Muhasebe sayfası). */
  office?: boolean;
  /** Ofis kategorileri dahil kategori listesi; verilmezse sistem kategorileri kullanılır. */
  categories?: readonly EntryCategoryOption[];
  suggestRule?: RuleSuggestFn;
  /** M komut çubuğu + G / E / T kısayolları (yalnız Muhasebe sayfası). */
  hotkeys?: boolean;
  commandTabs?: readonly CommandTab[];
}) {
  const [entry, setEntry] = useState<(NewEntryDetail & { seq: number }) | null>(null);
  const [command, setCommand] = useState(false);

  const open = useCallback((detail: NewEntryDetail) => {
    setCommand(false);
    setEntry((prev) => ({ ...detail, seq: (prev?.seq ?? 0) + 1 }));
  }, []);

  // Pencere parçası boşta önceden iner: ilk tık ağ turu beklemez.
  useEffect(() => runWhenIdle(warmDialog), []);

  // Ortak olay: Cari'deki "Tahsil et", Belgeler'deki "Fişten kayıt" vb. pencereyi önceden doldurulmuş açar.
  useEffect(() => {
    const onEvent = (e: Event) => {
      const d = (e as CustomEvent<NewEntryDetail | undefined>).detail ?? {};
      open({
        direction: d.direction === "in" || d.direction === "out" || d.direction === "transfer" ? d.direction : undefined,
        partyId: typeof d.partyId === "string" ? d.partyId : undefined,
        partyName: typeof d.partyId === "string" && typeof d.partyName === "string" ? d.partyName.slice(0, 120) : undefined,
        openItemId: typeof d.openItemId === "string" ? d.openItemId : undefined,
        attachmentId: typeof d.attachmentId === "string" ? d.attachmentId : undefined,
        amount: typeof d.amount === "number" && Number.isFinite(d.amount) && d.amount > 0 ? d.amount : undefined,
        text: typeof d.text === "string" ? d.text.slice(0, 300) : undefined,
      });
    };
    window.addEventListener(NEW_ENTRY_EVENT, onEvent);
    return () => window.removeEventListener(NEW_ENTRY_EVENT, onEvent);
  }, [open]);

  // Klavye: M muhasebe komut çubuğu · G gelir · E gider · T transfer. Ctrl/⌘K YAKALANMAZ: her sayfada olduğu gibi genel
  // komut paletini açar (YD5: kısayol tek anlam). Yazı alanında / açık pencerede tek harf kısayolu çalışmaz.
  useEffect(() => {
    if (!hotkeys) return;
    // "n m" (Yeni müşteri) genel zinciri bozulmasın: hemen önce "n" basıldıysa M komut çubuğunu açmaz.
    let prev = { key: "", at: -Infinity };
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      if (isTypingTarget(e.target) || document.querySelector("[role='dialog']")) return;
      const k = e.key.toLowerCase();
      const chained = prev.key === "n" && e.timeStamp - prev.at < 1200;
      prev = { key: k, at: e.timeStamp };
      if (k === "m" && !chained) {
        e.preventDefault();
        setCommand(true);
        return;
      }
      const direction: EntryDirection | null = k === "g" ? "in" : k === "e" ? "out" : k === "t" ? "transfer" : null;
      if (!direction) return;
      e.preventDefault();
      // "g" genel gezinme önekidir; Muhasebe sayfasında G "Yeni gelir"dir (önek dinleyicisine gitmez).
      e.stopImmediatePropagation();
      open({ direction });
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [hotkeys, open]);

  return (
    <>
      <Button variant="primary" icon={Plus} onClick={() => open({})} onPointerEnter={warmDialog} onFocus={warmDialog}>
        Yeni kayıt
      </Button>
      <span className="hidden items-center gap-1 sm:inline-flex">
        <Button variant="outline" size="sm" icon={ArrowDownCircle} onClick={() => open({ direction: "in" })} onPointerEnter={warmDialog} aria-keyshortcuts={hotkeys ? "G" : undefined} title={hotkeys ? "Gelir (G)" : undefined}>
          Gelir
        </Button>
        <Button variant="outline" size="sm" icon={ArrowUpCircle} onClick={() => open({ direction: "out" })} onPointerEnter={warmDialog} aria-keyshortcuts={hotkeys ? "E" : undefined} title={hotkeys ? "Gider (E)" : undefined}>
          Gider
        </Button>
      </span>
      {entry ? (
        <EntryDialog
          key={entry.seq}
          initial={entry}
          accounts={accounts}
          defaultDate={defaultDate}
          canSalary={canSalary}
          office={office}
          categories={categories}
          suggestRule={suggestRule}
          onClose={() => setEntry(null)}
        />
      ) : null}
      {command ? <CommandBar tabs={commandTabs ?? []} categories={categories} onClose={() => setCommand(false)} onNewEntry={(d: NewEntryDetail) => open(d)} /> : null}
    </>
  );
}
