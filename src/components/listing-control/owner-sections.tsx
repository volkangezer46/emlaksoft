import Link from "@/components/ui/smart-link";
import { ChevronRight } from "lucide-react";
import { TableFrame, Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { districtListHref } from "./helpers";
import { Panel } from "./ui-parts";
import type { OwnerQuestion } from "./owner-questions";
import type { DistrictSummaryRow } from "@/lib/listing-control/server/readers";

/** "Ofis sahibinin 12 sorusu" ve bölge (ilçe) kırılımı (sunucu bileşenleri; her sayı filtreli listeye gider). */

const TONE_DOT: Record<OwnerQuestion["tone"], string> = {
  neutral: "bg-text-faint",
  success: "bg-mint-600",
  warn: "bg-amber-500",
  danger: "bg-danger-600",
};
const TONE_LABEL: Record<OwnerQuestion["tone"], string> = { neutral: "Bilgi", success: "Sorun yok", warn: "İncelenmeli", danger: "Kritik" };

export function OwnerQuestions({ questions }: { questions: readonly OwnerQuestion[] }) {
  return (
    <Panel id="sorular" title="Ofis sahibinin 12 sorusu" description="Her cevap gerçek kayıtlardan gelir; tıklayınca o sayıyı oluşturan liste açılır.">
      <ol className="grid gap-2 md:grid-cols-2">
        {questions.map((q, i) => (
          <li key={q.key}>
            <Link href={q.href} className="focus-ring group flex min-h-14 items-start gap-3 rounded-[var(--radius-control)] border border-line px-3 py-2.5 transition hover:border-brand-400">
              <span className="mt-0.5 w-5 shrink-0 text-xs font-semibold tabular-nums text-text-muted">{i + 1}.</span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-text">{q.question}</span>
                <span className="mt-0.5 flex items-center gap-1.5 text-sm text-text-muted">
                  <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${TONE_DOT[q.tone]}`} />
                  <span className="sr-only">{TONE_LABEL[q.tone]}: </span>
                  <span className="truncate">{q.answer}</span>
                </span>
              </span>
              <ChevronRight aria-hidden="true" className="mt-1 h-4 w-4 shrink-0 text-text-muted transition group-hover:translate-x-0.5" />
            </Link>
          </li>
        ))}
      </ol>
    </Panel>
  );
}

export function DistrictBreakdown({ rows }: { rows: readonly DistrictSummaryRow[] }) {
  const sorted = [...rows].sort((a, b) => b.portal_missing + b.in_review - (a.portal_missing + a.in_review) || b.total_active - a.total_active).slice(0, 15);
  const cell = (n: number, href: string, label: string) =>
    n > 0 ? (
      <Link href={href} aria-label={label} className="focus-ring rounded font-semibold tabular-nums text-accent-text hover:underline">
        {n}
      </Link>
    ) : (
      <span className="tabular-nums text-text-muted">0</span>
    );
  return (
    <Panel id="bolge" title="Bölge kırılımı (ilçe)" description="Sorunların hangi ilçede toplandığı; en riskli 15 ilçe. Her sayı aynı ilçenin filtreli listesine gider.">
      {sorted.length === 0 ? (
        <p className="text-sm text-text-muted">İlçe kırılımı için aktif portföy yok.</p>
      ) : (
        <TableFrame minWidth={640}>
          <Table>
            <caption className="sr-only">İlçe bazında portföy sağlığı</caption>
            <THead>
              <TR>
                <TH>İlçe</TH>
                <TH align="right">Aktif</TH>
                <TH align="right">Yayında</TH>
                <TH align="right">Kayıp</TH>
                <TH align="right">İnceleme</TH>
                <TH align="right">Fiyat farkı</TH>
                <TH align="right">Sağlıklı</TH>
              </TR>
            </THead>
            <TBody>
              {sorted.map((r) => {
                const name = r.district_name ?? "İlçesi girilmemiş";
                const id = r.district_id;
                return (
                  <TR key={id ?? "yok"}>
                    <TD>{name}</TD>
                    <TD align="right">{cell(r.total_active, districtListHref("active", id), `${name}: aktif portföyler`)}</TD>
                    <TD align="right">{cell(r.in_portals, districtListHref("in_portals", id), `${name}: yayındakiler`)}</TD>
                    <TD align="right">{cell(r.portal_missing, districtListHref("portal_missing", id), `${name}: portal ilanı kayıp`)}</TD>
                    <TD align="right">{cell(r.in_review, districtListHref("in_review", id), `${name}: inceleme bekleyen`)}</TD>
                    <TD align="right">{cell(r.price_mismatch, districtListHref("price_mismatch", id), `${name}: fiyat uyuşmazlığı`)}</TD>
                    <TD align="right">{cell(r.healthy, districtListHref("healthy", id), `${name}: sağlıklı`)}</TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </TableFrame>
      )}
    </Panel>
  );
}
