"use client";

import Link from "next/link";
import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowRight, CheckCircle2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { clearSampleData, type SampleDataResult } from "@/app/actions/sample-data";
import { REAL_USE_NEXT_STEPS } from "@/lib/sample-data/real-use";

export type RealUseRow = { label: string; count: number | null };

/**
 * Tek tuş "Gerçek kullanıma geç" — sayfa içi onay (popup değil). Neyin silineceğini sayılarla söyler,
 * "geri alınamaz" onayı ister, tek işlemde tüm örnek kayıtları siler. Başarıda "Ofisin gerçek kullanıma hazır"
 * ekranı + sonraki 3 adım. Kısmi hatada yarım kaldığını söyler ve "Tekrar dene" sunar (işlem idempotenttir).
 */
export function RealUseSwitch({ rows, total, canClear }: { rows: RealUseRow[]; total: number; canClear: boolean }) {
  const router = useRouter();
  const [ack, setAck] = useState(false);
  const [result, setResult] = useState<SampleDataResult | null>(null);
  const [pending, startTransition] = useTransition();
  const ackId = useId();
  const visible = rows.filter((r) => (r.count ?? 0) > 0);

  function run() {
    setResult(null);
    startTransition(async () => {
      const res = await clearSampleData();
      setResult(res);
      if (res.ok) router.refresh();
    });
  }

  if (result?.ok) {
    return <RealUseDone deleted={result.clear?.totalDeleted ?? 0} />;
  }

  return (
    <section className="space-y-4 rounded-[var(--radius-panel)] border border-danger-500/30 bg-danger-500/[0.04] p-5" aria-label="Gerçek kullanıma geç onayı">
      <div>
        <h2 className="font-display text-lg font-bold text-ink-950">Örnek veriler silinecek</h2>
        <p className="mt-1 text-sm text-text-muted">
          Toplam <strong className="text-text">{total}</strong> örnek kayıt <strong className="text-danger-600">kalıcı olarak silinir ve geri alınamaz</strong>.
          Senin eklediğin gerçek müşteri, portföy ve diğer kayıtlar korunur; ofis ayarların, ekibin ve aboneliğin değişmez.
        </p>
      </div>
      {visible.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5" aria-label="Silinecek kayıtlar">
          {visible.map((r) => (
            <li key={r.label} className="rounded-full bg-surface px-2.5 py-1 text-xs font-semibold text-text shadow-[inset_0_0_0_1px_var(--line)]">
              {r.count} {r.label.toLocaleLowerCase("tr-TR")}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-text-muted">Silinecek örnek kayıt görünmüyor; yine de örnek veri işareti temizlenir.</p>
      )}
      <label htmlFor={ackId} className="flex cursor-pointer items-start gap-2 text-sm text-text">
        <input id={ackId} type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-1 h-4 w-4 accent-[var(--brand-600)]" />
        Bu işlemin geri alınamayacağını anlıyorum.
      </label>
      {result?.error ? (
        <div role="alert" className="flex items-start gap-2 text-xs font-semibold text-danger-600">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>
            {result.error}
            {result.clear?.failed.length ? ` Takılan: ${result.clear.failed.map((f) => `${f.label} (${f.message})`).join("; ")}` : ""}
          </span>
        </div>
      ) : null}
      {!canClear ? (
        <p role="status" className="text-xs font-semibold text-text-muted">
          Bu işlem yalnız ofis sahibi veya genel müdür tarafından yapılabilir.
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="danger" icon={Trash2} loading={pending} disabled={!ack || !canClear} onClick={run}>
          {result?.error ? "Tekrar dene" : "Gerçek kullanıma geç"}
        </Button>
        <Button href="/app/ayarlar" variant="ghost" disabled={pending}>
          Vazgeç
        </Button>
      </div>
    </section>
  );
}

/** Başarı ekranı: hem geçiş sonrasında hem örnek veri hiç yokken (ofis zaten gerçek kullanımda) gösterilir. */
export function RealUseDone({ deleted }: { deleted: number | null }) {
  return (
    <section className="space-y-5 rounded-[var(--radius-panel)] border border-mint-500/30 bg-mint-500/[0.05] p-5" aria-label="Ofisin gerçek kullanıma hazır">
      <div className="flex items-start gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[var(--radius-card)] bg-mint-500/15 text-mint-600">
          <CheckCircle2 className="h-6 w-6" aria-hidden />
        </span>
        <div>
          <h2 className="font-display text-lg font-bold text-ink-950">Ofisin gerçek kullanıma hazır</h2>
          <p className="mt-1 text-sm text-text-muted">
            {deleted != null && deleted > 0
              ? `${deleted} örnek kayıt silindi. Artık yalnız kendi kayıtlarınla çalışıyorsun; şerit kaldırıldı.`
              : "Ofiste örnek veri yok; tüm ekranlar kendi kayıtlarını gösterir."}
          </p>
        </div>
      </div>
      <ol className="grid gap-2 sm:grid-cols-3">
        {REAL_USE_NEXT_STEPS.map((s, i) => (
          <li key={s.href}>
            <Link href={s.href} className="lift group flex h-full flex-col gap-1 rounded-[var(--radius-card)] border border-line bg-surface p-4 transition hover:border-brand-300">
              <span className="text-xs font-bold uppercase tracking-wide text-text-faint">Adım {i + 1}</span>
              <span className="flex items-center justify-between gap-2 font-display font-bold text-ink-950">
                {s.title}
                <ArrowRight className="h-4 w-4 shrink-0 text-text-faint transition group-hover:translate-x-0.5 group-hover:text-brand-600" aria-hidden />
              </span>
              <span className="text-xs leading-relaxed text-text-muted">{s.description}</span>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}
