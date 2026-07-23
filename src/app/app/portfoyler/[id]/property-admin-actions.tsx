"use client";

import { useState } from "react";
import { Trash2, UserRoundCog } from "lucide-react";
import { deleteProperty, reassignProperty } from "@/app/actions/properties";

export function DeletePropertyButton({ propertyId }: { propertyId: string }) {
  const [confirming, setConfirming] = useState(false);

  if (confirming) {
    return (
      <div className="inline-flex items-center gap-2 rounded-[10px] border border-danger-500/30 bg-danger-500/10 px-3 py-1.5">
        <span className="text-xs font-semibold text-danger-100">Arşivlensin mi?</span>
        <form action={deleteProperty}>
          <input type="hidden" name="id" value={propertyId} />
          <input type="hidden" name="redirect_to" value="/app/portfoyler" />
          <button type="submit" className="rounded-[8px] bg-danger-500 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-danger-600">
            Evet, arşivle
          </button>
        </form>
        <button type="button" onClick={() => setConfirming(false)} className="rounded-[8px] px-2 py-1 text-[11px] font-semibold text-white/70 hover:text-white">
          Vazgeç
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setConfirming(true)}
      className="inline-flex items-center gap-1.5 rounded-[10px] border border-white/15 bg-white/5 px-3.5 py-2 text-sm font-semibold text-white/80 transition hover:border-danger-500/40 hover:bg-danger-500/10 hover:text-danger-300"
    >
      <Trash2 className="h-4 w-4" /> Arşivle
    </button>
  );
}

export function ReassignProperty({
  propertyId,
  currentAssignee,
  members,
}: {
  propertyId: string;
  currentAssignee: string | null;
  members: { id: string; full_name: string }[];
}) {
  return (
    <form action={reassignProperty} className="flex items-center gap-1.5">
      <input type="hidden" name="id" value={propertyId} />
      <UserRoundCog className="h-3.5 w-3.5 text-white/50" />
      <select
        name="assigned_to"
        defaultValue={currentAssignee ?? ""}
        className="rounded-[8px] border border-white/15 bg-white/5 px-2 py-1 text-xs font-semibold text-white outline-none [color-scheme:dark]"
      >
        <option value="">Atanmadı</option>
        {members.map((m) => (
          <option key={m.id} value={m.id}>{m.full_name}</option>
        ))}
      </select>
      <button type="submit" className="rounded-[8px] bg-white/10 px-2 py-1 text-[11px] font-bold text-white hover:bg-white/20">
        Ata
      </button>
    </form>
  );
}
