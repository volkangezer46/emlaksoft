"use client";

import { useState, useTransition } from "react";
import { ArrowDownCircle, ArrowUpCircle, FileInput, FilePlus2, FileText, Inbox, ScanText } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/button";
import Link from "@/components/ui/smart-link";
import { FormError, FormField, FormInput, FormSelect } from "@/components/ui/form-controls";
import { useToast } from "@/components/app/toast-provider";
import { recordReceivedInvoice } from "@/app/actions/expense-receipts";
import { formatAccountMoney } from "@/lib/finance/cash/money";
import { LEDGER_VAT_RATES } from "@/lib/finance/ledger/vat";
import { RECEIVED_INVOICE_CATEGORIES } from "@/lib/finance/received-invoice";
import { parseMoneyInput } from "@/lib/money-input";
import { now, trDayKey } from "@/lib/clock";
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
 * "Gelen fatura" (WP5): ödenmemiş tedarikçi faturası BORÇ olarak (indirilecek KDV fatura tarihinde) kaydedilir; ödeme sonra
 * Cari ekranından hesap seçilerek kapatılır. Kayıt servisi `invoice.received`; eski gider tablosuna yazılmaz.
 */

type InvoiceDraft = { requestId: string; vendor: string; invoiceNo: string; date: string; dueDate: string; amount: string; vatRate: number; category: string };
export function DocumentTab({ canInvoice, ocrEnabled, onUse, hidden }: { canInvoice: boolean; ocrEnabled: boolean; onUse: (r: ReceiptUse) => void; hidden?: boolean }) {
  const [upload, setUpload] = useState<UploadState>({ status: "idle" });
  const [ocr, setOcr] = useState<OcrResult | null>(null);
  const [invoice, setInvoice] = useState<InvoiceDraft | null>(null);
  const [invoiceError, setInvoiceError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();
  const { push } = useToast();
  const done = upload.status === "done" ? upload : null;

  function openInvoice() {
    setInvoiceError(null);
    setInvoice({
      requestId: crypto.randomUUID(),
      vendor: ocr?.vendor ?? "",
      invoiceNo: "",
      date: ocr?.date ?? trDayKey(now()),
      dueDate: "",
      amount: ocr?.amount != null ? String(ocr.amount).replace(".", ",") : "",
      vatRate: ocr?.vatRate != null && (LEDGER_VAT_RATES as readonly number[]).includes(ocr.vatRate) ? ocr.vatRate : 20,
      category: "diger_gider",
    });
  }

  function saveInvoice() {
    if (!invoice || !done) return;
    const amount = parseMoneyInput(invoice.amount);
    if (!amount.ok || amount.value === null) {
      setInvoiceError("Fatura toplamını (KDV dahil) yazın.");
      return;
    }
    const draft = invoice;
    const attachmentId = done.id;
    startSaving(async () => {
      const res = await recordReceivedInvoice({
        requestId: draft.requestId,
        vendor: draft.vendor,
        invoiceNo: draft.invoiceNo || null,
        date: draft.date,
        dueDate: draft.dueDate || null,
        amount: amount.value as number,
        vatRate: draft.vatRate,
        category: draft.category,
        attachmentId,
      });
      if (!res.ok) {
        setInvoiceError(res.error);
        return;
      }
      push(res.info ?? (res.duplicate ? "Bu fatura zaten kayıtlı." : "Gelen fatura borç olarak kaydedildi."), res.info ? "info" : "ok");
      setInvoice(null);
      setUpload({ status: "idle" });
      setOcr(null);
    });
  }

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
              <Button variant="secondary" icon={FileInput} onClick={openInvoice} aria-expanded={invoice !== null}>
                Gelen fatura
              </Button>
            </div>
            {invoice ? (
              <div className="grid gap-3 border-t border-line pt-3" role="group" aria-label="Gelen fatura">
                <p className="text-xs text-text-muted">
                  Ödenmemiş tedarikçi faturası borç olarak kaydedilir; KDV fatura tarihinde indirilecek KDV&apos;ye yazılır. Ödediğinizde Cari ekranından kapatın.
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <FormField label="Faturayı kesen" htmlFor="dt-inv-vendor" required>
                    <FormInput id="dt-inv-vendor" value={invoice.vendor} maxLength={120} onChange={(ev) => setInvoice({ ...invoice, vendor: ev.target.value })} />
                  </FormField>
                  <FormField label="Fatura no" htmlFor="dt-inv-no">
                    <FormInput id="dt-inv-no" value={invoice.invoiceNo} maxLength={40} onChange={(ev) => setInvoice({ ...invoice, invoiceNo: ev.target.value })} />
                  </FormField>
                  <FormField label="Fatura toplamı (KDV dahil)" htmlFor="dt-inv-amount" required>
                    <FormInput id="dt-inv-amount" inputMode="decimal" className="numeric" value={invoice.amount} onChange={(ev) => setInvoice({ ...invoice, amount: ev.target.value })} />
                  </FormField>
                  <FormField label="KDV oranı" htmlFor="dt-inv-vat">
                    <FormSelect id="dt-inv-vat" value={String(invoice.vatRate)} onChange={(ev) => setInvoice({ ...invoice, vatRate: Number(ev.target.value) })}>
                      {LEDGER_VAT_RATES.map((r) => (
                        <option key={r} value={r}>
                          %{r}
                        </option>
                      ))}
                    </FormSelect>
                  </FormField>
                  <FormField label="Fatura tarihi" htmlFor="dt-inv-date" required>
                    <FormInput id="dt-inv-date" type="date" min="2000-01-01" value={invoice.date} onChange={(ev) => setInvoice({ ...invoice, date: ev.target.value })} />
                  </FormField>
                  <FormField label="Son ödeme tarihi" htmlFor="dt-inv-due">
                    <FormInput id="dt-inv-due" type="date" min={invoice.date || "2000-01-01"} value={invoice.dueDate} onChange={(ev) => setInvoice({ ...invoice, dueDate: ev.target.value })} />
                  </FormField>
                  <FormField label="Gider kategorisi" htmlFor="dt-inv-cat" className="sm:col-span-2">
                    <FormSelect id="dt-inv-cat" value={invoice.category} onChange={(ev) => setInvoice({ ...invoice, category: ev.target.value })}>
                      {RECEIVED_INVOICE_CATEGORIES.map((c) => (
                        <option key={c.value} value={c.value}>
                          {c.label}
                        </option>
                      ))}
                    </FormSelect>
                  </FormField>
                </div>
                <FormError error={invoiceError} />
                <div className="flex flex-wrap gap-2">
                  <Button variant="primary" onClick={saveInvoice} disabled={saving}>
                    {saving ? "Kaydediliyor…" : "Borç olarak kaydet"}
                  </Button>
                  <Button variant="ghost" onClick={() => setInvoice(null)} disabled={saving}>
                    Vazgeç
                  </Button>
                </div>
              </div>
            ) : null}
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
