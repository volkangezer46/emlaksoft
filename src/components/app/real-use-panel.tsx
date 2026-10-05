"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { clearSampleData, type SampleDataResult } from "@/app/actions/sample-data";

export type RealUseRow = { label: string; count: number | null };

/**
 * "Gerçek kullanıma başla" — satır içi onay paneli (popup değil). Önce neyin silineceğini sayılarla
 * özetler, sonra "geri alınamaz" onayı ister; tek işlemde tüm örnek kayıtları siler. Kısmi hatada
 * yarım kaldığını söyler ve "Tekrar dene" sunar (işlem idempotenttir).
 */
export function RealUsePanel({
  rows,
  total,
  canClear,
  defaultOpen = false,
}: {
  rows: RealUseRow[];
  total: number;
  canClear: boolean;
  defaultOpen?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(defaultOpen);
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
      if (res.ok) {
        setOpen(false);
        router.refresh();
      }
    });
  }

  if (result?.ok) {
    return (
      <p role="status" className="flex items-center gap-2 text-sm font-semibold text-mint-600">
        <CheckCircle2 className="h-4 w-4" aria-hidden />
        Örnek veriler silindi ({result.clear?.totalDeleted ?? 0} kayıt). Artık kendi kayıtlarınızla çalışıyorsunuz.
      </p>
    );
  }

  if (!open) {
    return (
      <Button type="button" variant="secondary" icon={Trash2} onClick={() => setOpen(true)} disabled={!canClear} title={canClear ? undefined : "Bu işlem için ayar yetkisi gerekir"}>
        Gerçek kullanıma başla
      </Button>
    );
  }

  return (
    <div className="w-full space-y-3 rounded-[var(--radius-card)] border border-danger-500/30 bg-danger-500/[0.04] p-4" role="group" aria-label="Gerçek kullanıma başla onayı">
      <p className="text-sm font-bold text-ink-950">Gerçek kullanıma geçiliyor: tüm örnek veriler silinecek</p>
      {visible.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5" aria-label="Silinecek kayıtlar">
          {visible.map((r) => (
            <li key={r.label} className="rounded-full bg-surface px-2.5 py-1 text-xs font-semibold text-text shadow-[inset_0_0_0_1px_var(--line)]">
              {r.count} {r.label.toLocaleLowerCase("tr-TR")}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-text-muted">Silinecek örnek kayıt görünmüyor; yine de işaret temizlenir.</p>
      )}
      <p className="text-xs leading-relaxed text-text-muted">
        Toplam <strong className="text-text">{total}</strong> örnek kayıt <strong className="text-danger-500">kalıcı olarak silinir ve geri alınamaz</strong>. Sizin
        girdiğiniz gerçek müşteri, portföy ve diğer kayıtlara dokunulmaz. İşlem yarım kalırsa silinenler geri gelmez, kalanlar için tekrar deneyebilirsiniz.
      </p>
      <label htmlFor={ackId} className="flex cursor-pointer items-start gap-2 text-sm text-text">
        <input id={ackId} type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-1 h-4 w-4 accent-[var(--brand-600)]" />
        Bu işlemin geri alınamayacağını anlıyorum.
      </label>
      {result?.error ? (
        <div role="alert" className="flex items-start gap-2 text-xs font-semibold text-danger-500">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>
            {result.error}
            {result.clear?.failed.length ? ` Takılan: ${result.clear.failed.map((f) => `${f.label} (${f.message})`).join("; ")}` : ""}
          </span>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="danger" icon={Trash2} loading={pending} disabled={!ack || !canClear} onClick={run}>
          {result?.error ? "Tekrar dene" : "Tüm örnek verileri sil"}
        </Button>
        <Button type="button" variant="ghost" onClick={() => { setOpen(false); setAck(false); }} disabled={pending}>
          Vazgeç
        </Button>
      </div>
    </div>
  );
}
