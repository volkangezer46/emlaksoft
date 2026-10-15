"use client";

import { useState } from "react";
import { ArrowDownCircle, ArrowUpCircle, FilePlus2, FileText, Inbox, ScanText } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/button";
import Link from "@/components/ui/smart-link";
import { formatAccountMoney } from "@/lib/finance/cash/money";
import { formatDateTr } from "@/lib/format";
import { AttachmentField, Section, type OcrResult, type UploadState } from "./entry-ui";

export type ReceiptUse = {
  direction: "in" | "out";
  attachmentId: string;
  attachmentName: string;
  amount: number | null;
  date: string | null;
  vatRate: number | null;
  vendor: string | null;
};

/**
 * Fatura / Belge sekmesi. Fatura kesme mantığı KOPYALANMAZ: e-Fatura / e-Arşiv editörü Belgeler > Faturalar'dadır
 * (`/app/giderler?sekme=belgeler&tur=fatura`), buradan oraya bağlanır. Fiş/fatura yüklenince (fiş okuma açıksa) okunan
 * tutar/tarih/KDV/satıcı ile Gider ya da Gelir sekmesi önceden dolu açılır; belge kayda bağlanır.
 */
export function DocumentTab({ canInvoice, ocrEnabled, onUse, hidden }: { canInvoice: boolean; ocrEnabled: boolean; onUse: (r: ReceiptUse) => void; hidden?: boolean }) {
  const [upload, setUpload] = useState<UploadState>({ status: "idle" });
  const [ocr, setOcr] = useState<OcrResult | null>(null);
  const done = upload.status === "done" ? upload : null;

  function use(direction: "in" | "out") {
    if (!done) return;
    onUse({
      direction,
      attachmentId: done.id,
      attachmentName: done.name,
      amount: ocr?.amount ?? null,
      date: ocr?.date ?? null,
      vatRate: ocr?.vatRate ?? null,
      vendor: ocr?.vendor ?? null,
    });
    setUpload({ status: "idle" });
    setOcr(null);
  }

  return (
    <div hidden={hidden} className="grid gap-4 lg:grid-cols-2 lg:items-start">
      <Section
        title="Fiş veya faturadan kayıt"
        icon={ScanText}
        description={ocrEnabled ? "Belgeyi yükleyin; okunan tutar, tarih, KDV ve satıcı kayıt formuna öneri olarak yazılır." : "Belgeyi yükleyin ve kayda bağlayın. Fiş okuma kapalı; alanları siz doldurursunuz."}
      >
        <AttachmentField
          id="dt-file"
          value={upload}
          onChange={(next) => {
            setUpload(next);
            if (next.status === "idle") setOcr(null);
          }}
          onOcr={setOcr}
          label="Fiş veya fatura yükleyin (PDF, görsel)"
        />
        {done ? (
          <div className="grid gap-3 rounded-[var(--radius-control)] border border-line bg-canvas p-3">
            {ocr && (ocr.amount != null || ocr.date || ocr.vatRate != null || ocr.vendor) ? (
              <dl className="numeric grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                {ocr.amount != null ? (
                  <>
                    <dt className="text-text-muted">Tutar</dt>
                    <dd className="font-semibold text-text">{formatAccountMoney(ocr.amount, "TRY")}</dd>
                  </>
                ) : null}
                {ocr.date ? (
                  <>
                    <dt className="text-text-muted">Tarih</dt>
                    <dd className="font-semibold text-text">{formatDateTr(ocr.date)}</dd>
                  </>
                ) : null}
                {ocr.vatRate != null ? (
                  <>
                    <dt className="text-text-muted">KDV</dt>
                    <dd className="font-semibold text-text">%{ocr.vatRate}</dd>
                  </>
                ) : null}
                {ocr.vendor ? (
                  <>
                    <dt className="text-text-muted">Satıcı</dt>
                    <dd className="truncate font-semibold text-text">{ocr.vendor}</dd>
                  </>
                ) : null}
              </dl>
            ) : (
              <p className="text-xs text-text-muted">Belge yüklendi. Okunan bilgi yok; kayıt formunda alanları doldurun.</p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" icon={ArrowUpCircle} onClick={() => use("out")}>
                Gider olarak kaydet
              </Button>
              <Button variant="secondary" icon={ArrowDownCircle} onClick={() => use("in")}>
                Gelir olarak kaydet
              </Button>
            </div>
          </div>
        ) : null}
        {!ocrEnabled ? (
          <Link href="/app/giderler?sekme=ayarlar" className="text-xs font-semibold text-accent-text hover:underline">
            Fiş okumayı Muhasebe ayarlarından açın
          </Link>
        ) : null}
      </Section>

      <div className="grid gap-4">
        <Section title="e-Fatura / e-Arşiv" icon={FileText} description="Komisyon ve hizmet bedeli faturaları Belgeler > Faturalar'daki editörde kesilir (taslak, kontrol, resmileştirme).">
          <div className="flex flex-wrap gap-2">
            {canInvoice ? (
              <ButtonLink href="/app/giderler?sekme=belgeler&tur=fatura&kaynak=serbest" icon={FilePlus2}>
                Serbest fatura kes
              </ButtonLink>
            ) : null}
            <ButtonLink href="/app/giderler?sekme=belgeler&tur=fatura" variant="secondary" icon={FileText}>
              Fatura listesi
            </ButtonLink>
          </div>
          {!canInvoice ? <p className="text-xs text-text-muted">Fatura kesmek için komisyon yönetimi yetkisi gerekir.</p> : null}
        </Section>
        <Section title="Fiş kutusu" icon={Inbox} description="Toplu yüklenen ve henüz bir kayda bağlanmamış belgeler.">
          <ButtonLink href="/app/giderler?sekme=belgeler" variant="secondary" icon={Inbox} className="justify-self-start">
            Belgelere git
          </ButtonLink>
        </Section>
      </div>
    </div>
  );
}
