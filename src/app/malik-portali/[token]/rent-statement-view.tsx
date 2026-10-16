import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadRentStatementData } from "@/lib/owner-report/load";
import { RENT_DECLARATION_NOTE, buildRentStatement, statementYears } from "@/lib/owner-report/rent-statement";
import { now, trDayKey } from "@/lib/clock";
import { PrintButton } from "@/components/ui/print-button";
import { formatTryDecimal } from "@/lib/format";
import { WITHHOLDING_OWNER_NOTE } from "@/lib/rent-withholding";

const MONTHS = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];

const money = (n: number) => formatTryDecimal(n, 2);

/**
 * Malik kira ekstresi (yazdırılabilir): `/malik-portali/<token>?ekstre=<yıl>`. Seçilen yılın aylık tahakkuk / tahsilat /
 * gider / net dökümü. Token doğrulaması ve modül kapısı malik paneli sayfasında yapılır; istemci oradan gelir.
 */
export async function OwnerRentStatementView({
  db,
  token,
  tenantId,
  tenantName,
  propertyId,
  propertyLabel,
  ownerName,
  rawYear,
}: {
  db: SupabaseClient;
  token: string;
  tenantId: string;
  tenantName: string;
  propertyId: string;
  propertyLabel: string;
  ownerName: string;
  rawYear: number;
}) {
  const currentYear = Number(trDayKey(now()).slice(0, 4));
  const firstPass = await loadRentStatementData(db, tenantId, propertyId, currentYear);
  const years = statementYears(firstPass.firstStartDay, currentYear);
  const year = years.includes(rawYear) ? rawYear : currentYear;
  const rows = year === currentYear ? firstPass : await loadRentStatementData(db, tenantId, propertyId, year);
  const s = buildRentStatement(year, rows.charges, rows.expenses);

  return (
    <main id="main-content" className="mx-auto max-w-3xl space-y-5 bg-canvas p-4 py-6 print:max-w-none print:p-0">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href={`/malik-portali/${token}`} className="text-sm font-semibold text-brand-600 hover:underline">
          ← Malik paneline dön
        </Link>
        <div className="flex items-center gap-2">
          <nav aria-label="Ekstre yılı" className="flex flex-wrap gap-1">
            {years.map((y) => (
              <Link
                key={y}
                href={`/malik-portali/${token}?ekstre=${y}`}
                aria-current={y === year ? "page" : undefined}
                className={`rounded-[var(--radius-control)] border px-2.5 py-1 text-xs font-semibold ${y === year ? "border-brand-500 bg-brand-600/10 text-brand-700" : "border-line text-text-muted"}`}
              >
                {y}
              </Link>
            ))}
          </nav>
          <PrintButton tone="brand" size="sm" />
        </div>
      </div>

      <header>
        <p className="text-xs font-semibold uppercase tracking-wider text-text-muted">{tenantName}</p>
        <h1 className="font-display text-xl font-extrabold text-ink-950">Kira ekstresi · {year}</h1>
        <p className="mt-1 text-sm text-text-muted">
          {propertyLabel} · Sayın {ownerName}
        </p>
      </header>

      {rows.rentalCount === 0 ? (
        <p className="rounded-[var(--radius-card)] border border-dashed border-line px-4 py-8 text-center text-sm text-text-muted">Bu portföy için kira kaydı yok.</p>
      ) : (
        <>
          {/* Telefon: ay başına kart + toplam kartı (yana kaydırma yok); md+ tablo. */}
          <ul className="space-y-2 md:hidden" aria-label="Aylık kira dökümü">
            {s.months.map((m, i) => (
              <li key={m.month} className="rounded-[var(--radius-card)] border border-line bg-surface px-3 py-2 text-sm">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-medium text-ink-950">
                    {MONTHS[i]}
                    {m.overdue > 0 ? <span className="ml-2 text-xs font-semibold text-danger-600">gecikmiş {money(m.overdue)}</span> : null}
                  </span>
                  <span className="font-semibold tabular-nums text-ink-950">{m.collected || m.expense ? money(m.net) : "—"}</span>
                </div>
                <dl className="mt-1 grid grid-cols-3 gap-2 text-xs">
                  <div><dt className="text-text-muted">Tahakkuk</dt><dd className="tabular-nums">{m.accrued ? money(m.accrued) : "—"}</dd></div>
                  <div><dt className="text-text-muted">Tahsilat</dt><dd className="tabular-nums">{m.collected ? money(m.collected) : "—"}</dd></div>
                  <div><dt className="text-text-muted">Gider</dt><dd className="tabular-nums">{m.expense ? money(m.expense) : "—"}</dd></div>
                </dl>
              </li>
            ))}
            <li className="rounded-[var(--radius-card)] border border-line bg-canvas px-3 py-2 text-sm font-bold text-ink-950">
              <div className="flex items-baseline justify-between gap-2">
                <span>Toplam net</span>
                <span className="tabular-nums">{money(s.totals.net)}</span>
              </div>
              <dl className="mt-1 grid grid-cols-3 gap-2 text-xs font-normal">
                <div><dt className="text-text-muted">Tahakkuk</dt><dd className="tabular-nums">{money(s.totals.accrued)}</dd></div>
                <div><dt className="text-text-muted">Tahsilat</dt><dd className="tabular-nums">{money(s.totals.collected)}</dd></div>
                <div><dt className="text-text-muted">Gider</dt><dd className="tabular-nums">{money(s.totals.expense)}</dd></div>
              </dl>
            </li>
          </ul>
          <div className="hidden overflow-x-auto rounded-[var(--radius-card)] border border-line bg-surface md:block">
            <table className="w-full text-sm">
              <caption className="sr-only">Aylık kira dökümü</caption>
              <thead className="bg-canvas text-xs text-text-muted">
                <tr>
                  <th scope="col" className="px-3 py-2 text-left font-semibold">Ay</th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">Tahakkuk</th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">Tahsilat</th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">Gider</th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">Net</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {s.months.map((m, i) => (
                  <tr key={m.month}>
                    <th scope="row" className="px-3 py-2 text-left font-medium text-ink-950">
                      {MONTHS[i]}
                      {m.overdue > 0 ? <span className="ml-2 text-xs font-semibold text-danger-600">gecikmiş {money(m.overdue)}</span> : null}
                    </th>
                    <td className="px-3 py-2 text-right tabular-nums">{m.accrued ? money(m.accrued) : "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{m.collected ? money(m.collected) : "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{m.expense ? money(m.expense) : "—"}</td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums">{m.collected || m.expense ? money(m.net) : "—"}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-canvas font-bold text-ink-950">
                <tr>
                  <th scope="row" className="px-3 py-2 text-left">Toplam</th>
                  <td className="px-3 py-2 text-right tabular-nums">{money(s.totals.accrued)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{money(s.totals.collected)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{money(s.totals.expense)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{money(s.totals.net)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          {s.totals.withheld > 0 ? (
            <section aria-labelledby="stopaj-baslik" className="rounded-[var(--radius-card)] border border-line bg-surface p-4">
              <h2 id="stopaj-baslik" className="text-sm font-bold text-ink-950">Stopaj (kiracının kestiği vergi)</h2>
              <dl className="mt-2 space-y-1.5 text-sm">
                <div className="flex justify-between gap-3">
                  <dt className="text-text-muted">Size ödenen net kira</dt>
                  <dd className="tabular-nums font-semibold text-ink-950">{money(s.totals.collected)}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-text-muted">Kiracının yaptığı stopaj</dt>
                  <dd className="tabular-nums font-semibold text-ink-950">{money(s.totals.withheld)}</dd>
                </div>
                <div className="flex justify-between gap-3 border-t border-line pt-1.5">
                  <dt className="font-semibold text-ink-950">Brüt kira geliri ({year})</dt>
                  <dd className="tabular-nums font-bold text-ink-950">{money(s.totals.collected + s.totals.withheld)}</dd>
                </div>
              </dl>
              <p className="mt-2 text-xs leading-relaxed text-text-muted">{WITHHOLDING_OWNER_NOTE}</p>
            </section>
          ) : null}

          {s.expenses.length > 0 ? (
            <section>
              <h2 className="text-sm font-bold text-ink-950">Gider kalemleri</h2>
              <ul className="mt-2 divide-y divide-line rounded-[var(--radius-card)] border border-line bg-surface text-sm">
                {s.expenses.map((e, i) => (
                  <li key={`${e.date}-${i}`} className="flex justify-between gap-3 px-3 py-2">
                    <span>
                      {e.date.split("-").reverse().join(".")} · {e.title}
                    </span>
                    <span className="tabular-nums">{money(e.cost)}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}

      <footer className="space-y-2 text-xs leading-relaxed text-text-faint">
        <p>
          Tahsilat: &quot;ödendi&quot; işaretli kira tahakkukları (ödeme ayına göre). Gider: tamamlanmış bakım taleplerine girilen maliyet. Net = tahsilat − gider.
          Ofis hizmet bedeli ve vergiler bu ekstrede hesaplanmaz.
        </p>
        <p>{RENT_DECLARATION_NOTE}</p>
      </footer>
    </main>
  );
}
