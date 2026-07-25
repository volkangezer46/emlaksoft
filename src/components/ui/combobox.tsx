"use client";

import * as PopoverPrimitive from "@radix-ui/react-popover";
import { Check, ChevronsUpDown, Loader2, Search, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { rankTr } from "@/lib/tr-text";

export type ComboboxOption = {
  value: string;
  label: string;
  /** İkinci satır — ilçe altında il adı, danışman altında rol gibi. */
  hint?: string;
  disabled?: boolean;
};

type Props = {
  options: ComboboxOption[];
  /** Server Action + FormData uyumu: gizli input bu adla gönderilir. */
  name?: string;
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
  loading?: boolean;
  required?: boolean;
  /** Seçimi temizleme düğmesi (zorunlu alanlarda kapatın). */
  clearable?: boolean;
  /**
   * Sunucu taraflı arama. Verilirse kullanıcı yazdıkça çağrılır ve dönen
   * sonuçlar `options` ile BİRLEŞTİRİLİR (değiştirmez) — böylece sayfa
   * açılışında gelen "son eklenenler" listesi kısayol olarak kalır.
   *
   * Server Action geçilebilir: fonksiyonun kendisi değil, serileştirilebilir
   * bir referans taşınır.
   */
  onSearch?: (query: string) => Promise<ComboboxOption[]>;
  /** `onSearch` için en az karakter sayısı. */
  minSearchLength?: number;
  className?: string;
  id?: string;
  "aria-label"?: string;
};

/**
 * Combobox — yazarak aranabilen seçim kutusu.
 *
 * NEDEN NATIVE `<select>` DEĞİL: Bu panelde 973 ilçe ve 31.922 mahalle var.
 * Native `<select>` içinde 973 seçenek arasında yalnızca "ilk harfe atlama"
 * ile gezilir; "kad" yazıp Kadıköy'e gitmek mümkün değildir. Kısa listelerde
 * native `<select>` hâlâ daha iyidir (mobilde işletim sisteminin kendi
 * seçicisi açılır) — bu bileşen uzun listeler için.
 *
 * NEDEN RADIX SELECT DEĞİL: Radix Select'in kendi harf-yakalama (typeahead)
 * davranışı, içine konan arama kutusuna yazılan her harfi kapar. Popover +
 * elle listbox doğru temel.
 *
 * FORM UYUMU: `name` verilirse gizli bir `<input>` render edilir, yani mevcut
 * `<form action={serverAction}>` + `FormData` desenimiz değişmeden çalışır.
 *
 * ERİŞİLEBİLİRLİK: role=combobox/listbox/option, aria-activedescendant ile
 * klavye gezinmesi (yukarı/aşağı/Home/End/Enter/Esc). Odak arama kutusunda
 * kalır; ok tuşları "etkin seçeneği" değiştirir, odağı değil — ekran
 * okuyucunun yazılanı takip edebilmesi için doğru olan budur.
 */
export function Combobox({
  options,
  name,
  value: controlledValue,
  defaultValue = "",
  onValueChange,
  placeholder = "Seçiniz",
  searchPlaceholder = "Ara…",
  emptyText = "Sonuç yok",
  disabled,
  loading,
  required,
  clearable = true,
  onSearch,
  minSearchLength = 2,
  className,
  id,
  "aria-label": ariaLabel,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [uncontrolled, setUncontrolled] = useState(defaultValue);
  const listRef = useRef<HTMLDivElement>(null);
  const autoId = useId();
  const listId = `${autoId}-list`;
  const triggerId = id ?? `${autoId}-trigger`;

  const [remote, setRemote] = useState<ComboboxOption[]>([]);
  const [searching, setSearching] = useState(false);

  const value = controlledValue ?? uncontrolled;

  /*
   * Aday havuzu: sayfadan gelen liste + sunucudan dönenler, değere göre
   * tekilleştirilmiş. Sunucu sonucu önce yazılıyor ki daha güncel etiket
   * (ör. yeniden adlandırılmış portföy) kazansın.
   */
  const pool = useMemo(() => {
    if (!onSearch) return options;
    const byValue = new Map<string, ComboboxOption>();
    for (const o of remote) byValue.set(o.value, o);
    for (const o of options) if (!byValue.has(o.value)) byValue.set(o.value, o);
    return [...byValue.values()];
  }, [options, remote, onSearch]);

  const selected = useMemo(() => pool.find((o) => o.value === value), [pool, value]);

  /*
   * Sunucu araması. Geciktirme (debounce) 250 ms: her tuş vuruşunda sorgu
   * atmak hem gereksiz hem de sonuçların sırasını bozar.
   *
   * `stale` bayrağı yarış koşulunu keser: "ka" sorgusu "kadıköy"den SONRA
   * dönerse eski sonucu yazmaz. Sadece son isteğin sonucu ekrana gelir.
   */
  useEffect(() => {
    if (!onSearch) return;
    const q = query.trim();
    if (q.length < minSearchLength) return;
    let stale = false;
    const timer = setTimeout(() => {
      // setSearching efekt GOVDESINDE degil, zamanlayici geri cagrisinda:
      // efekt icinde senkron setState zincirleme render doguruyor
      // (react-hooks/set-state-in-effect).
      setSearching(true);
      onSearch(q)
        .then((rows) => {
          if (!stale) setRemote(rows);
        })
        .catch(() => {
          // Ağ hatasında yerel listeyle devam; kutu kilitlenmesin.
          if (!stale) setRemote([]);
        })
        .finally(() => {
          if (!stale) setSearching(false);
        });
    }, 250);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [query, onSearch, minSearchLength]);

  // Sorgu esigin altina dustugunde "Araniyor..." takili kalmasin diye
  // gosterimde ek kosul: yalnizca yeterince uzun sorguda arama gostergesi.
  const showSearching = searching && query.trim().length >= minSearchLength;

  // Türkçe alaka sıralaması: "kad" → Kadıköy önce, Beykadı sonra.
  const filtered = useMemo(() => rankTr(pool, query, (o) => `${o.label} ${o.hint ?? ""}`), [pool, query]);

  // Etkin satırı görünür tut. `scrollIntoView({block:"nearest"})` sayfayı
  // kaydırmadan yalnızca listeyi kaydırır.
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  function commit(next: string) {
    if (controlledValue === undefined) setUncontrolled(next);
    onValueChange?.(next);
    setOpen(false);
    setQuery("");
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (filtered.length === 0) return;
      const dir = e.key === "ArrowDown" ? 1 : -1;
      // Modülo ile döngü: son satırda aşağı basınca başa döner.
      setActive((i) => (i + dir + filtered.length) % filtered.length);
      return;
    }
    if (e.key === "Home") {
      e.preventDefault();
      setActive(0);
      return;
    }
    if (e.key === "End") {
      e.preventDefault();
      setActive(Math.max(0, filtered.length - 1));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const opt = filtered[active];
      if (opt && !opt.disabled) commit(opt.value);
    }
  }

  return (
    <>
      {name ? <input type="hidden" name={name} value={value} required={required} /> : null}
      {/* `active` sıfırlaması efektte değil olay işleyicilerinde: efekt içinde
          senkron setState zincirleme render doğurur (react-hooks/set-state-in-effect).
          Zaten her iki tetikleyici de bizim kontrolümüzde. */}
      <PopoverPrimitive.Root
        open={open}
        onOpenChange={(v) => {
          setOpen(v);
          setQuery("");
          setActive(0);
        }}
      >
        <PopoverPrimitive.Trigger asChild>
          <button
            type="button"
            id={triggerId}
            role="combobox"
            aria-expanded={open}
            aria-controls={open ? listId : undefined}
            aria-label={ariaLabel}
            disabled={disabled || loading}
            className={cn(
              "focus-ring flex w-full items-center justify-between gap-2 rounded-[10px] border border-line bg-canvas px-3 py-2.5 text-left text-sm outline-none transition",
              "hover:border-brand-300 data-[state=open]:border-brand-400 data-[state=open]:bg-surface",
              "disabled:cursor-not-allowed disabled:opacity-60",
              selected ? "text-ink-950" : "text-text-faint",
              className,
            )}
          >
            <span className="min-w-0 flex-1 truncate">
              {loading ? "Yükleniyor…" : (selected?.label ?? placeholder)}
            </span>
            {loading ? (
              <Loader2 className="h-4 w-4 shrink-0 animate-spin text-text-faint" />
            ) : clearable && selected && !required ? (
              // `<button>` içinde `<button>` geçersiz HTML — bu yüzden span.
              // Rol ve klavye erişimi elle kuruldu.
              <span
                role="button"
                tabIndex={-1}
                aria-label="Seçimi temizle"
                onClick={(e) => {
                  e.stopPropagation();
                  commit("");
                }}
                className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-text-faint transition hover:bg-ink-950/[0.06] hover:text-ink-950"
              >
                <X className="h-3.5 w-3.5" />
              </span>
            ) : (
              <ChevronsUpDown className="h-4 w-4 shrink-0 text-text-faint" />
            )}
          </button>
        </PopoverPrimitive.Trigger>

        <PopoverPrimitive.Portal>
          <PopoverPrimitive.Content
            align="start"
            sideOffset={6}
            // Dialog içinde kullanıldığında da doğru yere oturması için
            // çarpışma algılama Radix'e bırakılıyor.
            collisionPadding={12}
            className="popover-in z-[80] w-[var(--radix-popover-trigger-width)] overflow-hidden rounded-[12px] border border-line bg-surface shadow-[var(--inner-top),var(--elev-4)]"
            // Odak arama kutusuna gitsin: Radix varsayılanı ilk odaklanabilir
            // öğeye gider, o da temizleme düğmesi olabilirdi.
            onOpenAutoFocus={(e) => {
              e.preventDefault();
              (e.currentTarget as HTMLElement)?.querySelector("input")?.focus();
            }}
          >
            <div className="hairline-b flex items-center gap-2 px-3">
              <Search className="h-4 w-4 shrink-0 text-text-faint" />
              <input
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActive(0);
                }}
                onKeyDown={onKeyDown}
                placeholder={searchPlaceholder}
                aria-autocomplete="list"
                aria-controls={listId}
                aria-activedescendant={filtered[active] ? `${listId}-${active}` : undefined}
                className="w-full bg-transparent py-2.5 text-sm outline-none placeholder:text-text-faint"
              />
            </div>

            <div ref={listRef} id={listId} role="listbox" className="max-h-64 overflow-y-auto p-1.5">
              {filtered.length === 0 ? (
                <p className="px-3 py-6 text-center text-sm text-text-faint">
                  {showSearching
                    ? "Aranıyor…"
                    : onSearch && query.trim().length > 0 && query.trim().length < minSearchLength
                      ? `Aramak için en az ${minSearchLength} karakter yazın`
                      : emptyText}
                </p>
              ) : (
                filtered.map((opt, i) => (
                  <div
                    key={opt.value}
                    id={`${listId}-${i}`}
                    data-idx={i}
                    role="option"
                    aria-selected={opt.value === value}
                    aria-disabled={opt.disabled || undefined}
                    onClick={() => !opt.disabled && commit(opt.value)}
                    onMouseMove={() => setActive(i)}
                    className={cn(
                      "flex cursor-pointer items-center gap-2 rounded-[8px] px-3 py-2 text-sm transition",
                      i === active ? "bg-brand-600/[0.07] text-brand-700" : "text-ink-950",
                      opt.disabled && "pointer-events-none opacity-50",
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{opt.label}</span>
                      {opt.hint ? (
                        <span className="block truncate text-[11px] text-text-faint">{opt.hint}</span>
                      ) : null}
                    </span>
                    {opt.value === value ? <Check className="h-4 w-4 shrink-0 text-brand-600" /> : null}
                  </div>
                ))
              )}
            </div>

            {/* Sunucu aramasi varken "x / y kayit" yaniltici olur: y sayfa
                acilisinda gelen kisitli listedir, tum veri degil. */}
            {onSearch ? (
              <p className="hairline-t px-3 py-1.5 text-[11px] text-text-faint">
                {query.trim().length >= minSearchLength
                  ? `${filtered.length} sonuç`
                  : "Yazmaya başlayın — tüm kayıtlarda aranır"}
              </p>
            ) : pool.length > 12 ? (
              <p className="hairline-t px-3 py-1.5 text-[11px] text-text-faint">
                {filtered.length} / {pool.length} kayıt
              </p>
            ) : null}
          </PopoverPrimitive.Content>
        </PopoverPrimitive.Portal>
      </PopoverPrimitive.Root>
    </>
  );
}
