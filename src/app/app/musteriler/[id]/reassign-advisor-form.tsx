import { UserCog } from "lucide-react";
import { reassignCustomer } from "@/app/actions/customers";
import { PersonSelect } from "@/components/ui/person-select";

/**
 * Müşteri kartı "Danışmanı değiştir": JS'siz çalışan tek satır form (sunucu eylemi + yenileme). Eylem hedef
 * danışmanı ofis içinde doğrular, denetim kaydı yazar ve yeni danışmana bildirim gönderir.
 */
export function ReassignAdvisorForm({
  customerId,
  current,
  advisors,
}: {
  customerId: string;
  current: string | null;
  advisors: readonly { id: string; full_name: string }[];
}) {
  return (
    <form action={reassignCustomer} className="inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border border-white/15 bg-white/5 py-1 pl-3 pr-1 text-sm text-white">
      <input type="hidden" name="id" value={customerId} />
      <UserCog className="h-4 w-4 shrink-0" aria-hidden="true" />
      <label htmlFor={`reassign-${customerId}`} className="sr-only">
        Danışman
      </label>
      <PersonSelect
        id={`reassign-${customerId}`}
        name="assigned_to"
        defaultValue={current ?? ""}
        people={advisors.map((a) => ({ id: a.id, name: a.full_name }))}
        emptyLabel="Danışmansız"
        clearable={false}
        className="w-auto min-w-[11rem] max-w-[14rem] border-0 bg-transparent font-semibold text-white hover:border-0"
      />
      <button type="submit" className="focus-ring press rounded-[var(--radius-control)] bg-white/10 px-2.5 py-1 text-xs font-semibold text-white transition hover:bg-white/20">
        Danışmanı değiştir
      </button>
    </form>
  );
}
