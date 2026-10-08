"use client";

import { Button } from "@/components/ui/button";
import { useActionState, useRef } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { createGeoEntity, type GeoActionResult } from "@/app/actions/geo-admin";
import { GEO_LEVEL_LABEL, type GeoLevel } from "@/lib/geo/types";

const initial: GeoActionResult = {};
const field =
  "rounded-[var(--radius-control)] border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-brand-400";

/** Her düzeyde (il/ilçe/mahalle) yeni kayıt ekleme — satır içi form, popup yok. */
export function NewEntityForm({ level, parentId }: { level: GeoLevel; parentId?: string }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const label = GEO_LEVEL_LABEL[level];

  const [state, action, pending] = useActionState(async (_prev: GeoActionResult, formData: FormData) => {
    const result = await createGeoEntity(formData);
    if (result.ok) {
      formRef.current?.reset();
      router.refresh();
    }
    return result;
  }, initial);

  return (
    <form ref={formRef} action={action} className="flex flex-wrap items-center gap-2 border-b border-line bg-canvas/50 px-5 py-3.5">
      <input type="hidden" name="level" value={level} />
      {parentId ? <input type="hidden" name="parent_id" value={parentId} /> : null}
      <input name="name" required aria-label={`Yeni ${label.toLowerCase()} adı`} placeholder={`Yeni ${label.toLowerCase()} adı…`} className={`${field} min-w-[160px] flex-1`} />
      {level === "province" ? <input name="plate_code" required inputMode="numeric" aria-label="Plaka kodu" placeholder="Plaka (1-81)" className={`${field} w-28 text-xs`} /> : null}
      {level === "neighborhood" ? <input name="postal_code" aria-label="Posta kodu" placeholder="Posta kodu (ops.)" className={`${field} w-32 text-xs`} /> : null}
      <input name="lat" aria-label="Enlem" placeholder="Enlem (ops.)" className={`${field} w-28 text-xs`} />
      <input name="lng" aria-label="Boylam" placeholder="Boylam (ops.)" className={`${field} w-28 text-xs`} />
      <input name="description" aria-label="Açıklama" placeholder="Açıklama (ops.)" className={`${field} min-w-[140px] flex-1 text-xs`} />
      <Button variant="primary" size="sm" type="submit" disabled={pending}>
        <Plus className="h-3.5 w-3.5" /> {pending ? "Ekleniyor…" : `${label} ekle`}
      </Button>
      {state.error ? <p role="alert" className="w-full text-xs text-danger-500">{state.error}</p> : null}
    </form>
  );
}
