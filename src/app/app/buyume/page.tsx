import Link from "next/link";
import { HeartHandshake, MousePointerClick, UserPlus, Wallet } from "lucide-react";
import { requireModulePage } from "@/lib/require-module-page";
import { effectiveHasPermission } from "@/lib/permissions-effective";
import { getBaseUrl } from "@/lib/base-url";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { StatCard } from "@/components/app/stat-card";
import { buildReferralUrl } from "@/lib/growth/attribution";
import { getReferralOverview } from "@/lib/growth/store";
import { formatDateTr } from "@/lib/format";
import { InvitePanel } from "./invite-panel";

export const metadata = { title: "Arkadaşını getir" };

type Durum = "tumu" | "kayit" | "odeyen";
const FILTERS: { key: Durum; label: string }[] = [
  { key: "tumu", label: "Tümü" },
  { key: "kayit", label: "Deneme sürecinde" },
  { key: "odeyen", label: "Ödeyen" },
];

export default async function BuyumePage({ searchParams }: { searchParams: Promise<{ durum?: string }> }) {
  const { tenantId, perms } = await requireModulePage("settings", "/app/buyume");
  const sp = await searchParams;
  const durum: Durum = sp.durum === "kayit" || sp.durum === "odeyen" ? sp.durum : "tumu";

  if (!tenantId) return null;
  const ov = await getReferralOverview(tenantId);
  const url = ov.code ? buildReferralUrl(getBaseUrl(), ov.code) : null;
  const canEdit = effectiveHasPermission(perms, "settings", "edit");

  const payers = ov.invites.filter((i) => i.paying).length;
  const shown = ov.invites.filter((i) => (durum === "odeyen" ? i.paying : durum === "kayit" ? !i.paying : true));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Arkadaşını getir"
        description="Bir meslektaşınız EmlakSoft'u denemek isterse size özel bağlantıyı paylaşın. Yalnız bağlantıyla gelen kayıtlar sayılır."
        icon={<HeartHandshake className="h-6 w-6 text-brand-600" aria-hidden />}
      />

      {!ov.available || !ov.enabled ? (
        <Alert tone="info" title="Davet programı şu an etkin değil">
          Program henüz yayına alınmadı. Açıldığında davet bağlantınızı buradan oluşturup paylaşabilirsiniz.
        </Alert>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard label="Bağlantı tıklaması" value={ov.clicks} icon={MousePointerClick} href="#davet-baglantisi" />
            <StatCard label="Kayıt olan" value={ov.invites.length} icon={UserPlus} href="/app/buyume?durum=tumu#davetler" />
            <StatCard label="Ödeyen" value={payers} icon={Wallet} tone="mint" href="/app/buyume?durum=odeyen#davetler" />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Davet bağlantınız</CardTitle>
              <CardDescription>Kod rastgeledir; ofis adınızı veya kişisel bilginizi içermez.</CardDescription>
            </CardHeader>
            <CardContent>
              <InvitePanel url={url} canCreate={canEdit} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Ödül</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-text-muted">
              {ov.rewardText ? (
                <p>
                  Yöneticinin tanımladığı kurala göre: {ov.rewardText}. Koşullar ve süreler kural metnindeki gibidir; ödeme alınmadan ödül oluşmaz.
                </p>
              ) : (
                <p>Şu an tanımlı bir ödül kuralı yok; bu sayfa yalnız davetlerinizi takip eder ve ödül vaat etmez.</p>
              )}
            </CardContent>
          </Card>

          <Card id="davetler">
            <CardHeader>
              <CardTitle>Davetleriniz</CardTitle>
              <CardDescription>Gizlilik gereği davet ettiğiniz ofislerin adı gösterilmez.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <nav aria-label="Davet filtresi" className="flex flex-wrap gap-2">
                {FILTERS.map((f) => (
                  <Link
                    key={f.key}
                    href={f.key === "tumu" ? "/app/buyume#davetler" : `/app/buyume?durum=${f.key}#davetler`}
                    aria-current={durum === f.key ? "page" : undefined}
                    className={`focus-ring rounded-full border px-3 py-1 text-xs font-semibold transition ${
                      durum === f.key ? "border-brand-600 bg-brand-600/10 text-brand-700" : "border-hairline bg-surface text-text-muted hover:bg-canvas"
                    }`}
                  >
                    {f.label}
                  </Link>
                ))}
              </nav>
              {shown.length === 0 ? (
                <p className="text-sm text-text-muted">
                  {ov.invites.length === 0 ? "Henüz bağlantınızla kayıt olan ofis yok." : "Bu filtreye uyan davet yok."}
                </p>
              ) : (
                <ul className="divide-y divide-line">
                  {shown.map((i, idx) => (
                    <li key={i.tenantId} className="flex items-center justify-between gap-3 py-2 text-sm">
                      <span className="text-ink-950">{shown.length - idx}. davet</span>
                      <span className="flex items-center gap-3">
                        <span className="text-xs text-text-muted">{formatDateTr(i.at)}</span>
                        <Badge variant={i.paying ? "success" : "neutral"}>{i.paying ? "Ödeyen" : "Deneme sürecinde"}</Badge>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
