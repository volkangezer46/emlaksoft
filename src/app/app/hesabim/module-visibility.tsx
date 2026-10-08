"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { resetModuleHidden, setModuleHidden } from "@/app/actions/module-prefs";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { BUNDLES, getModuleDef, modulesOfBundle, type FeatureKey } from "@/lib/modules/registry";

type Feedback = { tone: "success" | "danger"; text: string } | null;

/**
 * Hesabım > Görünüm: ofisin AÇIK tuttuğu modüllerden kullanmadıklarınızı kendi menünüzden, ana ekranınızdan ve
 * komut paletinizden gizleyin. Yetkinizi ve ofis ayarını değiştirmez; yalnız sizin görünümünüz.
 */
export function ModuleVisibility({ officeClosed, hidden, canEdit }: { officeClosed: string[]; hidden: string[]; canEdit: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<Feedback>(null);

  function run(task: () => Promise<{ ok?: boolean; error?: string; message?: string }>) {
    setFeedback(null);
    startTransition(async () => {
      try {
        const res = await task();
        setFeedback(res.error ? { tone: "danger", text: res.error } : { tone: "success", text: res.message ?? "Kaydedildi." });
        if (!res.error) router.refresh();
      } catch {
        setFeedback({ tone: "danger", text: "İşlem sırasında bağlantı kesildi. Lütfen tekrar deneyin." });
      }
    });
  }

  const bundles = BUNDLES.map((b) => ({
    bundle: b,
    keys: modulesOfBundle(b.id).filter((k) => !officeClosed.includes(k)),
  })).filter((g) => g.keys.length > 0);

  return (
    <div className="space-y-4">
      <div aria-live="polite">
        {feedback ? (
          <Alert tone={feedback.tone} title={feedback.tone === "success" ? "Tamam" : "İşlem yapılamadı"}>
            {feedback.text}
          </Alert>
        ) : null}
      </div>
      {bundles.map(({ bundle, keys }) => (
        <section key={bundle.id} aria-labelledby={`gor-${bundle.id}`} className="space-y-2">
          <h3 id={`gor-${bundle.id}`} className="font-display text-sm font-bold text-ink-950">{bundle.title}</h3>
          <ul className="grid gap-2 sm:grid-cols-2">
            {keys.map((key: FeatureKey) => {
              const isShown = !hidden.includes(key);
              const def = getModuleDef(key);
              return (
                <li key={key} className="flex items-center justify-between gap-3 rounded-[var(--radius-control)] border border-line bg-canvas/60 px-3 py-2">
                  <span className="min-w-0 text-sm text-ink-950">{def.label}</span>
                  <Switch
                    checked={isShown}
                    disabled={!canEdit || pending}
                    aria-label={`${def.label} ${isShown ? "görünür" : "gizli"}`}
                    onCheckedChange={(next) => run(() => setModuleHidden(key, !next))}
                  />
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      {bundles.length === 0 ? <p className="text-sm text-text-muted">Ofisiniz şu an kapatılabilir hiçbir modül açık tutmuyor.</p> : null}
      {hidden.length > 0 ? (
        <Button size="sm" variant="secondary" loading={pending} disabled={!canEdit} onClick={() => run(() => resetModuleHidden())}>
          Tümünü yeniden göster
        </Button>
      ) : null}
    </div>
  );
}
