"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Crosshair, Loader2 } from "lucide-react";
import { previewDemandMatches, type MatchPreviewResult } from "@/app/actions/match-preview";
import { hasDemandContent, encodeDemandPreviewParam, type DemandFormValues } from "@/lib/demand-criteria";
import { tierCls, tierLabel } from "@/lib/matching";
import { AnimatedNumber } from "@/components/ui/animated-number";

/**
 * Formda salt-okunur CANLI eşleşme önizlemesi. Değerler debounce ile `previewDemandMatches`
 * action'ına gider (gerçek portföy sorgusu + scoreDemandProperty). Sayı, filtreli
 * `/app/eslestirme?kriter=` sayfasına bağlanır (sıfır çıkmaz metrik). Sahte sayı yok:
 * sonuç gelene dek "hesaplanıyor", kriter yoksa açıklama gösterilir.
 *
 * Özet paneli iki yerde render edilir (sağ panel + dar ekran `<details>`); aynı girdi için
 * tek istek atılır (modül düzeyi söz cache'i).
 */

const DEBOUNCE_MS = 600;
const inflight = new Map<string, Promise<MatchPreviewResult>>();

function request(key: string, values: DemandFormValues): Promise<MatchPreviewResult> {
  const hit = inflight.get(key);
  if (hit) return hit;
  const p = previewDemandMatches(values).finally(() => {
    // Kısa süre sonra düş: ardışık aynı girdi (iki panel) tek istek, sonra tazelenebilir.
    setTimeout(() => inflight.delete(key), 3000);
  });
  inflight.set(key, p);
  return p;
}

export function DemandMatchPreview({ values }: { values: DemandFormValues }) {
  const enabled = hasDemandContent(values) && (values.transaction_type ?? "").trim() !== "";
  const key = enabled ? encodeDemandPreviewParam(values) : "";
  // `prevCount`: bir önceki başarılı sonucun sayısı — yeni sonuç geldiğinde sayı eskiden yeniye akar.
  const [done, setDone] = useState<{ key: string; result: MatchPreviewResult; prevCount?: number } | null>(null);

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      request(key, values)
        .then((result) => {
          if (!cancelled) {
            setDone((old) => ({ key, result, prevCount: old?.result.ok ? old.result.count : old?.prevCount }));
          }
        })
        .catch(() => {
          if (!cancelled) setDone({ key, result: { ok: false, error: "Önizleme alınamadı." } });
        });
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // `values` içeriği key'e sığdırılmıştır; nesne kimliği değil içerik değişimi tetikler.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const current = done && done.key === key ? done.result : null;

  return (
    <section
      aria-live="polite"
      className="rounded-[var(--radius-control)] border border-line bg-canvas/60 p-3"
    >
      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.08em] text-text-muted">
        <Crosshair className="h-3.5 w-3.5" aria-hidden /> Canlı eşleşme önizlemesi
      </p>
      {!enabled ? (
        <p className="mt-2 text-xs text-text-muted">
          Bütçe, oda, bölge gibi bir kriter girince eşleşen portföyler burada görünür. Kayıt yazılmaz.
        </p>
      ) : !current ? (
        <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-text-muted">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Eşleşen portföyler hesaplanıyor…
        </p>
      ) : !current.ok ? (
        <p className="mt-2 text-xs text-amber-800">{current.error}</p>
      ) : (
        <div className="mt-2 space-y-2">
          <Link
            href={current.href}
            className="focus-ring group flex items-center justify-between gap-2 rounded-[var(--radius-control)] px-1 py-0.5 text-sm font-semibold text-ink-950 hover:text-brand-600"
          >
            <span>
              <span className="font-display text-xl font-extrabold">
                <AnimatedNumber value={current.count} from={done?.prevCount} />
              </span>{" "}
              portföy eşleşiyor
            </span>
            <ArrowUpRight className="h-4 w-4 shrink-0 opacity-60 transition group-hover:opacity-100" aria-hidden />
          </Link>
          {current.top.length > 0 ? (
            <ul className="space-y-1.5">
              {current.top.map((p) => (
                <li key={p.id}>
                  <Link
                    href={`/app/portfoyler/${p.id}`}
                    className="focus-ring flex items-center justify-between gap-2 rounded-[var(--radius-control)] px-1 py-0.5 text-xs hover:bg-brand-600/5"
                  >
                    <span className="min-w-0 truncate font-medium text-ink-950">{p.title}</span>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 font-bold ${tierCls(p.tier)}`} title={tierLabel(p.tier)}>
                      {p.score}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-text-muted">
              Şu an uyan portföy yok.{" "}
              <Link href="/app/portfoyler/yeni" className="font-semibold text-brand-600 underline underline-offset-2">
                Portföy ekle
              </Link>
            </p>
          )}
          <p className="text-xs text-text-faint">
            Eşleştirme sayfasıyla aynı skor ve eşik (≥ 35); olmazsa olmaz kriterler elenir.
            {current.scanned >= 200 ? " İlk 200 aday taranır." : null}
          </p>
        </div>
      )}
    </section>
  );
}
