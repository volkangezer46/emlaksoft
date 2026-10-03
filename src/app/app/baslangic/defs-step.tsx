"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { addDefinition } from "@/app/actions/definitions";

const inputCls =
  "focus-ring w-full rounded-[var(--radius-control)] border border-line bg-surface px-3 py-2 text-sm text-text";

/** Tanımlar adımı: tek satırda yeni kayıp nedeni ekler (mevcut `addDefinition`; ofise özel tanım). */
export function QuickLossReason({ canEdit }: { canEdit: boolean }) {
  const router = useRouter();
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  if (!canEdit) return null;

  function add() {
    setError(null);
    const fd = new FormData();
    fd.set("category", "loss_reason");
    fd.set("label", label);
    startTransition(async () => {
      const res = await addDefinition({}, fd);
      if (res.error) return setError(res.error);
      setLabel("");
      router.refresh();
    });
  }

  return (
    <div>
      <div className="flex gap-2">
        <input
          aria-label="Yeni kayıp nedeni"
          placeholder="Yeni kayıp nedeni (ör. Banka kredisi onaylanmadı)"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && label.trim()) {
              e.preventDefault();
              add();
            }
          }}
          className={inputCls}
        />
        <Button type="button" variant="secondary" icon={Plus} loading={pending} disabled={!label.trim()} onClick={add}>
          Ekle
        </Button>
      </div>
      {error ? <p className="mt-1 text-xs font-semibold text-danger-500">{error}</p> : null}
    </div>
  );
}
