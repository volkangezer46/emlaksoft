"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Trash2, X } from "lucide-react";
import { updateNeighborhood, deleteNeighborhood, type GeoActionResult } from "@/app/actions/geo-admin";

export type NeighborhoodRowData = {
  id: string;
  district_id: string;
  province_id: string;
  name: string;
  postal_code: string | null;
  population: number | null;
  is_active: boolean;
};

const initial: GeoActionResult = {};

export function NeighborhoodRow({ neighborhood }: { neighborhood: NeighborhoodRowData }) {
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const router = useRouter();

  const [state, action, pending] = useActionState(async (_prev: GeoActionResult, formData: FormData) => {
    const result = await updateNeighborhood(formData);
    if (result.ok) {
      setEditing(false);
      router.refresh();
    }
    return result;
  }, initial);

  const [delState, delAction, delPending] = useActionState(async (_prev: GeoActionResult, formData: FormData) => {
    const result = await deleteNeighborhood(formData);
    if (result.ok) router.refresh();
    return result;
  }, initial);

  if (editing) {
    return (
      <form action={action} className="grid gap-2.5 border-b border-line bg-brand-600/[0.03] px-4 py-3 sm:grid-cols-[1fr_auto_auto_auto] sm:items-center">
        <input type="hidden" name="id" value={neighborhood.id} />
        <input type="hidden" name="district_id" value={neighborhood.district_id} />
        <input type="hidden" name="province_id" value={neighborhood.province_id} />
        <input
          name="name"
          defaultValue={neighborhood.name}
          required
          className="rounded-[9px] border border-line bg-surface px-2.5 py-1.5 text-sm font-semibold outline-none focus:border-brand-400"
        />
        <input
          name="postal_code"
          defaultValue={neighborhood.postal_code ?? ""}
          placeholder="Posta kodu"
          className="w-24 rounded-[9px] border border-line bg-surface px-2.5 py-1.5 text-xs outline-none focus:border-brand-400"
        />
        <label className="flex items-center gap-1.5 text-xs font-semibold text-text-muted">
          <input type="checkbox" name="is_active" defaultChecked={neighborhood.is_active} className="h-3.5 w-3.5" />
          Aktif
        </label>
        <div className="flex items-center gap-2">
          <button type="submit" disabled={pending} className="rounded-[8px] bg-ink-950 px-3 py-1.5 text-xs font-semibold text-white hover:bg-ink-800 disabled:opacity-60">
            {pending ? "..." : "Kaydet"}
          </button>
          <button type="button" onClick={() => setEditing(false)} className="grid h-7 w-7 place-items-center rounded-[8px] text-text-muted hover:bg-canvas">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        {state.error ? <p className="text-xs text-danger-500 sm:col-span-4">{state.error}</p> : null}
      </form>
    );
  }

  return (
    <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5 transition hover:bg-canvas/60">
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-ink-950">{neighborhood.name}</p>
        <p className="mt-0.5 text-[11px] text-text-muted">
          {neighborhood.postal_code ? `${neighborhood.postal_code} · ` : ""}
          {neighborhood.population ? `${neighborhood.population.toLocaleString("tr-TR")} nüfus` : "—"}
          {!neighborhood.is_active ? " · Pasif" : ""}
        </p>
      </div>
      <div className="flex items-center gap-1">
        <button onClick={() => setEditing(true)} className="grid h-7 w-7 place-items-center rounded-[8px] text-text-muted hover:bg-canvas">
          <Pencil className="h-3.5 w-3.5" />
        </button>
        {confirmingDelete ? (
          <form action={delAction} className="flex items-center gap-1">
            <input type="hidden" name="id" value={neighborhood.id} />
            <input type="hidden" name="district_id" value={neighborhood.district_id} />
            <input type="hidden" name="province_id" value={neighborhood.province_id} />
            <button type="submit" disabled={delPending} className="rounded-[7px] bg-danger-500 px-2 py-1 text-[11px] font-bold text-white disabled:opacity-60">
              Onayla
            </button>
            <button type="button" onClick={() => setConfirmingDelete(false)} className="rounded-[7px] border border-line px-1.5 py-1 text-[11px] text-text-muted">
              Vazgeç
            </button>
          </form>
        ) : (
          <button onClick={() => setConfirmingDelete(true)} className="grid h-7 w-7 place-items-center rounded-[8px] text-text-muted hover:bg-danger-500/10 hover:text-danger-500">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {delState.error ? <p className="w-full text-xs text-danger-500">{delState.error}</p> : null}
    </div>
  );
}
