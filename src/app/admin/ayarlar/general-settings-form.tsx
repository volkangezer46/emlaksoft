"use client";

import { useState, useTransition } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Save } from "lucide-react";
import { saveGeneralSettings } from "@/app/actions/platform-settings-general";
import { FormField, FormInput, FormTextarea } from "@/components/ui/form-controls";
import {
  MAX_MAINTENANCE_MESSAGE,
  MAX_TRIAL_DAYS,
  MIN_TRIAL_DAYS,
  type GeneralSettings,
} from "@/lib/platform-setting-keys";

/** Platform genel ayarları. Yalnız süper admin düzenler; diğer roller salt okur. Bakım açılırken onay satır içidir. */
export function GeneralSettingsForm({ initial, canEdit }: { initial: GeneralSettings; canEdit: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [maintenance, setMaintenance] = useState(initial.maintenanceMode);
  const [confirming, setConfirming] = useState(false);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  function submit(form: HTMLFormElement) {
    const fd = new FormData(form);
    setNotice(null);
    setConfirming(false);
    start(async () => {
      const res = await saveGeneralSettings(fd);
      if (res.error) setNotice({ tone: "error", text: res.error });
      else {
        setNotice({
          tone: "ok",
          text: res.changed && res.changed.length > 0 ? `Kaydedildi: ${res.changed.join(", ")}.` : "Değişiklik yok.",
        });
        router.refresh();
      }
    });
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (maintenance && !initial.maintenanceMode && !confirming) {
      setConfirming(true);
      return;
    }
    submit(e.currentTarget);
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5 rounded-[var(--radius-panel)] border border-line bg-surface p-5">
      <fieldset disabled={!canEdit || pending} className="space-y-5">
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            name="maintenance_mode"
            checked={maintenance}
            onChange={(e) => {
              setMaintenance(e.target.checked);
              setConfirming(false);
            }}
            className="mt-1 h-4 w-4"
          />
          <span>
            <span className="block text-sm font-semibold text-ink-950">Bakım modu</span>
            <span className="block text-xs text-text-muted">Açıkken ofis panelleri bakım ekranı gösterir (uygulama middleware sürümünde okunur).</span>
          </span>
        </label>
        <FormField label="Bakım mesajı" htmlFor="maintenance_message" hint={`En fazla ${MAX_MAINTENANCE_MESSAGE} karakter.`}>
          <FormTextarea id="maintenance_message" name="maintenance_message" rows={3} maxLength={MAX_MAINTENANCE_MESSAGE} defaultValue={initial.maintenanceMessage} />
        </FormField>
        <label className="flex items-start gap-3">
          <input type="checkbox" name="registration_open" defaultChecked={initial.registrationOpen} className="mt-1 h-4 w-4" />
          <span>
            <span className="block text-sm font-semibold text-ink-950">Yeni kayıt açık</span>
            <span className="block text-xs text-text-muted">Kapatıldığında yeni ofis kaydı alınmaz (kayıt akışı bu ayarı okur).</span>
          </span>
        </label>
        <FormField
          label="Varsayılan deneme süresi (gün)"
          htmlFor="default_trial_days"
          required
          hint={`${MIN_TRIAL_DAYS}-${MAX_TRIAL_DAYS} gün. Yeni kayıt ve demo dönüşümünde uygulanır.`}
          className="max-w-xs"
        >
          <FormInput id="default_trial_days" name="default_trial_days" type="number" inputMode="numeric" min={MIN_TRIAL_DAYS} max={MAX_TRIAL_DAYS} defaultValue={initial.defaultTrialDays} required />
        </FormField>
      </fieldset>

      {notice ? (
        <p
          role={notice.tone === "error" ? "alert" : "status"}
          className={`rounded-[var(--radius-control)] px-3 py-2 text-sm font-medium ${notice.tone === "error" ? "bg-danger-500/8 text-danger-600" : "bg-mint-500/10 text-mint-700"}`}
        >
          {notice.text}
        </p>
      ) : null}

      {canEdit ? (
        confirming ? (
          <span className="inline-flex flex-wrap items-center gap-2 rounded-[var(--radius-control)] border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-xs font-semibold text-amber-800">
            Bakım modu açılsın mı? Ofis kullanıcıları etkilenebilir.
            <button type="submit" className="focus-ring press rounded-[var(--radius-control)] bg-ink-950 px-3 py-1.5 text-white">Evet, kaydet</button>
            <button type="button" onClick={() => setConfirming(false)} className="focus-ring press rounded-[var(--radius-control)] border border-line bg-surface px-3 py-1.5 text-ink-950">Vazgeç</button>
          </span>
        ) : (
          <button type="submit" disabled={pending} className="focus-ring press inline-flex items-center gap-1.5 rounded-[var(--radius-control)] bg-ink-950 px-4 py-2 text-xs font-semibold text-white disabled:opacity-60">
            {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Kaydet
          </button>
        )
      ) : (
        <p className="text-xs text-text-faint">Bu ayarlar yalnız süper admin tarafından değiştirilir.</p>
      )}
    </form>
  );
}
