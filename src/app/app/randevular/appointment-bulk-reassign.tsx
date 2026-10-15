"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { UserCog } from "lucide-react";
import { bulkAssignAppointments } from "@/app/actions/appointments";
import { Button } from "@/components/ui/button";
import { PersonSelect } from "@/components/ui/person-select";
import { useToast } from "@/components/app/toast-provider";

/**
 * Liste düzeyinde toplu "Sorumlu değiştir": randevu listesinde satır seçimi yok; bunun yerine o an GÖRÜNEN
 * (süzgeçlerden geçmiş) kapanmamış randevuların hepsi tek danışmana devredilir. Yalnız yönetim katmanına çizilir;
 * sunucu `appointments.edit` + yönetim kuralını ve durum süzgecini yeniden uygular.
 */
export function AppointmentBulkReassign({ ids, advisors }: { ids: string[]; advisors: { id: string; label: string }[] }) {
  const router = useRouter();
  const { push } = useToast();
  const [open, setOpen] = useState(false);
  const [advisor, setAdvisor] = useState("");
  const [pending, startTransition] = useTransition();

  if (ids.length === 0 || advisors.length === 0) return null;

  const apply = () => {
    if (!advisor || pending) return;
    const name = advisors.find((a) => a.id === advisor)?.label ?? "seçilen danışman";
    startTransition(async () => {
      const res = await bulkAssignAppointments(ids, advisor);
      if (res.error) {
        push(res.error, "err");
        return;
      }
      push(`${res.updatedCount ?? ids.length} randevu ${name} danışmanına devredildi`, "ok");
      setOpen(false);
      setAdvisor("");
      router.refresh();
    });
  };

  return (
    <div className="space-y-2">
      <Button
        size="sm"
        variant="secondary"
        aria-expanded={open}
        onClick={() => {
          setAdvisor("");
          setOpen((o) => !o);
        }}
      >
        <UserCog aria-hidden="true" className="h-3.5 w-3.5" /> Sorumlu değiştir
      </Button>
      {open ? (
        <section aria-label="Sorumlu değiştir" className="rounded-[var(--radius-card)] border border-brand-300 bg-surface p-4">
          <p className="text-sm font-semibold text-ink-950">Sorumlu değiştir</p>
          <p className="mt-0.5 text-xs text-text-muted">
            Listede görünen {ids.length} açık randevu (tamamlanan ve iptal edilenler hariç) seçtiğiniz danışmana devredilir.
            Süzgeçleri daraltarak kapsamı küçültebilirsiniz.
          </p>
          <label htmlFor="appointment-bulk-assign" className="mb-1.5 mt-3 block text-xs font-semibold text-text-muted">
            Danışman
          </label>
          <PersonSelect
            id="appointment-bulk-assign"
            className="max-w-sm"
            value={advisor}
            onValueChange={setAdvisor}
            people={advisors.map((a) => ({ id: a.id, name: a.label }))}
            emptyLabel="Danışman seçin"
          />
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={() => setOpen(false)}>Vazgeç</Button>
            <Button size="sm" loading={pending} disabled={!advisor} onClick={apply}>Devret</Button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
