"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpRight, Lightbulb, RotateCcw } from "lucide-react";
import Link from "@/components/ui/smart-link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { saveInsightSettings } from "@/app/actions/insights";

export type InsightRuleRowView = { id: string; base: string; label: string; state: "on" | "off" | "auto" };

/**
 * Ofis ayarları > Öneriler kartı (yalnız ofis sahibi / genel müdür görür; sunucu eylemleri yetkiyi ayrıca doğrular).
 * Kural adları kayıt listesinden gelir. Otomatik sessize alınan kural için "Yeniden aç" vardır. Kalite sayıları
 * gösterilmez: arkasında filtreli bir hedef ekran yoktur (sıfır çıkmaz metrik ilkesi).
 */
export function InsightRulesCard({
  rules,
  narrativeEnabled,
  reopened,
}: {
  rules: InsightRuleRowView[];
  narrativeEnabled: boolean;
  /** Sahibin "Yeniden aç" dediği (otomatik sessizden muaf) kural taban adları. */
  reopened: string[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [onlyClosed, setOnlyClosed] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const closed = rules.filter((r) => r.state !== "on");
  const shown = onlyClosed ? closed : rules;
  const dirty = closed.length > 0 || narrativeEnabled || reopened.length > 0;

  function run(fn: () => Promise<{ ok?: boolean; error?: string }>) {
    setError(null);
    start(async () => {
      const res = await fn();
      if (res.error) setError(res.error);
      else {
        setConfirmReset(false);
        router.refresh();
      }
    });
  }

  /** Otomatik sessiz kuralı yeniden açar: taban ad `qualityReopened`a eklenir (sunucuda ayrıca owner/gm doğrulanır). */
  function reopen(rule: InsightRuleRowView) {
    run(() => saveInsightSettings({ qualityReopened: [...new Set([...reopened, rule.base])] }));
  }

  function toggle(rule: InsightRuleRowView, nextOn: boolean) {
    if (nextOn && rule.state === "auto") {
      reopen(rule);
      return;
    }
    const mutedBases = new Set(rules.filter((r) => r.state === "off").map((r) => r.base));
    if (nextOn) mutedBases.delete(rule.base);
    else mutedBases.add(rule.base);
    run(() => saveInsightSettings({ mutedRules: [...mutedBases] }));
  }

  return (
    <Card aria-labelledby="oneriler-baslik">
      <CardHeader>
        <div className="flex items-start gap-3">
          <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius-control)] bg-accent/10 text-accent">
            <Lightbulb className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <CardTitle id="oneriler-baslik" className="text-base">
              Öneriler
            </CardTitle>
            <CardDescription>
              Ana ekranda size ve ekibinize görünen önerilerin hangi kurallarla üretileceğini seçin. Kapattığınız kural yeni öneri üretmez;
              mevcut öneriler süresi dolunca kalkar.
            </CardDescription>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          {closed.length > 0 ? (
            <button
              type="button"
              aria-pressed={onlyClosed}
              onClick={() => setOnlyClosed((v) => !v)}
              className="focus-ring press rounded-full border border-line bg-canvas px-3 py-1 text-xs font-semibold text-ink-950 transition hover:border-border-strong aria-pressed:border-amber-400/60 aria-pressed:bg-amber-400/15"
              title={onlyClosed ? "Tüm kuralları göster" : "Yalnız kapalı kuralları göster"}
            >
              Kapalı kural: {closed.length}
            </button>
          ) : (
            <span className="text-xs font-medium text-text-muted">Tüm kurallar açık</span>
          )}
          {confirmReset ? (
            <span className="flex items-center gap-1.5">
              <Button size="sm" variant="danger" loading={pending} onClick={() => run(() => saveInsightSettings({ mutedRules: [], narrativeEnabled: false, qualityReopened: [] }))}>
                Evet, varsayılana dön
              </Button>
              <Button size="sm" variant="ghost" disabled={pending} onClick={() => setConfirmReset(false)}>
                Vazgeç
              </Button>
            </span>
          ) : (
            <Button size="sm" variant="outline" icon={RotateCcw} disabled={!dirty || pending} onClick={() => setConfirmReset(true)}>
              Varsayılana dön
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-1">
        {error ? (
          <p role="alert" className="mb-2 rounded-[var(--radius-control)] border border-danger-500/30 bg-danger-500/10 px-3 py-2 text-xs font-medium text-danger-700">
            {error}
          </p>
        ) : null}
        <ul className="divide-y divide-line">
          {shown.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p id={`kural-${r.base}`} className="text-sm font-semibold text-ink-950">
                  {r.label}
                </p>
                {r.state === "auto" ? (
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <Badge variant="warning" size="sm" dot>
                      Yanlış alarm oranı yüksek olduğu için otomatik sessizde
                    </Badge>
                    <Button size="xs" variant="outline" disabled={pending} onClick={() => reopen(r)}>
                      Yeniden aç
                    </Button>
                  </div>
                ) : null}
              </div>
              <Switch
                checked={r.state === "on"}
                disabled={pending}
                onCheckedChange={(next) => toggle(r, next)}
                aria-labelledby={`kural-${r.base}`}
              />
            </li>
          ))}
          {shown.length === 0 ? <li className="py-6 text-center text-sm text-text-muted">Kapalı kural yok.</li> : null}
        </ul>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-3">
          <div className="min-w-0 flex-1">
            <p id="oneri-ai-anlatim" className="text-sm font-semibold text-ink-950">
              Günlük özeti yapay zekâyla anlat
            </p>
            <p className="text-xs text-text-muted">
              Varsayılan olarak kapalıdır. Açarsanız yalnız günlük özet kartının anlatımı üretilir; ofisinizin yapay zekâ kullanım kotasına tabidir, kişisel
              veriler maskelenir ve kuralların ürettiği metin her zaman korunur.
            </p>
          </div>
          <Switch
            checked={narrativeEnabled}
            disabled={pending}
            onCheckedChange={(next) => run(() => saveInsightSettings({ narrativeEnabled: next }))}
            aria-labelledby="oneri-ai-anlatim"
          />
        </div>

        <p className="pt-2 text-xs text-text-faint">
          Etkilediği ekran:{" "}
          <Link href="/app" className="inline-flex items-center gap-0.5 font-semibold text-brand-600 hover:underline">
            Ana ekran önerileri <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
