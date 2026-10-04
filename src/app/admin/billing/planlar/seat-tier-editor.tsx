"use client";

import { quoteSeats } from "@/lib/billing/seat-pricing";
import type { PlanDef, SeatRounding } from "@/lib/billing/plans";
import { opFieldClass } from "../inline-op";
import { rowFrom, type TierRow, type useSeatDraft } from "./seat-draft";

const lbl = "block text-xs font-semibold text-text-muted";
const tl = (n: number) => `${Math.round(n).toLocaleString("tr-TR")} ₺`;

type Draft = ReturnType<typeof useSeatDraft>;

/** Kademe düzenleyici: ekle/sil/düzenle, canlı doğrulama, önerilen kademeler ve fiyat önizlemesi. Kaydı üst form yapar. */
export function SeatTierEditor({ plan, draft, readOnly = false }: { plan: PlanDef; draft: Draft; readOnly?: boolean }) {
  const { rows, setRows, rounding, setRounding, maxSeats, setMaxSeats, report, replaced, edited } = draft;
  const included = plan.limits.seats;

  function update(i: number, patch: Partial<TierRow>) {
    setRows(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  function remove(i: number) {
    setRows(rows.filter((_, idx) => idx !== i));
  }
  function add() {
    const lastIndex = rows.length - 1;
    const last = rows[lastIndex];
    if (!last) {
      setRows([{ to: "", price: edited.extraSeatMonthlyTry ? String(edited.extraSeatMonthlyTry) : "" }]);
      return;
    }
    const closeAt = rowFrom(rows, lastIndex) + 4;
    const closed = rows.map((r, idx) => (idx === lastIndex && !r.to.trim() ? { ...r, to: String(closeAt) } : r));
    setRows([...closed, { to: "", price: last.price }]);
  }

  const sample = [0, 1, 3, 5, 10, 15, 20].map((e) => included + e);
  const previews = sample
    .map((s) => ({ s, q: quoteSeats(replaced, plan.id, s, "monthly") }))
    .filter(({ q }) => !q.maxSeatsExceeded);

  return (
    <fieldset className="space-y-3 rounded-[var(--radius-card)] border border-line bg-canvas/40 p-3">
      <legend className="px-1 text-xs font-bold uppercase tracking-wide text-text-faint">
        Ek kullanıcı kademeleri (dahil: {included} kullanıcı)
      </legend>
      <p className="text-xs text-text-muted">
        Kademeler marjinal uygulanır: bir kademedeki koltuk o kademenin birim fiyatıyla ücretlenir. Kademe yoksa tek &quot;Ek kullanıcı&quot; fiyatı geçerlidir.
      </p>

      {rows.length > 0 ? (
        <ul className="space-y-2">
          {rows.map((r, i) => (
            <li key={i} className="grid items-end gap-2 sm:grid-cols-[6rem_1fr_1fr_auto]">
              <span className="text-xs font-semibold text-text-muted">
                Kademe {i + 1}
                <span className="mt-1 block rounded-[var(--radius-control)] border border-line bg-surface px-2 py-2 font-mono text-xs text-ink-950">
                  {rowFrom(rows, i)}. ek
                </span>
              </span>
              <label className={lbl}>
                Bitiş (ek kullanıcı)
                <input
                  value={r.to}
                  disabled={readOnly}
                  onChange={(e) => update(i, { to: e.target.value })}
                  inputMode="numeric"
                  placeholder={i === rows.length - 1 ? "sınırsız" : "ör. 5"}
                  className={`mt-1 w-full ${opFieldClass}`}
                />
              </label>
              <label className={lbl}>
                Birim fiyat (aylık, ₺)
                <input
                  value={r.price}
                  disabled={readOnly}
                  onChange={(e) => update(i, { price: e.target.value })}
                  inputMode="numeric"
                  className={`mt-1 w-full ${opFieldClass}`}
                />
              </label>
              {readOnly ? null : (
                <button
                  type="button"
                  onClick={() => remove(i)}
                  aria-label={`Kademe ${i + 1} sil`}
                  className="focus-ring press min-h-9 rounded-[var(--radius-control)] border border-line px-3 py-2 text-xs font-semibold text-text-muted hover:text-danger-600"
                >
                  Sil
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-text-faint">Kademe tanımlı değil.</p>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <label className={lbl}>
          Yuvarlama düzeni
          <select
            value={rounding}
            disabled={readOnly}
            onChange={(e) => setRounding(e.target.value as SeatRounding)}
            className={`mt-1 w-full ${opFieldClass}`}
          >
            <option value="none">Yok</option>
            <option value="x9">Fiyatlar 9 ile biter (x9)</option>
            <option value="x0">Onluk (x0)</option>
          </select>
        </label>
        <label className={lbl}>
          Azami toplam kullanıcı
          <input
            value={maxSeats}
            disabled={readOnly}
            onChange={(e) => setMaxSeats(e.target.value)}
            inputMode="numeric"
            placeholder="kademelere göre"
            className={`mt-1 w-full ${opFieldClass}`}
          />
        </label>
        {readOnly ? null : (
          <div className="flex flex-wrap items-end gap-2">
            <button type="button" onClick={add} className="focus-ring press min-h-9 rounded-[var(--radius-control)] border border-line bg-surface px-3 py-2 text-xs font-semibold text-ink-950">
              Kademe ekle
            </button>
            <button type="button" onClick={draft.applySuggested} className="focus-ring press min-h-9 rounded-[var(--radius-control)] border border-line bg-surface px-3 py-2 text-xs font-semibold text-ink-950">
              Önerilen kademeleri uygula
            </button>
          </div>
        )}
      </div>

      {report.errors.length > 0 ? (
        <ul role="alert" className="space-y-1 text-xs font-semibold text-danger-600">
          {report.errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      ) : (
        <p role="status" className="text-xs font-semibold text-mint-700">Kademeler geçerli.</p>
      )}
      {report.warnings.length > 0 ? (
        <ul className="space-y-1 text-xs text-warn-600">
          {report.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      ) : null}

      {previews.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <caption className="pb-1 text-left font-semibold text-text-muted">Önizleme (KDV hariç, aylık)</caption>
            <thead>
              <tr className="text-text-faint">
                <th className="py-1 pr-3 font-semibold">Kullanıcı</th>
                <th className="py-1 pr-3 font-semibold">Toplam</th>
                <th className="py-1 pr-3 font-semibold">Kişi başı</th>
                <th className="py-1 font-semibold">Üst paket önerisi</th>
              </tr>
            </thead>
            <tbody>
              {previews.map(({ s, q }) => (
                <tr key={s} className="border-t border-line text-ink-950">
                  <td className="py-1 pr-3 tabular-nums">{s}</td>
                  <td className="py-1 pr-3 tabular-nums">{tl(q.totalMonthlyTry)}</td>
                  <td className="py-1 pr-3 tabular-nums">{tl(q.perSeatEffectiveTry)}</td>
                  <td className="py-1 text-text-muted">{q.recommendation ? q.recommendation.reason : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </fieldset>
  );
}
