"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FormField, FormInput, FormSelect } from "@/components/ui/form-controls";
import { Switch } from "@/components/ui/switch";
import {
  discardSeoDraft,
  draftSeoAiSuggestion,
  draftSeoRuleFix,
  publishSeoDraft,
  requestSeoAiSuggestion,
  saveSeoAiSettings,
  type SeoActionResult,
} from "@/app/actions/seo-admin";
import { LockedNote, ResultNote, SeoForm, SubmitButton } from "./seo-ui";

/* ------------------------------ AI önerisi ayarı ------------------------------ */

export function SeoAiSettingsPanel({
  value,
  canEdit,
  usedThisMonth,
}: {
  value: { enabled: boolean; monthlyLimit: number };
  canEdit: boolean;
  /** null: kota tablosu yok (kurulum bekliyor). */
  usedThisMonth: number | null;
}) {
  return (
    <SeoForm action={saveSeoAiSettings}>
      <Card>
        <CardHeader>
          <div>
            <CardTitle>AI önerisi (başlık ve açıklama)</CardTitle>
            <CardDescription>
              Varsayılan KAPALI. Açıkken yalnız süper admin, otomatik iyileştirme kapsamındaki sayfalar için öneri isteyebilir (üyelik ve ofis sayfaları hariç). Öneri yalnız taslağa yazılır; girdideki kişisel veri maskelenir, sayfada olmayan sayı ve abartılı vaat işaretlenir. Kiracı kredisi kullanılmaz; aylık platform sınırından düşer.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {!canEdit ? <LockedNote>AI önerisi ayarını yalnız süper admin değiştirebilir.</LockedNote> : null}
          <fieldset disabled={!canEdit} className="grid gap-3 md:grid-cols-2">
            <label className="flex items-center justify-between gap-3 rounded-[var(--radius-control)] border border-line px-3 py-2">
              <span className="text-sm font-semibold text-ink-950">AI önerisini aç</span>
              <Switch name="enabled" defaultChecked={value.enabled} aria-label="AI önerisini aç" />
            </label>
            <FormField label="Aylık en çok öneri" htmlFor="monthlyLimit" hint={usedThisMonth === null ? "Kota tablosu kurulmadı: AI önerisi açık olsa da çalışmaz." : `Bu ay kullanılan: ${usedThisMonth}`}>
              <FormInput id="monthlyLimit" name="monthlyLimit" type="number" min={1} max={5000} defaultValue={value.monthlyLimit} />
            </FormField>
          </fieldset>
          {canEdit ? <SubmitButton>AI ayarını kaydet</SubmitButton> : null}
        </CardContent>
      </Card>
    </SeoForm>
  );
}

/* ------------------------------ Kural önerisi → taslak ------------------------------ */

export function RuleDraftButton({ url, code }: { url: string; code: string }) {
  const router = useRouter();
  const [res, setRes] = useState<SeoActionResult | null>(null);
  const [pending, start] = useTransition();
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button
        size="sm"
        variant="secondary"
        loading={pending}
        onClick={() =>
          start(async () => {
            const fd = new FormData();
            fd.set("url", url);
            fd.set("code", code);
            const r = await draftSeoRuleFix(fd);
            setRes(r);
            if (r.ok) router.refresh();
          })
        }
      >
        Taslağa al
      </Button>
      <ResultNote res={res} />
    </span>
  );
}

/* ------------------------------ SEO taslağı (yayın yüzeyi) ------------------------------ */

export function SeoDraftPanel({ changes, canPublish }: { changes: { path: string; fields: string[] }[]; canPublish: boolean }) {
  const router = useRouter();
  const [res, setRes] = useState<SeoActionResult | null>(null);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<SeoActionResult>) =>
    start(async () => {
      const r = await fn();
      setRes(r);
      if (r.ok) router.refresh();
    });
  if (changes.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Yayınlanmamış SEO taslağı ({changes.length} sayfa)</CardTitle>
          <CardDescription>Taslak canlı siteyi değiştirmez. Yayınlayınca sayfa ayarlarına yazılır, geçmişe girer ve geri alınabilir; etkilenen sayfalar arama motorlarına bildirilir ve yeniden denetlenir.</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <ul className="space-y-1 text-sm">
          {changes.map((c) => (
            <li key={c.path} className="flex flex-wrap items-center gap-2">
              <code className="rounded bg-canvas px-1.5 py-0.5 font-mono text-xs text-ink-950">{c.path}</code>
              <span className="text-text-muted">{c.fields.join(", ")}</span>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-center gap-2">
          {canPublish ? (
            <Button loading={pending} onClick={() => run(() => publishSeoDraft())}>
              Taslağı yayınla
            </Button>
          ) : (
            <LockedNote>Yayın yalnız süper admin içindir.</LockedNote>
          )}
          <Button variant="secondary" loading={pending} onClick={() => run(() => discardSeoDraft())}>
            Taslağı at
          </Button>
        </div>
        <ResultNote res={res} />
      </CardContent>
    </Card>
  );
}

/* ------------------------------ AI önerisi isteği ------------------------------ */

type Suggestion = { title: string; description: string; ogTitle: string | null; flags: { ungroundedNumbers: boolean; riskyWords: string[] } };

export function AiSuggestPanel({ pages }: { pages: { path: string; label: string }[] }) {
  const router = useRouter();
  const [path, setPath] = useState(pages[0]?.path ?? "/");
  const [res, setRes] = useState<SeoActionResult | null>(null);
  const [sug, setSug] = useState<Suggestion | null>(null);
  const [pending, start] = useTransition();
  if (pages.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>AI önerisi iste</CardTitle>
          <CardDescription>Sayfanın görünür metninden başlık ve açıklama önerisi. Hiçbir şey kendiliğinden yayınlanmaz.</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-end gap-2">
          <FormField label="Sayfa" htmlFor="ai-path">
            <FormSelect
              id="ai-path"
              value={path}
              onChange={(e) => {
                setPath(e.target.value);
                setSug(null);
                setRes(null);
              }}
            >
              {pages.map((p) => (
                <option key={p.path} value={p.path}>
                  {p.label} ({p.path})
                </option>
              ))}
            </FormSelect>
          </FormField>
          <Button
            icon={Sparkles}
            loading={pending}
            onClick={() =>
              start(async () => {
                const fd = new FormData();
                fd.set("path", path);
                const r = await requestSeoAiSuggestion(fd);
                setRes(r);
                setSug(r.ok && r.data ? (JSON.parse(r.data) as Suggestion) : null);
              })
            }
          >
            Öneri al
          </Button>
        </div>
        <ResultNote res={res} />
        {sug ? (
          <div className="space-y-2 rounded-[var(--radius-control)] border border-line p-3 text-sm">
            <p><span className="text-text-muted">Başlık:</span> <span className="text-ink-950">{sug.title}</span></p>
            <p><span className="text-text-muted">Açıklama:</span> <span className="text-ink-950">{sug.description}</span></p>
            {sug.ogTitle ? <p><span className="text-text-muted">Paylaşım başlığı:</span> <span className="text-ink-950">{sug.ogTitle}</span></p> : null}
            {sug.flags.ungroundedNumbers ? <p className="tone-warning rounded px-2 py-1 text-xs">Dikkat: sayfada geçmeyen bir sayı içeriyor.</p> : null}
            {sug.flags.riskyWords.length > 0 ? <p className="tone-warning rounded px-2 py-1 text-xs">Riskli ifade: {sug.flags.riskyWords.join(", ")}</p> : null}
            <Button
              size="sm"
              variant="secondary"
              loading={pending}
              onClick={() =>
                start(async () => {
                  const fd = new FormData();
                  fd.set("path", path);
                  fd.set("title", sug.title);
                  fd.set("description", sug.description);
                  if (sug.ogTitle) fd.set("ogTitle", sug.ogTitle);
                  const r = await draftSeoAiSuggestion(fd);
                  setRes(r);
                  if (r.ok) {
                    setSug(null);
                    router.refresh();
                  }
                })
              }
            >
              Taslağa yaz
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
