"use client";

import { useActionState, useState } from "react";
import { Check, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { saveVitrinSettings, type VitrinSettingsResult } from "@/app/actions/vitrin-settings";
import { VITRIN_INTRO_MAX, type VitrinSettings } from "@/lib/vitrin-settings-logic";

function Row({
  id,
  name,
  label,
  hint,
  defaultChecked,
}: {
  id: string;
  name: string;
  label: string;
  hint: string;
  defaultChecked: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <div className="min-w-0">
        <label htmlFor={id} className="text-sm font-semibold text-ink-950">
          {label}
        </label>
        <p className="mt-0.5 text-xs text-text-muted">{hint}</p>
      </div>
      <Switch id={id} name={name} defaultChecked={defaultChecked} aria-label={label} />
    </div>
  );
}

export function VitrinForm({ settings }: { settings: VitrinSettings }) {
  const [state, formAction, pending] = useActionState<VitrinSettingsResult, FormData>(saveVitrinSettings, {});
  const [intro, setIntro] = useState(settings.intro ?? "");

  return (
    <form action={formAction} className="space-y-6">
      <div>
        <label htmlFor="vitrin-intro" className="text-sm font-semibold text-ink-950">
          Tanıtım metni
        </label>
        <p className="mt-0.5 text-xs text-text-muted">
          Vitrin başlığının altında ve arama sonuçlarındaki açıklamada görünür. Boş bırakırsanız gösterilmez.
        </p>
        <textarea
          id="vitrin-intro"
          name="intro"
          rows={4}
          maxLength={VITRIN_INTRO_MAX}
          value={intro}
          onChange={(e) => setIntro(e.target.value)}
          className="mt-2 w-full rounded-[var(--radius-control)] border border-line bg-canvas px-3.5 py-2.5 text-sm text-ink-950 outline-none focus:border-brand-400"
        />
        <p className="mt-1 text-right text-xs text-text-faint">
          {intro.length}/{VITRIN_INTRO_MAX}
        </p>
      </div>

      <div className="divide-y divide-line/60 rounded-[var(--radius-card)] border border-line px-4">
        <Row
          id="vitrin-enabled"
          name="enabled"
          label="Vitrin yayında"
          hint="Kapatırsanız herkese açık vitrin sayfanız bulunamadı olarak görünür; ilanlarınız silinmez."
          defaultChecked={settings.enabled}
        />
        <Row
          id="vitrin-phone"
          name="showPhone"
          label="Ofis telefonunu göster"
          hint="Vitrinin üstünde arama düğmesi olarak ve arama motorlarına verilen ofis bilgisinde görünür."
          defaultChecked={settings.showPhone}
        />
        <Row
          id="vitrin-lead"
          name="showLeadForm"
          label="Talep formu bölümü"
          hint="Ziyaretçilerin kriter bırakabildiği bölüm."
          defaultChecked={settings.showLeadForm}
        />
        <Row
          id="vitrin-valuation"
          name="showValuation"
          label="Ücretsiz değerleme bağlantısı"
          hint="Satıcı adaylarını değerleme sayfasına yönlendiren bölüm."
          defaultChecked={settings.showValuation}
        />
      </div>

      <div className="rounded-[var(--radius-card)] border border-brand-300/50 bg-brand-50/50 px-4">
        <Row
          id="vitrin-seo"
          name="seoOptin"
          label="Vitrinim aramalarda görünsün"
          hint="Açarsanız vitrininiz, yayındaki ilanlarınız ve herkese açık danışman kartlarınız arama motorlarına bildirilen site haritasına girer. Varsayılan kapalıdır; istediğiniz zaman kapatabilirsiniz."
          defaultChecked={settings.seoOptin}
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" loading={pending}>
          <Save className="h-4 w-4" /> Kaydet
        </Button>
        {state.ok ? (
          <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-mint-700" role="status">
            <Check className="h-4 w-4" /> Kaydedildi
          </span>
        ) : null}
        {state.error ? (
          <span className="text-sm font-medium text-danger-500" role="alert">
            {state.error}
          </span>
        ) : null}
      </div>
    </form>
  );
}
