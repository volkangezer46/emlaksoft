"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Presentation, RefreshCw, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/components/app/toast-provider";
import { saveValuationPresentation } from "@/app/actions/valuations";
import { MARKETING_ITEMS, type MarketingItemKey, type PresentationOptions } from "@/lib/valuation/listing-pitch";

/**
 * PF-03 — "Sunum modu": değerleme raporunu yetki alma sunumuna çevirir. Açıkken rapora ofisin bölgedeki sonuçları
 * (yalnız toplu sayı, n<3 ise kart yok), pazarlama planı, danışman kartı ve randevu çağrısı eklenir. Kaydetmek kanıt
 * kartlarını o anki veriyle yeniler; müşteriye giden link aynı kalır.
 */
export function PresentationPanel({
  valuationId,
  initial,
  computedAt,
  cardCount,
}: {
  valuationId: string;
  initial: PresentationOptions;
  computedAt: string | null;
  cardCount: number;
}) {
  const router = useRouter();
  const { push } = useToast();
  const [opts, setOpts] = useState<PresentationOptions>(initial);
  const [pending, start] = useTransition();
  const dirty = JSON.stringify(opts) !== JSON.stringify(initial);

  const set = <K extends keyof PresentationOptions>(k: K, v: PresentationOptions[K]) => setOpts((o) => ({ ...o, [k]: v }));
  const toggleItem = (key: MarketingItemKey, on: boolean) =>
    setOpts((o) => ({
      ...o,
      marketingItems: on ? Array.from(new Set([...o.marketingItems, key])) : o.marketingItems.filter((k) => k !== key),
    }));

  const save = () =>
    start(async () => {
      const res = await saveValuationPresentation(valuationId, opts);
      if (res.error) {
        push(res.error, "err");
        return;
      }
      push(opts.enabled ? "Sunum güncellendi; ofis kanıtları yenilendi" : "Sunum modu kapatıldı", "ok");
      router.refresh();
    });

  const sections: Array<{ key: "trackRecord" | "marketing" | "advisor" | "cta"; label: string; hint: string }> = [
    { key: "trackRecord", label: "Bölgedeki sonuçlarımız", hint: "Satış sayısı, satış süresi, satış/ilan oranı, kayıtlı alıcı (yalnız toplu sayı)" },
    { key: "marketing", label: "Pazarlama planı", hint: "Aşağıda seçtiğiniz adımlar" },
    { key: "advisor", label: "Danışman kartı", hint: "Herkese açık profiliniz varsa ad, unvan ve telefon" },
    { key: "cta", label: "Randevu çağrısı", hint: "Online randevu bağlantınız açıksa \"Yetki görüşmesi planlayalım\"" },
  ];

  return (
    <section
      aria-labelledby="sunum-modu"
      className="no-print rounded-[var(--radius-panel)] border border-line bg-surface p-4 shadow-[var(--shadow-xs)] sm:p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="sunum-modu" className="flex items-center gap-2 font-display text-base font-bold text-ink-950">
            <Presentation className="h-4 w-4 text-brand-600" /> Yetki alma sunumu
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-text-muted">
            Satıcıya &quot;neden bizimle?&quot; sorusunun cevabını rapora ekleyin. Rakamlar yalnız ofisinizin kendi
            kayıtlarından gelir; yeterli veri yoksa ilgili kart hiç gösterilmez.
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm font-semibold text-ink-950">
          Sunum modu
          <Switch checked={opts.enabled} onCheckedChange={(v) => set("enabled", v)} aria-label="Sunum modu" />
        </label>
      </div>

      {opts.enabled ? (
        <div className="motion-enter mt-4 grid gap-4 lg:grid-cols-2">
          <fieldset className="space-y-2">
            <legend className="mb-2 text-xs font-bold uppercase tracking-wide text-text-faint">Bölümler</legend>
            {sections.map((s) => (
              <label
                key={s.key}
                className="flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-[var(--radius-card)] border border-line bg-canvas px-3 py-2"
              >
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-ink-950">{s.label}</span>
                  <span className="block text-xs text-text-muted">{s.hint}</span>
                </span>
                <Switch checked={opts[s.key]} onCheckedChange={(v) => set(s.key, v)} aria-label={s.label} />
              </label>
            ))}
          </fieldset>
          <fieldset disabled={!opts.marketing} className="space-y-1.5 disabled:opacity-50">
            <legend className="mb-2 text-xs font-bold uppercase tracking-wide text-text-faint">Pazarlama planı adımları</legend>
            {MARKETING_ITEMS.map((m) => (
              <label key={m.key} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-[var(--radius-control)] px-2 hover:bg-canvas">
                <Checkbox checked={opts.marketingItems.includes(m.key)} onChange={(e) => toggleItem(m.key, e.target.checked)} />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-ink-950">{m.label}</span>
                  <span className="block text-xs text-text-muted">{m.detail}</span>
                </span>
              </label>
            ))}
          </fieldset>
        </div>
      ) : null}

      <div className="hairline-t mt-4 flex flex-wrap items-center justify-between gap-3 pt-3">
        <p className="text-xs text-text-faint">
          {computedAt
            ? `Ofis kanıtları ${new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Istanbul" }).format(new Date(computedAt))} itibarıyla · ${cardCount} kart`
            : "Henüz kaydedilmedi."}
        </p>
        <Button onClick={save} loading={pending} variant={dirty ? "primary" : "outline"} size="sm">
          {dirty ? <Save /> : <RefreshCw />} {dirty ? "Kaydet" : "Kanıtları yenile"}
        </Button>
      </div>
    </section>
  );
}
