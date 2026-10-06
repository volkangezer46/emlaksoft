import Link from "next/link";
import { BarChart3, FileText, Landmark } from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PortalEmpty, PortalSection } from "@/components/public/portal-kit";
import { buildOwnerWeeklyReport, lastFullWeek, periodLabel, trDayStartIsoOf } from "@/lib/owner-report/core";
import { loadOwnerReportFacts, loadRentStatementData } from "@/lib/owner-report/load";
import { RENT_DECLARATION_NOTE, buildRentStatement, showRentDeclarationReminder } from "@/lib/owner-report/rent-statement";
import { now, trDayKey } from "@/lib/clock";
import { formatTry } from "@/lib/format";

const money = formatTry;

/** Malik paneli "Haftalık rapor" bölümü (ofis ayarı açıksa çizilir). İstemci sayfanın mevcut istemcisidir. */
export async function OwnerWeeklyReportSection({ db, tenantId, propertyId }: { db: SupabaseClient; tenantId: string; propertyId: string }) {
  const week = lastFullWeek(trDayKey(now()));
  const facts = await loadOwnerReportFacts(db, {
    tenantId,
    propertyId,
    startIso: trDayStartIsoOf(week.startDay),
    endIso: trDayStartIsoOf(week.endDayExclusive),
    startDay: week.startDay,
    endDayExclusive: week.endDayExclusive,
    prevStartDay: week.prevStartDay,
  });
  const report = buildOwnerWeeklyReport(facts, periodLabel(week.startDay, week.endDayInclusive));
  return (
    <PortalSection id="haftalik-rapor" icon={BarChart3} title={`Haftalık rapor · ${report.periodLabel}`} iconClassName="text-brand-600">
      <div className="space-y-2">
        {report.lines.map((l) => (
          <div key={l.key} className="rounded-[var(--radius-card)] border border-line bg-surface px-4 py-3 shadow-[var(--shadow-xs)]">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-sm font-semibold text-ink-950">{l.label}</p>
              <p className="text-sm text-ink-950">{l.value}</p>
            </div>
            {l.hint ? <p className="mt-0.5 text-xs text-text-muted">{l.hint}</p> : null}
          </div>
        ))}
      </div>
      <p className="mt-2 text-xs text-text-faint">
        {report.empty ? "Bu hafta kayıtlı hareket olmadı. " : ""}
        Rapor ofisin kendi kayıtlarından hazırlanır; portal sitelerinin görüntülenme verisi içermez. Vitrin sayısı yaklaşıktır.
      </p>
    </PortalSection>
  );
}

/** Malik paneli "Kira ekstresi" özeti (bu yıl). Kira kaydı yoksa çizilmez. */
export async function OwnerRentStatementSection({ db, tenantId, propertyId, token }: { db: SupabaseClient; tenantId: string; propertyId: string; token: string }) {
  const today = trDayKey(now());
  const year = Number(today.slice(0, 4));
  const data = await loadRentStatementData(db, tenantId, propertyId, year);
  if (data.rentalCount === 0) return null;
  const s = buildRentStatement(year, data.charges, data.expenses);
  const declaration = showRentDeclarationReminder(today);
  return (
    <PortalSection id="kira-ekstresi" icon={FileText} title={`Kira ekstresi · ${year}`} iconClassName="text-mint-600">
      {declaration ? (
        <p className="mb-3 flex items-start gap-2 rounded-[var(--radius-card)] border border-amber-400/40 bg-amber-400/[0.07] px-3 py-2 text-xs leading-relaxed text-text-muted">
          <Landmark className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-700" aria-hidden />
          <span>
            {RENT_DECLARATION_NOTE}{" "}
            <Link href={`/malik-portali/${token}?ekstre=${year - 1}`} className="font-semibold text-brand-600 hover:underline">
              Geçen yılın ekstresi
            </Link>
          </span>
        </p>
      ) : null}
      {s.hasData ? (
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-[var(--radius-card)] border border-line bg-surface px-3 py-3">
            <p className="text-xs text-text-muted">Tahsilat</p>
            <p className="mt-0.5 font-bold text-ink-950">{money(s.totals.collected)}</p>
          </div>
          <div className="rounded-[var(--radius-card)] border border-line bg-surface px-3 py-3">
            <p className="text-xs text-text-muted">Gider</p>
            <p className="mt-0.5 font-bold text-ink-950">{money(s.totals.expense)}</p>
          </div>
          <div className="rounded-[var(--radius-card)] border border-line bg-surface px-3 py-3">
            <p className="text-xs text-text-muted">Net</p>
            <p className="mt-0.5 font-bold text-ink-950">{money(s.totals.net)}</p>
          </div>
        </div>
      ) : (
        <PortalEmpty icon={FileText} title="Bu yıl için tahsilat veya gider kaydı yok." />
      )}
      <Link
        href={`/malik-portali/${token}?ekstre=${year}`}
        className="focus-ring mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-600 hover:underline"
      >
        Aylık döküm ve yazdır →
      </Link>
    </PortalSection>
  );
}
