"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Building2, Check, Pencil, Trash2, X } from "lucide-react";
import { updateBranch, deleteBranch } from "@/app/actions/team";
import { useToast } from "@/components/app/toast-provider";

type Province = { id: string; name: string };

export function BranchCard({
  branch,
  memberCount,
  provinceName,
  provinces,
  canManage,
}: {
  branch: { id: string; name: string; province_id?: string | null };
  memberCount: number;
  provinceName: string | null;
  provinces: Province[];
  canManage: boolean;
}) {
  const router = useRouter();
  const { push } = useToast();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  function save(formData: FormData) {
    startTransition(async () => {
      const res = await updateBranch(formData);
      if (res.error) push(res.error, "err");
      else {
        push("Şube güncellendi", "ok");
        setEditing(false);
        router.refresh();
      }
    });
  }

  function remove() {
    startTransition(async () => {
      const fd = new FormData();
      fd.set("id", branch.id);
      const res = await deleteBranch(fd);
      if (res.error) push(res.error, "err");
      else {
        push("Şube silindi", "ok");
        router.refresh();
      }
    });
  }

  if (editing) {
    return (
      <form action={save} className="rounded-[14px] border border-brand-300 bg-canvas/60 p-4">
        <input type="hidden" name="id" value={branch.id} />
        <input
          name="name"
          defaultValue={branch.name}
          required
          className="w-full rounded-[9px] border border-line bg-surface px-2.5 py-2 text-sm font-semibold outline-none focus:border-brand-400"
          placeholder="Şube adı"
        />
        <select
          name="province_id"
          defaultValue={branch.province_id ?? ""}
          className="mt-2 w-full rounded-[9px] border border-line bg-surface px-2.5 py-2 text-xs outline-none focus:border-brand-400"
        >
          <option value="">İl seçilmedi</option>
          {provinces.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <div className="mt-3 flex justify-end gap-1.5">
          <button type="button" onClick={() => setEditing(false)} className="rounded-[9px] border border-line px-2.5 py-1.5 text-xs font-semibold text-text-muted hover:bg-canvas">
            Vazgeç
          </button>
          <button type="submit" disabled={pending} className="inline-flex items-center gap-1 rounded-[9px] bg-brand-600 px-2.5 py-1.5 text-xs font-semibold text-white disabled:opacity-60">
            <Check className="h-3.5 w-3.5" /> Kaydet
          </button>
        </div>
      </form>
    );
  }

  return (
    <div className="rounded-[14px] border border-line bg-canvas/60 p-4">
      <div className="flex items-center justify-between">
        <span className="grid h-9 w-9 place-items-center rounded-[11px] bg-brand-600/10 text-brand-600"><Building2 className="h-4 w-4" /></span>
        <span className="rounded-full bg-mint-500/10 px-2 py-0.5 text-[10px] font-bold text-mint-600">{memberCount} üye</span>
      </div>
      <p className="mt-3 font-display font-bold text-ink-950">{branch.name}</p>
      <p className="text-xs text-text-muted">{provinceName ?? "Konum belirtilmedi"}</p>
      {canManage ? (
        <div className="mt-3 flex items-center gap-1.5">
          <button type="button" onClick={() => setEditing(true)} className="inline-flex items-center gap-1 rounded-[8px] border border-line px-2 py-1 text-[11px] font-semibold text-text-muted transition hover:border-brand-300 hover:text-brand-600">
            <Pencil className="h-3 w-3" /> Düzenle
          </button>
          {confirming ? (
            <span className="flex items-center gap-1">
              <button type="button" disabled={pending} onClick={remove} className="rounded-[8px] bg-danger-500 px-2 py-1 text-[11px] font-bold text-white hover:bg-danger-600 disabled:opacity-60">
                Sil
              </button>
              <button type="button" aria-label="Vazgeç" onClick={() => setConfirming(false)} className="rounded-[8px] px-1.5 py-1 text-[11px] font-semibold text-text-muted hover:text-ink-950">
                <X className="h-3 w-3" />
              </button>
            </span>
          ) : (
            <button type="button" onClick={() => setConfirming(true)} className="inline-flex items-center gap-1 rounded-[8px] border border-line px-2 py-1 text-[11px] font-semibold text-text-muted transition hover:border-danger-500/40 hover:text-danger-500">
              <Trash2 className="h-3 w-3" /> Sil
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}
