"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { deleteNeighborhoodNote } from "@/app/actions/neighborhood-notes";

/** İki adımlı silme (satır içi onay; popup yok). Silme yumuşaktır, kayıt DB'de deleted_at ile işaretlenir. */
export function DeleteNoteButton({ id }: { id: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="focus-ring press inline-flex items-center gap-1 text-xs font-semibold text-text-muted transition hover:text-danger-600"
      >
        <Trash2 className="h-3.5 w-3.5" aria-hidden /> Sil
      </button>
    );
  }
  return (
    <span className="inline-flex items-center gap-2 text-xs">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const res = await deleteNeighborhoodNote(id);
            if (!res.ok) {
              setError(res.error);
              return;
            }
            router.refresh();
          })
        }
        className="focus-ring press font-semibold text-danger-600"
      >
        {pending ? "Siliniyor…" : "Evet, sil"}
      </button>
      <button type="button" onClick={() => setConfirming(false)} className="focus-ring press text-text-muted">
        Vazgeç
      </button>
      {error ? <span role="alert" className="text-danger-600">{error}</span> : null}
    </span>
  );
}
