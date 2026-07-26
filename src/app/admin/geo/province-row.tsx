"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronRight, Pencil, X } from "lucide-react";
import { updateProvince, type GeoActionResult } from "@/app/actions/geo-admin";

export type ProvinceRowData = {
  id: string;
  plate_code: number;
  name: string;
  lat: number | null;
  lng: number | null;
  is_active: boolean;
  population: number | null;
  districtCount: number;
  neighborhoodCount: number;
};

const initial: GeoActionResult = {};

export function ProvinceRow({ province }: { province: ProvinceRowData }) {
  const [editing, setEditing] = useState(false);
  const router = useRouter();
  const [state, action, pending] = useActionState(async (_prev: GeoActionResult, formData: FormData) => {
    const result = await updateProvince(formData);
    if (result.ok) {
      setEditing(false);
      router.refresh();
    }
    return result;
  }, initial);

  if (editing) {
    return (
      <form action={action} className="grid gap-3 border-b border-line bg-brand-600/[0.03] px-5 py-4 lg:grid-cols-[auto_1fr_auto_auto_auto_auto] lg:items-center">
        <input type="hidden" name="id" value={province.id} />
        <span className="rounded-full bg-ink-950/5 px-2.5 py-1 text-center text-[11px] font-bold text-text-muted">
          {province.plate_code}
        </span>
        <input
          name="name"
          defaultValue={province.name}
          required
          className="rounded-[9px] border border-line bg-surface px-2.5 py-1.5 text-sm font-semibold outline-none focus:border-brand-400"
        />
        <input
          name="lat"
          defaultValue={province.lat ?? ""}
          placeholder="Enlem"
          className="w-24 rounded-[9px] border border-line bg-surface px-2.5 py-1.5 text-xs outline-none focus:border-brand-400"
        />
        <input
          name="lng"
          defaultValue={province.lng ?? ""}
          placeholder="Boylam"
          className="w-24 rounded-[9px] border border-line bg-surface px-2.5 py-1.5 text-xs outline-none focus:border-brand-400"
        />
        <label className="flex items-center gap-1.5 text-xs font-semibold text-text-muted">
          <input type="checkbox" name="is_active" defaultChecked={province.is_active} className="h-3.5 w-3.5" />
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
        {state.error ? <p className="lg:col-span-6 text-xs text-danger-500">{state.error}</p> : null}
      </form>
    );
  }

  return (
    <div className="grid gap-3 border-b border-line px-5 py-3.5 transition hover:bg-canvas/60 lg:grid-cols-[auto_1fr_auto_auto_auto] lg:items-center">
      <span className="rounded-full bg-brand-600/8 px-2.5 py-1 text-center text-[11px] font-bold text-brand-600">
        {province.plate_code}
      </span>
      <div>
        <Link
          href={`/admin/geo/${province.id}`}
          className="font-display text-sm font-bold text-ink-950 transition hover:text-brand-600"
        >
          {province.name}
        </Link>
        <p className="mt-0.5 text-[11px] text-text-muted">
          <Link href={`/admin/geo/${province.id}`} className="transition hover:text-brand-600 hover:underline">
            {province.districtCount} ilçe · {province.neighborhoodCount} mahalle
          </Link>
          {province.population ? ` · ${province.population.toLocaleString("tr-TR")} nüfus` : ""}
        </p>
      </div>
      {!province.is_active ? (
        <span className="rounded-full bg-danger-500/10 px-2 py-1 text-[11px] font-bold text-danger-500">Pasif</span>
      ) : (
        <span />
      )}
      <button onClick={() => setEditing(true)} className="grid h-8 w-8 place-items-center rounded-[9px] text-text-muted hover:bg-canvas">
        <Pencil className="h-3.5 w-3.5" />
      </button>
      <Link
        href={`/admin/geo/${province.id}`}
        className="inline-flex items-center gap-1 rounded-[9px] border border-line px-3 py-1.5 text-xs font-semibold text-ink-950 transition hover:border-brand-400 hover:text-brand-600"
      >
        İlçeler <ChevronRight className="h-3.5 w-3.5" />
      </Link>
    </div>
  );
}
