import type { ReactNode } from "react";
import { HelpTipButton } from "@/components/ui/help-tip-button";
import { glossaryEntry } from "@/lib/help-content";

/**
 * HelpTip: terimin yanındaki "?" düğmesi. Tooltip ya da popup DEĞİL; basınca
 * metnin hemen altında kısa bir açıklama satır içi açılır, tekrar basınca kapanır.
 *
 * SUNUCU bileşeni: sözlük (`src/lib/help-content.ts`) yalnız sunucuda okunur; istemciye sadece
 * ilgili terimin metni gider (`help-tip-button.tsx`). Bu dosyayı bir "use client" dosyasından
 * içe aktarma (sözlük istemci paketine girer).
 *
 * - Klavye: Enter/Boşluk açar, Esc kapatır; `aria-expanded` + `aria-controls`.
 * - Dokunma hedefi 44x44 px (görünen yuvarlak 20 px; negatif kenar boşluğu
 *   satır yüksekliğini bozmaz).
 * - `topic`: yardım sözlüğündeki anahtar (src/lib/help-content.ts). Açıklama ve
 *   "Daha fazla" bağlantısı (/app/yardim?sekme=sozluk#konu) oradan gelir.
 *   `children` verilirse sözlük metninin yerine geçer.
 */
export function HelpTip({
  topic,
  children,
  label,
  className,
}: {
  topic: string;
  children?: ReactNode;
  /** Ekran okuyucu adı; verilmezse terim adı kullanılır. */
  label?: string;
  className?: string;
}) {
  const entry = glossaryEntry(topic);
  const text = children ?? entry?.short;
  if (!text) return null;
  return (
    <HelpTipButton
      text={text}
      name={label ?? entry?.term ?? "Yardım"}
      moreHref={entry ? `/app/yardim?sekme=sozluk#${entry.slug}` : undefined}
      className={className}
    />
  );
}
