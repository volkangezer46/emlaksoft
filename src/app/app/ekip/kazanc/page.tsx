import Link from "next/link";
import { EyeOff, HandCoins, Info, Wallet } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { now } from "@/lib/clock";
import { PageHeader } from "@/components/ui/page-header";
import { StatRow } from "@/components/ui/stat-row";
import { Table, TableFrame, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { EmptyState } from "@/components/app/empty-state";
import { ListLimitNotice } from "@/components/app/list-limit-notice";
import { canSeeAllEarnings } from "@/lib/team/earnings-scope";
import { summarizeAdvisorEarning, type ShareRow } from "@/lib/team/advisor-share";
import { trMonthContext } from "@/lib/team/scorecard";

const ROW_LIMIT = 2000;
const SCORED_ROLES = ["owner", "gm", "branch_manager", "team_lead", "advisor"];

function money(n: number) {
  return new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 }).format(n);
}

const LINK = "focus-ring rounded-[var(--radius-control)] hover:text-brand-600 hover:underline";

export default async function TeamEarningsPage() {
  const { userId, perms } = await requireModulePage("commissions", "/app/ekip");
  const seeAll = canSeeAllEarnings(perms);
  const supabase = await createClient();

  const { monthKey } = trMonthContext(now());
  const yearStartIso = `${monthKey.slice(0, 4)}-01-01T00:00:00+03:00`;
  const year = monthKey.slice(0, 4);

  const [commissionsRes, profilesRes] = await Promise.all([
    supabase
      .from("commissions")
      .select("gross_amount, status, splits, deal:deals!commissions_deal_id_fkey(assigned_to)", { count: "exact" })
      .gte("created_at", yearStartIso)
      .order("created_at", { ascending: false })
      .limit(ROW_LIMIT),
    supabase
      .from("profiles")
      .select("id, full_name, role")
      .eq("is_active", true)
      .in("role", SCORED_ROLES)
      .order("full_name")
      .limit(200),
  ]);

  const failed = Boolean(commissionsRes.error || profilesRes.error);
  const commissions = (commissionsRes.data ?? []) as unknown as ShareRow[];
  const profiles = (profilesRes.data ?? []) as { id: string; full_name: string; role: string }[];

  const mine = summarizeAdvisorEarning(
    commissions,
    profiles.find((p) => p.id === userId)?.full_name ?? null,
    userId,
  );
  const table = seeAll
    ? profiles
        .map((p) => ({ p, e: summarizeAdvisorEarning(commissions, p.full_name, p.id) }))
        .sort((a, b) => b.e.collected + b.e.pending - (a.e.collected + a.e.pending) || a.p.full_name.localeCompare(b.p.full_name, "tr"))
    : [];
  const anyEarning = table.some(({ e }) => e.count > 0);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Ekip Merkezi"
        title="Kazanç"
        description={
          seeAll
            ? `${year} yılı danışman kazançları: tahsil edilmiş ve bekleyen paylar.`
            : `${year} yılı kendi kazancınız. Başkasının kazancını görme izniniz yok; ofis sahibi bu izni Ayarlar > Roller bölümünden verebilir.`
        }
        actions={
          <Link
            href="/app/cuzdan"
            className="focus-ring press inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-text-muted transition hover:border-line-strong hover:text-text"
          >
            <Wallet className="h-3.5 w-3.5" aria-hidden /> Cüzdanım
          </Link>
        }
      />

      {failed ? (
        <EmptyState
          icon={Info}
          tone="danger"
          illustration="error"
          title="Kazanç verisi yüklenemedi"
          description="Komisyon kayıtları şu an okunamadı. Sayfayı yenileyin."
        />
      ) : (
        <>
          <StatRow
            label="Kendi kazancınız"
            items={[
              { label: "Bekleyen payım", value: money(mine.pending), href: "/app/komisyon?durum=bekleyen", hint: "tahsil edilmemiş" },
              { label: "Tahsil edilen payım", value: money(mine.collected), href: "/app/komisyon?durum=tahsil", hint: `${year} yılı` },
              { label: "Paylı kayıt", value: mine.count, href: "/app/cuzdan", hint: "cüzdanda listelenir" },
            ]}
          />

          {seeAll ? (
            <>
              <ListLimitNotice shown={commissions.length} total={commissionsRes.count} hint="Tarih aralığını Komisyon sayfasında daraltın." />
              {profiles.length === 0 || !anyEarning ? (
                <EmptyState
                  icon={HandCoins}
                  illustration="list"
                  title={`${year} yılında paylaşılmış komisyon yok`}
                  description="Anlaşmalar komisyona dönüşüp paylaşım tanımlandığında danışman payları burada toplanır."
                  action={{ href: "/app/komisyon", label: "Komisyon defteri" }}
                />
              ) : (
                <TableFrame minWidth={640}>
                  <Table>
                    <THead>
                      <TR>
                        <TH>Danışman</TH>
                        <TH align="right">Paylı kayıt</TH>
                        <TH align="right">Bekleyen</TH>
                        <TH align="right">Tahsil edilen</TH>
                        <TH align="right">Toplam</TH>
                      </TR>
                    </THead>
                    <TBody>
                      {table.map(({ p, e }) => (
                        <TR key={p.id}>
                          <TD>
                            <Link href={`/app/ekip/${p.id}`} className={`${LINK} font-semibold text-ink-950`}>
                              {p.full_name}
                            </Link>
                          </TD>
                          <TD align="right">
                            <Link href="/app/komisyon" className={LINK}>{e.count}</Link>
                          </TD>
                          <TD align="right">
                            <Link href="/app/komisyon?durum=bekleyen" className={LINK}>{e.pending > 0 ? money(e.pending) : "—"}</Link>
                          </TD>
                          <TD align="right">
                            <Link href="/app/komisyon?durum=tahsil" className={LINK}>{e.collected > 0 ? money(e.collected) : "—"}</Link>
                          </TD>
                          <TD align="right" className="font-bold text-mint-700">
                            {e.pending + e.collected > 0 ? money(e.pending + e.collected) : "—"}
                          </TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                </TableFrame>
              )}
              <p className="text-xs text-text-faint">
                Pay, komisyon paylaşım satırındaki ad etiketine (ya da anlaşmaya atanmış danışmanın &quot;Danışman&quot; payına) göre
                hesaplanır. &quot;Tahsil edilen&quot; müşteriden tahsilattır; danışmana ödeme (hakediş) durumu henüz ayrı tutulmuyor.
              </p>
            </>
          ) : (
            <div className="flex items-start gap-3 rounded-[var(--radius-card)] border border-line bg-canvas px-4 py-4 text-sm text-text-muted">
              <EyeOff className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <p>
                Ekip arkadaşlarınızın kazançları gizlidir. Kendi hakedişinizin ayrıntısı ve bordro çıktısı için{" "}
                <Link href="/app/cuzdan" className="font-semibold text-brand-700 hover:underline">Cüzdanım</Link> sayfasını kullanın.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
