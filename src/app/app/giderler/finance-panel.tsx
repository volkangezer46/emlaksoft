import Link from "@/components/ui/smart-link";
import { CalendarClock, PiggyBank, Radio } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { now } from "@/lib/clock";
import { formatDateTr, formatTry } from "@/lib/format";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Table, TableFrame, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { BudgetForm, BudgetRemoveButton } from "./budget-form";
import { cachedTenantAggregate } from "@/lib/cache/tenant-aggregate";
import { loadBudgetContext, loadPortalRoi, loadRecurringSeries } from "@/lib/finance/load";
import { BUDGET_WARN_RATIO } from "@/lib/finance/expense-budget";
import { RECURRENCE_LABEL, monthlyEquivalent, renewalInfo } from "@/lib/finance/recurring-expenses";
import { PORTAL_LABEL, ROI_WINDOW_DAYS, leadSourceOf, pickLeastEfficientPortal, unusedPortalSubscriptions } from "@/lib/finance/portal-roi";

type Category = { value: string; label: string };

/** Veritabanı güncellemesi (20261008000700) beklenirken gösterilen sakin not. */
function PendingNote({ what }: { what: string }) {
  return (
    <Alert tone="info">
      {what} için veritabanı güncellemesi bekleniyor; güncelleme uygulanınca bu bölüm otomatik açılır.
    </Alert>
  );
}

/**
 * Giderler sayfası "bütçe ve verimlilik" bölümü: kategori bütçesi (gerçekleşen ↔ bütçe), tekrarlayan giderler / abonelikler
 * ve portal getirisi (talep ve anlaşma başına maliyet). Her sayı filtreli bir hedefe gider. Yöntem:
 * `src/lib/finance/*` (saf, testli). Veri yoksa kart yok, uydurma sayı yok.
 */
export async function FinancePanel({
  tenantId,
  userId,
  canEdit,
  categories,
  showEarnings,
}: {
  tenantId: string;
  /** Önbellek anahtarı (ofis + kullanıcı): RLS kapsamı başka kullanıcıya sızmaz. */
  userId: string;
  canEdit: boolean;
  categories: readonly Category[];
  /** Komisyon tutarları ofis geneli kazançtır: yalnız tüm kazancı görenlere. */
  showEarnings: boolean;
}) {
  const supabase = await createClient();
  const nowMs = now();
  const [budget, recurring, portal] = await Promise.all([
    loadBudgetContext(supabase, tenantId, nowMs).catch(() => null),
    loadRecurringSeries(supabase, tenantId, nowMs).catch(() => null),
    // Portal getirisi en ağır okuma (5 tablo, 13 ay): 2 dk önbellek; gider/anlaşma/portföy yazmaları etiketi düşürür.
    cachedTenantAggregate("portal-roi", { tenantId, userId }, () => loadPortalRoi(supabase, tenantId, nowMs), 120).catch(() => null),
  ]);
  const catLabel = (v: string) => categories.find((c) => c.value === v)?.label ?? v;
  const monthLabel = new Intl.DateTimeFormat("tr-TR", { month: "long", year: "numeric", timeZone: "Europe/Istanbul" }).format(new Date(nowMs));

  return (
    <div className="space-y-4">
      {/* ---------------------------------------------------------------- Bütçe */}
      <Card id="butce" className="scroll-mt-24">
        <CardHeader>
          <div>
            <CardTitle className="flex items-center gap-2"><PiggyBank className="h-4 w-4 text-brand-600" aria-hidden /> Aylık gider bütçesi</CardTitle>
            <CardDescription>
              {monthLabel} · kategori bazlı bütçe ↔ gerçekleşen. %{Math.round(BUDGET_WARN_RATIO * 100)} dolunca uyarı, %100&apos;de aşım bildirimi gelir. Örnek veri hariç.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {budget === null ? (
            <Alert tone="warning">Bütçe verisi şu an yüklenemedi; sayfayı yenileyin.</Alert>
          ) : !budget.available ? (
            <PendingNote what="Gider bütçesi" />
          ) : (
            <>
              {budget.rows.length === 0 ? (
                <p className="text-sm text-text-muted">
                  Henüz bütçe tanımlı değil. {canEdit ? "Aşağıdan bir kategoriye aylık bütçe girin" : "Bütçe tanımlamak için giderleri düzenleme yetkisi gerekir"}: harcama bütçenin %80&apos;ine
                  ulaşınca yöneticilere uyarı düşer.
                </p>
              ) : (
                <>
                  {budget.rows.some((r) => r.status === "over") ? (
                    <Alert tone="danger">
                      {budget.rows.filter((r) => r.status === "over").length} kategoride bu ayın bütçesi aşıldı.
                    </Alert>
                  ) : null}
                  <ul className="space-y-3">
                    {budget.rows.map((r) => {
                      const tone = r.status === "over" ? "danger" : r.status === "warn" ? "warning" : "success";
                      const href = `/app/giderler?kategori=${encodeURIComponent(r.category)}&from=${budget.monthStart}&to=${budget.monthEnd}`;
                      return (
                        <li key={r.category} className="rounded-[var(--radius-card)] border border-line p-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <Link href={href} className="focus-ring rounded font-semibold text-text hover:underline">{catLabel(r.category)}</Link>
                            <span className="flex flex-wrap items-center gap-2 text-xs">
                              <span className="numeric text-text-muted">
                                {formatTry(r.spent)} / {formatTry(r.budget)}
                              </span>
                              <Badge variant={r.status === "over" ? "danger" : r.status === "warn" ? "warning" : "success"} size="sm">
                                %{Math.round(r.ratio * 100)}
                              </Badge>
                              {r.deltaPctVsPrev !== null ? (
                                <Link
                                  href={`/app/giderler?kategori=${encodeURIComponent(r.category)}&from=${budget.prevMonthStart}&to=${budget.prevMonthEnd}`}
                                  className="focus-ring rounded text-text-faint hover:underline"
                                  title="Önceki ayın giderleri"
                                >
                                  geçen aya göre {r.deltaPctVsPrev >= 0 ? "+" : ""}%{r.deltaPctVsPrev}
                                </Link>
                              ) : (
                                <span className="text-text-faint">{r.prevSpent > 0 ? "geçen ay: " + formatTry(r.prevSpent) : "geçen ay gider yok"}</span>
                              )}
                              {canEdit ? <BudgetRemoveButton category={r.category} label={catLabel(r.category)} /> : null}
                            </span>
                          </div>
                          <Progress value={r.ratio * 100} tone={tone} label={`${catLabel(r.category)} bütçe kullanımı`} className="mt-2" />
                          <p className="mt-1 text-xs text-text-muted">
                            {r.remaining >= 0 ? `${formatTry(r.remaining)} kaldı` : `${formatTry(Math.abs(r.remaining))} aşıldı`}
                          </p>
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}
              {canEdit ? (
                <div className="border-t border-line pt-4">
                  <BudgetForm categories={categories} budgets={Object.fromEntries(budget.budgets)} />
                </div>
              ) : null}
            </>
          )}
        </CardContent>
      </Card>

      {/* ---------------------------------------------------- Tekrarlayan giderler */}
      <Card id="abonelikler" className="scroll-mt-24">
        <CardHeader>
          <div>
            <CardTitle className="flex items-center gap-2"><CalendarClock className="h-4 w-4 text-brand-600" aria-hidden /> Tekrarlayan giderler ve abonelikler</CardTitle>
            <CardDescription>
              Gider eklerken &quot;tekrar dönemi&quot; seçilenler. Yenileme tarihi son ödemeye dönem eklenerek bulunur; 7 gün kala hatırlatılır.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {recurring === null ? (
            <Alert tone="warning">Tekrarlayan giderler şu an yüklenemedi; sayfayı yenileyin.</Alert>
          ) : !recurring.available ? (
            <PendingNote what="Tekrarlayan gider" />
          ) : recurring.series.length === 0 ? (
            <p className="text-sm text-text-muted">
              Tekrarlayan gider yok. Kira, portal paketi, yazılım aboneliği gibi düzenli giderleri eklerken &quot;Tekrar dönemi&quot; seçerseniz yenileme tarihi burada izlenir.
            </p>
          ) : (
            <>
              <p className="mb-3 text-sm text-text-muted">
                {recurring.series.length} kalem · aylık eşdeğer{" "}
                <strong className="numeric text-text">{formatTry(recurring.series.reduce((s, x) => s + monthlyEquivalent(x.lastAmount, x.recurrence), 0))}</strong>
              </p>
              <TableFrame minWidth={560} stack>
                <Table>
                  <THead>
                    <TR>
                      <TH>Kalem</TH>
                      <TH className="hidden sm:table-cell">Dönem</TH>
                      <TH align="right">Son ödeme</TH>
                      <TH align="right">Sonraki yenileme</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {recurring.series.map((s) => {
                      const info = renewalInfo(s, recurring.todayKey);
                      return (
                        <TR key={s.key}>
                          <TD primary className="font-semibold text-text">
                            <Link
                              href={`/app/giderler?kategori=${encodeURIComponent(s.category)}`}
                              className="focus-ring rounded hover:underline"
                            >
                              {s.title}
                            </Link>
                            <span className="mt-0.5 block text-xs font-normal text-text-faint">{catLabel(s.category)}</span>
                          </TD>
                          <TD label="Dönem" className="hidden sm:table-cell">{RECURRENCE_LABEL[s.recurrence]}</TD>
                          <TD label="Son ödeme" align="right" className="numeric">
                            {formatTry(s.lastAmount)} <span className="text-xs text-text-faint">· {formatDateTr(new Date(`${s.lastDate}T00:00:00Z`))}</span>
                          </TD>
                          <TD label="Sonraki yenileme" align="right">
                            <span className="inline-flex flex-wrap items-center justify-end gap-2">
                              {formatDateTr(new Date(`${s.nextDue}T00:00:00Z`))}
                              {info.state === "due_soon" ? (
                                <Badge variant="warning" size="sm">{info.daysLeft === 0 ? "bugün" : `${info.daysLeft} gün`}</Badge>
                              ) : info.state === "overdue" ? (
                                <Badge variant="danger" size="sm">kayıt girilmedi</Badge>
                              ) : info.state === "inactive" ? (
                                <Badge variant="outline" size="sm">sona erdi?</Badge>
                              ) : null}
                            </span>
                          </TD>
                        </TR>
                      );
                    })}
                  </TBody>
                </Table>
              </TableFrame>
              <p className="mt-2 text-xs text-text-faint">
                Vadesi 14 günden fazla geçmiş ve yeni kaydı girilmemiş kalemler &quot;sona erdi?&quot; olarak işaretlenir; hatırlatma üretilmez.
              </p>
            </>
          )}
        </CardContent>
      </Card>

      {/* ---------------------------------------------------------- Portal getirisi */}
      <Card id="portal-getirisi" className="scroll-mt-24">
        <CardHeader>
          <div>
            <CardTitle className="flex items-center gap-2"><Radio className="h-4 w-4 text-brand-600" aria-hidden /> Portal getirisi</CardTitle>
            <CardDescription>
              Son {ROI_WINDOW_DAYS} gün · portal başına gider payı ↔ o portaldan gelen talep ve kazanılan anlaşma. Portal gösterim sayısı sisteme gelmediğinden gösterim yoktur.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {portal === null ? (
            <Alert tone="warning">Portal getirisi şu an yüklenemedi; sayfayı yenileyin.</Alert>
          ) : !portal.available ? (
            <PendingNote what="Portal getirisi" />
          ) : portal.rows.length === 0 ? (
            <p className="text-sm text-text-muted">
              Hesaplamak için portal giderini eşleyin: Gider eklerken &quot;Portal gideri&quot; alanından portalı seçin (ör. aylık Sahibinden paketi). Talep kaynağı müşteri
              kartındaki &quot;Kaynak&quot; alanından okunur.
            </p>
          ) : (
            <PortalRoiTable portal={portal} showEarnings={showEarnings} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function PortalRoiTable({ portal, showEarnings }: { portal: NonNullable<Awaited<ReturnType<typeof loadPortalRoi>>>; showEarnings: boolean }) {
  const worst = pickLeastEfficientPortal(portal.rows);
  const unused = unusedPortalSubscriptions(portal.rows);
  const leadHref = (key: (typeof portal.rows)[number]["portalKey"]) => `/app/musteriler?source=${leadSourceOf(key)}&from=${portal.windowStart}`;
  return (
    <>
      {worst ? (
        <Alert tone="warning">
          {worst.kind === "no_leads"
            ? `${PORTAL_LABEL[worst.portalKey]}: ${worst.liveListings} ilan yayında ve ${formatTry(worst.cost)} gider payı var ama hiç talep gelmedi. Talep kaynağını doğru girdiğinizden emin olun; doğruysa paketi gözden geçirin.`
            : `${PORTAL_LABEL[worst.portalKey]}: talep başına ${formatTry(worst.costPerLead)}; en verimli portal ${PORTAL_LABEL[worst.benchmarkKey]} (${formatTry(worst.benchmarkCostPerLead)}). Bütçeyi verimli portala kaydırmayı düşünün.`}{" "}
          <Link href={`/app/giderler?portal=${worst.portalKey}#portal-getirisi`} className="font-semibold underline">Giderlerini gör</Link>
        </Alert>
      ) : null}
      {unused.length > 0 ? (
        <Alert tone="info">
          {unused.map((r) => PORTAL_LABEL[r.portalKey]).join(", ")} için gider payı var ama {ROI_WINDOW_DAYS} günde ilan yayınlanmadı ve talep gelmedi: abonelik kullanılmıyor olabilir.
        </Alert>
      ) : null}
      <TableFrame minWidth={640} stack>
        <Table>
          <THead>
            <TR>
              <TH>Portal</TH>
              <TH align="right">Gider payı</TH>
              <TH align="right">Talep</TH>
              <TH align="right">Talep başına</TH>
              <TH align="right">Anlaşma</TH>
              <TH align="right">Anlaşma başına</TH>
              {showEarnings ? <TH align="right">Komisyon</TH> : null}
            </TR>
          </THead>
          <TBody>
            {portal.rows.map((r) => (
              <TR key={r.portalKey}>
                <TD primary className="font-semibold text-text">
                  {r.label}
                  <span className="mt-0.5 block text-xs font-normal text-text-faint">{r.liveListings} ilan yayında</span>
                </TD>
                <TD label="Gider payı" align="right" className="numeric">
                  <Link href={`/app/giderler?portal=${r.portalKey}#portal-getirisi`} className="focus-ring rounded hover:underline">
                    {r.cost > 0 ? formatTry(r.cost) : "—"}
                  </Link>
                </TD>
                <TD label="Talep" align="right" className="numeric">
                  <Link href={leadHref(r.portalKey)} className="focus-ring rounded hover:underline">{r.leads}</Link>
                </TD>
                <TD label="Talep başına" align="right" className="numeric">
                  {r.sufficient ? (r.costPerLead !== null ? formatTry(r.costPerLead) : "talep yok") : <span className="text-text-faint">veri yetersiz</span>}
                </TD>
                <TD label="Anlaşma" align="right" className="numeric">
                  <Link href={`/app/anlasmalar?gorunum=liste&asama=won`} className="focus-ring rounded hover:underline">{r.wonDeals}</Link>
                </TD>
                <TD label="Anlaşma başına" align="right" className="numeric">
                  {r.sufficient ? (r.costPerDeal !== null ? formatTry(r.costPerDeal) : "anlaşma yok") : <span className="text-text-faint">veri yetersiz</span>}
                </TD>
                {showEarnings ? (
                  <TD label="Komisyon" align="right" className="numeric">
                    <Link href={`/app/komisyon?from=${portal.windowStart}`} className="focus-ring rounded hover:underline">
                      {r.commission > 0 ? formatTry(r.commission) : "—"}
                    </Link>
                  </TD>
                ) : null}
              </TR>
            ))}
          </TBody>
        </Table>
      </TableFrame>
      <p className="text-xs leading-relaxed text-text-faint">
        Gider payı: portala eşlenmiş giderlerin son {ROI_WINDOW_DAYS} güne düşen kısmıdır (yıllık/3 aylık ödemeler dönemlerine bölünür). &quot;Veri yetersiz&quot;: maliyet
        geçmişi 45 günden kısa. Talep: kaynağı portal olan yeni müşteri kayıtları; anlaşma: kaynağı portal olan müşterilerin dönemde kazanılan anlaşmaları (komisyon bağlantısı
        tarih filtreli genel komisyon listesidir). Kaynak alanı boş girilen talepler hiçbir portala sayılmaz.
      </p>
    </>
  );
}
