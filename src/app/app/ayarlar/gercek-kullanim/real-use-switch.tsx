"use client";

import Link from "@/components/ui/smart-link";
import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowRight, CheckCircle2, Lock, ShieldAlert, Trash2 } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { FormInput } from "@/components/ui/form-controls";
import { clearSampleData, type SampleDataResult } from "@/app/actions/sample-data";
import { REAL_USE_CONFIRM_WORD, REAL_USE_NEXT_STEPS, realUseConfirmMatches } from "@/lib/sample-data/real-use";

export type RealUseRow = { label: string; count: number | null };

/**
 * Tek tuş "Gerçek kullanıma geç" — İKİ ONAY:
 *  1. Onay penceresi: neyin silineceği varlık başına sayılarla (müşteri, portföy, fotoğraf, anlaşma, demo ekip...) +
 *     "Devam et".
 *  2. İkinci pencere: ofis adını ya da SİL yazmak zorunlu; son düğme ancak eşleşince açılır. Sunucu aynı metni yeniden
 *     doğrular (`clearSampleData({ confirm })`); RPC tek transaction'dır ve ofisi KİLİTLER (bir daha örnek veri yüklenemez).
 * Başarıda "İlk adımlar" ekranı. Hata/kısmi durumda hiçbir şey silinmemiştir; "Tekrar dene" sunulur.
 */
export function RealUseSwitch({ rows, total, canClear, officeName }: { rows: RealUseRow[]; total: number; canClear: boolean; officeName: string }) {
  const router = useRouter();
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [typed, setTyped] = useState("");
  const [result, setResult] = useState<SampleDataResult | null>(null);
  const [pending, startTransition] = useTransition();
  const inputId = useId();
  const visible = rows.filter((r) => (r.count ?? 0) > 0);
  const matches = realUseConfirmMatches(typed, officeName);

  function run() {
    setResult(null);
    startTransition(async () => {
      const res = await clearSampleData({ confirm: typed });
      setResult(res);
      if (res.ok) {
        setStep(0);
        router.refresh();
      }
    });
  }

  if (result?.ok) return <RealUseDone deleted={result.clear?.totalDeleted ?? 0} />;

  const counts = (
    <ul className="grid gap-1.5 sm:grid-cols-2" aria-label="Silinecek örnek kayıtlar">
      {visible.map((r) => (
        <li key={r.label} className="flex items-center justify-between gap-3 rounded-[var(--radius-control)] border border-line bg-surface px-3 py-2 text-sm">
          <span className="text-text-muted">{r.label}</span>
          <strong className="font-display tabular-nums text-ink-950">{(r.count ?? 0).toLocaleString("tr-TR")}</strong>
        </li>
      ))}
    </ul>
  );

  return (
    <section className="space-y-4 rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-sm" aria-label="Gerçek kullanıma geç">
      <div className="flex items-start gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[var(--radius-card)] bg-brand-600/10 text-brand-600">
          <ShieldAlert className="h-5 w-5" aria-hidden />
        </span>
        <div>
          <h2 className="font-display text-lg font-bold text-ink-950">Ofisin şu an demo modunda</h2>
          <p className="mt-1 text-sm text-text-muted">
            Toplam <strong className="text-text">{total.toLocaleString("tr-TR")}</strong> örnek kayıt var. Gerçek kullanıma geçince hepsi tek seferde
            silinir; ofis ayarların, gerçek kullanıcıların, kendi girdiğin kayıtlar ve aboneliğin değişmez.
          </p>
          <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-amber-400/12 px-2.5 py-1 text-xs font-semibold text-amber-700">
            <Lock className="h-3.5 w-3.5" aria-hidden /> Geçişten sonra örnek veri bir daha yüklenemez.
          </p>
        </div>
      </div>
      {visible.length > 0 ? counts : <p className="text-sm text-text-muted">Silinecek örnek kayıt görünmüyor; yine de demo işareti kaldırılır.</p>}
      {result?.error ? <ErrorLine result={result} /> : null}
      {!canClear ? (
        <p role="status" className="text-xs font-semibold text-text-muted">
          Bu işlemi yalnız ofis sahibi veya genel müdür yapabilir.
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="danger" icon={Trash2} disabled={!canClear || pending} onClick={() => setStep(1)}>
          {result?.error ? "Tekrar dene" : "Gerçek kullanıma geç"}
        </Button>
        <ButtonLink href="/app/ayarlar" variant="ghost">
          Vazgeç
        </ButtonLink>
      </div>

      {/* 1. onay: sayılarla ne silinecek */}
      <Dialog open={step === 1} onOpenChange={(o) => setStep(o ? 1 : 0)}>
        <DialogContent size="md">
          <DialogHeader tone="danger" icon={<AlertTriangle className="h-5 w-5" aria-hidden />} title="Örnek kayıtlar silinecek (1/2)" description="Aşağıdaki örnek kayıtların TAMAMI kalıcı olarak silinir. Gerçek kayıtlarına dokunulmaz." />
          <DialogBody>{counts}</DialogBody>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setStep(0)}>
              Vazgeç
            </Button>
            <Button
              type="button"
              variant="danger"
              onClick={() => {
                setTyped("");
                setStep(2);
              }}
            >
              Anladım, devam et
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 2. onay: ofis adı ya da SİL yazımı */}
      <Dialog open={step === 2} onOpenChange={(o) => (!pending ? setStep(o ? 2 : 0) : undefined)}>
        <DialogContent size="md">
          <DialogHeader
            tone="danger"
            icon={<Trash2 className="h-5 w-5" aria-hidden />}
            title="Son onay (2/2)"
            description="Bu işlem geri alınamaz ve ofisine bir daha örnek veri yüklenemez."
          />
          <DialogBody>
            <form
              id="real-use-final"
              className="space-y-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (matches && !pending) run();
              }}
            >
              <label htmlFor={inputId} className="block text-sm text-text">
                Onaylamak için <strong className="font-mono">{officeName || "ofis adını"}</strong> ya da <strong className="font-mono">{REAL_USE_CONFIRM_WORD}</strong> yaz:
              </label>
              <FormInput id={inputId} autoComplete="off" autoFocus value={typed} onChange={(e) => setTyped(e.target.value)} aria-invalid={typed.length > 0 && !matches} />
              {result?.error ? <ErrorLine result={result} /> : null}
            </form>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="ghost" disabled={pending} onClick={() => setStep(0)}>
              Vazgeç
            </Button>
            <Button type="submit" form="real-use-final" variant="danger" icon={Trash2} loading={pending} disabled={!matches}>
              Örnekleri sil ve gerçek kullanıma geç
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function ErrorLine({ result }: { result: SampleDataResult }) {
  return (
    <div role="alert" className="flex items-start gap-2 text-xs font-semibold text-danger-600">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
      <span>
        {result.error}
        {result.clear?.failed.length ? ` Takılan: ${result.clear.failed.map((f) => `${f.label} (${f.message})`).join("; ")}` : ""}
      </span>
    </div>
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
              ? `${deleted.toLocaleString("tr-TR")} örnek kayıt silindi. Artık yalnız kendi kayıtlarınla çalışıyorsun.`
              : "Ofiste örnek veri yok; tüm ekranlar kendi kayıtlarını gösterir."}
          </p>
        </div>
      </div>
      <div>
        <p className="mb-2 text-xs font-bold uppercase tracking-wide text-text-faint">İlk adımlar</p>
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
      </div>
    </section>
  );
}
