"use client";

import Link from "@/components/ui/smart-link";
import { useState, useTransition } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { generateControlSummary, type ControlSummaryResult } from "@/app/actions/listing-control-report";

/**
 * Yönetici/danışman özeti. Kural tabanlı metin her zaman görünür; "AI ile özetle" yalnız kullanıcı tıklayınca çalışır
 * (otomatik çağrı yok). AI çıktısındaki her sayı veritabanı olgularıyla sunucuda doğrulanır; doğrulanamazsa AI metni
 * gösterilmez ve nedeni söylenir. Her olgu tıklanabilir: filtrelenmiş hedefe gider.
 */
export function ControlAiSummary({ initial }: { initial: { rules: string[]; facts: { key: string; label: string; value: number; href: string }[] } }) {
  const [pending, start] = useTransition();
  const [period, setPeriod] = useState<"day" | "week">("day");
  const [audience, setAudience] = useState<"manager" | "advisor">("manager");
  const [result, setResult] = useState<ControlSummaryResult | null>(null);
  const rules = result && result.ok ? result.rules : initial.rules;
  const facts = result && result.ok ? result.facts : initial.facts;

  const run = () =>
    start(async () => {
      setResult(await generateControlSummary(period, audience));
    });

  const select = "focus-ring rounded-[var(--radius-control)] border border-line bg-canvas px-2.5 py-2 text-sm";
  return (
    <div className="space-y-3">
      <ul className="space-y-1 text-sm text-text">
        {rules.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor="lc-sum-period">Dönem</label>
        <select id="lc-sum-period" className={select} value={period} onChange={(e) => setPeriod(e.target.value === "week" ? "week" : "day")}>
          <option value="day">Son 24 saat</option>
          <option value="week">Son 7 gün</option>
        </select>
        <label className="sr-only" htmlFor="lc-sum-aud">Okuyucu</label>
        <select id="lc-sum-aud" className={select} value={audience} onChange={(e) => setAudience(e.target.value === "advisor" ? "advisor" : "manager")}>
          <option value="manager">Yönetici özeti</option>
          <option value="advisor">Danışman özeti</option>
        </select>
        <Button type="button" onClick={run} loading={pending} size="md" variant="secondary" icon={Sparkles}>
          {pending ? "Hazırlanıyor" : "AI ile özetle"}
        </Button>
      </div>
      {result && !result.ok ? <p role="alert" className="text-sm text-danger-600">{result.error}</p> : null}
      {result && result.ok ? (
        result.ai ? (
          <p className="rounded-[var(--radius-control)] border border-line bg-canvas p-3 text-sm text-text">{result.ai}</p>
        ) : (
          <p className="text-sm text-text-muted">AI özeti şu an üretilemedi (anahtar tanımlı değil, servis yanıt vermedi ya da çıktı sayılarla doğrulanamadı). Yukarıdaki özet doğrudan veriden hazırlandı.</p>
        )
      ) : null}
      <ul className="flex flex-wrap gap-2 text-xs">
        {facts.map((f) => (
          <li key={f.key}>
            <Link href={f.href} className="focus-ring inline-flex items-center gap-1 rounded-full border border-line px-2.5 py-1 text-text-muted hover:text-text">
              {f.label}: <span className="font-semibold tabular-nums text-text">{f.value}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
