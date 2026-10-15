import Link from "@/components/ui/smart-link";
import { ArrowRight } from "lucide-react";
import { isAppointmentOutcome } from "@/lib/appointment-outcome";
import { appointmentNextSteps } from "@/lib/appointment-follow-up";

/**
 * Tamamlanan randevunun sonucuna göre "sonraki adım" kısayolu (takip zinciri): olumlu → Teklif gir, kararsız →
 * 2. gösterim planla (takip görevi sunucuda açılır), olumsuz → Talebi güncelle. Sonuç/müşteri yoksa hiçbir şey çizmez.
 */
export function AppointmentNextSteps({
  outcome,
  customerId,
  propertyId,
}: {
  outcome: string | null | undefined;
  customerId: string | null;
  propertyId: string | null;
}) {
  const steps = appointmentNextSteps(outcome && isAppointmentOutcome(outcome) ? outcome : null, { customerId, propertyId });
  if (steps.length === 0) return null;
  return (
    <>
      {steps.map((s) => (
        <Link
          key={s.href}
          href={s.href}
          prefetch={false}
          title={s.hint}
          className="focus-ring press inline-flex items-center gap-1 rounded-[var(--radius-control)] border border-brand-300 bg-brand-600/8 px-2.5 py-1.5 text-xs font-semibold text-brand-700 transition hover:border-brand-400 touch:min-h-11"
        >
          <ArrowRight className="h-3 w-3" aria-hidden /> {s.label}
        </Link>
      ))}
    </>
  );
}
