"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronRight, Pencil, Trash2, X } from "lucide-react";
import { updateDistrict, deleteDistrict, type GeoActionResult } from "@/app/actions/geo-admin";

export type DistrictRowData = {
  id: string;
  province_id: string;
  name: string;
  lat: number | null;
  lng: number | null;
  is_active: boolean;
  population: number | null;
  neighborhoodCount: number;
};

const initial: GeoActionResult = {};

export function DistrictRow({ district }: { district: DistrictRowData }) {
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const router = useRouter();

  const [state, action, pending] = useActionState(async (_prev: GeoActionResult, formData: FormData) => {
    const result = await updateDistrict(formData);
    if (result.ok) {
      setEditing(false);
      router.refresh();
    }
    return result;
  }, initial);

  const [delState, delAction, delPending] = useActionState(async (_prev: GeoActionResult, formData: FormData) => {
    const result = await deleteDistrict(formData);
    if (result.ok) router.refresh();
    return result;
  }, initial);

  if (editing) {
    return (
      <form action={action} className="grid gap-3 border-b border-line bg-brand-600/[0.03] px-5 py-4 lg:grid-cols-[1fr_auto_auto_auto_auto] lg:items-center">
        <input type="hidden" name="id" value={district.id} />
        <input type="hidden" name="province_id" value={district.province_id} />
        <input
          name="name"
          defaultValue={district.name}
          required
          className="rounded-[9px] border border-line bg-surface px-2.5 py-1.5 text-sm font-semibold outline-none focus:border-brand-400"
        />
        <input
          name="lat"
          defaultValue={district.lat ?? ""}
          placeholder="Enlem"
          className="w-24 rounded-[9px] border border-line bg-surface px-2.5 py-1.5 text-xs outline-none focus:border-brand-400"
        />
        <input
          name="lng"
          defaultValue={district.lng ?? ""}
          placeholder="Boylam"
          className="w-24 rounded-[9px] border border-line bg-surface px-2.5 py-1.5 text-xs outline-none focus:border-brand-400"
        />
        <label className="flex items-center gap-1.5 text-xs font-semibold text-text-muted">
          <input type="checkbox" name="is_active" defaultChecked={district.is_active} className="h-3.5 w-3.5" />
          Aktif
        </label>
        <div className="flex items-center gap-2">
          <button type="submit" disabled={pending} className="rounded-[9px] bg-ink-950 px-3 py-1.5 text-xs font-semibold text-white hover:bg-ink-800 disabled:opacity-60">
            {pending ? "..." : "Kaydet"}
          </button>
          <button type="button" onClick={() => setEditing(false)} className="grid h-8 w-8 place-items-center rounded-[9px] text-text-muted hover:bg-canvas">
            <X className="h-4 w-4" />
          </button>
        </div>
        {state.error ? <p className="text-xs text-danger-500 lg:col-span-5">{state.error}</p> : null}
      </form>
    );
  }

  return (
    <div className="grid gap-3 border-b border-line px-5 py-3.5 transition hover:bg-canvas/60 lg:grid-cols-[1fr_auto_auto_auto_auto] lg:items-center">
      <div>
        <p className="font-display text-sm font-bold text-ink-950">{district.name}</p>
        <p className="mt-0.5 text-[11px] text-text-muted">
          {district.neighborhoodCount} mahalle
          {district.population ? ` · ${district.population.toLocaleString("tr-TR")} nüfus` : ""}
        </p>
      </div>
      {!district.is_active ? (
        <span className="rounded-full bg-danger-500/10 px-2 py-1 text-[10px] font-bold text-danger-500">Pasif</span>
      ) : (
        <span />
      )}
      <button onClick={() => setEditing(true)} className="grid h-8 w-8 place-items-center rounded-[9px] text-text-muted hover:bg-canvas">
        <Pencil className="h-3.5 w-3.5" />
      </button>
      {confirmingDelete ? (
        <form
          action={delAction}
          onSubmit={(e) => {
            if (delPending) e.preventDefault();
          }}
          className="flex items-center gap-1.5"
        >
          <input type="hidden" name="id" value={district.id} />
          <input type="hidden" name="province_id" value={district.province_id} />
          <button type="submit" disabled={delPending} className="rounded-[8px] bg-danger-500 px-2.5 py-1.5 text-[11px] font-bold text-white disabled:opacity-60">
            Onayla
          </button>
          <button type="button" onClick={() => setConfirmingDelete(false)} className="rounded-[8px] border border-line px-2 py-1.5 text-[11px] text-text-muted">
            Vazgeç
          </button>
        </form>
      ) : (
        <button onClick={() => setConfirmingDelete(true)} className="grid h-8 w-8 place-items-center rounded-[9px] text-text-muted hover:bg-danger-500/10 hover:text-danger-500">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}
      <Link
        href={`/admin/geo/${district.province_id}/${district.id}`}
        className="inline-flex items-center gap-1 rounded-[9px] border border-line px-3 py-1.5 text-xs font-semibold text-ink-950 transition hover:border-brand-400 hover:text-brand-600"
      >
        Mahalleler <ChevronRight className="h-3.5 w-3.5" />
      </Link>
      {delState.error ? <p className="text-xs text-danger-500 lg:col-span-5">{delState.error}</p> : null}
    </div>
  );
}
