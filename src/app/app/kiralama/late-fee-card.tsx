"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Hourglass } from "lucide-react";
import { saveLateFeeSettings } from "@/app/actions/rental-finance";
import { useToast } from "@/components/app/toast-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormError, FormField, FormInput } from "@/components/ui/form-controls";
import { Switch } from "@/components/ui/switch";
import type { LateFeeSettings } from "@/lib/property-management/payments";

/**
 * Gecikme bedeli ofis ayarı (KAPALI doğar). Açıksa geciken tahakkuklarda kalan tutar × aylık oran × (gecikme günü − hoşgörü) / 30
 * BİLGİ olarak gösterilir; tahakkuka otomatik eklenmez, ofis isterse tahsil eder.
 */
export function LateFeeCard({ initial, canEdit, schemaReady }: { initial: LateFeeSettings; canEdit: boolean; schemaReady: boolean }) {
  const router = useRouter();
  const { push } = useToast();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [enabled, setEnabled] = useState(initial.enabled);
  const [percent, setPercent] = useState(String(initial.monthlyPercent).replace(".", ","));
  const [grace, setGrace] = useState(String(initial.graceDays));
  const [error, setError] = useState<string | null>(null);

  function save() {
    setError(null);
    const pct = Number(percent.trim().replace(",", "."));
    const g = Number(grace.trim());
    start(async () => {
      const res = await saveLateFeeSettings({ enabled, monthlyPercent: Number.isFinite(pct) ? pct : -1, graceDays: Number.isFinite(g) ? g : -1 });
      if (res.error) {
        setError(res.error);
        return;
      }
      push("Gecikme bedeli ayarı kaydedildi", "ok");
      router.refresh();
    });
  }

  return (
    <section id="gecikme-bedeli" className="rounded-[var(--radius-panel)] border border-line bg-surface p-4 shadow-[var(--shadow-xs)]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-bold text-ink-950">
          <Hourglass className="h-4 w-4 text-brand-600" /> Gecikme bedeli
          <Badge variant={initial.enabled ? "success" : "outline"} size="sm">{initial.enabled ? "Açık" : "Kapalı"}</Badge>
        </h2>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="focus-ring rounded-[var(--radius-control)] px-1 text-xs font-semibold text-brand-600 hover:underline touch:min-h-11"
        >
          {open ? "Kapat" : canEdit ? "Düzenle" : "Görüntüle"}
        </button>
      </div>
      <p className="mt-1 text-xs text-text-muted">
        Geciken tahakkuklarda bilgi amaçlı gecikme bedeli hesaplanır. Varsayılan KAPALIDIR; tahakkuka otomatik eklenmez.
      </p>
      {open ? (
        <div className="mt-4 space-y-4">
          {!schemaReady ? (
            <p className="rounded-[var(--radius-control)] bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700">
              Bu özellik için veritabanı güncellemesi henüz uygulanmamış; ayar şu an kaydedilemez.
            </p>
          ) : null}
          <label className="flex items-center justify-between gap-3">
            <span className="text-sm font-semibold text-ink-950">Gecikme bedelini göster</span>
            <Switch checked={enabled} onCheckedChange={setEnabled} disabled={!canEdit || pending} aria-label="Gecikme bedelini göster" />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="Aylık gecikme oranı (%)" htmlFor="lf-pct" hint="Örn. 3 → aylık %3, günlüğe 30 üzerinden bölünür.">
              <FormInput id="lf-pct" inputMode="decimal" value={percent} onChange={(e) => setPercent(e.target.value)} disabled={!canEdit || pending} />
            </FormField>
            <FormField label="Hoşgörü günü" htmlFor="lf-grace" hint="Vadeden sonra bu kadar gün bedel işlemez (0-30).">
              <FormInput id="lf-grace" inputMode="numeric" value={grace} onChange={(e) => setGrace(e.target.value)} disabled={!canEdit || pending} />
            </FormField>
          </div>
          <FormError error={error} />
          {canEdit ? (
            <div className="flex justify-end">
              <Button size="sm" onClick={save} loading={pending} disabled={!schemaReady}>Kaydet</Button>
            </div>
          ) : (
            <p className="text-xs text-text-muted">Ayarı değiştirmek için ofis sahibi, genel müdür veya şube müdürü olmalısınız.</p>
          )}
        </div>
      ) : null}
    </section>
  );
}
