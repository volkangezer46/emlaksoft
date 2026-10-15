import Link from "@/components/ui/smart-link";
import { CalendarClock, Radio } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { now } from "@/lib/clock";
import { formatDateTr, formatTry } from "@/lib/format";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableFrame, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { ConvertSeriesButton } from "../_lazy";
import type { AccountOption } from "../quick-entry";
import { cachedTenantAggregate } from "@/lib/cache/tenant-aggregate";
import { getDefinitionsOrDefault } from "@/lib/definitions";
import { loadAccountsWithBalances } from "@/lib/finance/cash/load";
import { loadPortalRoi, loadRecurringSeries } from "@/lib/finance/load";
import { RECURRENCE_LABEL, monthlyEquivalent, renewalInfo } from "@/lib/finance/recurring-expenses";
import { PORTAL_MEMBERSHIP_HREF } from "@/lib/portals/catalog";
import { PORTAL_LABEL, ROI_WINDOW_DAYS, leadSourceOf, pickLeastEfficientPortal, unusedPortalSubscriptions } from "@/lib/finance/portal-roi";

/**
 * Bütçe sekmesinin alt kartları: tekrarlayan giderler / abonelikler (`#abonelikler`) ve portal getirisi (`#portal-getirisi`).
 * Her sayı filtreli bir hedefe gider. Yöntem `src/lib/finance/*` (saf, testli). Veri yoksa kart yok, uydurma sayı yok.
 */

/** Veritabanı güncellemesi (20261008000700) beklenirken gösterilen sakin not. */
function PendingNote({ what }: { what: string }) {
  return (
    <Alert tone="info">
      {what} için veritabanı güncellemesi bekleniyor; güncelleme uygulanınca bu bölüm otomatik açılır.
    </Alert>
  );
}

type RecurringData = Awaited<ReturnType<typeof loadRecurringSeries>> | null;
type PortalData = Awaited<ReturnType<typeof loadPortalRoi>> | null;

/**
 * Muhasebe v2 Bütçe sekmesi: "Tekrarlayan giderler ve abonelikler" kartı (kendi verisini çeker). `canConvert` ise yazılabilir
 * ofis hesapları da okunur ve "Kurala çevir" düğmesi görünür.
 */
export async function RecurringSeriesCard({ tenantId, canConvert }: { tenantId: string; canConvert: boolean }) {
  const supabase = await createClient();
  const [recurring, defs, cash] = await Promise.all([
    loadRecurringSeries(supabase, tenantId, now()).catch(() => null),
    getDefinitionsOrDefault("expense_category"),
    canConvert ? loadAccountsWithBalances(supabase) : Promise.resolve({ available: false, accounts: [] }),
  ]);
  const convertAccounts: AccountOption[] = cash.accounts
    .filter((a) => !a.archived_at && a.owner_scope === "office")
    .map((a) => ({ id: a.id, name: a.name, kind: a.kind, currency: a.currency, scope: a.owner_scope }));
  const catLabel = (v: string) => defs.find((d) => d.value === v)?.label ?? v;
  return <RecurringSeriesView recurring={recurring} catLabel={catLabel} convertAccounts={convertAccounts} />;
}

/** Muhasebe v2 Bütçe sekmesi: "Portal getirisi" kartı (2 dk ofis önbelleği; anahtar ofis + kullanıcı). */
export async function PortalRoiCard({ tenantId, userId, showEarnings }: { tenantId: string; userId: string; showEarnings: boolean }) {
  const supabase = await createClient();
  const portal = await cachedTenantAggregate("portal-roi", { tenantId, userId }, () => loadPortalRoi(supabase, tenantId, now()), 120).catch(() => null);
  return <PortalRoiView portal={portal} showEarnings={showEarnings} />;
}

function RecurringSeriesView({ recurring, catLabel, convertAccounts }: { recurring: RecurringData; catLabel: (v: string) => string; convertAccounts: readonly AccountOption[] }) {
  return (
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
                    {convertAccounts.length > 0 ? <TH align="right"><span className="sr-only">Düzenli ödemeye çevir</span></TH> : null}
                  </TR>
                </THead>
                <TBody>
                  {recurring.series.map((s) => {
                    const info = renewalInfo(s, recurring.todayKey);
                    return (
                      <TR key={s.key}>
                        <TD primary className="font-semibold text-text">
                          <Link
                            href={`/app/giderler?sekme=hareketler&tur=gider&kategori=${encodeURIComponent(s.category)}`}
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
                        {convertAccounts.length > 0 ? (
                          <TD align="right">
                            <ConvertSeriesButton expenseId={s.lastId} title={s.title} officeAccounts={convertAccounts} />
                          </TD>
                        ) : null}
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
  );
}

function PortalRoiView({ portal, showEarnings }: { portal: PortalData; showEarnings: boolean }) {
  return (
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
          <Link href="/app/giderler?sekme=hareketler&tur=gider&kategori=portal" className="font-semibold underline">Giderlerini gör</Link>
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
              // Üye olunmayan portal yalnız geçmiş verisi için görünür ve soluk durur; üye olunan ama verisi olmayan portal da listelenir.
              <TR key={r.portalKey} className={r.member === false ? "opacity-60" : undefined}>
                <TD primary className="font-semibold text-text">
                  {r.label}
                  <span className="mt-0.5 block text-xs font-normal text-text-faint">
                    {r.member === true && r.cost === 0 && r.leads === 0 && r.wonDeals === 0 && r.liveListings === 0
                      ? "henüz veri yok"
                      : `${r.liveListings} ilan yayında`}
                  </span>
                  {r.member === false ? (
                    <Link href={PORTAL_MEMBERSHIP_HREF} className="focus-ring mt-0.5 inline-block rounded text-xs font-semibold text-accent-text hover:underline">
                      Üye değilsiniz, ekle
                    </Link>
                  ) : null}
                </TD>
                <TD label="Gider payı" align="right" className="numeric">
                  <Link href="/app/giderler?sekme=hareketler&tur=gider&kategori=portal" className="focus-ring rounded hover:underline">
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
