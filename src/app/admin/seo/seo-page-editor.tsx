"use client";

import { useState } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { FormField, FormInput, FormSelect, FormTextarea } from "@/components/ui/form-controls";
import { resetSeoPage, saveSeoPage } from "@/app/actions/seo-admin";
import { canonicalUrl, type ChecklistItem } from "@/lib/seo/rules";
import { CHANGE_FREQS, JSON_LD_KINDS, type JsonLdKind, type SeoPageOverride } from "@/lib/seo/schema";
import { Checklist, LockedNote, SeoForm, SerpPreview, SocialPreview, SubmitButton } from "./seo-ui";

export type PageEditorData = {
  path: string;
  label: string;
  canIndex: boolean;
  defaults: { title: string | null; description: string | null; ogTitle: string | null; ogDescription: string | null; index: boolean; sitemapInclude: boolean; priority: number; freq: string; jsonLd: JsonLdKind[] };
  override: SeoPageOverride | null;
  checklist: ChecklistItem[];
};

export function PageEditor({
  data,
  titleTemplate,
  defaultTitle,
  defaultDescription,
  defaultOgImage,
  base,
  canSensitive,
}: {
  data: PageEditorData;
  titleTemplate: string;
  defaultTitle: string;
  defaultDescription: string;
  defaultOgImage: string;
  base: string;
  canSensitive: boolean;
}) {
  const ov = data.override ?? {};
  const d = data.defaults;
  const [title, setTitle] = useState(ov.title ?? "");
  const [description, setDescription] = useState(ov.description ?? "");
  const [ogTitle, setOgTitle] = useState(ov.ogTitle ?? "");
  const [ogDescription, setOgDescription] = useState(ov.ogDescription ?? "");
  const [ogImage, setOgImage] = useState(ov.ogImage ?? "");
  const [canonical, setCanonical] = useState(ov.canonical ?? "");

  const effTitleRaw = title || d.title || "";
  const renderedTitle = effTitleRaw ? (data.path === "/" && title ? title : titleTemplate.replace("%s", effTitleRaw)) : defaultTitle;
  const effDesc = description || d.description || defaultDescription;
  const effOgTitle = ogTitle || d.ogTitle || renderedTitle;
  const effOgDesc = ogDescription || d.ogDescription || effDesc;
  const effOgImage = ogImage || defaultOgImage || "/opengraph-image";
  let host = base;
  try {
    host = new URL(base).host;
  } catch {
    /* ham */
  }
  const kinds = new Set(ov.jsonLd ?? d.jsonLd);

  return (
    <Card id="editor">
      <CardHeader>
        <div>
          <CardTitle>{data.label}</CardTitle>
          <CardDescription>
            {data.path} · boş bıraktığınız alan varsayılan değere döner (placeholder’da görünür).
          </CardDescription>
        </div>
        <Link href="/admin/seo?sekme=sayfalar" aria-label="Editörü kapat" className="focus-ring rounded p-1 text-text-muted hover:text-ink-950">
          <X className="h-4 w-4" aria-hidden />
        </Link>
      </CardHeader>
      <CardContent className="grid gap-6 lg:grid-cols-2">
        <SeoForm action={saveSeoPage}>
          <input type="hidden" name="path" value={data.path} />
          <FormField label="Başlık" htmlFor="pe-title" hint={`Şablon uygulanır: ${titleTemplate}`}>
            <FormInput id="pe-title" name="title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={d.title ?? defaultTitle} maxLength={120} />
          </FormField>
          <FormField label="Açıklama" htmlFor="pe-desc">
            <FormTextarea id="pe-desc" name="description" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder={d.description ?? defaultDescription} maxLength={320} />
          </FormField>
          <FormField label="Canonical" htmlFor="pe-canon" hint="Boşsa sayfanın kendi adresi. Yol (/…) ya da https adresi.">
            <FormInput id="pe-canon" name="canonical" value={canonical} onChange={(e) => setCanonical(e.target.value)} placeholder={data.path} />
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="OG başlığı" htmlFor="pe-ogt">
              <FormInput id="pe-ogt" name="ogTitle" value={ogTitle} onChange={(e) => setOgTitle(e.target.value)} placeholder={d.ogTitle ?? ""} maxLength={120} />
            </FormField>
            <FormField label="OG görseli" htmlFor="pe-ogi" hint="Yol ya da https adresi (1200x630).">
              <FormInput id="pe-ogi" name="ogImage" value={ogImage} onChange={(e) => setOgImage(e.target.value)} placeholder="/opengraph-image" />
            </FormField>
          </div>
          <FormField label="OG açıklaması" htmlFor="pe-ogd">
            <FormTextarea id="pe-ogd" name="ogDescription" rows={2} value={ogDescription} onChange={(e) => setOgDescription(e.target.value)} placeholder={d.ogDescription ?? ""} maxLength={320} />
          </FormField>

          <fieldset disabled={!canSensitive} className="space-y-4 rounded-[var(--radius-card)] border border-line p-3">
            <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-text-muted">Tarama ve sitemap (süper admin)</legend>
            {!canSensitive ? <LockedNote>Bu bölümü yalnız süper admin değiştirebilir; mevcut değerler korunur.</LockedNote> : null}
            {!data.canIndex ? <LockedNote>Bu sayfa her zaman noindex’tir ve indekslenebilir yapılamaz.</LockedNote> : null}
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="İndeksleme" htmlFor="pe-index">
                <FormSelect id="pe-index" name="robotsIndex" defaultValue={ov.robotsIndex === undefined ? "" : ov.robotsIndex ? "index" : "noindex"}>
                  <option value="">Varsayılan ({d.index ? "index" : "noindex"})</option>
                  {data.canIndex ? <option value="index">index</option> : null}
                  <option value="noindex">noindex</option>
                </FormSelect>
              </FormField>
              <FormField label="Bağlantı takibi" htmlFor="pe-follow">
                <FormSelect id="pe-follow" name="robotsFollow" defaultValue={ov.robotsFollow === false ? "nofollow" : ""}>
                  <option value="">Varsayılan (follow)</option>
                  <option value="nofollow">nofollow</option>
                </FormSelect>
              </FormField>
              <FormField label="Sitemap'e dahil" htmlFor="pe-sm">
                <FormSelect id="pe-sm" name="sitemapInclude" defaultValue={ov.sitemapInclude === undefined ? "" : ov.sitemapInclude ? "include" : "exclude"}>
                  <option value="">Varsayılan ({d.sitemapInclude ? "dahil" : "hariç"})</option>
                  <option value="include">Dahil</option>
                  <option value="exclude">Hariç</option>
                </FormSelect>
              </FormField>
              <FormField label="Öncelik (0-1)" htmlFor="pe-prio">
                <FormInput id="pe-prio" name="sitemapPriority" inputMode="decimal" defaultValue={ov.sitemapPriority ?? ""} placeholder={String(d.priority)} />
              </FormField>
              <FormField label="Değişim sıklığı" htmlFor="pe-freq">
                <FormSelect id="pe-freq" name="changeFreq" defaultValue={ov.changeFreq ?? ""}>
                  <option value="">Varsayılan ({d.freq})</option>
                  {CHANGE_FREQS.map((f) => (
                    <option key={f} value={f}>{f}</option>
                  ))}
                </FormSelect>
              </FormField>
            </div>
            <div>
              <p className="mb-1.5 text-sm font-medium text-ink-950">Yapılandırılmış veri (JSON-LD) türleri</p>
              <div className="flex flex-wrap gap-3">
                {JSON_LD_KINDS.map((k) => (
                  <label key={k} className="inline-flex items-center gap-1.5 text-sm text-ink-950">
                    <Checkbox name="jsonLd" value={k} defaultChecked={kinds.has(k)} />
                    {k}
                  </label>
                ))}
              </div>
              <p className="mt-1 text-xs text-text-muted">Seçim yalnız sayfanın üretebildiği türleri açar/kapatır (örn. FAQPage için sayfada görünen SSS gerekir); AggregateRating/Review hiçbir koşulda üretilmez.</p>
            </div>
          </fieldset>

          <div className="flex flex-wrap items-center gap-2">
            <SubmitButton>Sayfayı kaydet</SubmitButton>
          </div>
        </SeoForm>

        <div className="space-y-6">
          <SerpPreview title={renderedTitle} url={canonicalUrl(base, canonical || data.path)} description={effDesc} />
          <SocialPreview title={effOgTitle} description={effOgDesc} image={effOgImage} host={host} />
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Kontrol listesi (kural tabanlı, puan değil)</p>
            <Checklist items={data.checklist} />
          </div>
          {data.override ? (
            <SeoForm action={resetSeoPage}>
              <input type="hidden" name="path" value={data.path} />
              <SubmitButton variant="secondary">Varsayılana döndür</SubmitButton>
            </SeoForm>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
