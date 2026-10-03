import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/**
 * Checkbox — yerel <input type="checkbox"> üstüne marka rengi + odak halkası.
 * Yerel kalması klavye, form gönderimi ve ekran okuyucu davranışını bedavaya
 * korur. `accent-accent` işaret rengini tema (ve beyaz etiket) tokenından alır.
 */
export function Checkbox({ className, ...props }: ComponentProps<"input">) {
  return (
    <input
      type="checkbox"
      className={cn(
        "focus-ring h-4 w-4 touch:h-6 touch:w-6 shrink-0 cursor-pointer rounded-sm border border-line-strong accent-accent disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}
