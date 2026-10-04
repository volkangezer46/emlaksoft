"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { GeoSelect } from "@/components/app/geo-select";
import type { GeoOption } from "@/app/actions/geo";
import { createNeighborhoodNote } from "@/app/actions/neighborhood-notes";
import { Button } from "@/components/ui/button";
import { NOTE_TAGS as TAGS } from "@/lib/neighborhood-notes/notes";
import { FormError, FormField, FormTextarea } from "@/components/ui/form-controls";


export function NeighborhoodNoteForm({
  provinces,
  defaultProvinceId,
  defaultDistrictId,
  defaultNeighborhoodId,
}: {
  provinces: GeoOption[];
  defaultProvinceId?: string | null;
  defaultDistrictId?: string | null;
  defaultNeighborhoodId?: string | null;
}) {
  const router = useRouter();
  const [neighborhoodId, setNeighborhoodId] = useState(defaultNeighborhoodId ?? "");
  const [tags, setTags] = useState<string[]>([]);
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  function toggle(tag: string) {
    setTags((cur) => (cur.includes(tag) ? cur.filter((t) => t !== tag) : [...cur, tag]));
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const res = await createNeighborhoodNote({ neighborhoodId, tags, body });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setBody("");
      setTags([]);
      setSaved(true);
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4" aria-label="Yeni mahalle notu">
      <GeoSelect
        provinces={provinces}
        defaultProvinceId={defaultProvinceId}
        defaultDistrictId={defaultDistrictId}
        defaultNeighborhoodId={defaultNeighborhoodId}
        onSelectionChange={(sel) => setNeighborhoodId(sel.neighborhood_id)}
        className="grid gap-3 sm:grid-cols-3"
      />
      <fieldset>
        <legend className="mb-1.5 text-sm font-medium text-ink-950">Etiketler</legend>
        <div className="flex flex-wrap gap-2">
          {TAGS.map((t) => {
            const on = tags.includes(t.value);
            return (
              <button
                key={t.value}
                type="button"
                aria-pressed={on}
                onClick={() => toggle(t.value)}
                className={`focus-ring press rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                  on ? "border-brand-400 bg-brand-600/10 text-brand-700" : "border-line text-text-muted hover:border-brand-300"
                }`}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      </fieldset>
      <FormField label="Saha notu" htmlFor="mahalle-not-govde" required hint="Yalnız ofis içinde görünür; vitrin ve portallara çıkmaz. Kişisel veri yazmayın.">
        <FormTextarea
          id="mahalle-not-govde"
          rows={4}
          maxLength={2000}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Örn. Metroya 6 dk yürüme; ana cadde akşamları gürültülü; ilkokul 400 m."
        />
      </FormField>
      <FormError error={error} />
      {saved ? <p role="status" className="text-xs font-medium text-mint-600">Not kaydedildi.</p> : null}
      <Button type="submit" disabled={pending || !neighborhoodId || body.trim().length < 3}>
        <Plus className="h-4 w-4" /> {pending ? "Kaydediliyor…" : "Notu kaydet"}
      </Button>
      {!neighborhoodId ? <p className="text-xs text-text-muted">Kaydetmek için il, ilçe ve mahalle seçin.</p> : null}
    </form>
  );
}
