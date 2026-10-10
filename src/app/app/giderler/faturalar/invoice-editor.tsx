"use client";

import { useActionState, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Save, Search, Trash2 } from "lucide-react";
import {
  lookupInvoiceBuyer,
  saveInvoiceDraft,
  type BuyerLookupResult,
  type EInvoiceActionResult,
} from "@/app/actions/einvoice";
import { useToast } from "@/components/app/toast-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormField, Input, Textarea } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { computeTotals, DEFAULT_VAT_RATE, VAT_RATE_OPTIONS } from "@/lib/integrations/einvoice/invoice-math";

export type EditorLine = { description: string; quantity: string; unitPrice: string; vatRate: number };

export type EditorInitial = {
  id: string | null;
  sourceType: string;
  sourceId: string | null;
  sourceLabel: string;
  buyerName: string;
  buyerTaxId: string;
  buyerTaxOffice: string;
  buyerAddress: string;
  buyerCity: string;
  buyerDistrict: string;
  issueDate: string;
  note: string;
  lines: EditorLine[];
};

const money = (n: number) => new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" }).format(n);
const num = (v: string) => Number(v.replace(/\./g, "").replace(",", ".")) ;
/** Düz sayı metni ("1250.5" ya da "1.250,50"): noktalı ondalık yazımı da kabul eder. */
function parseAmount(v: string): number {
  const t = v.trim();
  if (!t) return NaN;
  if (t.includes(",")) return num(t);
  return Number(t);
}

export function InvoiceEditor({ initial }: { initial: EditorInitial }) {
  const router = useRouter();
  const { push } = useToast();
  const [lines, setLines] = useState<EditorLine[]>(initial.lines);
  const [taxId, setTaxId] = useState(initial.buyerTaxId);
  const [lookup, setLookup] = useState<BuyerLookupResult | null>(null);
  const [looking, startLookup] = useTransition();

  const [state, action, pending] = useActionState<EInvoiceActionResult, FormData>(async (prev, formData) => {
    const result = await saveInvoiceDraft(prev, formData);
    if (result.ok && result.id) {
      push(result.message ?? "Taslak kaydedildi", "ok");
      router.replace(`/app/giderler?sekme=faturalar&duzenle=${result.id}`);
      router.refresh();
    }
    return result;
  }, {});

  const parsed = useMemo(
    () => lines.map((l) => ({ description: l.description, quantity: parseAmount(l.quantity), unitPrice: parseAmount(l.unitPrice), vatRate: l.vatRate })),
    [lines],
  );
  const totals = useMemo(() => computeTotals(parsed.filter((l) => Number.isFinite(l.quantity) && Number.isFinite(l.unitPrice))), [parsed]);

  function patch(i: number, next: Partial<EditorLine>) {
    setLines((cur) => cur.map((l, idx) => (idx === i ? { ...l, ...next } : l)));
  }

  return (
    <form action={action} aria-busy={pending} className="space-y-5 rounded-[var(--radius-panel)] border border-line bg-surface p-5">
      {initial.id ? <input type="hidden" name="id" value={initial.id} /> : null}
      <input type="hidden" name="source_type" value={initial.sourceType} />
      <input type="hidden" name="source_id" value={initial.sourceId ?? ""} />
      <input type="hidden" name="lines" value={JSON.stringify(parsed)} />

      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-display text-base font-bold text-ink-950">{initial.id ? "Taslağı düzenle" : "Fatura taslağı"}</h2>
        <Badge variant="outline" size="sm">{initial.sourceLabel}</Badge>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="Alıcı adı / unvanı" htmlFor="inv-name" required>
          <Input id="inv-name" name="buyer_name" defaultValue={initial.buyerName} maxLength={300} required />
        </FormField>
        <FormField label="Vergi no (10) / TC kimlik no (11)" htmlFor="inv-taxid" required hint="Alıcı e-Fatura mükellefiyse e-Fatura, değilse e-Arşiv kesilir.">
          <div className="flex gap-2">
            <Input
              id="inv-taxid"
              name="buyer_tax_id"
              value={taxId}
              onChange={(e) => {
                setTaxId(e.target.value.replace(/\D/g, "").slice(0, 11));
                setLookup(null);
              }}
              inputMode="numeric"
              maxLength={11}
              required
              autoComplete="off"
            />
            <Button
              type="button"
              variant="secondary"
              size="sm"
              icon={Search}
              loading={looking}
              onClick={() => startLookup(async () => setLookup(await lookupInvoiceBuyer(taxId)))}
            >
              Sorgula
            </Button>
          </div>
          {lookup?.error ? <p className="mt-1 text-xs font-semibold text-danger-600" role="alert">{lookup.error}</p> : null}
          {lookup?.ok ? (
            <p className="mt-1 text-xs font-semibold text-accent-text">
              {lookup.isEInvoiceUser ? "e-Fatura mükellefi: e-Fatura kesilecek." : "e-Fatura mükellefi değil: e-Arşiv kesilecek."}
            </p>
          ) : null}
        </FormField>
        <FormField label="Vergi dairesi" htmlFor="inv-office">
          <Input id="inv-office" name="buyer_tax_office" defaultValue={initial.buyerTaxOffice} maxLength={120} />
        </FormField>
        <FormField label="Fatura tarihi" htmlFor="inv-date" required>
          <Input id="inv-date" name="issue_date" type="date" defaultValue={initial.issueDate} required />
        </FormField>
        <FormField label="Adres" htmlFor="inv-address" className="sm:col-span-2">
          <Input id="inv-address" name="buyer_address" defaultValue={initial.buyerAddress} maxLength={500} />
        </FormField>
        <FormField label="İl" htmlFor="inv-city">
          <Input id="inv-city" name="buyer_city" defaultValue={initial.buyerCity} maxLength={100} placeholder="Örn. İstanbul" />
        </FormField>
        <FormField label="İlçe" htmlFor="inv-district">
          <Input id="inv-district" name="buyer_district" defaultValue={initial.buyerDistrict} maxLength={100} placeholder="Örn. Kadıköy" />
        </FormField>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-semibold text-ink-950">Kalemler (tutarlar KDV hariç)</p>
        {lines.map((l, i) => (
          <div key={i} className="grid gap-2 rounded-[var(--radius-card)] border border-line bg-canvas/60 p-3 sm:grid-cols-[minmax(0,2fr)_80px_130px_110px_auto] sm:items-end">
            <FormField label="Açıklama" htmlFor={`inv-l-${i}-d`}>
              <Input id={`inv-l-${i}-d`} value={l.description} onChange={(e) => patch(i, { description: e.target.value })} maxLength={300} />
            </FormField>
            <FormField label="Miktar" htmlFor={`inv-l-${i}-q`}>
              <Input id={`inv-l-${i}-q`} value={l.quantity} onChange={(e) => patch(i, { quantity: e.target.value })} inputMode="decimal" />
            </FormField>
            <FormField label="Birim fiyat (TL)" htmlFor={`inv-l-${i}-p`}>
              <Input id={`inv-l-${i}-p`} value={l.unitPrice} onChange={(e) => patch(i, { unitPrice: e.target.value })} inputMode="decimal" />
            </FormField>
            <FormField label="KDV oranı" htmlFor={`inv-l-${i}-v`}>
              <Select value={String(l.vatRate)} onValueChange={(v) => patch(i, { vatRate: Number(v) })}>
                <SelectTrigger id={`inv-l-${i}-v`} aria-label="KDV oranı" placeholder="KDV" />
                <SelectContent>
                  {VAT_RATE_OPTIONS.map((r) => (
                    <SelectItem key={r} value={String(r)}>{`%${r}`}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              icon={Trash2}
              aria-label={`${i + 1}. kalemi sil`}
              disabled={lines.length === 1}
              onClick={() => setLines((cur) => cur.filter((_, idx) => idx !== i))}
            />
          </div>
        ))}
        <Button
          type="button"
          variant="secondary"
          size="sm"
          icon={Plus}
          onClick={() => setLines((cur) => [...cur, { description: "", quantity: "1", unitPrice: "", vatRate: DEFAULT_VAT_RATE }])}
        >
          Kalem ekle
        </Button>
        <p className="text-xs text-text-faint">KDV oranını siz seçersiniz (varsayılan %{DEFAULT_VAT_RATE}); uygunluğu sağlayıcı ve mali müşavirinizle teyit edin.</p>
      </div>

      <FormField label="Fatura notu" htmlFor="inv-note">
        <Textarea id="inv-note" name="note" defaultValue={initial.note} maxLength={500} rows={2} />
      </FormField>

      <dl className="grid max-w-sm grid-cols-2 gap-x-6 gap-y-1 text-sm">
        <dt className="text-text-muted">Ara toplam</dt>
        <dd className="numeric text-right font-semibold">{money(totals.net)}</dd>
        <dt className="text-text-muted">KDV</dt>
        <dd className="numeric text-right font-semibold">{money(totals.vat)}</dd>
        <dt className="font-semibold text-ink-950">Genel toplam</dt>
        <dd className="numeric text-right font-display text-base font-extrabold text-ink-950">{money(totals.gross)}</dd>
      </dl>

      {state.error ? <p className="text-sm font-semibold text-danger-600" role="alert">{state.error}</p> : null}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" loading={pending} icon={Save}>
          {initial.id ? "Taslağı güncelle" : "Taslağı kaydet ve kontrol et"}
        </Button>
        <p className="text-xs text-text-faint">Taslak sağlayıcıya gönderilmez; resmileştirmeden önce kontrol edersiniz.</p>
      </div>
    </form>
  );
}
