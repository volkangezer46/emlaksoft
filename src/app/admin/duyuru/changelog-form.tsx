"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormField, FormInput, FormSelect, FormTextarea } from "@/components/ui/form-controls";
import { deleteChangelogEntry, saveChangelogEntry } from "@/app/actions/platform-notifications";

export type ChangelogInit = { id: string; title: string; body: string | null; category: string; href: string | null; publishedLocal: string; draft: boolean };

/** Yenilik girdisi formu: yayınlanınca ofis panelindeki "Yenilikler" çekmecesinde okunmamış rozeti oluşur. */
export function ChangelogForm({ init }: { init?: ChangelogInit }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      id="yenilik-formu"
      onSubmit={(e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const fd = new FormData(form);
        setError(null);
        start(async () => {
          const r = await saveChangelogEntry(fd);
          if (r.error) {
            setError(r.error);
            return;
          }
          if (!init) form.reset();
          router.push("/admin/duyuru?sekme=yenilikler");
          router.refresh();
        });
      }}
      className="space-y-4 rounded-[var(--radius-panel)] border border-line bg-surface p-5"
    >
      <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
        <Sparkles className="h-4 w-4 text-brand-600" /> {init ? "Yeniliği düzenle" : "Yeni girdi"}
      </h2>
      {init ? <input type="hidden" name="id" value={init.id} /> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Başlık" htmlFor="cl-title" required className="sm:col-span-2">
          <FormInput id="cl-title" name="title" required maxLength={140} defaultValue={init?.title} placeholder="Örn. Portföylere toplu fiyat güncelleme geldi" />
        </FormField>
        <FormField label="Açıklama" htmlFor="cl-body" className="sm:col-span-2">
          <FormTextarea id="cl-body" name="body" rows={4} maxLength={4000} defaultValue={init?.body ?? ""} />
        </FormField>
        <FormField label="Kategori" htmlFor="cl-category">
          <FormSelect id="cl-category" name="category" defaultValue={init?.category ?? "yeni"}>
            <option value="yeni">Yeni</option>
            <option value="iyilestirme">İyileştirme</option>
            <option value="duzeltme">Düzeltme</option>
          </FormSelect>
        </FormField>
        <FormField label="Bağlantı (isteğe bağlı)" htmlFor="cl-href" hint="/app/... ya da https://">
          <FormInput id="cl-href" name="href" maxLength={500} defaultValue={init?.href ?? ""} placeholder="/app/portfoyler" />
        </FormField>
        <FormField label="Yayın zamanı" htmlFor="cl-published" hint="Boş: hemen (Türkiye saati)">
          <FormInput id="cl-published" name="published_at" type="datetime-local" defaultValue={init?.publishedLocal} />
        </FormField>
        <label className="flex min-h-11 cursor-pointer items-center gap-2 self-end text-sm text-ink-950">
          <input type="checkbox" name="draft" defaultChecked={init?.draft ?? false} className="h-4 w-4 accent-[var(--brand-600)]" />
          Taslak (ofislerde görünmez)
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" variant="navy" size="md" disabled={pending}>
          {pending ? "Kaydediliyor…" : init ? "Kaydet" : "Yayınla"}
        </Button>
        {error ? <span role="alert" className="text-sm font-semibold text-danger-600">{error}</span> : null}
      </div>
    </form>
  );
}

export function ChangelogDelete({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!confirm) {
    return (
      <Button type="button" variant="outline" size="sm" className="text-danger-600" onClick={() => setConfirm(true)}>
        <Trash2 className="h-3.5 w-3.5" /> Sil
      </Button>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-2 text-xs">
      <Button
        type="button"
        variant="danger"
        size="sm"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const fd = new FormData();
            fd.set("id", id);
            const r = await deleteChangelogEntry(fd);
            if (r.error) setError(r.error);
            else router.refresh();
          })
        }
      >
        {pending ? "Siliniyor…" : "Evet, sil"}
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={() => setConfirm(false)}>
        Vazgeç
      </Button>
      {error ? <span role="alert" className="font-semibold text-danger-600">{error}</span> : null}
    </span>
  );
}
