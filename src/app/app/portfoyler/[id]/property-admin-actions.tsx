"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2, UserRoundCog } from "lucide-react";
import { deleteProperty, reassignProperty } from "@/app/actions/properties";
import { useUndoDelete } from "@/components/app/record-ops-buttons";

export function DeletePropertyButton({ propertyId }: { propertyId: string }) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const undo = useUndoDelete();

  async function archive(fd: FormData) {
    const r = await deleteProperty(fd);
    if (r && r.error) {
      setError(r.error);
      setConfirming(false);
      return;
    }
    // Başarılı: listeye dön + "Silindi · Geri al" (çöp kutusu; 8 sn içinde tek tıkla geri alınır).
    undo("property", propertyId, "Portföy arşivlendi ve çöp kutusuna taşındı");
    router.push("/app/portfoyler");
  }

  if (confirming) {
    return (
      <div className="inline-flex items-center gap-2 rounded-[var(--radius-control)] border border-danger-500/30 bg-danger-500/10 px-3 py-1.5">
        <span className="text-xs font-semibold text-danger-100">Arşivlensin mi?</span>
        <form action={archive}>
          <input type="hidden" name="id" value={propertyId} />
          <button type="submit" className="rounded-[var(--radius-control)] bg-danger-500 px-2.5 py-1 text-xs font-bold text-white hover:bg-danger-600">
            Evet, arşivle
          </button>
        </form>
        <button type="button" onClick={() => setConfirming(false)} className="rounded-[var(--radius-control)] px-2 py-1 text-xs font-semibold text-white/70 hover:text-white">
          Vazgeç
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-start gap-1.5">
      <button
        type="button"
        onClick={() => {
          setError(null);
          setConfirming(true);
        }}
        className="inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border border-white/15 bg-white/5 px-3.5 py-2 text-sm font-semibold text-white/80 transition hover:border-danger-500/40 hover:bg-danger-500/10 hover:text-danger-300"
      >
        <Trash2 className="h-4 w-4" /> Arşivle
      </button>
      {error ? (
        <p role="alert" className="max-w-xs text-xs font-semibold text-danger-300">
          {error}
        </p>
      ) : null}
    </div>
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
        className="rounded-[var(--radius-control)] border border-white/15 bg-white/5 px-2 py-1 text-xs font-semibold text-white outline-none [color-scheme:dark]"
      >
        <option value="">Atanmadı</option>
        {members.map((m) => (
          <option key={m.id} value={m.id}>{m.full_name}</option>
        ))}
      </select>
      <button type="submit" className="rounded-[var(--radius-control)] bg-white/10 px-2 py-1 text-xs font-bold text-white hover:bg-white/20">
        Ata
      </button>
    </form>
  );
}
