"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Database, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { applyOfficeTemplate } from "@/app/actions/onboarding-setup";
import { seedSampleData } from "@/app/actions/sample-data";
import { OFFICE_TEMPLATES, type OfficeTemplateKey } from "@/lib/onboarding-templates";

/**
 * Sihirbazın "Nasıl başlamak istersiniz?" paneli (popup değil, sayfa içi): ofis tipi + dolu demo / boş başla.
 * Demo, tüm modüllerde tutarlı örnek veri yükler (tek tuşla silinebilir); boş başla yalnız ofis tipi
 * tanımlarını ekler. Her iki yol da tekrar çalıştırılabilir ve hata olursa mesaj gösterir.
 */
export function StartChoice({ canEdit, canSeed }: { canEdit: boolean; canSeed: boolean }) {
  const router = useRouter();
  const [kind, setKind] = useState<OfficeTemplateKey>("konut");
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();
  const [mode, setMode] = useState<"demo" | "bos" | null>(null);
  const [done, setDone] = useState<"demo" | "bos" | null>(null);

  if (!canEdit) return null;

  function go(choice: "demo" | "bos") {
    setError(null);
    setNotes([]);
    setMode(choice);
    startTransition(async () => {
      const tpl = await applyOfficeTemplate(kind);
      if (tpl.error) return setError(tpl.error);
      if (choice === "demo") {
        const seed = await seedSampleData({ pack: kind });
        if (seed.error) return setError(seed.error);
        const skipped = seed.seed?.skipped.length ?? 0;
        if (skipped > 0) setNotes([`${skipped} modül bu ortamda etkin değil, atlandı; kalan tüm demo veri yüklendi.`]);
      }
      setDone(choice);
      router.refresh();
    });
  }

  return (
    <section aria-label="Nasıl başlamak istersiniz?" className="space-y-4 rounded-[var(--radius-card)] border border-brand-300/60 bg-brand-600/[0.04] p-4">
      <div>
        <h2 className="font-display text-base font-bold text-text">Nasıl başlamak istersiniz?</h2>
        <p className="mt-0.5 text-sm text-text-muted">Ofis tipinizi seçin; sonra dolu bir demo ofisle keşfedin ya da boş başlayın. İkisi de sonradan değiştirilebilir.</p>
      </div>
      <fieldset>
        <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-faint">Ofis tipi</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {OFFICE_TEMPLATES.map((t) => (
            <label
              key={t.key}
              className={
                "focus-within:ring-2 focus-within:ring-brand-400 flex cursor-pointer flex-col gap-0.5 rounded-[var(--radius-card)] border p-3 text-sm transition " +
                (kind === t.key ? "border-brand-600 bg-surface shadow-[var(--elev-2)]" : "border-line bg-surface hover:border-brand-300")
              }
            >
              <span className="flex items-center gap-2 font-semibold text-text">
                <input type="radio" name="office-template" value={t.key} checked={kind === t.key} onChange={() => setKind(t.key)} className="accent-[var(--brand-600)]" />
                {t.label}
              </span>
              <span className="pl-6 text-xs text-text-muted">{t.description}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-line bg-surface p-4">
          <p className="flex items-center gap-2 text-sm font-bold text-text">
            <Sparkles className="h-4 w-4 text-amber-500" aria-hidden /> Dolu demo ile başla
          </p>
          <p className="text-xs text-text-muted">
            Müşteri, talep, portföy, randevu, görev, teklif, kazanılmış anlaşma ve komisyon, kira ve giderlerle dolu bir ofis. Düzenleyin, silin, her ekranı deneyin; hazır olunca tek tuşla hepsi silinir.
          </p>
          <Button type="button" className="mt-auto self-start" icon={Sparkles} loading={pending && mode === "demo"} disabled={pending || !canSeed} onClick={() => go("demo")}>
            Demo ofisle başla
          </Button>
          {!canSeed ? <p className="text-xs text-text-faint">Demo için müşteri, portföy, talep, görev, randevu ve anlaşma yetkileri gerekir.</p> : null}
        </div>
        <div className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-line bg-surface p-4">
          <p className="flex items-center gap-2 text-sm font-bold text-text">
            <Database className="h-4 w-4 text-brand-600" aria-hidden /> Boş başla
          </p>
          <p className="text-xs text-text-muted">Hiç örnek kayıt olmadan, yalnız ofis tipinize uygun tanımlarla (kayıp nedenleri, müşteri kaynakları) başlayın.</p>
          <Button type="button" variant="secondary" className="mt-auto self-start" loading={pending && mode === "bos"} disabled={pending} onClick={() => go("bos")}>
            Boş başla
          </Button>
        </div>
      </div>
      {done ? (
        <p role="status" className="text-sm font-semibold text-mint-600">
          {done === "demo" ? "Demo ofis hazır. Ana ekrandaki bant ve Ayarlar > Örnek veriler üzerinden istediğiniz an gerçek kullanıma geçebilirsiniz." : "Ofis tipi tanımları eklendi. Aşağıdaki adımlarla devam edin."}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-xs font-semibold text-danger-500">
          {error}
        </p>
      ) : null}
      {notes.map((n) => (
        <p key={n} role="status" className="text-xs text-text-muted">
          {n}
        </p>
      ))}
    </section>
  );
}
