"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createSitePage } from "@/app/actions/site-pages";

type TemplateView = { id: string; label: string; description: string; slug: string };

/** "+ Yeni sayfa": şablon galerisi (şablonlar örnek blok ve metinlerle dolu gelir) + yol seçimi; sayfa taslak açılır. */
export function NewPageGallery({ templates, full }: { templates: TemplateView[]; full: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<TemplateView | null>(null);
  const [slug, setSlug] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const slugId = useId();

  const pick = (t: TemplateView) => {
    setPicked(t);
    setSlug(t.slug);
    setError(null);
  };

  const create = () => {
    if (!picked) return;
    setError(null);
    start(async () => {
      const res = await createSitePage(picked.id, slug);
      if (res.error || !res.id) {
        setError(res.error ?? "Sayfa açılamadı.");
        return;
      }
      router.push(`/admin/site/sayfalar/${res.id}${res.notice ? "?uyari=yonlendirme" : ""}`);
    });
  };

  if (!open) {
    return (
      <Button type="button" onClick={() => setOpen(true)} disabled={full} title={full ? "En çok 50 sayfa açılabilir" : undefined}>
        <Plus className="h-4 w-4" aria-hidden="true" /> Yeni sayfa
      </Button>
    );
  }

  return (
    <div role="dialog" aria-label="Yeni sayfa: şablon seçin" className="w-full rounded-[var(--radius-panel)] border border-brand-400 bg-surface p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="font-display text-base font-extrabold text-ink-950">Şablon seçin</p>
        <Button type="button" variant="ghost" size="icon" aria-label="Kapat" onClick={() => setOpen(false)}>
          <X className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {templates.map((t) => (
          <li key={t.id}>
            <Button
              type="button"
              variant="outline"
              aria-pressed={picked?.id === t.id}
              onClick={() => pick(t)}
              className={`h-full min-h-11 w-full flex-col items-start gap-1 whitespace-normal p-3 text-left ${picked?.id === t.id ? "border-brand-600 bg-brand-600/8" : ""}`}
            >
              <span className="font-semibold text-ink-950">{t.label}</span>
              <span className="text-xs font-normal text-text-muted">{t.description}</span>
            </Button>
          </li>
        ))}
      </ul>
      {picked ? (
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-1">
            <label htmlFor={slugId} className="mb-1 block text-xs font-semibold text-ink-950">Sayfa yolu</label>
            <div className="flex items-center gap-1">
              <span className="text-sm text-text-muted">/</span>
              <Input id={slugId} value={slug} maxLength={80} onChange={(e) => setSlug(e.target.value)} aria-describedby={`${slugId}-h`} />
            </div>
            <span id={`${slugId}-h`} className="mt-1 block text-xs text-text-faint">Küçük harf, rakam ve tire; en çok 3 bölüm (ör. kampanya/istanbul). Sistem yolları (admin, giris, vitrin...) kullanılamaz.</span>
          </div>
          <Button type="button" onClick={create} loading={pending} disabled={!slug.trim()}>
            Taslağı oluştur
          </Button>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="mt-3 rounded-[var(--radius-control)] bg-danger-500/8 px-3 py-2 text-sm font-medium text-danger-600">{error}</p>
      ) : null}
    </div>
  );
}
