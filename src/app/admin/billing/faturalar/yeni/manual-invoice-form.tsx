"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createManualInvoice } from "@/app/actions/platform-invoices";
import { MANUAL_INVOICE_CATEGORIES, MAX_MANUAL_LINES, computeLine, parseQuantity, parseUnitPrice, sumLines, type ManualLineInput } from "@/lib/billing/manual-invoice";

const field =
  "mt-1 block w-full rounded-[var(--radius-control)] border border-line bg-canvas px-2.5 py-2 text-sm text-ink-950 outline-none focus:border-brand-400 touch:min-h-11";
const lbl = "text-xs font-semibold text-text-muted";
const money = (n: number) => new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" }).format(n);

const PRESET_TEXT: Record<string, string> = {
  kurulum: "Kurulum ücreti",
  egitim: "Eğitim hizmeti",
  yillik: "Yıllık abonelik ödemesi",
  diger: "",
};

type Tenant = { id: string; name: string; status: string | null };
type Row = ManualLineInput & { key: number };

/**
 * Elle fatura / tek seferlik ücret formu: kalemler + anlık KDV ön izlemesi (oran sunucudan; kesin hesap sunucuda aynı
 * saf fonksiyonla yapılır). Kaydet = TASLAK; kesim fatura detayında yapılır.
 */
export function ManualInvoiceForm({ tenants, defaultTenantId, vatRate }: { tenants: Tenant[]; defaultTenantId: string | null; vatRate: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState<string>("kurulum");
  const [rows, setRows] = useState<Row[]>([{ key: 1, description: PRESET_TEXT.kurulum, quantity: "1", unitNet: "" }]);
  const [nextKey, setNextKey] = useState(2);

  const preview = useMemo(() => {
    const lines = rows.flatMap((r, i) => {
      const q = parseQuantity(r.quantity || "1");
      const u = parseUnitPrice(r.unitNet);
      return q !== null && u !== null ? [computeLine(i + 1, r.description, q, u, vatRate)] : [];
    });
    return { lines, totals: sumLines(lines) };
  }, [rows, vatRate]);

  const update = (key: number, patch: Partial<ManualLineInput>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const onCategory = (v: string) => {
    setCategory(v);
    // Tek kalem ve açıklaması hazır metinse türle birlikte güncellenir (kullanıcının yazdığı metne dokunulmaz).
    setRows((rs) => (rs.length === 1 && Object.values(PRESET_TEXT).includes(rs[0].description) ? [{ ...rs[0], description: PRESET_TEXT[v] ?? "" }] : rs));
  };

  const submit = (fd: FormData) => {
    setError(null);
    fd.set("category", category);
    fd.set("lines", JSON.stringify(rows.map(({ description, quantity, unitNet }) => ({ description, quantity, unitNet }))));
    startTransition(async () => {
      const res = await createManualInvoice(fd);
      if (res.error) {
        setError(res.error);
        return;
      }
      if (res.id) router.push(`/admin/billing/faturalar/${res.id}`);
    });
  };

  const pct = Math.round(vatRate * 10000) / 100;

  return (
    <form action={submit} className="space-y-5 rounded-[var(--radius-panel)] border border-line bg-surface p-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className={lbl}>
          Ofis
          <select name="tenant_id" required defaultValue={defaultTenantId ?? ""} className={field}>
            <option value="" disabled>
              Ofis seçin…
            </option>
            {tenants.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
                {t.status && t.status !== "active" ? ` (${t.status})` : ""}
              </option>
            ))}
          </select>
        </label>
        <label className={lbl}>
          Fatura türü
          <select value={category} onChange={(e) => onCategory(e.target.value)} className={field}>
            {MANUAL_INVOICE_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold text-ink-950">Kalemler</legend>
        <p className="text-xs text-text-faint">Birim fiyat KDV hariçtir. KDV oranı bugün %{pct} (ayar defteri; aşağıdaki Ayarlar bölümü).</p>
        <ul className="space-y-2">
          {rows.map((r, i) => {
            const q = parseQuantity(r.quantity || "1");
            const u = parseUnitPrice(r.unitNet);
            const line = q !== null && u !== null ? computeLine(i + 1, r.description, q, u, vatRate) : null;
            return (
              <li key={r.key} className="grid gap-2 rounded-[var(--radius-card)] border border-line bg-canvas/60 p-3 sm:grid-cols-[1fr_6rem_9rem_8rem_auto] sm:items-end">
                <label className={lbl}>
                  Açıklama
                  <input value={r.description} onChange={(e) => update(r.key, { description: e.target.value })} maxLength={200} required className={field} placeholder="Örn. Kurulum ücreti" />
                </label>
                <label className={lbl}>
                  Miktar
                  <input value={r.quantity} onChange={(e) => update(r.key, { quantity: e.target.value })} inputMode="decimal" className={field} />
                </label>
                <label className={lbl}>
                  Birim fiyat (₺)
                  <input value={r.unitNet} onChange={(e) => update(r.key, { unitNet: e.target.value })} inputMode="decimal" required className={field} placeholder="2.500" />
                </label>
                <p className="text-xs text-text-muted sm:pb-2.5">
                  {line ? (
                    <>
                      <span className="block font-semibold text-ink-950">{money(line.totalTry)}</span>
                      KDV {money(line.taxTry)}
                    </>
                  ) : (
                    "—"
                  )}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={rows.length === 1}
                  onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
                  aria-label={`${i + 1}. kalemi kaldır`}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </li>
            );
          })}
        </ul>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={rows.length >= MAX_MANUAL_LINES}
          onClick={() => {
            setRows((rs) => [...rs, { key: nextKey, description: "", quantity: "1", unitNet: "" }]);
            setNextKey((k) => k + 1);
          }}
        >
          <Plus className="h-4 w-4" /> Kalem ekle
        </Button>
      </fieldset>

      <label className={`${lbl} block`}>
        İç not (isteğe bağlı; ofise gitmez)
        <textarea name="note" maxLength={500} rows={2} className={field} />
      </label>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
        <p className="text-sm text-text-muted">
          Net {money(preview.totals.amountTry)} · KDV {money(preview.totals.taxTry)} · Toplam{" "}
          <strong className="text-ink-950">{money(preview.totals.totalTry)}</strong>
        </p>
        <Button type="submit" variant="navy" size="sm" disabled={pending || preview.lines.length === 0}>
          {pending ? "Kaydediliyor…" : "Taslağı kaydet"}
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-sm font-semibold text-danger-600">
          {error}
        </p>
      ) : null}
      <p className="text-xs text-text-faint">
        Taslak ofise görünmez ve borç sayılmaz. Fatura detayında &quot;Faturayı kes&quot; ile açık faturaya dönüşür; abonelik geliri (MRR) değildir.
      </p>
    </form>
  );
}
