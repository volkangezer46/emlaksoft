"use client";

import { useMemo, useState, useTransition, type FormEvent } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createManualInvoice } from "@/app/actions/platform-invoices";
import {
  MANUAL_INVOICE_CATEGORIES,
  MAX_MANUAL_LINES,
  computeLine,
  isManualLineFilled,
  manualLineIssue,
  parseQuantity,
  parseUnitPrice,
  sumLines,
  type ManualLineInput,
} from "@/lib/billing/manual-invoice";

const field =
  "mt-1 block w-full rounded-[var(--radius-control)] border border-line bg-canvas px-2.5 py-2 text-sm text-ink-950 outline-none focus:border-brand-400 touch:min-h-11";
const fieldBad = "border-danger-600 focus:border-danger-600";
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

const fieldId = (key: number, f: "description" | "quantity" | "unitNet") => `mi-${f}-${key}`;

/**
 * Elle fatura / tek seferlik ücret formu: kalemler + anlık KDV ön izlemesi (oran sunucudan; kesin hesap sunucuda aynı
 * saf fonksiyonla yapılır). Kaydet = TASLAK; kesim fatura detayında yapılır.
 *
 * SK6/B112: form React 19 form eylemi (`action={…}`) DEĞİL, `onSubmit` + preventDefault ile gönderilir ve TÜM alanlar
 * kontrollüdür (ofis, iç not dahil): sunucu hatasından sonra React kontrolsüz alanları sıfırlamaz, seçim ve not korunur.
 * Doldurulmuş her kalem istemcide sunucuyla aynı kuralla (manualLineIssue) doğrulanır; geçersiz kalem varken düğme kapalı.
 * SK6/B037: başarıda sunucu eylemi revalidate + redirect'i TEK yanıtta yapar (istemci router.push / ek RSC turu yok).
 */
export function ManualInvoiceForm({ tenants, defaultTenantId, vatRate }: { tenants: Tenant[]; defaultTenantId: string | null; vatRate: number }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [tenantId, setTenantId] = useState<string>(defaultTenantId ?? "");
  const [note, setNote] = useState("");
  const [category, setCategory] = useState<string>("kurulum");
  const [rows, setRows] = useState<Row[]>([{ key: 1, description: PRESET_TEXT.kurulum, quantity: "1", unitNet: "" }]);
  const [nextKey, setNextKey] = useState(2);
  // Kullanıcı bir alana dokunduysa (ya da gönderdiyse) o satırın hatası gösterilir; ilk açılışta kırmızı yağmuru yok.
  const [touched, setTouched] = useState<Set<number>>(() => new Set());
  const [submitted, setSubmitted] = useState(false);

  const checked = useMemo(
    () =>
      rows.map((r, i) => {
        const issue = manualLineIssue(r);
        const q = parseQuantity(r.quantity || "1");
        const u = parseUnitPrice(r.unitNet);
        const line = !issue && isManualLineFilled(r) && q !== null && u !== null ? computeLine(i + 1, r.description, q, u, vatRate) : null;
        return { row: r, issue, line };
      }),
    [rows, vatRate],
  );
  const lines = checked.flatMap((c) => (c.line ? [c.line] : []));
  const totals = sumLines(lines);
  const invalid = checked.filter((c) => c.issue);
  const canSubmit = !pending && Boolean(tenantId) && lines.length > 0 && invalid.length === 0;

  const update = (key: number, patch: Partial<ManualLineInput>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const touch = (key: number) => setTouched((t) => (t.has(key) ? t : new Set(t).add(key)));

  const onCategory = (v: string) => {
    setCategory(v);
    // Tek kalem ve açıklaması hazır metinse türle birlikte güncellenir (kullanıcının yazdığı metne dokunulmaz).
    setRows((rs) => (rs.length === 1 && Object.values(PRESET_TEXT).includes(rs[0].description) ? [{ ...rs[0], description: PRESET_TEXT[v] ?? "" }] : rs));
  };

  /** Sunucu hatasında odak ilk hatalı alana: "N. kalem: …" → N. doldurulmuş kalemin ilgili alanı; ofis hatası → ofis seçimi. */
  const focusFromError = (message: string) => {
    if (/^Ofis/.test(message)) return document.getElementById("mi-tenant")?.focus();
    const m = /^(\d+)\. kalem:/.exec(message);
    if (!m) return;
    const filled = rows.filter(isManualLineFilled);
    const target = filled[Number(m[1]) - 1];
    if (!target) return;
    const f = /miktar/.test(message) ? "quantity" : /birim fiyat/.test(message) ? "unitNet" : "description";
    document.getElementById(fieldId(target.key, f))?.focus();
  };

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSubmitted(true);
    setError(null);
    if (!tenantId) {
      setError("Ofis seçin.");
      document.getElementById("mi-tenant")?.focus();
      return;
    }
    const firstBad = invalid[0];
    if (firstBad?.issue) {
      document.getElementById(fieldId(firstBad.row.key, firstBad.issue.field))?.focus();
      return;
    }
    if (lines.length === 0) {
      setError("En az bir kalem girin.");
      return;
    }
    const fd = new FormData();
    fd.set("tenant_id", tenantId);
    fd.set("note", note);
    fd.set("category", category);
    fd.set("lines", JSON.stringify(rows.map(({ description, quantity, unitNet }) => ({ description, quantity, unitNet }))));
    startTransition(async () => {
      // Başarıda eylem yönlendirir (bu satırdan sonrası çalışmaz); yalnız hata döner.
      const res = await createManualInvoice(fd);
      if (res?.error) {
        setError(res.error);
        focusFromError(res.error);
      }
    });
  };

  const pct = Math.round(vatRate * 10000) / 100;

  return (
    <form onSubmit={onSubmit} noValidate aria-busy={pending} className="space-y-5 rounded-[var(--radius-panel)] border border-line bg-surface p-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className={lbl}>
          Ofis
          <select
            id="mi-tenant"
            name="tenant_id"
            required
            value={tenantId}
            onChange={(e) => setTenantId(e.target.value)}
            aria-invalid={submitted && !tenantId ? true : undefined}
            className={`${field} ${submitted && !tenantId ? fieldBad : ""}`}
          >
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
          {checked.map(({ row: r, issue, line }, i) => {
            const show = issue && (submitted || touched.has(r.key));
            const bad = (f: "description" | "quantity" | "unitNet") => (show && issue?.field === f ? fieldBad : "");
            const errId = `mi-err-${r.key}`;
            return (
              <li key={r.key} className="grid gap-2 rounded-[var(--radius-card)] border border-line bg-canvas/60 p-3 sm:grid-cols-[1fr_6rem_9rem_8rem_auto] sm:items-end">
                <label className={lbl}>
                  Açıklama
                  <input
                    id={fieldId(r.key, "description")}
                    value={r.description}
                    onChange={(e) => update(r.key, { description: e.target.value })}
                    onBlur={() => touch(r.key)}
                    maxLength={200}
                    aria-invalid={show && issue?.field === "description" ? true : undefined}
                    aria-describedby={show ? errId : undefined}
                    className={`${field} ${bad("description")}`}
                    placeholder="Örn. Kurulum ücreti"
                  />
                </label>
                <label className={lbl}>
                  Miktar
                  <input
                    id={fieldId(r.key, "quantity")}
                    value={r.quantity}
                    onChange={(e) => update(r.key, { quantity: e.target.value })}
                    onBlur={() => touch(r.key)}
                    inputMode="decimal"
                    aria-invalid={show && issue?.field === "quantity" ? true : undefined}
                    aria-describedby={show ? errId : undefined}
                    className={`${field} ${bad("quantity")}`}
                  />
                </label>
                <label className={lbl}>
                  Birim fiyat (₺)
                  <input
                    id={fieldId(r.key, "unitNet")}
                    value={r.unitNet}
                    onChange={(e) => update(r.key, { unitNet: e.target.value })}
                    onBlur={() => touch(r.key)}
                    inputMode="decimal"
                    aria-invalid={show && issue?.field === "unitNet" ? true : undefined}
                    aria-describedby={show ? errId : undefined}
                    className={`${field} ${bad("unitNet")}`}
                    placeholder="2.500"
                  />
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
                {show ? (
                  <p id={errId} role="alert" className="text-xs font-semibold text-danger-600 sm:col-span-5">
                    {i + 1}. kalem: {issue.message}
                  </p>
                ) : null}
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
        <textarea name="note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={2} className={field} />
      </label>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
        <p className="text-sm text-text-muted">
          Net {money(totals.amountTry)} · KDV {money(totals.taxTry)} · Toplam <strong className="text-ink-950">{money(totals.totalTry)}</strong>
        </p>
        {invalid.length > 0 ? (
          <p className="text-xs font-semibold text-danger-600">
            {invalid.length} kalem hatalı ({invalid.map((c) => checked.indexOf(c) + 1).join(", ")}. satır); düzeltmeden kaydedilemez.
          </p>
        ) : null}
        <Button type="submit" variant="navy" size="sm" disabled={!canSubmit} title={invalid.length > 0 ? "Hatalı kalemleri düzeltin" : !tenantId ? "Ofis seçin" : undefined}>
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
