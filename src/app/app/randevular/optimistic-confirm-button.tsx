"use client";

import { useOptimistic, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { updateAppointmentStatus } from "@/app/actions/appointments";
import { useToast } from "@/components/app/toast-provider";

/**
 * Randevu "Onayla" hızlı eylemi — iyimser güncelleme: tıklanır tıklanmaz buton "Onaylandı" olur, action arkada çalışır.
 * Transition bitince taban değere dönülür: başarıda revalidate edilmiş sayfa aynı durumu getirir, hatada buton kendiliğinden
 * eski haline döner (+ toast, refresh). Yetki/geçiş kuralları sunucuda (`updateAppointmentStatus`) değişmez.
 */
export function OptimisticConfirmButton({ id, className }: { id: string; className: string }) {
  const router = useRouter();
  const { push } = useToast();
  const [pending, startTransition] = useTransition();
  const [confirmed, setConfirmed] = useOptimistic(false);

  function confirm() {
    if (pending) return; // çifte tıklama koruması
    startTransition(async () => {
      setConfirmed(true);
      const fd = new FormData();
      fd.set("id", id);
      fd.set("status", "confirmed");
      try {
        const result = await updateAppointmentStatus(fd);
        if (result && "error" in result && result.error) {
          push(result.error, "err");
          router.refresh();
        }
      } catch {
        push("Randevu onaylanamadı. Lütfen tekrar deneyin.", "err");
        router.refresh();
      }
    });
  }

  // İyimser durum: onaylı randevuda bu eylem zaten görünmez (sunucu yanıtıyla aynı sonuç); hatada geri gelir.
  if (confirmed) return null;
  const label = "Randevuyu onayla";
  return (
    <button
      type="button"
      onClick={confirm}
      disabled={pending}
      aria-label={label}
      title={label}
      className={`focus-ring press grid h-8 w-8 place-items-center rounded-[var(--radius-control)] border border-transparent transition hover:border-line hover:bg-canvas ${className}`}
    >
      <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
    </button>
  );
}
