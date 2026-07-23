"use client";

import { useActionState, useRef } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { createDistrict, type GeoActionResult } from "@/app/actions/geo-admin";

const initial: GeoActionResult = {};

export function NewDistrictForm({ provinceId }: { provinceId: string }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);

  const [state, action, pending] = useActionState(async (_prev: GeoActionResult, formData: FormData) => {
    const result = await createDistrict(formData);
    if (result.ok) {
      formRef.current?.reset();
      router.refresh();
    }
    return result;
  }, initial);

  return (
    <form ref={formRef} action={action} className="flex flex-wrap items-center gap-2 border-b border-line bg-canvas/50 px-5 py-3.5">
      <input type="hidden" name="province_id" value={provinceId} />
      <input
        name="name"
        required
        placeholder="Yeni ilçe adı…"
        className="flex-1 min-w-[160px] rounded-[9px] border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-brand-400"
      />
      <input
        name="lat"
        placeholder="Enlem (ops.)"
        className="w-28 rounded-[9px] border border-line bg-surface px-3 py-2 text-xs outline-none focus:border-brand-400"
      />
      <input
        name="lng"
        placeholder="Boylam (ops.)"
        className="w-28 rounded-[9px] border border-line bg-surface px-3 py-2 text-xs outline-none focus:border-brand-400"
      />
      <button
        type="submit"
        disabled={pending}
        className="inline-flex items-center gap-1.5 rounded-[9px] bg-brand-600 px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-brand-700 disabled:opacity-60"
      >
        <Plus className="h-3.5 w-3.5" /> {pending ? "Ekleniyor…" : "İlçe ekle"}
      </button>
      {state.error ? <p className="w-full text-xs text-danger-500">{state.error}</p> : null}
    </form>
  );
}
