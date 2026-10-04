"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, MapPin, Pencil, StickyNote } from "lucide-react";
import { InlineTabbedPanel } from "@/components/ui/inline-tabbed-panel";
import { FormField, FormInput, FormTextarea } from "@/components/ui/form-controls";
import { updateOpenHouse } from "@/app/actions/targets-openhouse-sources";

/** Açık ev etkinliğini düzenleme: sayfa içi sekme alanı (popup yok). */
export function EditOpenHousePanel({
  openHouseId,
  scheduledLocal,
  durationMin,
  location,
  maxVisitors,
  notes,
}: {
  openHouseId: string;
  /** `datetime-local` değeri (Türkiye saati), sunucuda toTrLocalInput ile üretilir. */
  scheduledLocal: string;
  durationMin: number | null;
  location: string | null;
  maxVisitors: number | null;
  notes: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(fd: FormData) {
    setError(null);
    startTransition(async () => {
      const res = await updateOpenHouse(openHouseId, fd);
      if (res.error) {
        setError(res.error);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <InlineTabbedPanel
      open={open}
      onOpenChange={setOpen}
      title="Açık evi düzenle"
      icon={<Pencil />}
      onSubmit={onSubmit}
      pending={pending}
      error={error}
      fieldLabels={{
        scheduled_at: "Tarih ve saat",
        duration_min: "Süre (dk)",
        location: "Konum",
        max_visitors: "Kapasite",
        notes: "Not",
      }}
      trigger={({ onClick, ...aria }) => (
        <button
          type="button"
          onClick={onClick}
          {...aria}
          className="focus-ring press inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-ink-950 transition hover:border-brand-300"
        >
          <Pencil className="h-3.5 w-3.5" /> Düzenle
        </button>
      )}
      tabs={[
        { id: "zaman", label: "Zaman", icon: CalendarDays, fields: ["scheduled_at", "duration_min"] },
        { id: "yer", label: "Yer ve kapasite", icon: MapPin, fields: ["location", "max_visitors"] },
        { id: "not", label: "Not", icon: StickyNote, fields: ["notes"] },
      ]}
      panels={{
        zaman: (
          <>
            <FormField label="Tarih ve saat" htmlFor="oh-e-when" required>
              <FormInput name="scheduled_at" type="datetime-local" required defaultValue={scheduledLocal} />
            </FormField>
            <FormField label="Süre (dk)" htmlFor="oh-e-dur">
              <FormInput name="duration_min" type="number" min={15} step={15} defaultValue={durationMin ?? 120} />
            </FormField>
          </>
        ),
        yer: (
          <>
            <FormField label="Konum / buluşma noktası" htmlFor="oh-e-loc" className="sm:col-span-2">
              <FormInput name="location" defaultValue={location ?? ""} />
            </FormField>
            <FormField label="Ziyaretçi kapasitesi" htmlFor="oh-e-max">
              <FormInput name="max_visitors" type="number" min={1} placeholder="Sınırsız" defaultValue={maxVisitors ?? ""} />
            </FormField>
          </>
        ),
        not: (
          <FormField label="Not" htmlFor="oh-e-notes" className="sm:col-span-2">
            <FormTextarea name="notes" rows={5} defaultValue={notes ?? ""} />
          </FormField>
        ),
      }}
    />
  );
}
