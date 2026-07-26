"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Save } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/button";
import { updateContract, type ContractResult } from "@/app/actions/contracts";

const init: ContractResult = {};

/** Taslak sözleşme düzenleme formu — kaydetmede önceki içerik sürümlenir. */
export function EditContractForm({ id, title, body }: { id: string; title: string; body: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await updateContract(init, fd);
      if (res.ok) router.push(`/app/sozlesmeler/${id}`);
      else setError(res.error ?? "Sözleşme güncellenemedi.");
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <input type="hidden" name="id" value={id} />

      <div>
        <label htmlFor="duzenle-title" className="mb-1.5 block text-sm font-semibold text-ink-950">
          Sözleşme başlığı
        </label>
        <input
          id="duzenle-title"
          name="title"
          type="text"
          required
          defaultValue={title}
          className="w-full rounded-[10px] border border-line bg-canvas px-3.5 py-2.5 text-sm text-ink-950 outline-none focus:border-brand-300"
        />
      </div>

      <div>
        <label htmlFor="duzenle-body" className="mb-1.5 block text-sm font-semibold text-ink-950">
          Sözleşme içeriği
        </label>
        <textarea
          id="duzenle-body"
          name="body"
          required
          rows={18}
          defaultValue={body}
          className="w-full resize-y rounded-[10px] border border-line bg-canvas px-3.5 py-2.5 font-mono text-xs leading-relaxed text-ink-950 outline-none focus:border-brand-300"
        />
      </div>

      {error ? (
        <p className="rounded-[8px] bg-danger-500/8 px-3 py-2 text-sm font-medium text-danger-600" role="alert">
          {error}
        </p>
      ) : null}

      <div className="flex justify-end gap-2">
        <ButtonLink href={`/app/sozlesmeler/${id}`} variant="secondary">
          Vazgeç
        </ButtonLink>
        <Button type="submit" loading={pending}>
          <Save className="h-4 w-4" /> Kaydet
        </Button>
      </div>
    </form>
  );
}
