"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Tags, Trash2 } from "lucide-react";
import { BulkBar } from "@/components/ui/list-kit";
import { Button } from "@/components/ui/button";
import { InlineSelect } from "@/components/ui/inline-select";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useBulkSelection } from "@/components/app/bulk-selection";
import { useToast } from "@/components/app/toast-provider";
import { bulkDeleteExpenses, bulkSetExpenseCategory } from "@/app/actions/expenses";

/** Gider listesi toplu işlemleri: kategori değiştir, sil (onaylı). */
export function ExpenseBulkBar({
  categories,
  canEdit,
  canDelete,
}: {
  categories: readonly { value: string; label: string }[];
  canEdit: boolean;
  canDelete: boolean;
}) {
  const { selected, clear } = useBulkSelection();
  const router = useRouter();
  const { push } = useToast();
  const [pending, startTransition] = useTransition();
  const [category, setCategory] = useState("");
  if (selected.size === 0) return null;
  const ids = [...selected];

  return (
    <BulkBar count={selected.size} noun="gider" onClear={clear}>
      {canEdit ? (
        <>
          <InlineSelect
            plain
            value={category}
            onValueChange={setCategory}
            label="Yeni kategori"
            options={[{ value: "", label: "Kategori seç…" }, ...categories]}
          />
          <Button
            size="sm"
            variant="secondary"
            loading={pending}
            disabled={!category}
            onClick={() =>
              startTransition(async () => {
                const res = await bulkSetExpenseCategory(ids, category);
                if (res.error) return push(res.error, "err");
                push(`${res.count ?? 0} giderin kategorisi değişti`, "ok");
                clear();
                router.refresh();
              })
            }
          >
            <Tags className="h-3.5 w-3.5" /> Uygula
          </Button>
        </>
      ) : null}
      {canDelete ? (
        <ConfirmDialog
          title={`${ids.length} gider kalıcı silinsin mi?`}
          description="Seçili gider kayıtları kalıcı olarak silinir. Bu işlem geri alınamaz."
          confirmLabel="Kalıcı sil"
          onConfirm={async () => {
            const res = await bulkDeleteExpenses(ids);
            if (res.error) return push(res.error, "err");
            push(`${res.count ?? 0} gider silindi`, "ok");
            clear();
            router.refresh();
          }}
          trigger={
            <Button size="sm" variant="danger">
              <Trash2 className="h-3.5 w-3.5" /> Sil
            </Button>
          }
        />
      ) : null}
    </BulkBar>
  );
}
