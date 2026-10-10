"use client";

import Link from "@/components/ui/smart-link";
import { useRouter } from "next/navigation";
import { useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { Building2, User } from "lucide-react";
import { SCOPE_COOKIE, SCOPE_COOKIE_MAX_AGE, type ScopeValue } from "@/lib/ui/scope";
import { announceScope } from "@/lib/ui/use-nav-role";

/**
 * ScopeSwitch — "Ofis geneli | Benim işlerim" kapsam geçişi (tasarım sistemi v4; `SegmentedControl` ile aynı aile:
 * `.ds-seg` kabı + kayan dolgulu hap, CSS transform, 0 KB hareket kütüphanesi). Farkı: ikonlu iki parça, altında
 * seçili kapsamın tek satır açıklaması ve ERİŞİLEBİLİR RADYO GRUBU (`role=radiogroup`, `aria-checked`, ok tuşlarıyla
 * gezinme, gezici tabindex).
 *
 * Filtre kontratı: seçenekler BAĞLANTIDIR (URL `?kapsam=` ↔ sunucu sorgusu; JS'siz de çalışır). Son seçim
 * birinci taraf çerezde (`es_scope`) saklanır; sunucu URL'de kapsam yoksa çerezi okur (SSR uyumlu varsayılan,
 * yanıp sönme yok). Yalnız yönetim rolleri görür; danışmanda çağıran bileşen hiç çizmez.
 */
export type ScopeSwitchOption = { value: ScopeValue; href: string; hint: string };

const META: Record<ScopeValue, { label: string; Icon: typeof Building2 }> = {
  ofis: { label: "Ofis geneli", Icon: Building2 },
  ben: { label: "Benim işlerim", Icon: User },
};

function remember(value: ScopeValue) {
  // Yalnız tercih (yetki değil): sunucu her istekte rolü yeniden doğrular.
  document.cookie = `${SCOPE_COOKIE}=${value}; path=/app; max-age=${SCOPE_COOKIE_MAX_AGE}; samesite=lax`;
}

export function ScopeSwitch({
  value,
  office,
  mine,
  label = "Görünüm kapsamı",
  className,
}: {
  value: ScopeValue;
  office: Omit<ScopeSwitchOption, "value">;
  mine: Omit<ScopeSwitchOption, "value">;
  label?: string;
  className?: string;
}) {
  const router = useRouter();
  const options: ScopeSwitchOption[] = [
    { value: "ofis", ...office },
    { value: "ben", ...mine },
  ];
  // Tıklanan seçenek, `value` güncellenene kadar geçerli (gezinme sürerken hap anında kayar).
  const [picked, setPicked] = useState<{ value: ScopeValue; from: ScopeValue } | null>(null);
  const current = picked && picked.from === value ? picked.value : value;
  const index = options.findIndex((o) => o.value === current);
  const refs = useRef<(HTMLAnchorElement | null)[]>([]);
  const style = { "--seg-n": 2, "--seg-i": Math.max(0, index) } as CSSProperties;
  const hintId = "scope-switch-hint";

  const choose = (o: ScopeSwitchOption) => {
    remember(o.value);
    announceScope(o.value); // menü (yan menü + alt çubuk) anında kişisel/ofis düzenine geçer
    setPicked({ value: o.value, from: value });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    const next =
      e.key === "Home" ? 0 : e.key === "End" ? options.length - 1 : (index + (e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 1) + options.length) % options.length;
    const o = options[next];
    refs.current[next]?.focus();
    if (o.value !== current) {
      choose(o);
      router.push(o.href, { scroll: false });
    }
  };

  const active = options[Math.max(0, index)];
  return (
    <div className={`flex w-full flex-col gap-1 sm:w-auto sm:items-end ${className ?? ""}`}>
      <div
        role="radiogroup"
        aria-label={label}
        aria-describedby={hintId}
        onKeyDown={onKeyDown}
        className="ds-seg scope-seg w-full sm:w-auto"
        style={style}
      >
        <span className="ds-seg-thumb" aria-hidden="true" />
        {options.map((o, i) => {
          const m = META[o.value];
          const on = o.value === current;
          return (
            <Link
              key={o.value}
              ref={(el) => {
                refs.current[i] = el;
              }}
              href={o.href}
              scroll={false}
              role="radio"
              aria-checked={on}
              tabIndex={on ? 0 : -1}
              data-on={on ? "1" : undefined}
              onClick={() => choose(o)}
              className="ds-seg-opt scope-opt focus-ring"
            >
              <m.Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
              {m.label}
            </Link>
          );
        })}
      </div>
      <p id={hintId} aria-live="polite" className="scope-hint text-xs text-text-muted">
        {active.hint}
      </p>
    </div>
  );
}
