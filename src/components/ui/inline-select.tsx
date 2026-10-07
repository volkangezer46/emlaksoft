"use client";

import * as PopoverPrimitive from "@radix-ui/react-popover";
import { Check, ChevronDown } from "lucide-react";
import { useId, useRef, useState, type ComponentType, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";
import type { PremiumTone } from "@/components/ui/premium/premium-math";

/**
 * InlineSelect — satır içi seçici (tablo hücresi): rozet/ikon görünümlü tetik + açılır liste.
 *
 * KAYDIRMAYI KİLİTLEMEZ: Radix Select her açılışta react-remove-scroll ile body'yi kilitler; html `overflow-x: clip`
 * olduğundan kilit body'yi kaydırma kabına çevirir ve yapışkan yan menü sayfanın tepesine kayar (menü yarıda biter).
 * Bu yüzden seçici Radix Popover `modal={false}` + kendi listbox'ı ile kuruludur: sayfa açıkken de kayar, liste
 * tetiği izler, dış tıklama / Esc kapatır.
 *
 * Erişilebilirlik: tetik `role="combobox"` + `aria-haspopup="listbox"` + `aria-expanded`; liste `role="listbox"`,
 * seçenekler `role="option"` + `aria-selected` (`aria-activedescendant` ile vurgulu seçenek). Klavye: kapalı tetikte
 * ↓/↑/Boşluk açar (Enter satır içi kaydetme standardına bırakılır: kirli satırda kaydeder, temiz satırda açar);
 * açık listede ↑/↓, Home/End, harfle arama, Enter/Boşluk seçer, Esc/Tab kapatır ve odak tetiğe döner.
 * Görünüm `kit.css` `.ins-*`; ton `pm-t-*` ailesinden. `changed` → tetiğin köşesinde amber "değişti" noktası.
 * `name` verilirse gizli input üretir → `<form action>` + FormData ile de çalışır.
 *
 * Seçenek ikonları istemci tarafında tanımlanmalıdır (fonksiyon sunucudan istemciye geçemez).
 */
export type InlineSelectOption = {
  value: string;
  label: string;
  icon?: ComponentType<{ className?: string }>;
  tone?: PremiumTone;
  /** Liste satırında ikinci satır açıklama. */
  hint?: string;
  disabled?: boolean;
};

const TYPEAHEAD_MS = 600;

export function InlineSelect({
  value,
  onValueChange,
  options,
  label,
  disabled = false,
  changed = false,
  plain = false,
  name,
  className,
  contentLabel,
}: {
  value: string;
  onValueChange: (value: string) => void;
  options: readonly InlineSelectOption[];
  /** Erişilebilir ad ("Volkan Emlak durumu"). */
  label: string;
  disabled?: boolean;
  /** Kaydedilmemiş değişiklik işareti. */
  changed?: boolean;
  /** Tonsuz (beyaz) tetik — nötr seçimler için. */
  plain?: boolean;
  name?: string;
  className?: string;
  /** Liste başlığı (görsel değil, ekran okuyucu). */
  contentLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const listRef = useRef<HTMLDivElement>(null);
  const typed = useRef({ text: "", timer: null as ReturnType<typeof setTimeout> | null });
  const baseId = useId();
  const listId = `${baseId}-list`;
  const optId = (i: number) => `${baseId}-opt-${i}`;

  const current = options.find((o) => o.value === value);
  const Icon = current?.icon;
  const tone = current?.tone ?? "neutral";
  const selectedIndex = options.findIndex((o) => o.value === value);

  const enabledIndex = (from: number, step: 1 | -1) => {
    const n = options.length;
    for (let k = 1; k <= n; k++) {
      const i = (((from + step * k) % n) + n) % n;
      if (!options[i]?.disabled) return i;
    }
    return -1;
  };
  const firstEnabled = () => enabledIndex(-1, 1);
  const lastEnabled = () => enabledIndex(options.length, -1);

  function openWith(index: number) {
    if (disabled) return;
    setActive(index >= 0 && !options[index]?.disabled ? index : firstEnabled());
    setOpen(true);
  }

  function choose(i: number) {
    const o = options[i];
    if (!o || o.disabled) return;
    setOpen(false);
    if (o.value !== value) onValueChange(o.value);
  }

  function typeahead(ch: string) {
    const t = typed.current;
    if (t.timer) clearTimeout(t.timer);
    t.text += ch.toLocaleLowerCase("tr");
    t.timer = setTimeout(() => {
      t.text = "";
    }, TYPEAHEAD_MS);
    const start = t.text.length === 1 ? active : active - 1; // tek harf: sonraki eşleşme; kelime: aynı yerden
    const n = options.length;
    for (let k = 1; k <= n; k++) {
      const i = (((start + k) % n) + n) % n;
      const o = options[i];
      if (o && !o.disabled && o.label.toLocaleLowerCase("tr").startsWith(t.text)) return i;
    }
    return -1;
  }

  function onTriggerKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    if (e.defaultPrevented || open) return; // satır kısayolu (Enter = kaydet) önce çalışır
    // Enter/Boşluk düğmenin yerel tıklamasıyla açar; oklar burada.
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      openWith(selectedIndex >= 0 ? selectedIndex : e.key === "ArrowUp" ? lastEnabled() : firstEnabled());
    }
  }

  function onListKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    let next = -2;
    switch (e.key) {
      case "ArrowDown":
        next = enabledIndex(active, 1);
        break;
      case "ArrowUp":
        next = enabledIndex(active < 0 ? options.length : active, -1);
        break;
      case "Home":
      case "PageUp":
        next = firstEnabled();
        break;
      case "End":
      case "PageDown":
        next = lastEnabled();
        break;
      case "Enter":
      case " ":
        if (e.key === " " && typed.current.text) {
          const i = typeahead(" ");
          if (i >= 0) next = i;
          break;
        }
        e.preventDefault();
        if (active >= 0) choose(active);
        return;
      case "Tab":
        e.preventDefault();
        setOpen(false); // odak tetiğe döner (onCloseAutoFocus)
        return;
      default:
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
          const i = typeahead(e.key);
          if (i >= 0) next = i;
          else return;
        } else return;
    }
    e.preventDefault();
    if (next >= 0) {
      setActive(next);
      document.getElementById(optId(next))?.scrollIntoView({ block: "nearest" });
    }
  }

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={(o) => (o ? openWith(selectedIndex) : setOpen(false))} modal={false}>
      <PopoverPrimitive.Trigger
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={changed ? `${label} (değişti, kaydedilmedi)` : label}
        disabled={disabled}
        data-changed={changed ? "1" : undefined}
        data-plain={plain ? "1" : undefined}
        onKeyDown={onTriggerKeyDown}
        className={cn("ins-trigger focus-ring", !plain && `pm-t-${tone}`, className)}
      >
        {Icon ? <Icon className="ins-ico" aria-hidden="true" /> : null}
        <span className="ins-label">{current?.label ?? "Seçin"}</span>
        <ChevronDown className="ins-chev" aria-hidden="true" />
      </PopoverPrimitive.Trigger>
      {name ? <input type="hidden" name={name} value={value} disabled={disabled} /> : null}
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          side="bottom"
          align="start"
          sideOffset={6}
          collisionPadding={12}
          role="presentation"
          className="ins-content popover-in"
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            listRef.current?.focus({ preventScroll: true });
            if (active >= 0) document.getElementById(optId(active))?.scrollIntoView({ block: "nearest" });
          }}
        >
          <div
            ref={listRef}
            id={listId}
            role="listbox"
            tabIndex={-1}
            aria-label={contentLabel ?? label}
            aria-activedescendant={active >= 0 ? optId(active) : undefined}
            onKeyDown={onListKeyDown}
            className="ins-list"
          >
            {options.map((o, i) => {
              const OIcon = o.icon;
              const selected = o.value === value;
              return (
                <div
                  key={o.value}
                  id={optId(i)}
                  role="option"
                  aria-selected={selected}
                  aria-disabled={o.disabled || undefined}
                  data-state={selected ? "checked" : "unchecked"}
                  data-highlighted={i === active ? "" : undefined}
                  data-disabled={o.disabled ? "" : undefined}
                  onPointerMove={() => {
                    if (!o.disabled && active !== i) setActive(i);
                  }}
                  onClick={() => choose(i)}
                  className={cn("ins-item", `pm-t-${o.tone ?? "neutral"}`)}
                >
                  {OIcon ? (
                    <span className="ins-dot" aria-hidden="true">
                      <OIcon />
                    </span>
                  ) : null}
                  <span className="min-w-0">
                    {o.label}
                    {o.hint ? <span className="ins-hint">{o.hint}</span> : null}
                  </span>
                  {selected ? <Check className="ins-check" aria-hidden="true" /> : null}
                </div>
              );
            })}
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
