"use client";

import Link from "@/components/ui/smart-link";
import { useState, type CSSProperties } from "react";

/**
 * SegmentedControl — eşit genişlikli seçenekler + kayan dolgulu hap (tasarım sistemi v4).
 * Filtre kontratı: her seçenek bir BAĞLANTIDIR (URL ↔ sunucu sorgusu iki yönlü; JS'siz de
 * çalışır, geri/ileri ve paylaşılan bağlantı doğru). Tıklayınca hap gezinme bitmeden kayar
 * (anında geri bildirim); yeni sayfa aynı konumda çizildiği için sıçrama olmaz.
 *
 * Neden `motion` layoutId değil: layoutId `domMax` (+~25 KB) ister; eşit genişlikli segmentte
 * aynı kayma CSS `transform` geçişiyle 0 KB'dir (`.ds-seg-thumb`, --motion-base + yay eğrisi,
 * reduce'ta anında). Arama parametresi değişimi sayfayı yeniden bağlamaz (Next template belgesi).
 */
export type SegmentOption = { value: string; label: string; href: string };

export function SegmentedControl({
  options,
  value,
  label,
  className,
}: {
  options: readonly SegmentOption[];
  value: string;
  /** Erişilebilir ad (ör. "Özet dönemi"). */
  label: string;
  className?: string;
}) {
  const valueIndex = Math.max(0, options.findIndex((o) => o.value === value));
  // Tıklanan seçenek, `value` o tıklamadan sonra değişene kadar geçerli (gezinme sürerken).
  const [picked, setPicked] = useState<{ index: number; from: string } | null>(null);
  const index = picked && picked.from === value ? picked.index : valueIndex;
  const style = { "--seg-n": options.length, "--seg-i": index } as CSSProperties;
  return (
    <nav aria-label={label} className={`ds-seg ${className ?? ""}`} style={style}>
      <span className="ds-seg-thumb" aria-hidden="true" />
      {options.map((o, i) => (
        <Link
          key={o.value}
          href={o.href}
          scroll={false}
          aria-current={o.value === value ? "true" : undefined}
          data-on={i === index ? "1" : undefined}
          onClick={() => setPicked({ index: i, from: value })}
          className="ds-seg-opt focus-ring"
        >
          {o.label}
        </Link>
      ))}
    </nav>
  );
}
