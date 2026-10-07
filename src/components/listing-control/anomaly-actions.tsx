"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, ClipboardCheck, Eye, MessageSquareText, SearchCheck } from "lucide-react";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogClose } from "@/components/ui/inline-dialog";
import { Button, ButtonLink } from "@/components/ui/button";
import {
  acknowledgeAnomaly,
  explainAnomaly,
  resolveAnomaly,
  submitManualCheck,
  type ControlActionResult,
} from "@/app/actions/listing-control";

/**
 * Anomali satır eylemleri (istemci). Sunucu eylemleri kendi yetki/kapsam denetimini yapar; burada yalnız akış vardır:
 * Gördüm -> Açıkla (ZORUNLU, kodlu neden) -> Çöz (açıklama olmadan kapatılamaz). "Satıldı/Kiralandı" seçilince CRM'de
 * işlem kaydı ÖNERİLİR; hiçbir CRM kaydı otomatik değişmez, kullanıcı onaylayıp işlem ekranına gider.
 * Neden listesi motorun saf `types.ts` dosyasındaki REASON_LABELS'ından gelir (tek kaynak; kopya yok).
 */
import { REASON_CODES, REASON_LABELS, type ReasonCode } from "@/lib/listing-control/types";

export type AnomalyActionModel = {
  id: string;
  propertyId: string;
  portalListingId: string | null;
  status: string;
  explainedReason: string | null;
};

const REASON_ORDER: ReasonCode[] = ["sold", "rented", "owner_withdrew", "authority_expired", "price_will_update", "portal_removed", "will_republish", "mistake", "other"];

const fieldClass =
  "w-full rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2.5 text-sm outline-none transition focus:border-brand-400 focus:bg-surface";

export function AnomalyActions({ a, canEdit }: { a: AnomalyActionModel; canEdit: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [explainOpen, setExplainOpen] = useState(false);
  const [resolveOpen, setResolveOpen] = useState(false);
  const [checkOpen, setCheckOpen] = useState(false);
  const [closure, setClosure] = useState<{ kind: "sold" | "rented"; label: string } | null>(null);
  const [reason, setReason] = useState<string>("");

  if (!canEdit) return <span className="text-xs text-text-muted">Yalnız görüntüleme</span>;

  const run = (fn: () => Promise<ControlActionResult>, onOk?: (r: ControlActionResult) => void) => {
    setError(null);
    start(async () => {
      const r = await fn();
      if (r.error) {
        setError(r.error);
        return;
      }
      onOk?.(r);
      router.refresh();
    });
  };

  const explained = a.status === "explained";

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {a.status === "open" ? (
        <Button
          size="sm"
          variant="secondary"
          icon={Eye}
          loading={pending}
          onClick={() => {
            const fd = new FormData();
            fd.set("anomaly_id", a.id);
            run(() => acknowledgeAnomaly(fd));
          }}
        >
          Gördüm
        </Button>
      ) : null}
      {!explained ? (
        <Button size="sm" variant="primary" icon={MessageSquareText} onClick={() => { setError(null); setExplainOpen(true); }}>
          Açıkla
        </Button>
      ) : null}
      {a.portalListingId ? (
        <Button size="sm" variant="ghost" icon={SearchCheck} onClick={() => { setError(null); setCheckOpen(true); }}>
          Elle kontrol
        </Button>
      ) : null}
      <Button
        size="sm"
        variant="ghost"
        icon={CheckCircle2}
        disabled={!explained}
        title={explained ? "Uyarıyı çözüldü olarak kapat" : "Önce açıklama girin; açıklamasız uyarı kapatılamaz"}
        onClick={() => { setError(null); setResolveOpen(true); }}
      >
        Çöz
      </Button>
      {error ? <span role="alert" className="basis-full text-xs text-danger-600">{error}</span> : null}

      {/* Açıklama (zorunlu) */}
      <Dialog open={explainOpen} onOpenChange={setExplainOpen}>
        <DialogContent size="md">
          <DialogHeader icon={<MessageSquareText />} title="Neden kaldırıldı / değişti?" description="Açıklama girmeden uyarı kapatılamaz. Seçiminiz kayıt altına alınır." />
          <form
            action={(fd) => {
              fd.set("anomaly_id", a.id);
              run(
                () => explainAnomaly(fd),
                (r) => {
                  setExplainOpen(false);
                  if (r.suggestClosure) setClosure(r.suggestClosure);
                },
              );
            }}
          >
            <DialogBody>
              <fieldset className="space-y-1.5">
                <legend className="sr-only">Açıklama nedeni</legend>
                {REASON_ORDER.filter((c) => (REASON_CODES as readonly string[]).includes(c)).map((c) => (
                  <label key={c} className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-[var(--radius-control)] border border-line px-3 text-sm has-[:checked]:border-brand-500 has-[:checked]:bg-brand-600/5">
                    <input type="radio" name="reason_code" value={c} required checked={reason === c} onChange={() => setReason(c)} className="h-4 w-4" />
                    {REASON_LABELS[c]}
                  </label>
                ))}
              </fieldset>
              <label className="mt-3 block text-sm font-medium text-text">
                Not {reason === "other" ? "(zorunlu)" : "(isteğe bağlı)"}
                <textarea name="note" maxLength={500} rows={3} required={reason === "other"} className={`${fieldClass} mt-1.5`} placeholder="Kısa açıklama (en fazla 500 karakter)" />
              </label>
              {error ? <p role="alert" className="mt-2 text-sm text-danger-600">{error}</p> : null}
            </DialogBody>
            <DialogFooter>
              <DialogClose asChild><Button variant="ghost">Vazgeç</Button></DialogClose>
              <Button type="submit" loading={pending} disabled={!reason}>Açıklamayı kaydet</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* CRM kapanış önerisi: otomatik değişiklik YOK */}
      <Dialog open={closure !== null} onOpenChange={(o) => { if (!o) setClosure(null); }}>
        <DialogContent size="sm">
          <DialogHeader
            icon={<ClipboardCheck />}
            title={closure?.kind === "rented" ? "CRM'deki işlemi Kiralandı olarak kapatmak ister misiniz?" : "Emlaksoft'taki işlemi Satıldı olarak kapatmak ister misiniz?"}
            description="Açıklamanız kaydedildi. CRM kaydı otomatik değişmez; onaylarsanız işlem kayıt ekranına gidersiniz."
          />
          <DialogFooter>
            <DialogClose asChild><Button variant="ghost">Şimdi değil</Button></DialogClose>
            <ButtonLink href={`/app/anlasmalar/yeni`} onClick={() => setClosure(null)}>Evet, işlem kaydına git</ButtonLink>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Çözüm */}
      <Dialog open={resolveOpen} onOpenChange={setResolveOpen}>
        <DialogContent size="sm">
          <DialogHeader icon={<CheckCircle2 />} title="Uyarıyı çözüldü olarak kapat" description={explained && a.explainedReason ? `Kayıtlı neden: ${REASON_LABELS[a.explainedReason as ReasonCode] ?? "Açıklandı"}` : undefined} />
          <form
            action={(fd) => {
              fd.set("anomaly_id", a.id);
              fd.set("resolution", "resolved");
              run(() => resolveAnomaly(fd), () => setResolveOpen(false));
            }}
          >
            <DialogBody>
              <label className="block text-sm font-medium text-text">
                Not (isteğe bağlı)
                <textarea name="note" maxLength={500} rows={3} className={`${fieldClass} mt-1.5`} />
              </label>
              {error ? <p role="alert" className="mt-2 text-sm text-danger-600">{error}</p> : null}
            </DialogBody>
            <DialogFooter>
              <DialogClose asChild><Button variant="ghost">Vazgeç</Button></DialogClose>
              <Button type="submit" loading={pending}>Çözüldü olarak kapat</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Elle kontrol */}
      {a.portalListingId ? (
        <Dialog open={checkOpen} onOpenChange={setCheckOpen}>
          <DialogContent size="sm">
            <DialogHeader icon={<SearchCheck />} title="Portalda elle kontrol" description="İlana portal sitesinden bakın ve sonucu girin." />
            <form
              action={(fd) => {
                fd.set("portal_listing_id", a.portalListingId ?? "");
                run(() => submitManualCheck(fd), () => setCheckOpen(false));
              }}
            >
              <DialogBody>
                <fieldset className="space-y-1.5">
                  <legend className="sr-only">Kontrol sonucu</legend>
                  <label className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-[var(--radius-control)] border border-line px-3 text-sm has-[:checked]:border-brand-500">
                    <input type="radio" name="result" value="present" required className="h-4 w-4" /> İlan portalda yayında
                  </label>
                  <label className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-[var(--radius-control)] border border-line px-3 text-sm has-[:checked]:border-brand-500">
                    <input type="radio" name="result" value="absent" required className="h-4 w-4" /> İlan portalda yok
                  </label>
                </fieldset>
                <label className="mt-3 block text-sm font-medium text-text">
                  Portaldaki fiyat (isteğe bağlı)
                  <input name="portal_price" inputMode="decimal" className={`${fieldClass} mt-1.5`} placeholder="Örn. 4.250.000" />
                </label>
                {error ? <p role="alert" className="mt-2 text-sm text-danger-600">{error}</p> : null}
              </DialogBody>
              <DialogFooter>
                <DialogClose asChild><Button variant="ghost">Vazgeç</Button></DialogClose>
                <Button type="submit" loading={pending}>Sonucu kaydet</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}
