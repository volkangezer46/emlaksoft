"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDownCircle, ArrowLeftRight, ArrowRight, ArrowUpCircle, CornerDownLeft, Search, Sparkles } from "lucide-react";
import { Dialog, DialogContent, DialogTitleHidden } from "@/components/ui/dialog";
import { matchesQuery, openPalette } from "@/lib/palette-events";
import { formatAccountMoney } from "@/lib/finance/cash/money";
import { CASH_CATEGORIES, cashCategoryLabel } from "@/lib/finance/cash/categories";
import { hasSmartSignal, parseSmartEntry } from "@/lib/finance/smart-entry";
import { cn } from "@/lib/utils";
import { entryHref, type EntryLinkInput } from "@/lib/finance/entry-workspace";
import type { CommandTab } from "../quick-entry";

/**
 * Muhasebe komut çubuğu (M tuşu; Ctrl/⌘K her yerde olduğu gibi genel paleti açar). Yalnız açılınca iner (`next/dynamic`). Satırlar:
 *  1) Yazılan metin bir kayda benziyorsa "Kaydet: …" (tek satır akıllı giriş; kayıt sayfası önceden dolu açılır),
 *  2) Yeni gelir (G) / Yeni gider (E) / Transfer (T),
 *  3) sekmelere git (etiketler finance-shell.tsx'ten prop olarak gelir; kopya yok),
 *  4) "Tüm uygulamada ara" (genel komut paleti; Ctrl/⌘K ile de doğrudan açılır).
 * Klavye: ↑/↓ seçer, Enter çalıştırır, Esc kapatır.
 */

type Command = { id: string; label: string; hint?: string; icon: typeof Search; kbd?: string; run: () => void };

const SYSTEM_CATS = CASH_CATEGORIES.map((c) => ({ value: c.value, label: c.label, direction: c.direction }));

export function CommandBar({ tabs, onClose }: { tabs: readonly CommandTab[]; onClose: () => void }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [index, setIndex] = useState(0);
  // Önizleme sistem kategorileriyle yapılır; kayıt sayfası metni ofisin kendi kategorileriyle yeniden ayrıştırır.
  const cats = SYSTEM_CATS;
  const onNewEntry = useCallback(
    (input: EntryLinkInput) => {
      onClose();
      router.push(entryHref(input));
    },
    [onClose, router],
  );

  const commands = useMemo<Command[]>(() => {
    const list: Command[] = [];
    const text = q.trim();
    const smart = text ? parseSmartEntry(text, cats) : null;
    if (smart && hasSmartSignal(smart) && smart.amount != null) {
      const parts = [
        smart.direction === "in" ? "Gelir" : smart.direction === "transfer" ? "Transfer" : smart.direction === "out" ? "Gider" : null,
        formatAccountMoney(smart.amount, "TRY"),
        smart.category ? (cats.find((c) => c.value === smart.category)?.label ?? cashCategoryLabel(smart.category)) : null,
        smart.partyName,
        smart.deferred ? "vadeli" : null,
      ].filter(Boolean);
      list.push({ id: "smart", label: `Kaydet: ${parts.join(" · ")}`, hint: "Kayıt sayfası önceden dolu açılır", icon: Sparkles, kbd: "Enter", run: () => onNewEntry({ tab: smart.direction === "in" ? "gelir" : smart.direction === "transfer" ? "transfer" : "gider", text }) });
    }
    const actions: Command[] = [
      { id: "in", label: "Yeni gelir", icon: ArrowDownCircle, kbd: "G", run: () => onNewEntry({ tab: "gelir" }) },
      { id: "out", label: "Yeni gider", icon: ArrowUpCircle, kbd: "E", run: () => onNewEntry({ tab: "gider" }) },
      { id: "transfer", label: "Hesaplar arası transfer", icon: ArrowLeftRight, kbd: "T", run: () => onNewEntry({ tab: "transfer" }) },
    ];
    const go: Command[] = tabs.map((t) => ({
      id: `tab-${t.id}`,
      label: t.label,
      hint: t.hint,
      icon: ArrowRight,
      run: () => {
        onClose();
        router.push(t.href);
      },
    }));
    const filtered = [...actions, ...go].filter((c) => !text || matchesQuery(`${c.label} ${c.hint ?? ""}`, text));
    list.push(...filtered);
    if (text) {
      list.push({
        id: "global",
        label: `Tüm uygulamada ara: “${text.slice(0, 40)}”`,
        icon: Search,
        run: () => {
          onClose();
          openPalette(text);
        },
      });
    }
    return list;
  }, [q, tabs, cats, onNewEntry, onClose, router]);

  const active = Math.min(index, Math.max(commands.length - 1, 0));

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setIndex((i) => (commands.length ? (Math.min(i, commands.length - 1) + 1) % commands.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setIndex((i) => (commands.length ? (Math.min(i, commands.length - 1) - 1 + commands.length) % commands.length : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      commands[active]?.run();
    }
  }

  return (
    <Dialog open onOpenChange={(v) => (v ? undefined : onClose())}>
      <DialogContent size="md" overlayClassName="pt-[10vh]" className="self-start" aria-describedby={undefined}>
        <DialogTitleHidden>Muhasebe komut çubuğu</DialogTitleHidden>
        <div className="flex items-center gap-2 border-b border-line px-4">
          <Search className="h-4 w-4 shrink-0 text-text-faint" aria-hidden="true" />
          <input
            autoFocus
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setIndex(0);
            }}
            onKeyDown={onKeyDown}
            role="combobox"
            aria-expanded="true"
            aria-controls="finance-command-list"
            aria-activedescendant={commands[active] ? `fc-${commands[active].id}` : undefined}
            aria-label="Komut ya da kayıt yazın"
            placeholder="Komut ya da kayıt yazın: gider 4.500 portal…"
            className="h-14 min-w-0 flex-1 bg-transparent text-base text-text outline-none placeholder:text-text-faint"
          />
          <kbd className="hidden rounded border border-line px-1.5 text-xs text-text-faint sm:inline">Esc</kbd>
        </div>
        <ul id="finance-command-list" role="listbox" aria-label="Komutlar" className="max-h-[min(60vh,26rem)] overflow-y-auto p-2">
          {commands.map((c, i) => (
            <li
              key={c.id}
              id={`fc-${c.id}`}
              role="option"
              aria-selected={i === active}
              onPointerEnter={() => setIndex(i)}
              // Odak giriş alanında kalır (combobox + aria-activedescendant); seçenek fareyle tıklanır, klavyede Enter çalıştırır.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => c.run()}
              className={cn(
                "flex min-h-11 w-full cursor-pointer items-center gap-3 rounded-[var(--radius-control)] px-3 text-left text-sm transition",
                i === active ? "bg-surface-accent-soft text-ink-950" : "text-text hover:bg-surface-hover",
              )}
            >
                <c.icon className={cn("h-4 w-4 shrink-0", c.id === "smart" ? "text-accent-text" : "text-text-faint")} aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{c.label}</span>
                  {c.hint ? <span className="block truncate text-xs text-text-muted">{c.hint}</span> : null}
                </span>
                {c.kbd ? (
                  <kbd className="inline-flex items-center gap-1 rounded border border-line px-1.5 text-xs text-text-faint">
                    {c.kbd === "Enter" ? <CornerDownLeft className="h-3 w-3" aria-hidden="true" /> : c.kbd}
                  </kbd>
                ) : null}
            </li>
          ))}
        </ul>
        <p className="kbd-hint border-t border-line px-4 py-2 text-xs text-text-faint">↑ ↓ seç · Enter çalıştır · Muhasebe dışında G, E, T kısayolları çalışmaz</p>
      </DialogContent>
    </Dialog>
  );
}
