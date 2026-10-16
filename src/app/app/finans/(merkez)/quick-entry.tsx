"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { ArrowDownCircle, ArrowUpCircle, Plus } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { entryHref, type EntryLinkInput } from "@/lib/finance/entry-workspace";
import type { RuleSuggestion } from "@/lib/finance/ledger/types";

/**
 * "Yeni kayıt" girişleri: pencere YOK, tam sayfa kayıt çalışma alanına (`/app/finans/kayit`) giden bağlantılar.
 * Finans sayfasında `hotkeys` ile klavye: G gelir · E gider · T transfer sayfayı ilgili sekmede açar, M muhasebe komut
 * çubuğu. Ctrl/⌘K burada da genel komut paletidir (her yerde aynı anlam). Kasam `personal` ile kişisel kipte açar.
 * Önceden doldurma bağlantıları (cari, tutar, hesap, belge …) `entryHref` ile kurulur (eski `finance:new-entry` olayı yok).
 */

export type AccountOption = { id: string; name: string; kind: string; currency: string; scope: "office" | "user" };

/** Kayıt sayfasının kategori çipleri: sistem (`CASH_CATEGORIES`) + ofisin kendi kategorileri (`x_…`). */
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

/** Kural önerisi (finance_rule_suggest) — sunucu eylemi olarak sayfadan gelir. */
export type { RuleSuggestion };
export type RuleSuggestFn = (input: { text: string; amount: number | null; direction: "in" | "out" }) => Promise<RuleSuggestion | null>;

export type CommandTab = { id: string; label: string; hint: string; href: string };

const loadCommandBar = () => import("./_components/command-bar");
const CommandBar = dynamic(() => loadCommandBar().then((m) => m.CommandBar), { ssr: false });

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

export function QuickEntryButtons({ hotkeys = false, personal = false, commandTabs }: { hotkeys?: boolean; personal?: boolean; commandTabs?: readonly CommandTab[] }) {
  const router = useRouter();
  const [command, setCommand] = useState(false);
  const href = (input: EntryLinkInput = {}) => entryHref({ ...input, personal });

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
      const tab = k === "g" ? "gelir" : k === "e" ? "gider" : k === "t" ? "transfer" : null;
      if (!tab) return;
      e.preventDefault();
      // "g" genel gezinme önekidir; Finans sayfasında G "Yeni gelir"dir (önek dinleyicisine gitmez).
      e.stopImmediatePropagation();
      router.push(entryHref({ tab, personal }));
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [hotkeys, personal, router]);

  return (
    <>
      <ButtonLink href={href()} variant="primary" icon={Plus}>
        Yeni kayıt
      </ButtonLink>
      <span className="hidden items-center gap-1 sm:inline-flex">
        <ButtonLink href={href({ tab: "gelir" })} variant="outline" size="sm" icon={ArrowDownCircle} aria-keyshortcuts={hotkeys ? "G" : undefined} title={hotkeys ? "Gelir (G)" : undefined}>
          Gelir
        </ButtonLink>
        <ButtonLink href={href({ tab: "gider" })} variant="outline" size="sm" icon={ArrowUpCircle} aria-keyshortcuts={hotkeys ? "E" : undefined} title={hotkeys ? "Gider (E)" : undefined}>
          Gider
        </ButtonLink>
      </span>
      {command ? <CommandBar tabs={commandTabs ?? []} onClose={() => setCommand(false)} /> : null}
    </>
  );
}
