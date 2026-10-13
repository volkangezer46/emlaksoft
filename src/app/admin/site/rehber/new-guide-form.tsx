"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";
import { createGuide } from "@/app/actions/site-guides";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { GUIDE_CATEGORIES, GUIDE_CATEGORY_LABEL, GUIDE_LIMITS, type GuideCategory } from "@/lib/guides/defaults";
import { toGuideSlug } from "@/lib/guides/slug";

/** "+ Yeni yazı": başlık ve kategori; yol başlıktan önerilir (Türkçe harf dönüşümü). Yazı taslak olarak açılır. */
export function NewGuideForm({ full }: { full: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<GuideCategory>(GUIDE_CATEGORIES[0]);
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const ids = { title: useId(), category: useId(), slug: useId() };
  const shownSlug = slugTouched ? slug : toGuideSlug(title);

  const create = () => {
    setError(null);
    start(async () => {
      const res = await createGuide(title, category, shownSlug);
      if (res.error || !res.id) {
        setError(res.error ?? "Yazı açılamadı.");
        return;
      }
      router.push(`/admin/site/rehber/${res.id}`);
    });
  };

  if (!open) {
    return (
      <Button type="button" onClick={() => setOpen(true)} disabled={full} title={full ? `En çok ${GUIDE_LIMITS.maxGuides} yazı açılabilir` : undefined}>
        <Plus className="h-4 w-4" aria-hidden="true" /> Yeni yazı
      </Button>
    );
  }

  return (
    <div role="dialog" aria-label="Yeni rehber yazısı" className="w-full rounded-[var(--radius-panel)] border border-brand-400 bg-surface p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="font-display text-base font-extrabold text-ink-950">Yeni yazı</p>
        <Button type="button" variant="ghost" size="icon" aria-label="Kapat" onClick={() => setOpen(false)}>
          <X className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-[1fr_14rem]">
        <div>
          <label htmlFor={ids.title} className="mb-1 block text-xs font-semibold text-ink-950">Başlık</label>
          <Input id={ids.title} value={title} maxLength={GUIDE_LIMITS.title} onChange={(e) => setTitle(e.target.value)} placeholder="Ör. Emlak komisyonu nasıl hesaplanır?" />
        </div>
        <div>
          <label htmlFor={ids.category} className="mb-1 block text-xs font-semibold text-ink-950">Kategori</label>
          <select id={ids.category} value={category} onChange={(e) => setCategory(e.target.value as GuideCategory)} className="h-11 w-full rounded-[var(--radius-control)] border border-line bg-surface px-2 text-sm">
            {GUIDE_CATEGORIES.map((k) => (
              <option key={k} value={k}>{GUIDE_CATEGORY_LABEL[k]}</option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label htmlFor={ids.slug} className="mb-1 block text-xs font-semibold text-ink-950">Yol</label>
          <div className="flex items-center gap-1">
            <span className="shrink-0 text-sm text-text-muted">/rehber/</span>
            <Input
              id={ids.slug}
              value={shownSlug}
              maxLength={GUIDE_LIMITS.slug}
              onChange={(e) => {
                setSlugTouched(true);
                setSlug(e.target.value);
              }}
              aria-describedby={`${ids.slug}-h`}
            />
          </div>
          <span id={`${ids.slug}-h`} className="mt-1 block text-xs text-text-faint">Türkçe harfler sadeleşir (ş→s, ı→i); sistem yolları (admin, api, giris, kayit) kullanılamaz.</span>
        </div>
      </div>
      <div className="mt-4 flex items-center gap-2">
        <Button type="button" onClick={create} loading={pending} disabled={!title.trim()}>
          Taslağı oluştur
        </Button>
      </div>
      {error ? (
        <p role="alert" className="mt-3 rounded-[var(--radius-control)] bg-danger-500/8 px-3 py-2 text-sm font-medium text-danger-600">{error}</p>
      ) : null}
    </div>
  );
}
