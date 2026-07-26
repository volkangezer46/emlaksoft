"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  GitMerge,
  Loader2,
  ShieldAlert,
} from "lucide-react";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button, ButtonLink } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { getMergePreview, mergeCustomers, type MergePreview } from "@/app/actions/customers";
import { formatTurkishPhone } from "@/lib/phone";
import type { DuplicateRecord } from "./groups-client";

/**
 * Birleştirme sihirbazı (X6) — üç adım:
 *  1. Ana kayıt seçimi (en dolu kayıt önerilir ve önseçilidir)
 *  2. Özet: gerçek count sorgularıyla taşınacak alt kayıtlar + kopyalanacak alanlar
 *  3. ConfirmDialog onayı → mergeCustomers → başarı ekranı + ana kayda link
 *
 * Geri alınamazlık her adımda açıkça belirtilir; asıl yazma işlemi yalnızca
 * ConfirmDialog onayından sonra çalışır.
 */
export function MergeWizard({ kayitlar }: { kayitlar: DuplicateRecord[] }) {
  const router = useRouter();
  const enDolu = Math.max(...kayitlar.map((k) => k.activity));
  const onerilenId =
    kayitlar.find((k) => k.activity === enDolu)?.customer_id ?? kayitlar[0]?.customer_id ?? "";

  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"select" | "summary" | "done">("select");
  const [primaryId, setPrimaryId] = useState(onerilenId);
  const [preview, setPreview] = useState<MergePreview | null>(null);
  const [error, setError] = useState("");
  const [loadingPreview, startPreview] = useTransition();
  const [merging, startMerge] = useTransition();

  const duplicateIds = kayitlar.map((k) => k.customer_id).filter((id) => id !== primaryId);
  const primary = kayitlar.find((k) => k.customer_id === primaryId);

  function reset() {
    setStep("select");
    setPrimaryId(onerilenId);
    setPreview(null);
    setError("");
  }

  function goSummary() {
    setError("");
    setStep("summary");
    setPreview(null);
    startPreview(async () => {
      const p = await getMergePreview(primaryId, duplicateIds);
      if (p.error) {
        setError(p.error);
        setStep("select");
        return;
      }
      setPreview(p);
    });
  }

  async function runMerge() {
    setError("");
    await new Promise<void>((resolve) => {
      startMerge(async () => {
        const r = await mergeCustomers(primaryId, duplicateIds);
        if (r.error) setError(r.error);
        else {
          setStep("done");
          router.refresh();
        }
        resolve();
      });
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="primary" size="sm">
          <GitMerge className="h-3.5 w-3.5" /> Birleştir
        </Button>
      </DialogTrigger>
      <DialogContent size="md">
        {step === "done" ? (
          <>
            <DialogHeader
              icon={<CheckCircle2 />}
              title="Birleştirme tamamlandı"
              description="Kopya kayıtlar silindi, geçmiş ana kayda taşındı."
            />
            <DialogBody>
              <div className="grid place-items-center py-4 text-center">
                <span className="grid h-14 w-14 place-items-center rounded-[16px] bg-mint-500/12 text-mint-600">
                  <CheckCircle2 className="h-7 w-7" />
                </span>
                <p className="mt-4 font-display text-lg font-bold text-ink-950">
                  {primary?.full_name ?? "Ana kayıt"} artık tek kayıt
                </p>
                <p className="mt-1 max-w-sm text-sm text-text-muted">
                  {duplicateIds.length} kopya kayıt kapatıldı; çağrı, randevu ve diğer alt
                  kayıtlar ana kayda taşındı.
                </p>
              </div>
            </DialogBody>
            <DialogFooter>
              <Button variant="secondary" onClick={() => setOpen(false)}>
                Kapat
              </Button>
              <ButtonLink href={`/app/musteriler/${primaryId}`}>Ana kaydı aç</ButtonLink>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader
              icon={<GitMerge />}
              tone="danger"
              title="Müşteri kayıtlarını birleştir"
              description={
                step === "select"
                  ? "Adım 1/3 — Tutulacak ana kaydı seçin"
                  : "Adım 2/3 — Taşınacakları kontrol edin"
              }
            />
            <DialogBody className="space-y-4">
              {error ? (
                <p
                  className="rounded-[12px] border border-danger-500/30 bg-danger-500/5 px-3 py-2 text-sm text-danger-600"
                  role="alert"
                >
                  {error}
                </p>
              ) : null}

              {step === "select" ? (
                <>
                  <p className="text-sm text-text-muted">
                    Seçtiğiniz kayıt <strong>kalır</strong>; diğerlerindeki tüm geçmiş bu kayda
                    taşınır ve kopyalar silinir.
                  </p>
                  <div className="space-y-2" role="radiogroup" aria-label="Ana kayıt seçimi">
                    {kayitlar.map((k) => {
                      const secili = k.customer_id === primaryId;
                      const onerilen = k.customer_id === onerilenId && enDolu > 0;
                      return (
                        <label
                          key={k.customer_id}
                          className={`focus-ring flex cursor-pointer items-start gap-3 rounded-[14px] border p-3.5 transition ${
                            secili
                              ? "border-brand-500 bg-brand-600/[0.05]"
                              : "border-line bg-canvas hover:border-brand-400"
                          }`}
                        >
                          <input
                            type="radio"
                            name="merge-primary"
                            className="mt-1 h-4 w-4 accent-brand-600"
                            checked={secili}
                            onChange={() => setPrimaryId(k.customer_id)}
                          />
                          <span className="min-w-0">
                            <span className="flex flex-wrap items-center gap-2">
                              <span className="truncate font-semibold text-ink-950">
                                {k.full_name ?? "İsimsiz"}
                              </span>
                              {onerilen ? (
                                <span className="rounded-full bg-mint-500/12 px-2 py-0.5 text-[11px] font-semibold text-mint-600">
                                  Önerilen — en dolu kayıt
                                </span>
                              ) : null}
                            </span>
                            <span className="numeric mt-0.5 block text-xs text-text-muted">
                              {k.phone ? formatTurkishPhone(k.phone) : "Telefon yok"} ·{" "}
                              {k.email ?? "E-posta yok"}
                            </span>
                            <span className="numeric mt-0.5 block text-[11px] text-text-faint">
                              {k.activity} kayıt hareketi
                            </span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </>
              ) : (
                <>
                  {loadingPreview || !preview ? (
                    <div className="grid place-items-center gap-2 py-8 text-sm text-text-muted">
                      <Loader2 className="h-6 w-6 animate-spin text-brand-600" />
                      Taşınacak kayıtlar sayılıyor…
                    </div>
                  ) : (
                    <>
                      <div className="rounded-[14px] border border-line bg-canvas p-4">
                        <p className="text-xs font-semibold text-text-muted">
                          Ana kayıt: <span className="text-ink-950">{primary?.full_name ?? "—"}</span>{" "}
                          · {duplicateIds.length} kopya kapatılacak
                        </p>
                        {preview.counts && preview.counts.length > 0 ? (
                          <>
                            <p className="mt-3 text-sm font-semibold text-ink-950">
                              Taşınacak alt kayıtlar ({preview.totalMoves ?? 0})
                            </p>
                            <ul className="mt-1.5 flex flex-wrap gap-1.5">
                              {preview.counts.map((c) => (
                                <li
                                  key={c.label}
                                  className="numeric rounded-full bg-surface px-2.5 py-1 text-xs font-semibold text-text-muted"
                                >
                                  {c.count} {c.label}
                                </li>
                              ))}
                            </ul>
                          </>
                        ) : (
                          <p className="mt-3 text-sm text-text-muted">
                            Kopya kayıtlarda taşınacak alt kayıt yok.
                          </p>
                        )}
                        {preview.filled && preview.filled.length > 0 ? (
                          <>
                            <p className="mt-3 text-sm font-semibold text-ink-950">
                              Ana kayda kopyalanacak alanlar
                            </p>
                            <ul className="mt-1.5 space-y-1 text-xs text-text-muted">
                              {preview.filled.map((f) => (
                                <li key={f.label} className="truncate">
                                  <span className="font-semibold">{f.label}:</span> {f.value}
                                </li>
                              ))}
                            </ul>
                          </>
                        ) : null}
                      </div>
                      <p className="flex items-start gap-2 rounded-[12px] border border-danger-500/30 bg-danger-500/5 px-3 py-2.5 text-xs leading-relaxed text-danger-600">
                        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
                        <span>
                          <strong>Bu işlem geri alınamaz.</strong> Kopya kayıtlar silinir ve tüm
                          geçmişleri ana kayda taşınır. Farklı kişileri birleştirirseniz veriler
                          karışır — emin değilseniz vazgeçin.
                        </span>
                      </p>
                    </>
                  )}
                </>
              )}
            </DialogBody>
            <DialogFooter>
              {step === "select" ? (
                <>
                  <Button variant="secondary" onClick={() => setOpen(false)}>
                    Vazgeç
                  </Button>
                  <Button onClick={goSummary} disabled={!primaryId || duplicateIds.length === 0}>
                    Devam <ArrowRight className="h-4 w-4" />
                  </Button>
                </>
              ) : (
                <>
                  <Button variant="secondary" onClick={() => setStep("select")} disabled={merging}>
                    <ArrowLeft className="h-4 w-4" /> Geri
                  </Button>
                  <ConfirmDialog
                    trigger={
                      <Button
                        variant="danger"
                        loading={merging}
                        disabled={loadingPreview || !preview}
                      >
                        <GitMerge className="h-4 w-4" /> Birleştir
                      </Button>
                    }
                    title="Kayıtlar birleştirilsin mi?"
                    description={`${duplicateIds.length} kopya kayıt silinecek ve ${
                      preview?.totalMoves ?? 0
                    } alt kayıt "${primary?.full_name ?? "ana kayıt"}" üzerine taşınacak. Bu işlem geri alınamaz.`}
                    confirmLabel="Evet, birleştir"
                    cancelLabel="Vazgeç"
                    tone="danger"
                    onConfirm={runMerge}
                  />
                </>
              )}
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
