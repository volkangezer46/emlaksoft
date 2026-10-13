"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { saveMeasureSettings, type MeasureActionResult } from "@/app/actions/measure-admin";
import type { MeasureSettings } from "@/lib/measure/settings";

/**
 * Ölçüm ayarları (yalnız süper admin düzenler; diğer roller salt okur). Kayıt kaynağını taşımayı AÇMAK için
 * "Aydınlatma metnine kayıt kaynağı maddesi eklendi" onayı zorunludur; onay kutusu yalnız açılırken görünür.
 */
export function MeasureSettingsForm({ value, canEdit, legalAtText }: { value: MeasureSettings; canEdit: boolean; legalAtText: string | null }) {
  const router = useRouter();
  const ids = useId();
  const [attribution, setAttribution] = useState(value.attribution);
  const [res, setRes] = useState<MeasureActionResult | null>(null);
  const [pending, start] = useTransition();
  const turningOn = attribution && !value.attribution;

  return (
    <form
      className="space-y-4"
      action={(fd) =>
        start(async () => {
          const r = await saveMeasureSettings(fd);
          setRes(r);
          if (r.ok) router.refresh();
        })
      }
    >
      <fieldset disabled={!canEdit || pending} className="space-y-3">
        <Row id={`${ids}-pv`} label="Ziyaret sayacı" hint="Herkese açık sayfaların günlük görüntülenme sayısı (çerezsiz; IP saklanmaz).">
          <Switch id={`${ids}-pv`} name="pageviews" defaultChecked={value.pageviews} disabled={!canEdit} />
        </Row>
        <Row id={`${ids}-vt`} label="Gerçek kullanıcı hız ölçümü" hint="Sayfaların ziyaretçinin cihazında ne kadar hızlı açıldığı (Saha verisi ekranı).">
          <Switch id={`${ids}-vt`} name="vitals" defaultChecked={value.vitals} disabled={!canEdit} />
        </Row>
        <Row
          id={`${ids}-at`}
          label="Kayıt kaynağını taşı"
          hint="Ziyaretçinin geldiği kaynak (reklam etiketi, yönlendiren site, ilk açtığı sayfa) sekme kapanana kadar tutulur ve kayıt formuna eklenir."
        >
          <Switch id={`${ids}-at`} name="attribution" checked={attribution} onCheckedChange={setAttribution} disabled={!canEdit} />
        </Row>
        {turningOn ? (
          <label className="flex items-start gap-2 rounded-[var(--radius-control)] border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
            <Checkbox name="legalConfirmed" required className="mt-0.5" />
            <span>Aydınlatma metnine kayıt kaynağı maddesi eklendi.</span>
          </label>
        ) : null}
        {value.attribution && legalAtText ? (
          <p className="text-xs text-text-muted">Aydınlatma onayı: {legalAtText}</p>
        ) : null}
      </fieldset>
      {canEdit ? (
        <Button type="submit" loading={pending}>
          Ayarları kaydet
        </Button>
      ) : (
        <p className="text-xs text-text-muted">Ölçüm ayarlarını yalnız süper admin değiştirebilir.</p>
      )}
      {res?.error ? (
        <p role="alert" className="rounded-[var(--radius-control)] bg-danger-500/8 px-3 py-2 text-sm font-medium text-danger-600">
          {res.error}
        </p>
      ) : res?.ok ? (
        <p role="status" className="flex items-center gap-1.5 text-sm font-medium text-success-strong">
          <CheckCircle2 className="h-4 w-4" aria-hidden /> {res.message}
        </p>
      ) : null}
    </form>
  );
}

function Row({ id, label, hint, children }: { id: string; label: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <label htmlFor={id} className="text-sm font-semibold text-text">
          {label}
        </label>
        <p className="text-xs text-text-muted">{hint}</p>
      </div>
      {children}
    </div>
  );
}
