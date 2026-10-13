import Link from "@/components/ui/smart-link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TableFrame, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { formatDateTimeTr } from "@/lib/format";
import { pctText, rate, type FunnelChannelRow, type GrowthFunnel } from "@/lib/growth-analytics/funnel";
import type { LandingView } from "@/lib/growth-analytics/landing";
import type { HealthGrade } from "@/lib/measure/health";
import type { MeasureHealthView } from "@/lib/measure/collector";
import type { NotFoundRow } from "@/lib/seo/store";

/**
 * Huni ve kanallar ekranının bölümleri (SUNUCU bileşenleri; istemci JS yok). Her sayı bir hedefe gider:
 * kayıt/aktivasyon/ödeme → dönem süzgeçli ofis listesi, ziyaret → iniş yolu tablosu, 404 → yönlendirme ekranı.
 */

const num = (n: number | null) => (n === null ? "—" : n.toLocaleString("tr-TR"));

function Delta({ cur, prev }: { cur: number | null; prev: number | null | undefined }) {
  if (cur === null || prev === null || prev === undefined) return null;
  const d = cur - prev;
  if (d === 0) return <span className="block text-[11px] text-text-faint">önceki dönemle aynı</span>;
  return (
    <span className={`block text-[11px] ${d > 0 ? "text-success-strong" : "text-danger-600"}`}>
      {d > 0 ? "+" : "−"}
      {Math.abs(d).toLocaleString("tr-TR")} önceki döneme göre
    </span>
  );
}

function CellLink({ href, children, label }: { href: string; children: React.ReactNode; label: string }) {
  return (
    <Link href={href} aria-label={label} className="focus-ring rounded font-semibold tabular-nums text-ink-950 hover:text-brand-700 hover:underline">
      {children}
    </Link>
  );
}

export function ChannelTable({
  funnel,
  prev,
  days,
}: {
  funnel: GrowthFunnel;
  prev: GrowthFunnel | null;
  days: number;
}) {
  const prevBy = new Map<string, FunnelChannelRow>((prev?.channels ?? []).map((c) => [c.channel, c]));
  const tenants = `/admin/tenants?yeni=${days}`;
  return (
    <TableFrame minWidth={760} stickyFirst>
      <Table className="w-full text-left text-sm">
        <THead>
          <TR className="border-b border-line text-xs uppercase tracking-wide text-text-muted">
            <TH scope="col" className="px-4 py-2 font-semibold">Kanal</TH>
            <TH scope="col" align="right" className="px-4 py-2 font-semibold">Ziyaret</TH>
            <TH scope="col" align="right" className="px-4 py-2 font-semibold">Kayıt</TH>
            <TH scope="col" align="right" className="px-4 py-2 font-semibold">Kayıt oranı</TH>
            <TH scope="col" align="right" className="px-4 py-2 font-semibold">İlk ilan</TH>
            <TH scope="col" align="right" className="px-4 py-2 font-semibold">Ödeyen</TH>
            <TH scope="col" align="right" className="px-4 py-2 font-semibold">İlk ödemeye (medyan)</TH>
          </TR>
        </THead>
        <TBody className="divide-y divide-line">
          {funnel.channels.map((c) => {
            const p = prevBy.get(c.channel);
            return (
              <TR key={c.channel}>
                <TD className="px-4 py-2.5 font-semibold text-ink-950">{c.label}</TD>
                <TD align="right" className="px-4 py-2.5">
                  {c.visits === null ? (
                    <span className="text-text-faint" title="Bu kanal ya da dönem için ziyaret ölçümü yok">—</span>
                  ) : (
                    <CellLink href="#inis-yollari" label={`${c.label}: ${num(c.visits)} ziyaret, iniş yollarına git`}>{num(c.visits)}</CellLink>
                  )}
                  <Delta cur={c.visits} prev={p?.visits} />
                </TD>
                <TD align="right" className="px-4 py-2.5">
                  <CellLink href={tenants} label={`${c.label}: ${c.signups} kayıt, son ${days} günün ofisleri`}>{num(c.signups)}</CellLink>
                  <Delta cur={c.signups} prev={p ? p.signups : prev ? 0 : undefined} />
                </TD>
                <TD align="right" className="px-4 py-2.5 tabular-nums">{pctText(rate(c.signups, c.visits))}</TD>
                <TD align="right" className="px-4 py-2.5">
                  <CellLink href={tenants} label={`${c.label}: ${c.activated} ofis ilk ilanını girdi`}>{num(c.activated)}</CellLink>
                  <span className="block text-[11px] text-text-faint">{pctText(rate(c.activated, c.signups))}</span>
                </TD>
                <TD align="right" className="px-4 py-2.5">
                  <CellLink href={`${tenants}&durum=active`} label={`${c.label}: ${c.paid} ödeyen ofis`}>{num(c.paid)}</CellLink>
                  <span className="block text-[11px] text-text-faint">{pctText(rate(c.paid, c.signups))}</span>
                </TD>
                <TD align="right" className="px-4 py-2.5 tabular-nums">
                  {c.medianDaysToPaid === null ? (
                    <span className="text-text-faint" title="Geçerli ödeme örneği yok">—</span>
                  ) : (
                    <>
                      {c.medianDaysToPaid.toLocaleString("tr-TR", { maximumFractionDigits: 1 })} gün
                      <span className="block text-[11px] text-text-faint">{c.paidSamples} örnek</span>
                    </>
                  )}
                </TD>
              </TR>
            );
          })}
        </TBody>
      </Table>
    </TableFrame>
  );
}

export function LandingTable({ rows }: { rows: LandingView[] }) {
  if (!rows.length) return <p className="text-sm text-text-muted">Bu dönemde iniş yolu verisi yok.</p>;
  return (
    <TableFrame minWidth={640} stickyFirst>
      <Table className="w-full text-left text-sm">
        <THead>
          <TR className="border-b border-line text-xs uppercase tracking-wide text-text-muted">
            <TH scope="col" className="px-4 py-2 font-semibold">Sayfa</TH>
            <TH scope="col" align="right" className="px-4 py-2 font-semibold">Ziyaret</TH>
            <TH scope="col" align="right" className="px-4 py-2 font-semibold">Kayıt</TH>
            <TH scope="col" align="right" className="px-4 py-2 font-semibold">Oran</TH>
            <TH scope="col" className="px-4 py-2 font-semibold">Düzenle</TH>
          </TR>
        </THead>
        <TBody className="divide-y divide-line">
          {rows.map((r) => (
            <TR key={r.path}>
              <TD className="max-w-[18rem] truncate px-4 py-2.5 font-mono text-xs text-ink-950" title={r.path}>{r.path}</TD>
              <TD align="right" className="px-4 py-2.5 tabular-nums">{num(r.visits)}</TD>
              <TD align="right" className="px-4 py-2.5 tabular-nums">{num(r.signups)}</TD>
              <TD align="right" className="px-4 py-2.5 tabular-nums">{pctText(r.signupRate)}</TD>
              <TD className="px-4 py-2.5">
                <span className="flex flex-wrap gap-3 text-xs font-semibold">
                  {r.links.content ? (
                    <Link href={r.links.content.href} className="focus-ring rounded text-brand-700 hover:underline">{r.links.content.label}</Link>
                  ) : null}
                  <Link href={r.links.seo.href} className="focus-ring rounded text-brand-700 hover:underline">{r.links.seo.label}</Link>
                </span>
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </TableFrame>
  );
}

export function LostTraffic({ rows, available }: { rows: NotFoundRow[]; available: boolean }) {
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Kayıp trafik</CardTitle>
          <CardDescription>Ziyaretçinin bulamadığı (404) adresler. Bir yönlendirme kuralıyla bu ziyaretleri doğru sayfaya geri kazanabilirsiniz.</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        {!available ? (
          <p className="text-sm text-text-muted">404 kaydı henüz etkin değil.</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-text-muted">Kayıp trafik yok: bulunamayan adres kaydı boş.</p>
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((r) => (
              <li key={r.path} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="min-w-0 truncate font-mono text-xs" title={r.path}>{r.path}</span>
                <span className="flex shrink-0 items-center gap-3">
                  <span className="text-xs text-text-muted">son {formatDateTimeTr(r.last_seen_at)}</span>
                  <Link
                    href={`/admin/seo?sekme=yonlendirme&kaynak=${encodeURIComponent(r.path)}`}
                    className="focus-ring rounded font-semibold tabular-nums text-brand-700 hover:underline"
                    aria-label={`${r.path}: ${r.hits} kayıp ziyaret, yönlendirme ekle`}
                  >
                    {r.hits.toLocaleString("tr-TR")} ziyaret
                  </Link>
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

const GRADE_TONE: Record<HealthGrade, string> = {
  A: "bg-mint-500/15 text-mint-700",
  B: "bg-mint-500/15 text-mint-700",
  C: "bg-amber-100 text-amber-900",
  D: "bg-amber-100 text-amber-900",
  E: "bg-danger-500/10 text-danger-600",
  F: "bg-danger-500/10 text-danger-600",
};

export function HealthCard({ health }: { health: MeasureHealthView }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start gap-3">
          <span className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-lg font-extrabold ${GRADE_TONE[health.grade]}`} aria-label={`Ölçüm notu ${health.grade}`}>
            {health.grade}
          </span>
          <div>
            <CardTitle>Ölçüm sağlığı</CardTitle>
            <CardDescription>Sayaç akışı, kayıt kaynağı kapsaması ve kayıt hataları. Not ölçüm verisinin ne kadar güvenilir olduğunu söyler.</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {health.findings.length === 0 ? (
          <p className="text-sm text-text-muted">Sorun yok: sayaç çalışıyor, kayıtların kaynağı yeterince biliniyor.</p>
        ) : (
          <ul className="space-y-2">
            {health.findings.map((f) => (
              <li key={f.code} className="text-sm">
                <Link href={f.href} className="focus-ring rounded hover:underline">
                  <span className={f.severity === "kritik" ? "font-semibold text-danger-600" : f.severity === "uyari" ? "font-semibold text-amber-900" : "text-text-muted"}>
                    {f.text}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
