"use client";

import { markInvoicePaid, recordInvoiceChargeback, recordInvoiceRefund, voidInvoice } from "@/app/actions/platform-billing";
import { MANUAL_PAYMENT_METHODS } from "@/lib/billing/invoice-ops";
import { InlineOp, opFieldClass } from "./inline-op";

export function InvoiceActions({
  invoiceId,
  status,
  totalTry,
  refunded,
  chargedBack = false,
  isSuperAdmin,
  today,
}: {
  invoiceId: string;
  status: string;
  totalTry: number;
  refunded: boolean;
  chargedBack?: boolean;
  isSuperAdmin: boolean;
  today: string;
}) {
  const hidden = { invoice_id: invoiceId };
  const lbl = "text-xs font-semibold text-text-muted";
  return (
    <div className="space-y-3">
      {status === "open" || status === "draft" || status === "uncollectible" ? (
        <InlineOp
          label="Ödendi olarak işaretle"
          confirmLabel="Ödemeyi kaydet"
          hidden={hidden}
          action={markInvoicePaid}
          hint={`Fatura tutarı ${totalTry.toLocaleString("tr-TR", { style: "currency", currency: "TRY" })}. Kısmi ödeme desteklenmez.`}
        >
          <label className={lbl}>
            Yöntem
            <select name="method" required defaultValue="havale" className={`mt-1 block ${opFieldClass}`}>
              {MANUAL_PAYMENT_METHODS.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </label>
          <label className={lbl}>
            Alınan tutar (TRY)
            <input name="received_try" inputMode="decimal" placeholder={String(totalTry)} className={`mt-1 block w-32 ${opFieldClass}`} />
          </label>
          <label className={lbl}>
            Ödeme tarihi
            <input name="paid_date" type="date" defaultValue={today} max={today} className={`mt-1 block ${opFieldClass}`} />
          </label>
          <label className={lbl}>
            Dekont / referans
            <input name="reference" maxLength={120} placeholder="Örn. havale açıklaması" className={`mt-1 block w-48 ${opFieldClass}`} />
          </label>
        </InlineOp>
      ) : null}

      {isSuperAdmin && (status === "open" || status === "draft" || status === "uncollectible") ? (
        <InlineOp label="Faturayı iptal et" confirmLabel="İptal et" tone="danger" hidden={hidden} action={voidInvoice}>
          <label className={lbl}>
            İptal nedeni
            <input name="reason" required minLength={3} maxLength={300} className={`mt-1 block w-64 ${opFieldClass}`} />
          </label>
        </InlineOp>
      ) : null}

      {isSuperAdmin && status === "paid" && !refunded ? (
        <InlineOp
          label="İade kaydı düş"
          confirmLabel="İadeyi kaydet"
          tone="danger"
          hidden={hidden}
          action={recordInvoiceRefund}
          hint="Bu ekran para göndermez: iadeyi iyzico/banka üzerinden yaptıktan sonra kayıt düşün. Boş tutar = tam iade."
        >
          <label className={lbl}>
            İade tutarı (TRY)
            <input name="amount_try" inputMode="decimal" placeholder={String(totalTry)} className={`mt-1 block w-32 ${opFieldClass}`} />
          </label>
          <label className={lbl}>
            İade nedeni
            <input name="reason" required minLength={3} maxLength={300} className={`mt-1 block w-64 ${opFieldClass}`} />
          </label>
        </InlineOp>
      ) : null}
      {isSuperAdmin && status === "paid" && !chargedBack ? (
        <InlineOp
          label="Ters ibraz kaydı düş"
          confirmLabel="Ters ibrazı kaydet"
          tone="danger"
          hidden={hidden}
          action={recordInvoiceChargeback}
          hint="Kart sahibi/banka işlemi geri çektiyse kayıt düşün: bu faturaya bağlı davet/ortak ödülleri geri alınır, verilmiş kredi geri çekilir. Bu ekran para hareketi yapmaz."
        >
          <label className={lbl}>
            Ters ibraz nedeni
            <input name="reason" required minLength={3} maxLength={300} className={`mt-1 block w-64 ${opFieldClass}`} />
          </label>
        </InlineOp>
      ) : null}
      {!isSuperAdmin && status !== "void" ? (
        <p className="text-xs text-text-faint">İptal ve iade işlemleri yalnız süper admin tarafından yapılır.</p>
      ) : null}
    </div>
  );
}
