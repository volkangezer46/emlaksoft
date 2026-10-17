"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { EyeOff, Eye, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { recomputeSeoScore, refreshSitemapNow, saveHubSettings, toggleHubPath, type SeoProResult } from "@/app/actions/seo-pro";
import { HUB_LEVELS, HUB_MIN_LISTINGS, type SeoHubSettings } from "@/lib/seo/schema-core";
import { LockedNote, ResultNote, SeoForm, SubmitButton } from "./seo-ui";

/** SEO merkezi (gelişmiş) istemci parçaları: küçük formlar ve tek tık eylemleri. */

const LEVEL_LABEL: Record<(typeof HUB_LEVELS)[number], string> = { il: "İl sayfaları", ilce: "İlçe sayfaları", mahalle: "Mahalle sayfaları (yalnız niyetli)" };

export function HubSettingsForm({ value, canEdit }: { value: SeoHubSettings; canEdit: boolean }) {
  if (!canEdit) return <LockedNote>Programatik sayfaları açmak, eşiği ve düzeyleri değiştirmek yalnız süper admin içindir.</LockedNote>;
  return (
    <SeoForm action={saveHubSettings}>
      <label className="flex min-h-11 items-center gap-3 text-sm font-semibold text-ink-950">
        <input type="checkbox" name="enabled" defaultChecked={value.enabled} className="h-4 w-4" />
        Programatik bölge sayfaları açık (/emlak/…)
      </label>
      <label className="block text-sm font-semibold text-ink-950">
        İndeksleme eşiği (en az ilan)
        <input
          type="number"
          name="minListings"
          min={HUB_MIN_LISTINGS.min}
          max={HUB_MIN_LISTINGS.max}
          defaultValue={value.minListings}
          className="mt-1 block h-11 w-32 rounded-[var(--radius-control)] border border-line bg-surface px-3 text-sm font-normal"
        />
        <span className="mt-1 block text-xs font-normal text-text-muted">Eşiğin altındaki sayfa “noindex, follow” döner ve sitemap’e girmez (ince/kapı sayfası yok). Hiç ilanı olmayan sayfa 404.</span>
      </label>
      <fieldset className="space-y-1">
        <legend className="text-sm font-semibold text-ink-950">Düzeyler</legend>
        {HUB_LEVELS.map((l) => (
          <label key={l} className="flex min-h-11 items-center gap-3 text-sm">
            <input type="checkbox" name={`level_${l}`} defaultChecked={value.levels.includes(l)} className="h-4 w-4" />
            {LEVEL_LABEL[l]}
          </label>
        ))}
      </fieldset>
      <label className="flex min-h-11 items-center gap-3 text-sm">
        <input type="checkbox" name="roomIntents" defaultChecked={value.roomIntents} className="h-4 w-4" />
        Oda sayısı sayfaları (ör. “Kadıköy kiralık 2+1 daire”)
      </label>
      <label className="flex min-h-11 items-start gap-3 text-sm">
        <input type="checkbox" name="listingLinks" defaultChecked={value.listingLinks} className="mt-1 h-4 w-4" />
        <span>
          İlan sayfalarından bölge sayfasına bağlantı ver
          <span className="block text-xs text-text-muted">Bölge sayfası birden çok ofisin ilanını listeler; açmadan önce ofislerin bunu kabul ettiğinden emin olun.</span>
        </span>
      </label>
      <SubmitButton>Kaydet</SubmitButton>
    </SeoForm>
  );
}

function useAction() {
  const router = useRouter();
  const [res, setRes] = useState<SeoProResult | null>(null);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<SeoProResult>) =>
    start(async () => {
      const r = await fn();
      setRes(r);
      if (r.ok) router.refresh();
    });
  return { res, pending, run };
}

export function HubPathToggle({ path, disabled }: { path: string; disabled: boolean }) {
  const { res, pending, run } = useAction();
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <Button
        type="button"
        size="sm"
        variant="outline"
        icon={disabled ? Eye : EyeOff}
        loading={pending}
        onClick={() =>
          run(() => {
            const fd = new FormData();
            fd.set("path", path);
            return toggleHubPath(fd);
          })
        }
      >
        {disabled ? "Aç" : "Kapat"}
      </Button>
      {res?.error ? <ResultNote res={res} /> : null}
    </span>
  );
}

export function RecomputeScoreButton() {
  const { res, pending, run } = useAction();
  return (
    <div className="space-y-2">
      <Button type="button" variant="outline" icon={RefreshCw} loading={pending} onClick={() => run(() => recomputeSeoScore())}>
        Puanı yeniden hesapla
      </Button>
      <ResultNote res={res} />
    </div>
  );
}

export function RefreshSitemapButton({ canRun }: { canRun: boolean }) {
  const { res, pending, run } = useAction();
  if (!canRun) return null;
  return (
    <div className="space-y-2">
      <Button type="button" variant="outline" icon={RefreshCw} loading={pending} onClick={() => run(() => refreshSitemapNow())}>
        Sitemap’i şimdi tazele
      </Button>
      <ResultNote res={res} />
    </div>
  );
}
