"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Layers, Lock, PowerOff, Sparkles } from "lucide-react";
import { applyModulePreset, setModuleEnabled } from "@/app/actions/modules";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { computePresetChanges, MODULE_PRESETS, type ModulePreset } from "@/lib/modules/logic";
import {
  CORE_AREAS,
  dependentsOf,
  FEATURE_GROUPS,
  getModuleDef,
  isFeatureKey,
  type FeatureKey,
  type FeatureGroupId,
} from "@/lib/modules/registry";

export type ModuleCardData = {
  key: FeatureKey;
  label: string;
  desc: string;
  group: FeatureGroupId;
  enabled: boolean;
  /** Platform kilidi: ofis değiştiremez. */
  platformLocked: boolean;
  /** Paketle kilitli: ofis değiştiremez. */
  planLocked: boolean;
  requiredPlan: string | null;
  upgradeHref: string | null;
  dependsOn: { key: string; label: string }[];
  stops: string | null;
  /** Modülün ana sayfası (açıkken "Aç" bağlantısı; yoksa null). */
  href: string | null;
};

type Feedback = { tone: "success" | "danger"; text: string } | null;

function labelOf(key: string): string {
  return isFeatureKey(key) ? getModuleDef(key).label : key;
}

export function ModulesBoard({
  cards,
  closed,
  locked,
  planLocked,
  canEdit,
}: {
  cards: ModuleCardData[];
  closed: string[];
  locked: string[];
  planLocked: string[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [confirmKey, setConfirmKey] = useState<FeatureKey | null>(null);
  const [previewId, setPreviewId] = useState<ModulePreset["id"] | null>(null);

  function run(task: () => Promise<{ ok?: boolean; error?: string; message?: string }>) {
    setFeedback(null);
    startTransition(async () => {
      try {
        const res = await task();
        if (res.error) {
          setFeedback({ tone: "danger", text: res.error });
          return;
        }
        setFeedback({ tone: "success", text: res.message ?? "Kaydedildi." });
        setConfirmKey(null);
        setPreviewId(null);
        router.refresh();
      } catch {
        setFeedback({ tone: "danger", text: "İşlem sırasında bağlantı kesildi. Lütfen tekrar deneyin." });
      }
    });
  }

  function toggle(card: ModuleCardData, next: boolean) {
    if (!next) {
      setConfirmKey(card.key);
      setFeedback(null);
      return;
    }
    run(() => setModuleEnabled(card.key, true));
  }

  const openDependents = (key: FeatureKey) => dependentsOf(key).filter((k) => !closed.includes(k));

  return (
    <div className="space-y-6">
      <div aria-live="polite">
        {feedback ? (
          <Alert tone={feedback.tone} title={feedback.tone === "success" ? "Tamam" : "İşlem yapılamadı"}>
            {feedback.text}
          </Alert>
        ) : null}
      </div>

      <section aria-labelledby="mod-presets" className="dashboard-panel rounded-[var(--radius-panel)] border border-line bg-surface p-4 md:p-6">
        <div className="flex items-start gap-3 border-b border-line pb-4">
          <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-[var(--radius-control)] bg-brand-600/10 text-brand-700">
            <Sparkles className="h-4 w-4" />
          </span>
          <div>
            <h2 id="mod-presets" className="font-display font-bold text-ink-950">Ofis tipine göre hazır düzen</h2>
            <p className="text-xs text-text-muted">Tek tıkla ofisinize uygun modülleri açın, gerisini kapatın. Önce neyin değişeceğini görürsünüz; verileriniz silinmez.</p>
          </div>
        </div>
        <ul className="mt-4 grid gap-3 sm:grid-cols-2">
          {MODULE_PRESETS.map((preset) => {
            const diff = computePresetChanges(preset, closed, { locked, planLocked });
            const isOpen = previewId === preset.id;
            return (
              <li key={preset.id} className="rounded-[var(--radius-card)] border border-line bg-canvas/60 p-4">
                <p className="text-sm font-bold text-ink-950">{preset.title}</p>
                <p className="mt-1 text-xs text-text-muted">{preset.desc}</p>
                <div className="mt-3">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={!canEdit}
                    aria-expanded={isOpen}
                    onClick={() => {
                      setFeedback(null);
                      setPreviewId(isOpen ? null : preset.id);
                    }}
                  >
                    {isOpen ? "Önizlemeyi kapat" : "Önizle"}
                  </Button>
                </div>
                {isOpen ? (
                  <div className="mt-3 space-y-2 rounded-[var(--radius-control)] border border-brand-300/50 bg-brand-600/[0.04] p-3 text-xs">
                    <p className="font-semibold text-ink-950">Bu ön ayar uygulanırsa:</p>
                    <p>
                      <span className="font-semibold text-danger-600">Kapanacak ({diff.toClose.length}):</span>{" "}
                      {diff.toClose.length > 0 ? diff.toClose.map(labelOf).join(", ") : "değişiklik yok"}
                    </p>
                    <p>
                      <span className="font-semibold text-mint-700">Açılacak ({diff.toOpen.length}):</span>{" "}
                      {diff.toOpen.length > 0 ? diff.toOpen.map(labelOf).join(", ") : "değişiklik yok"}
                    </p>
                    {diff.skipped.length > 0 ? (
                      <p className="text-text-muted">
                        Dokunulmayacak: {[...new Set(diff.skipped.map((s) => `${labelOf(s.key)} (${s.reason === "platform" ? "platform kilidi" : "pakette yok"})`))].join(", ")}
                      </p>
                    ) : null}
                    <p className="text-text-muted">Çekirdek modüller (müşteri, portföy, anlaşma, randevu...) her zaman açıktır.</p>
                    <div className="flex flex-wrap gap-2 pt-1">
                      <Button
                        size="sm"
                        loading={pending}
                        disabled={diff.toClose.length + diff.toOpen.length === 0}
                        onClick={() => run(() => applyModulePreset(preset.id))}
                      >
                        Uygula
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setPreviewId(null)}>Vazgeç</Button>
                    </div>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </section>

      {FEATURE_GROUPS.map((group) => {
        const groupCards = cards.filter((c) => c.group === group.id);
        if (groupCards.length === 0) return null;
        return (
          <section key={group.id} aria-labelledby={`mod-${group.id}`} className="space-y-3">
            <h2 id={`mod-${group.id}`} className="font-display text-base font-bold text-ink-950">{group.title}</h2>
            <ul className="grid gap-3 lg:grid-cols-2">
              {groupCards.map((card) => {
                const frozen = card.platformLocked || card.planLocked || !canEdit;
                const dependents = openDependents(card.key);
                const confirming = confirmKey === card.key;
                return (
                  <li key={card.key} className="rounded-[var(--radius-panel)] border border-line bg-surface p-4">
                    <div className="flex items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-display font-bold text-ink-950">{card.label}</h3>
                          {card.platformLocked ? <Badge variant="warning" size="sm">Platform tarafından kilitli</Badge> : null}
                          {card.planLocked ? <Badge variant="info" size="sm">Pakette yok</Badge> : null}
                          {!card.enabled && !card.planLocked ? <Badge variant="neutral" size="sm">Kapalı</Badge> : null}
                        </div>
                        <p className="mt-1 text-xs leading-relaxed text-text-muted">{card.desc}</p>
                        {card.dependsOn.length > 0 ? (
                          <p className="mt-1.5 text-xs text-text-muted">
                            <span className="font-semibold text-ink-950">Bağımlılık:</span> {card.dependsOn.map((d) => d.label).join(", ")} kapalıyken açılamaz.
                          </p>
                        ) : null}
                        {card.stops ? (
                          <p className="mt-1 text-xs text-text-faint">Kapalıyken: {card.stops}</p>
                        ) : null}
                        {card.requiredPlan ? (
                          <p className="mt-1 text-xs text-text-faint">
                            {card.planLocked ? (
                              <>
                                {card.requiredPlan} paketiyle açılır.{" "}
                                {card.upgradeHref ? (
                                  <Link href={card.upgradeHref} className="font-semibold text-brand-600 hover:underline">Yükselt</Link>
                                ) : null}
                              </>
                            ) : (
                              <>En düşük paket: {card.requiredPlan}</>
                            )}
                          </p>
                        ) : null}
                        {card.enabled && card.href ? (
                          <p className="mt-1.5">
                            <Link href={card.href} className="text-xs font-semibold text-brand-600 hover:underline">Modülü aç</Link>
                          </p>
                        ) : null}
                      </div>
                      <div className="flex shrink-0 items-center gap-2 pt-0.5">
                        {frozen ? <Lock className="h-3.5 w-3.5 text-text-faint" aria-hidden /> : null}
                        <Switch
                          checked={card.enabled}
                          disabled={frozen || pending}
                          aria-label={`${card.label} ${card.enabled ? "açık" : "kapalı"}`}
                          onCheckedChange={(next) => toggle(card, next)}
                        />
                      </div>
                    </div>
                    {confirming ? (
                      <div role="group" aria-label={`${card.label} kapatma onayı`} className="mt-3 space-y-2 rounded-[var(--radius-card)] border border-amber-400/40 bg-amber-400/8 p-3 text-xs">
                        <p className="flex items-start gap-2 font-semibold text-ink-950">
                          <PowerOff className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                          {card.label} kapatılsın mı?
                        </p>
                        <p className="text-text-muted">
                          Bu modülü kapatırsanız menüden ve aramadan gizlenir, ana ekranda görünmez, otomasyon ve bildirim üretmez.
                          Verileriniz silinmez; istediğiniz zaman yeniden açabilirsiniz.
                        </p>
                        {dependents.length > 0 ? (
                          <p className="font-semibold text-amber-800">Bunlar da kapanır: {dependents.map(labelOf).join(", ")}.</p>
                        ) : null}
                        <div className="flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            variant="danger"
                            loading={pending}
                            onClick={() => run(() => setModuleEnabled(card.key, false, dependents.length > 0))}
                          >
                            {dependents.length > 0 ? "İkisini de kapat" : "Kapat"}
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setConfirmKey(null)}>Vazgeç</Button>
                        </div>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}

      <section aria-labelledby="mod-core" className="space-y-3">
        <h2 id="mod-core" className="font-display text-base font-bold text-ink-950">Çekirdek ve sistem alanları</h2>
        <p className="text-xs text-text-muted">Bunlar ofisin omurgasıdır ve kapatılamaz.</p>
        <ul className="grid gap-3 lg:grid-cols-2">
          {CORE_AREAS.map((area) => (
            <li key={area.key} className="flex items-start gap-3 rounded-[var(--radius-panel)] border border-line bg-canvas/60 p-4">
              <span aria-hidden className="grid h-8 w-8 shrink-0 place-items-center rounded-[var(--radius-control)] bg-ink-950/8 text-text-muted">
                <Layers className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-display font-bold text-ink-950">{area.label}</h3>
                  <Badge variant="neutral" size="sm">Çekirdek</Badge>
                </div>
                <p className="mt-1 text-xs text-text-muted">{area.desc}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
