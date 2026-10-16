"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { applyModulePreset, answerPropertyManagement } from "@/app/actions/modules";
import { applyOfficeTemplate } from "@/app/actions/onboarding-setup";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { PROPERTY_MANAGEMENT_QUESTION } from "@/lib/onboarding-steps";

/** Hazır düzen kartı (sunucu `computePresetChanges` ile önizlemeyi hesaplar; istemcide yeniden hesap yok). */
export type OfisTipiPreset = {
  id: string;
  title: string;
  desc: string;
  /** Uygulanınca kapanacak bölümlerin adları. */
  closes: string[];
  /** Uygulanınca yeniden açılacak bölümlerin adları. */
  opens: string[];
  /** Kira takibi sorusunun bu düzende önerilen cevabı. */
  rentalsDefault: boolean;
  /** Tanım şablonu (kayıp nedenleri, müşteri kaynakları): onboarding-templates anahtarı. */
  template: string;
};

/**
 * Kurulum 2. adımı "Ne iş yapıyorsunuz?" (C27): Ayarlar > Modüller'deki hazır düzenler burada seçilir; varsayılan
 * "Konut ağırlıklı" ve seçimin etkisi (kapanacak / açılacak bölümler) kaydetmeden önce gösterilir. Kaydet: hazır düzen +
 * kira takibi cevabı (Mülk yönetimi modülü) + ofis tipine uygun tanımlar. Hiçbir veri silinmez; Ayarlar > Modüller'den
 * her bölüm tek tek geri açılır.
 */
export function OfisTipiStep({
  presets,
  canEdit,
  rentalsPlanLocked,
  nextHref,
}: {
  presets: OfisTipiPreset[];
  canEdit: boolean;
  /** Mülk yönetimi paketinizde yoksa "Evet" seçilemez. */
  rentalsPlanLocked: boolean;
  nextHref: string;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState(presets[0]?.id ?? "");
  const preset = presets.find((p) => p.id === selected) ?? presets[0];
  const [rentals, setRentals] = useState<boolean>(rentalsPlanLocked ? false : (preset?.rentalsDefault ?? false));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!canEdit) {
    return <Alert tone="info">Bu seçimi ofis sahibi ya da genel müdür yapar. Bu adımı atlayabilirsiniz.</Alert>;
  }
  if (!preset) return null;

  function choose(id: string) {
    setSelected(id);
    const p = presets.find((x) => x.id === id);
    if (p && !rentalsPlanLocked) setRentals(p.rentalsDefault);
  }

  function save() {
    setError(null);
    startTransition(async () => {
      const applied = await applyModulePreset(preset.id);
      if (applied.error) return setError(applied.error);
      const answered = await answerPropertyManagement(rentals);
      if (answered.error) return setError(answered.error);
      // Tanımlar en iyi çaba: var olan değer atlanır; hata düzeni geri almaz, yalnız bildirilir.
      const tpl = await applyOfficeTemplate(preset.template);
      if (tpl.error) return setError(tpl.error);
      router.push(nextHref);
      router.refresh();
    });
  }

  return (
    <div className="space-y-5">
      <fieldset>
        <legend className="sr-only">Ofisinize uyan düzen</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {presets.map((p) => {
            const active = p.id === preset.id;
            return (
              <label
                key={p.id}
                className={
                  "focus-within:ring-2 focus-within:ring-brand-400 flex min-h-11 cursor-pointer flex-col gap-1 rounded-[var(--radius-card)] border p-4 transition " +
                  (active ? "border-brand-600 bg-brand-600/[0.05]" : "border-line bg-surface hover:border-brand-300")
                }
              >
                <span className="flex items-center gap-2 text-base font-semibold text-text">
                  <input
                    type="radio"
                    name="ofis-tipi"
                    value={p.id}
                    checked={active}
                    onChange={() => choose(p.id)}
                    className="h-5 w-5 accent-[var(--brand-600)]"
                  />
                  {p.title}
                </span>
                <span className="pl-7 text-sm text-text-muted">{p.desc}</span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <section aria-label="Seçimin etkisi" className="rounded-[var(--radius-card)] border border-line bg-canvas p-4 text-sm">
        <p className="font-semibold text-text">Bu seçimle menünüz</p>
        {preset.closes.length === 0 && preset.opens.length === 0 ? (
          <p className="mt-1 text-text-muted">Değişmez: ofisiniz zaten bu düzende.</p>
        ) : (
          <ul className="mt-1 space-y-1 text-text-muted">
            {preset.closes.length > 0 ? (
              <li>
                <span className="font-semibold text-text">Gizlenir:</span> {preset.closes.join(", ")}
              </li>
            ) : null}
            {preset.opens.length > 0 ? (
              <li>
                <span className="font-semibold text-text">Açılır:</span> {preset.opens.join(", ")}
              </li>
            ) : null}
          </ul>
        )}
        <p className="mt-2 text-text-muted">Verileriniz silinmez; Ayarlar &gt; Modüller ekranından istediğiniz an geri açarsınız.</p>
      </section>

      <fieldset>
        <legend className="mb-2 text-base font-semibold text-text">{PROPERTY_MANAGEMENT_QUESTION}</legend>
        <div className="flex flex-wrap gap-2">
          {[true, false].map((yes) => {
            const active = rentals === yes;
            const disabled = yes && rentalsPlanLocked;
            return (
              <Button
                key={String(yes)}
                type="button"
                variant={active ? "primary" : "secondary"}
                aria-pressed={active}
                disabled={disabled}
                icon={active ? Check : undefined}
                onClick={() => setRentals(yes)}
              >
                {yes ? "Evet, yapıyoruz" : "Hayır"}
              </Button>
            );
          })}
        </div>
        {rentalsPlanLocked ? <p className="mt-2 text-sm text-text-muted">Mülk yönetimi paketinizde yok; paketi yükseltince açabilirsiniz.</p> : null}
      </fieldset>

      {error ? <Alert tone="danger">{error}</Alert> : null}
      <Button type="button" size="lg" loading={pending} onClick={save}>
        Kaydet ve devam et
      </Button>
    </div>
  );
}
