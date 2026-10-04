import type { CustomerDeleteImpact } from "@/app/actions/customers";

/** Silme özeti satırları ("2 açık anlaşma", ...). Boşsa bağlı kayıt yok demektir. */
export function describeDeleteImpact(i: CustomerDeleteImpact | null): string[] {
  if (!i) return [];
  const out: string[] = [];
  if (i.openDeals > 0) out.push(`${i.openDeals} açık anlaşma`);
  if (i.openDemands > 0) out.push(`${i.openDemands} aktif talep`);
  if (i.activeAppointments > 0) out.push(`${i.activeAppointments} bekleyen randevu`);
  if (i.openTasks > 0) out.push(`${i.openTasks} açık görev`);
  if (i.contracts > 0) out.push(`${i.contracts} sözleşme`);
  return out;
}
