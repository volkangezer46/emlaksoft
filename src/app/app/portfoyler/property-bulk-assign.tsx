"use client";

import { PersonSelect } from "@/components/ui/person-select";
import type { AssignableAdvisor } from "@/lib/team/assignable-roles";

/**
 * Toplu "Sorumlu değiştir" danışman seçicisi. Combobox + Radix Popover yalnız panel açılınca iner
 * (property-bulk-actions.tsx `next/dynamic` ile yükler; portföy listesinin ilk yük JS'ine girmez).
 */
export function PropertyBulkAssignPicker({
  advisors,
  value,
  onValueChange,
}: {
  advisors: AssignableAdvisor[];
  value: string;
  onValueChange: (id: string) => void;
}) {
  return (
    <PersonSelect
      id="property-bulk-assign"
      className="max-w-sm"
      value={value}
      onValueChange={onValueChange}
      people={advisors.map((a) => ({ id: a.id, name: a.full_name }))}
      featuredIds={advisors.filter((a) => a.featured).map((a) => a.id)}
      emptyLabel="Danışman seçin"
    />
  );
}
