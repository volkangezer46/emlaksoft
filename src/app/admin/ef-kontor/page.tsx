import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { StatRow } from "@/components/ui/stat-row";
import { Table, TableEmptyRow, TableFrame, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { ListPager } from "@/components/ui/list-kit/list-pager";
import { pageWindow } from "@/components/ui/list-kit/list-logic";
import { requirePlatformModule } from "@/lib/platform";
import { getEfCatalog, getEfCreditReady, readEfBalance, readEfHistory } from "@/lib/ef-credits/credit-reader";
import { ADMIN_BALANCE_PAGE_SIZE, listTenantEfBalances, readTenantName } from "@/lib/ef-credits/admin-data";
import { filterAndPage } from "@/lib/ef-credits/credit-view";
import { GrantForm, PacksEditor, TariffForm } from "./editors";

export const metadata = { title: "EmlakFiyati kontör" };

const fmt = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 });
const dt = new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Istanbul" });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BASE = "/admin/ef-kontor";

type SP = { q?: string; sayfa?: string; ofis?: string; hsayfa?: string };

export default async function AdminEfKontorPage({ searchParams }: { searchParams: Promise<SP> }) {
  const staff = await requirePlatformModule("billing");
  const canWrite = staff.role === "super_admin";
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const page = Math.max(1, Number.parseInt(sp.sayfa ?? "", 10) || 1);
  const officeId = sp.ofis && UUID.test(sp.ofis) ? sp.ofis : null;

  const [ready, catalog] = await Promise.all([getEfCreditReady(), getEfCatalog()]);
  const list = ready ? await listTenantEfBalances({ q, page }) : null;

  let detail: Awaited<ReturnType<typeof loadDetail>> | null = null;
  if (officeId && ready) detail = await loadDetail(officeId, Math.max(1, Number.parseInt(sp.hsayfa ?? "", 10) || 1));

  const activeCount = catalog.packs.filter((p) => p.active).length;
  const totals = (list?.rows ?? []).reduce(
    (a, r) => ({ available: a.available + (r.balance?.available ?? 0), reserved: a.reserved + (r.balance?.reserved ?? 0) }),
    { available: 0, reserved: 0 },
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Faturalama"
        title="EmlakFiyati kontör"
        description="Tarife, paket kataloğu, ofis bakiyeleri ve manuel yükleme tek merkezde. Kontör YALNIZ Emlaksoft'ta tutulur."
        breadcrumbs={[{ label: "Yönetim", href: "/admin" }, { label: "Abonelik & fatura", href: "/admin/billing" }, { label: "EmlakFiyati kontör" }]}
      />

      {!ready ? (
        <Alert tone="info" title="Kontör bakiyesi henüz etkin değil">
          Cüzdan SQL&apos;i (ef_credit_ready) hazır olana kadar bakiye, yükleme ve ofis satışı kapalıdır. Tarife ve paket kataloğunu şimdiden
          hazırlayabilirsiniz.
        </Alert>
      ) : null}
      {!canWrite ? <Alert tone="info" title="Salt okunur">Bu bölümü yalnız süper admin değiştirebilir; operasyon rolü okur.</Alert> : null}

      <StatRow
        label="Kontör özeti"
        items={[
          { label: "Satıştaki paket", value: activeCount, href: "#paketler", hint: `${catalog.packs.length} tanımlı` },
          { label: "Listelenen ofis", value: list?.total ?? 0, href: "#bakiyeler" },
          { label: "Kullanılabilir (sayfa)", value: fmt.format(totals.available), href: "#bakiyeler" },
          { label: "Rezerve (sayfa)", value: fmt.format(totals.reserved), href: "#bakiyeler" },
        ]}
      />

      <Card id="tarife">
        <CardHeader>
          <CardTitle>Tarife</CardTitle>
          <CardDescription>Hangi işlem kaç kontör. Kayıt sonrası yeni işlemlere uygulanır.</CardDescription>
        </CardHeader>
        <CardContent>
          <TariffForm tariff={catalog.tariff} canWrite={canWrite} />
        </CardContent>
      </Card>

      <Card id="paketler">
        <CardHeader>
          <CardTitle>Paket kataloğu</CardTitle>
          <CardDescription>Varsayılan katalog boştur: fiyatlar sahibin kararıdır. Net fiyatlar KDV hariçtir (faturada %20 KDV eklenir).</CardDescription>
        </CardHeader>
        <CardContent>
          <PacksEditor initial={catalog.packs} tariff={catalog.tariff} canWrite={canWrite} />
        </CardContent>
      </Card>

      <Card id="bakiyeler">
        <CardHeader>
          <CardTitle>Ofis bakiyeleri</CardTitle>
          <CardDescription>Kontör hareketi olan ofisler; ofis adı araması tüm ofisleri bulur. Satıra tıklayınca hareketler ve yükleme açılır.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <form action={BASE} method="get" className="flex flex-wrap gap-2">
            <input
              name="q"
              defaultValue={q}
              placeholder="Ofis adı ara"
              aria-label="Ofis adı ara"
              className="min-h-9 w-full max-w-xs rounded-[var(--radius-control)] border border-line bg-surface px-2.5 py-1.5 text-sm"
            />
            <button type="submit" className="focus-ring min-h-9 rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-1.5 text-sm font-semibold">Ara</button>
            {q ? <Link href={`${BASE}#bakiyeler`} className="focus-ring inline-flex min-h-9 items-center px-2 text-sm font-semibold text-brand-600">Temizle</Link> : null}
          </form>
          {!list ? (
            <p className="rounded-[var(--radius-card)] border border-dashed border-line-strong px-4 py-6 text-center text-sm text-text-muted">
              Cüzdan etkin değil: ofis bakiyeleri yok.
            </p>
          ) : !list.enabled ? (
            <p className="rounded-[var(--radius-card)] border border-dashed border-line-strong px-4 py-6 text-center text-sm text-text-muted">Liste okunamadı; tekrar deneyin.</p>
          ) : (
            <>
              <TableFrame minWidth={620}>
                <Table>
                  <THead>
                    <TR>
                      <TH>Ofis</TH>
                      <TH align="right">Bakiye</TH>
                      <TH align="right">Rezerve</TH>
                      <TH align="right">Toplam yüklenen</TH>
                      <TH align="right">Toplam harcanan</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {list.rows.length === 0 ? (
                      <TableEmptyRow colSpan={5}>{q ? "Aramaya uyan ofis yok." : "Henüz kontör hareketi olan ofis yok. Ofis adıyla arayıp manuel yükleme yapabilirsiniz."}</TableEmptyRow>
                    ) : (
                      list.rows.map((r) => (
                        <TR key={r.tenantId}>
                          <TD className="font-semibold text-ink-950">
                            <Link href={`${BASE}?ofis=${r.tenantId}${q ? `&q=${encodeURIComponent(q)}` : ""}#ofis`} className="hover:text-brand-600 hover:underline">
                              {r.name}
                            </Link>
                          </TD>
                          <TD align="right" className="numeric font-bold">{r.balance ? fmt.format(r.balance.available) : "—"}</TD>
                          <TD align="right" className="numeric text-text-muted">{r.balance ? fmt.format(r.balance.reserved) : "—"}</TD>
                          <TD align="right" className="numeric text-text-muted">{r.balance ? fmt.format(r.balance.granted_total) : "—"}</TD>
                          <TD align="right" className="numeric text-text-muted">{r.balance ? fmt.format(r.balance.committed_total) : "—"}</TD>
                        </TR>
                      ))
                    )}
                  </TBody>
                </Table>
              </TableFrame>
              <ListPager
                pathname={BASE}
                params={{ q: q || undefined }}
                window={pageWindow(page, list.total, ADMIN_BALANCE_PAGE_SIZE, list.rows.length)}
                total={list.total}
              />
            </>
          )}
        </CardContent>
      </Card>

      {officeId ? (
        <Card id="ofis">
          <CardHeader>
            <CardTitle>{detail?.name ?? "Ofis"}: kontör hareketleri</CardTitle>
            <CardDescription>
              <Link href={`/admin/tenants/${officeId}`} className="font-semibold text-brand-600 hover:underline">Ofis kartını aç</Link>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!ready ? (
              <p className="text-sm text-text-muted">Cüzdan etkin değil.</p>
            ) : detail ? (
              <>
                <p className="numeric text-sm text-ink-950">
                  Bakiye <strong>{detail.balance ? fmt.format(detail.balance.available) : "—"}</strong> · rezerve {detail.balance ? fmt.format(detail.balance.reserved) : "—"}
                </p>
                <GrantForm tenantId={officeId} tenantName={detail.name ?? "Ofis"} disabledReason={canWrite ? null : "Yalnız süper admin kontör yükleyebilir."} />
                <TableFrame minWidth={560}>
                  <Table>
                    <THead>
                      <TR>
                        <TH>Tarih</TH>
                        <TH>Kalem</TH>
                        <TH>Kullanıcı</TH>
                        <TH align="right">Kontör</TH>
                      </TR>
                    </THead>
                    <TBody>
                      {detail.page.rows.length === 0 ? (
                        <TableEmptyRow colSpan={4}>Bu ofiste kontör hareketi yok.</TableEmptyRow>
                      ) : (
                        detail.page.rows.map((r) => (
                          <TR key={r.id}>
                            <TD className="text-text-muted">{r.at && Number.isFinite(Date.parse(r.at)) ? dt.format(Date.parse(r.at)) : "—"}</TD>
                            <TD className="font-semibold text-ink-950">{r.label}</TD>
                            <TD className="text-text-muted">{r.userId ? (detail.userNames[r.userId] ?? "Kullanıcı") : "Sistem"}</TD>
                            <TD align="right" className={`numeric font-bold ${r.units < 0 ? "text-ink-950" : "text-mint-700"}`}>
                              {r.units > 0 ? "+" : ""}
                              {fmt.format(r.units)}
                            </TD>
                          </TR>
                        ))
                      )}
                    </TBody>
                  </Table>
                </TableFrame>
                <p className="flex flex-wrap items-center gap-3 text-xs text-text-muted">
                  <span className="numeric">Sayfa {detail.page.page} / {detail.page.pages} · {fmt.format(detail.page.total)} hareket</span>
                  {detail.page.page > 1 ? <Link className="font-semibold text-brand-600 hover:underline" href={hrefDetail(officeId, q, detail.page.page - 1)}>Önceki</Link> : null}
                  {detail.page.page < detail.page.pages ? <Link className="font-semibold text-brand-600 hover:underline" href={hrefDetail(officeId, q, detail.page.page + 1)}>Sonraki</Link> : null}
                </p>
              </>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function hrefDetail(officeId: string, q: string, hpage: number): string {
  const sp = new URLSearchParams({ ofis: officeId });
  if (q) sp.set("q", q);
  if (hpage > 1) sp.set("hsayfa", String(hpage));
  return `${BASE}?${sp.toString()}#ofis`;
}

async function loadDetail(tenantId: string, hpage: number) {
  const [name, balance, history] = await Promise.all([readTenantName(tenantId), readEfBalance(tenantId), readEfHistory(tenantId)]);
  return { name, balance, userNames: history.userNames, page: filterAndPage(history.rows, { page: hpage }) };
}
