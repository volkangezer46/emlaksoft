import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/**
 * MobileCardList / MobileCard — liste sayfalarının <md kart listesi (tablo yerine).
 * Tek kap: kartlar ilk girişte `.list-stagger` ile sırayla belirir, tıklanabilir kart
 * hover'da `.hover-lift` ile 2px yükselir (motion.css; yalnız transform/opacity, CLS yok,
 * reduced-motion'da kapalı). Sunucu bileşenidir.
 */
export function MobileCardList({ className, ...props }: ComponentProps<"ul">) {
  return <ul className={cn("list-stagger space-y-2.5 md:hidden", className)} {...props} />;
}

export function MobileCard({ className, ...props }: ComponentProps<"li">) {
  return <li className={cn("surface-card hover-lift relative rounded-[var(--radius-card)] p-3", className)} {...props} />;
}
