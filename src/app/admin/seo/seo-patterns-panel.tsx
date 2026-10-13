"use client";

import { useRef, useState } from "react";
import { AlertTriangle, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FormField, FormInput, FormTextarea } from "@/components/ui/form-controls";
import { saveSeoPatterns } from "@/app/actions/seo-admin";
import {
  DEFAULT_SEO_PATTERNS,
  SEO_PATTERN_DESC_MAX,
  SEO_PATTERN_TITLE_MAX,
  SEO_PATTERN_VARS,
  fillSeoPattern,
  resolveSeoPattern,
  unknownPatternVars,
  type SeoPatternField,
  type SeoPatternVars,
} from "@/lib/seo/patterns";
import type { SeoPatternEntity, SeoPatterns } from "@/lib/seo/schema";
import { LockedNote, SeoForm, SerpPreview, SubmitButton } from "./seo-ui";

export type PatternSampleView = { url: string; vars: SeoPatternVars; ownText: string | null } | null;

const ENTITY_META: Record<SeoPatternEntity, { title: string; hint: string; ownTextLabel: string; prefix: string }> = {
  office: {
    title: "Vitrin (ofis sayfası)",
    hint: "/vitrin/<ofis>",
    ownTextLabel: "Ofis tanıtım metni yazılmışsa açıklama olarak o kullanılır; kalıp yalnız tanıtımı olmayan ofislere uygulanır.",
    prefix: "office",
  },
  listing: {
    title: "İlan sayfası",
    hint: "/vitrin/<ofis>/<ilan>",
    ownTextLabel: "İlanın kendi açıklaması varsa o kullanılır (ilk 160 karakter); kalıp açıklamasız ilanlara uygulanır.",
    prefix: "listing",
  },
  agent: {
    title: "Danışman kartviziti",
    hint: "/danisman/<danışman>",
    ownTextLabel: "Danışmanın kendi tanıtımı (biyografi) varsa o kullanılır; kalıp tanıtımı olmayanlara uygulanır.",
    prefix: "agent",
  },
};

function PatternCard({
  entity,
  initial,
  sample,
  base,
  canEdit,
}: {
  entity: SeoPatternEntity;
  initial: { title: string; description: string };
  sample: PatternSampleView;
  base: string;
  canEdit: boolean;
}) {
  const meta = ENTITY_META[entity];
  const [title, setTitle] = useState(initial.title);
  const [description, setDescription] = useState(initial.description);
  const [focus, setFocus] = useState<SeoPatternField>("title");
  const titleRef = useRef<HTMLInputElement>(null);
  const descRef = useRef<HTMLTextAreaElement>(null);
  const vars = SEO_PATTERN_VARS.filter((v) => (v.entities as readonly string[]).includes(entity));

  const insert = (key: string) => {
    const token = `{${key}}`;
    const el = focus === "title" ? titleRef.current : descRef.current;
    const cur = focus === "title" ? title : description;
    const start = el?.selectionStart ?? cur.length;
    const end = el?.selectionEnd ?? cur.length;
    const next = `${cur.slice(0, start)}${token}${cur.slice(end)}`.slice(0, 200);
    if (focus === "title") setTitle(next);
    else setDescription(next);
    requestAnimationFrame(() => {
      el?.focus();
      const pos = Math.min(start + token.length, next.length);
      el?.setSelectionRange(pos, pos);
    });
  };

  const local: SeoPatterns = {
    office: { title: "", description: "" },
    listing: { title: "", description: "" },
    agent: { title: "", description: "" },
    [entity]: { title, description },
  };
  const sv = sample?.vars ?? {};
  const previewTitle = resolveSeoPattern(local, entity, "title", sv);
  let previewDesc = resolveSeoPattern(local, entity, "description", sv);
  if (entity === "listing") previewDesc = previewDesc.replace(/\s+/g, " ").slice(0, 160);

  const warnings: string[] = [];
  for (const [field, tpl] of [["Başlık", title], ["Açıklama", description]] as const) {
    const unknown = unknownPatternVars(tpl, entity);
    if (unknown.length > 0) warnings.push(`${field}: bu sayfada olmayan değişken boş kalır: ${unknown.map((u) => `{${u}}`).join(", ")}.`);
  }
  if (sample && title) {
    const raw = fillSeoPattern(title, sv).replace(/\s+/g, " ").trim();
    if (raw.length > SEO_PATTERN_TITLE_MAX) warnings.push(`Örnek kayıtta başlık ${raw.length} karakter; ${SEO_PATTERN_TITLE_MAX} karakterde kelime sınırından kesilir.`);
  }
  if (sample && description) {
    const raw = fillSeoPattern(description, sv).replace(/\s+/g, " ").trim();
    if (raw.length > SEO_PATTERN_DESC_MAX) warnings.push(`Örnek kayıtta açıklama ${raw.length} karakter; ${SEO_PATTERN_DESC_MAX} karakterde kelime sınırından kesilir.`);
  }

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>{meta.title}</CardTitle>
          <CardDescription>
            <span className="font-mono">{meta.hint}</span> · boş alan bugünkü sabit metni kullanır.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          <FormField label="Başlık kalıbı" htmlFor={`pt-${entity}-title`} hint={`Varsayılan: ${DEFAULT_SEO_PATTERNS[entity].title}`}>
            <FormInput
              ref={titleRef}
              id={`pt-${entity}-title`}
              name={`${meta.prefix}Title`}
              value={title}
              maxLength={200}
              placeholder={DEFAULT_SEO_PATTERNS[entity].title}
              onFocus={() => setFocus("title")}
              onChange={(e) => setTitle(e.target.value)}
            />
          </FormField>
          <FormField label="Açıklama kalıbı" htmlFor={`pt-${entity}-desc`} hint={meta.ownTextLabel}>
            <FormTextarea
              ref={descRef}
              id={`pt-${entity}-desc`}
              name={`${meta.prefix}Description`}
              rows={3}
              value={description}
              maxLength={200}
              placeholder={DEFAULT_SEO_PATTERNS[entity].description}
              onFocus={() => setFocus("description")}
              onChange={(e) => setDescription(e.target.value)}
            />
          </FormField>
          {canEdit ? (
            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-text-muted">
                Değişken ekle ({focus === "title" ? "başlığa" : "açıklamaya"})
              </p>
              <div className="flex flex-wrap gap-1.5">
                {vars.map((v) => (
                  <Button key={v.key} type="button" size="sm" variant="secondary" onClick={() => insert(v.key)} title={v.label} className="font-mono">
                    {`{${v.key}}`}
                  </Button>
                ))}
              </div>
            </div>
          ) : null}
          {warnings.length > 0 ? (
            <ul className="space-y-1">
              {warnings.map((w) => (
                <li key={w} className="flex items-start gap-1.5 text-xs font-medium text-warning-strong">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> {w}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <div className="space-y-2">
          {sample ? (
            <>
              <SerpPreview title={previewTitle} url={`${base}${sample.url}`} description={sample.ownText ? sample.ownText.replace(/\s+/g, " ").slice(0, 160) : previewDesc} />
              {sample.ownText ? (
                <p className="flex items-start gap-1.5 text-xs text-text-muted">
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> Örnek kaydın kendi açıklaması olduğu için önizlemede o görünüyor. Kalıp çıktısı: “{previewDesc}”
                </p>
              ) : null}
              <p className="text-xs text-text-muted">Gerçek kayıtla önizleme: {sample.url}</p>
            </>
          ) : (
            <p className="text-sm text-text-muted">Önizleme için yayında bir kayıt yok; kalıp yine kaydedilebilir.</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function PatternsPanel({
  value,
  samples,
  base,
  canEdit,
}: {
  value: SeoPatterns;
  samples: Record<SeoPatternEntity, PatternSampleView>;
  base: string;
  canEdit: boolean;
}) {
  return (
    <SeoForm action={saveSeoPatterns}>
      {!canEdit ? <LockedNote>Dinamik kalıpları yalnız süper admin değiştirebilir; burada salt okunur görünür.</LockedNote> : null}
      <fieldset disabled={!canEdit} className="space-y-6">
        {(["office", "listing", "agent"] as const).map((entity) => (
          <PatternCard key={entity} entity={entity} initial={value[entity]} sample={samples[entity]} base={base} canEdit={canEdit} />
        ))}
      </fieldset>
      {canEdit ? <SubmitButton>Kalıpları kaydet</SubmitButton> : null}
    </SeoForm>
  );
}
