import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

type AlertTone = "info" | "success" | "warning" | "danger";

const TONES: Record<AlertTone, { cls: string; icon: typeof Info }> = {
  info: { cls: "tone-info", icon: Info },
  success: { cls: "tone-success", icon: CheckCircle2 },
  warning: { cls: "tone-warning", icon: AlertTriangle },
  danger: { cls: "tone-danger", icon: XCircle },
};

/**
 * Alert — satır içi bilgi/uyarı. Renkler `tone-*` yardımcılarından gelir
 * (AA kontrast, dark modda otomatik uyum). Hata durumu `role="alert"`,
 * diğerleri `role="status"` olarak ekran okuyucuya bildirilir.
 */
export function Alert({
  tone = "info",
  title,
  children,
  action,
  className,
}: {
  tone?: AlertTone;
  title?: string;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  const { cls, icon: Icon } = TONES[tone];
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={cn("es-alert flex items-start gap-3 rounded-[var(--radius-card)] px-4 py-3", cls, className)}
    >
      {/* Tonlu ikon diski (console-premium.css `.alert-ico`; panel dışında düz ikon gibi görünür). */}
      <span className="alert-ico" aria-hidden="true">
        <Icon className="h-4 w-4 shrink-0" aria-hidden />
      </span>
      <div className="min-w-0 flex-1 text-sm">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div className={cn("text-xs/relaxed", title && "mt-0.5")}>{children}</div> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
