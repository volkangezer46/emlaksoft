"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Pencil, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/app/toast-provider";
import { deleteCustomerTagEverywhere, renameCustomerTag } from "@/app/actions/customer-tags";

export function TagManager({ tags, canEdit }: { tags: { tag: string; count: number }[]; canEdit: boolean }) {
  const router = useRouter();
  const { push } = useToast();
  const [editing, setEditing] = useState<string | null>(null);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (tags.length === 0) {
    return (
      <p className="rounded-[var(--radius-card)] border border-dashed border-line-strong px-4 py-10 text-center text-sm text-text-muted">
        Henüz etiket yok. Müşteri kartından ya da toplu işlemle etiket eklediğinizde burada listelenir.
      </p>
    );
  }

  function save(from: string) {
    setError(null);
    startTransition(async () => {
      const res = await renameCustomerTag(from, value);
      if (res.error) {
        setError(res.error);
        if ((res.affected ?? 0) > 0) router.refresh();
        return;
      }
      push(res.message ?? `${res.affected ?? 0} müşteride güncellendi`, "ok");
      setEditing(null);
      router.refresh();
    });
  }

  return (
    <section className="surface-card rounded-[var(--radius-panel)] p-4 md:p-6">
      {pending ? (
        <p role="status" className="mb-3 text-sm text-text-muted">
          Müşteri kayıtları parça parça güncelleniyor, lütfen sayfayı kapatmayın…
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mb-3 text-sm font-semibold text-danger-500">
          {error}
        </p>
      ) : null}
      <ul className="divide-y divide-line/60">
        {tags.map(({ tag, count }) => (
          <li key={tag} className="flex flex-wrap items-center justify-between gap-3 py-3">
            {editing === tag ? (
              <form
                className="flex flex-wrap items-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  save(tag);
                }}
              >
                <input
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  maxLength={30}
                  aria-label={`${tag} için yeni ad`}
                  className="rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-brand-400"
                />
                <Button type="submit" size="sm" loading={pending} disabled={!value.trim()}>
                  <Check className="h-3.5 w-3.5" /> Kaydet
                </Button>
                <Button type="button" size="sm" variant="secondary" onClick={() => setEditing(null)}>
                  <X className="h-3.5 w-3.5" /> Vazgeç
                </Button>
                <span className="text-xs text-text-faint">Var olan bir etiketin adını yazarsanız ikisi birleşir.</span>
              </form>
            ) : (
              <>
                <div className="flex items-center gap-3">
                  <span className="rounded-full bg-brand-600/10 px-2.5 py-1 text-sm font-semibold text-brand-700">{tag}</span>
                  <Link
                    href={`/app/musteriler?etiket=${encodeURIComponent(tag)}`}
                    className="focus-ring text-xs font-semibold text-text-muted hover:text-brand-600 hover:underline"
                  >
                    {count} müşteri
                  </Link>
                </div>
                {canEdit ? (
                  <div className="flex items-center gap-1.5">
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        setEditing(tag);
                        setValue(tag);
                        setError(null);
                      }}
                    >
                      <Pencil className="h-3.5 w-3.5" /> Yeniden adlandır
                    </Button>
                    <ConfirmDialog
                      trigger={
                        <Button type="button" size="sm" variant="danger" aria-label={`${tag} etiketini kaldır`}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      }
                      title={`"${tag}" etiketi kaldırılsın mı?`}
                      description={`Etiket ${count} müşteriden çıkarılır. Müşteriler silinmez; bu işlem geri alınamaz.`}
                      confirmLabel="Kaldır"
                      onConfirm={async () => {
                        const res = await deleteCustomerTagEverywhere(tag);
                        if (res.error) {
                          setError(res.error);
                          if ((res.affected ?? 0) > 0) router.refresh();
                        } else {
                          push(`${res.affected ?? 0} müşteriden kaldırıldı`, "ok");
                          router.refresh();
                        }
                      }}
                    />
                  </div>
                ) : null}
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
