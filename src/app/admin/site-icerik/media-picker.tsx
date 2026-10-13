"use client";

import { useId, useState, useTransition } from "react";
import Link from "@/components/ui/smart-link";
import { AlertTriangle, ImageIcon, ImagePlus, Loader2, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Issue } from "@/lib/site-menu/schema-core";
import type { SiteContent } from "@/lib/site-content/schema";
import { kb, SITE_MEDIA_LIMITS } from "@/lib/site-media/quota";
import { ACCEPT_IMAGES, postSiteMedia } from "../site/medya/upload-client";
import { Card, Full } from "./editor-fields";
import { toPickerMedia, type MediaLibraryState, type PickerMedia } from "./media-view";

export type { MediaLibraryState, PickerMedia } from "./media-view";

type HeroImage = SiteContent["hero"]["image"];

/**
 * Ana başlık görseli seçici: YALNIZ medya kütüphanesinden seçilir (serbest bağlantı yok). Boşsa ana sayfada bugünkü ürün
 * sahnesi kalır. Burada yüklenen görsel kütüphaneye eklenir ve seçilir. İlk ekran bütçesini aşan görselde uyarı; taslak
 * kaydında gerekçe istenir (site-content-editor kalite kapısı). Alt metin kütüphanede zorunludur; burada sayfaya özel
 * alt metin isteğe bağlıdır (boşsa kütüphanedeki kullanılır).
 */
export function MediaPicker({
  value,
  onChange,
  library,
  onUploaded,
  readOnly,
  issues,
}: {
  value: HeroImage;
  onChange: (next: HeroImage) => void;
  library: MediaLibraryState;
  onUploaded: (m: PickerMedia) => void;
  readOnly: boolean;
  issues: readonly Issue[];
}) {
  const altId = useId();
  const fileId = useId();
  const upAltId = useId();
  const [upAlt, setUpAlt] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [msg, setMsg] = useState<{ kind: "error" | "warn"; text: string } | null>(null);
  const [pending, start] = useTransition();
  const selected = value ? library.items.find((m) => m.id === value.mediaId) : undefined;
  const err = issues.find((i) => i.level === "error" && (i.path === "hero.image" || i.path === "hero.image.alt" || i.path.startsWith("hero.image.")));

  const upload = () => {
    if (!file) return setMsg({ kind: "error", text: "Dosya seçin." });
    if (file.size > SITE_MEDIA_LIMITS.inputBytes) return setMsg({ kind: "error", text: `Dosya en fazla ${kb(SITE_MEDIA_LIMITS.inputBytes)} olabilir.` });
    const form = new FormData();
    form.set("file", file);
    form.set("alt", upAlt);
    setMsg(null);
    start(async () => {
      const res = await postSiteMedia(form);
      if (res.error || !res.media) return setMsg({ kind: "error", text: res.error ?? "Yüklenemedi." });
      const m = toPickerMedia(res.media);
      onUploaded(m);
      onChange({ mediaId: m.id });
      setFile(null);
      setUpAlt("");
      if (res.warnings?.length) setMsg({ kind: "warn", text: res.warnings.join(" ") });
    });
  };

  return (
    <Card
      title="Ana başlık görseli"
      aside={<Link href="/admin/site/medya" className="text-xs font-semibold text-brand-700 underline">Medya kütüphanesi</Link>}
    >
      <Full>
        <div data-cms-field="hero.image" tabIndex={-1} className="focus-ring space-y-3 rounded-[var(--radius-card)]">
          {library.status !== "ok" ? (
            <p role="status" className="flex items-start gap-1.5 text-xs font-semibold text-amber-700">
              <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {library.status === "missing" ? "Medya kütüphanesi kurulum bekliyor; görsel eklenemez. Ana sayfa bugünkü ürün sahnesiyle çalışır." : "Medya kütüphanesi okunamadı."}
            </p>
          ) : null}
          <div className="flex flex-wrap items-start gap-3">
            <div className="flex h-24 w-40 shrink-0 items-center justify-center overflow-hidden rounded-[var(--radius-card)] border border-line bg-ink-950/5">
              {selected?.thumb ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={selected.thumb} alt={value?.alt ?? selected.alt} width={selected.w} height={selected.h} className="h-full w-full object-cover" />
              ) : value ? (
                <span className="px-2 text-center text-xs text-danger-500">Seçili görsel kütüphanede yok</span>
              ) : (
                <span className="flex flex-col items-center gap-1 px-2 text-center text-xs text-text-muted"><ImageIcon className="h-5 w-5" aria-hidden="true" />Görsel yok: bugünkü ürün sahnesi</span>
              )}
            </div>
            <div className="min-w-0 flex-1 space-y-2">
              {selected ? (
                <p className={`text-xs ${selected.heroOver ? "font-semibold text-amber-700" : "text-text-muted"}`}>
                  {selected.w}×{selected.h} px · ilk ekran {kb(selected.heroBytes)}
                  {selected.heroOver ? ` · bütçe (${kb(SITE_MEDIA_LIMITS.heroBudgetBytes)}) aşıldı; kayıtta gerekçe istenir` : ""}
                </p>
              ) : null}
              {value ? (
                <div>
                  <label htmlFor={altId} className="mb-1 block text-xs font-semibold text-ink-950">Bu sayfaya özel alt metin (boşsa kütüphanedeki: “{selected?.alt ?? "—"}”)</label>
                  <Input
                    id={altId}
                    data-cms-field="hero.image.alt"
                    value={value.alt ?? ""}
                    maxLength={SITE_MEDIA_LIMITS.altMax}
                    readOnly={readOnly}
                    onChange={(e) => {
                      const v = e.target.value;
                      // Boş alan = kütüphanedeki alt metin (alan kaldırılır; boş alt metin kaydedilemez).
                      onChange(v ? { mediaId: value.mediaId, alt: v } : { mediaId: value.mediaId });
                    }}
                  />
                </div>
              ) : null}
              {value && !readOnly ? (
                <Button type="button" variant="outline" size="sm" onClick={() => onChange(undefined)}>
                  <X className="h-3.5 w-3.5" aria-hidden="true" /> Görseli kaldır (ürün sahnesine dön)
                </Button>
              ) : null}
            </div>
          </div>
          {err ? (
            <p role="alert" className="flex items-start gap-1.5 text-xs font-semibold text-danger-500">
              <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {err.message}
            </p>
          ) : null}
          {library.items.length && !readOnly ? (
            <ul className="grid grid-cols-3 gap-2 sm:grid-cols-6" role="radiogroup" aria-label="Kütüphaneden seç">
              {library.items.map((m) => (
                <li key={m.id}>
                  <label
                    className={`block aspect-[16/10] w-full cursor-pointer overflow-hidden rounded-[var(--radius-control)] border-2 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand-500 ${value?.mediaId === m.id ? "border-brand-600" : "border-transparent hover:border-brand-300"}`}
                    title={m.alt}
                  >
                    <input
                      type="radio"
                      name={`${altId}-kutuphane`}
                      className="sr-only"
                      checked={value?.mediaId === m.id}
                      onChange={() => onChange(value?.alt ? { mediaId: m.id, alt: value.alt } : { mediaId: m.id })}
                    />
                    {m.thumb ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={m.thumb} alt={m.alt} width={m.w} height={m.h} loading="lazy" decoding="async" className="h-full w-full object-cover" />
                    ) : (
                      <span className="text-xs">{m.alt}</span>
                    )}
                  </label>
                </li>
              ))}
            </ul>
          ) : null}
          {!readOnly && library.status === "ok" ? (
            <div className="grid items-end gap-2 rounded-[var(--radius-card)] border border-dashed border-line p-3 sm:grid-cols-[1fr_1fr_auto]">
              <div>
                <label htmlFor={fileId} className="mb-1 block text-xs font-semibold text-ink-950">Yeni görsel yükle</label>
                <input id={fileId} type="file" accept={ACCEPT_IMAGES} onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="block w-full text-xs text-text-muted" />
              </div>
              <div>
                <label htmlFor={upAltId} className="mb-1 block text-xs font-semibold text-ink-950">Alt metin (zorunlu)</label>
                <Input id={upAltId} value={upAlt} maxLength={SITE_MEDIA_LIMITS.altMax} onChange={(e) => setUpAlt(e.target.value)} placeholder="Görselde ne var?" />
              </div>
              <Button type="button" size="sm" disabled={pending || !file || !upAlt.trim()} onClick={upload}>
                {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Upload className="h-3.5 w-3.5" aria-hidden="true" />} Yükle ve seç
              </Button>
            </div>
          ) : null}
          {msg ? (
            <p role={msg.kind === "error" ? "alert" : "status"} className={`flex items-start gap-1.5 text-xs font-semibold ${msg.kind === "error" ? "text-danger-500" : "text-amber-700"}`}>
              {msg.kind === "error" ? <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : <ImagePlus className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
              {msg.text}
            </p>
          ) : null}
        </div>
      </Full>
    </Card>
  );
}
