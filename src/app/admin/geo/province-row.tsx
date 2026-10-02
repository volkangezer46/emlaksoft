"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronRight, LoaderCircle, Pencil, RefreshCw, X } from "lucide-react";
import {
  enqueueProvinceGeoSync,
  updateProvince,
  type GeoActionResult,
  type GeoSyncActionResult,
} from "@/app/actions/geo-admin";

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
  sync: Record<string, unknown> | null;
  syncAvailable: boolean;
};

const initial: GeoActionResult = {};
const initialSync: GeoSyncActionResult = {};

const statusPresentation: Record<string, { label: string; className: string }> = {
  queued: { label: "Sırada", className: "bg-amber-500/10 text-amber-700" },
  running: { label: "Taranıyor", className: "bg-brand-600/10 text-brand-700" },
  retry: { label: "Yeniden denenecek", className: "bg-amber-500/10 text-amber-700" },
  succeeded: { label: "Tamamlandı", className: "bg-emerald-500/10 text-emerald-700" },
  partial: { label: "İnceleme gerekli", className: "bg-orange-500/10 text-orange-700" },
  dead_letter: { label: "İşlem gerekli", className: "bg-danger-500/10 text-danger-600" },
  paused: { label: "Bekletiliyor", className: "bg-ink-950/5 text-text-muted" },
};

function syncString(sync: Record<string, unknown> | null, key: string): string | null {
  const value = sync?.[key];
  return typeof value === "string" && value ? value : null;
}

function syncNumber(sync: Record<string, unknown> | null, key: string): number {
  const value = Number(sync?.[key]);
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

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
  const [syncState, syncAction, syncPending] = useActionState(
    async (_prev: GeoSyncActionResult, formData: FormData) => {
      const result = await enqueueProvinceGeoSync(formData);
      if (result.ok) router.refresh();
      return result;
    },
    initialSync,
  );

  if (editing) {
    return (
      <form action={action} className="grid gap-3 border-b border-line bg-brand-600/[0.03] px-5 py-4 lg:grid-cols-[auto_1fr_auto_auto_auto_auto] lg:items-center">
        <input type="hidden" name="id" value={province.id} />
        <span className="rounded-full bg-ink-950/5 px-2.5 py-1 text-center text-[11px] font-bold text-text-muted">
          {province.plate_code}
        </span>
        <input
          name="name"
          aria-label="İl adı"
          defaultValue={province.name}
          required
          className="rounded-[9px] border border-line bg-surface px-2.5 py-1.5 text-sm font-semibold outline-none focus:border-brand-400"
        />
        <input
          name="lat"
          aria-label={`${province.name} enlem`}
          defaultValue={province.lat ?? ""}
          placeholder="Enlem"
          className="w-24 rounded-[9px] border border-line bg-surface px-2.5 py-1.5 text-xs outline-none focus:border-brand-400"
        />
        <input
          name="lng"
          aria-label={`${province.name} boylam`}
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
            {pending ? "Kaydediliyor…" : "Kaydet"}
          </button>
          <button type="button" aria-label={`${province.name} düzenlemesini iptal et`} onClick={() => setEditing(false)} className="focus-ring grid h-8 w-8 place-items-center rounded-[9px] text-text-muted hover:bg-canvas">
            <X className="h-4 w-4" />
          </button>
        </div>
        {state.error ? <p role="alert" className="lg:col-span-6 text-xs text-danger-500">{state.error}</p> : null}
      </form>
    );
  }

  const syncStatus = syncString(province.sync, "status");
  const status = syncStatus ? statusPresentation[syncStatus] : null;
  const activeSync = syncStatus === "queued" || syncStatus === "running" || syncStatus === "retry";
  const expectedNeighborhoods = syncNumber(province.sync, "expected_neighborhood_count");
  const inserted = syncNumber(province.sync, "inserted_count");
  const updated = syncNumber(province.sync, "updated_count");
  const conflicts = syncNumber(province.sync, "conflict_count");
  const lastRun = syncString(province.sync, "completed_at")
    ?? syncString(province.sync, "started_at")
    ?? syncString(province.sync, "created_at");

  return (
    <div className={`grid gap-3 border-b border-line px-5 py-3.5 transition hover:bg-canvas/60 lg:grid-cols-[auto_minmax(0,1fr)_minmax(190px,auto)_auto_auto_auto_auto] lg:items-center ${province.plate_code === 46 ? "bg-amber-500/[0.025]" : ""}`}>
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
        {province.plate_code === 46 ? (
          <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.1em] text-amber-700">Öncelikli doğrulama ili</p>
        ) : null}
      </div>
      <div className="min-w-0">
        {status ? (
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${status.className}`}>
                {syncStatus === "running" ? <LoaderCircle className="mr-1 inline h-3 w-3 animate-spin" /> : null}
                {status.label}
              </span>
              {lastRun ? <span className="text-[10px] text-text-faint">{lastRun.slice(0, 10)}</span> : null}
            </div>
            {syncStatus === "succeeded" || syncStatus === "partial" ? (
              <p className="mt-1 truncate text-[10px] text-text-muted">
                {expectedNeighborhoods.toLocaleString("tr-TR")} kaynak kaydı · {inserted} eklendi · {updated} güncellendi
                {conflicts > 0 ? ` · ${conflicts} inceleme` : ""}
              </p>
            ) : null}
          </div>
        ) : (
          <span className="text-[11px] text-text-faint">Henüz il bazlı taranmadı</span>
        )}
        {syncState.error ? <p className="mt-1 text-[10px] text-danger-500">{syncState.error}</p> : null}
        {syncState.message ? <p className="mt-1 text-[10px] text-emerald-700">{syncState.message}</p> : null}
      </div>
      {!province.is_active ? (
        <span className="rounded-full bg-danger-500/10 px-2 py-1 text-[11px] font-bold text-danger-500">Pasif</span>
      ) : (
        <span />
      )}
      <button type="button" aria-label={`${province.name} ilini düzenle`} onClick={() => setEditing(true)} className="focus-ring grid h-8 w-8 place-items-center rounded-[9px] text-text-muted hover:bg-canvas">
        <Pencil className="h-3.5 w-3.5" />
      </button>
      <form action={syncAction}>
        <input type="hidden" name="province_id" value={province.id} />
        <button
          type="submit"
          disabled={!province.syncAvailable || !province.is_active || activeSync || syncPending}
          className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-[9px] border border-brand-400/40 bg-brand-600/[0.04] px-3 py-1.5 text-xs font-semibold text-brand-700 transition hover:bg-brand-600/[0.08] disabled:cursor-not-allowed disabled:opacity-50"
          title={!province.syncAvailable ? "Tarama altyapısı henüz etkin değil" : "Seçilen ili öne alır ve diğer il taramalarını bekletir"}
        >
          {syncPending || syncStatus === "running" ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          {syncPending ? "Kuyruğa alınıyor" : activeSync ? status?.label : "Tara ve tamamla"}
        </button>
      </form>
      <Link
        href={`/admin/geo/${province.id}`}
        className="inline-flex items-center gap-1 rounded-[9px] border border-line px-3 py-1.5 text-xs font-semibold text-ink-950 transition hover:border-brand-400 hover:text-brand-600"
      >
        İlçeler <ChevronRight className="h-3.5 w-3.5" />
      </Link>
    </div>
  );
}
