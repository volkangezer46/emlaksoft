import { redirect } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Progress } from "@/components/ui/progress";
import { StatRow } from "@/components/ui/stat-row";
import { requireModulePage } from "@/lib/require-module-page";
import { canManageModules } from "@/lib/modules/permissions";
import { featureLabel, type QuotaView, type UsageBucket } from "@/lib/ai/credits/aggregate";
import { getTenantUsage } from "@/lib/ai/credits/usage";

export const metadata = { title: "AI kullanımı" };

const fmt = (n: number) => n.toLocaleString("tr-TR", { maximumFractionDigits: 2 });
const TONE: Record<QuotaView["state"], "accent" | "success" | "warning" | "danger"> = {
  unlimited: "success",
  ok: "accent",
  warn: "warning",
  over: "danger",
};

function monthLabel(key: string): string {
  const [y, m] = key.split("-");
  const names = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
  return `${names[Number(m) - 1] ?? m} ${y}`;
}

function BucketList({ items, total, label }: { items: { name: string; b: UsageBucket }[]; total: number; label: string }) {
  if (items.length === 0) {
    return <p className="text-sm text-text-muted">Bu ay henüz AI kullanımı yok. Kullanım oldukça burada görünür.</p>;
  }
  return (
    <ul className="space-y-3" aria-label={label}>
      {items.map(({ name, b }) => (
        <li key={b.key}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate font-medium text-ink-950">{name}</span>
            <span className="numeric shrink-0 text-text-muted">
              {fmt(b.credits)} kredi · {b.calls} çağrı
            </span>
          </div>
          <Progress className="mt-1" value={total > 0 ? (b.credits / total) * 100 : 0} label={`${name} payı`} />
        </li>
      ))}
    </ul>
  );
}

/**
 * Ayarlar > AI kullanımı: ofisin bu ayki AI kredisi ve değerleme raporu kullanımı.
 * Yalnız ofis sahibi ve genel müdür. Aşımda hiçbir özellik kapanmaz; uyarı ve ek kredi yönlendirmesi gösterilir.
 */
export default async function AiUsagePage() {
  const { tenantId, role } = await requireModulePage("settings", "/app/ayarlar/ai-kullanim");
  if (!canManageModules(role) || !tenantId) redirect("/app?yetki=yok");

  const u = await getTenantUsage(tenantId);
  const ai = u.ai;
  const featureItems = ai.byFeature.map((b) => ({ name: featureLabel(b.key), b }));
  const userItems = ai.byUser.map((b) => ({ name: b.key === "sistem" ? "Sistem / otomasyon" : (u.userNames[b.key] ?? "Eski kullanıcı"), b }));

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Ofis yapılandırması"
        title="AI kullanımı"
        description={`${monthLabel(u.monthKey)} dönemi (Türkiye saati). Kredi her ayın başında paketinize göre yenilenir.`}
        breadcrumbs={[{ label: "Ana ekran", href: "/app" }, { label: "Ayarlar", href: "/app/ayarlar" }, { label: "AI kullanımı" }]}
      />

      {!u.enabled ? (
        <Alert tone="info" title="Kullanım ölçümü henüz etkin değil">
          AI asistan ve diğer özellikler her zamanki gibi çalışır. Ölçüm etkinleşince kullanımınız burada görünür.
        </Alert>
      ) : null}
      {ai.state === "warn" ? (
        <Alert
          tone="warning"
          title={`Aylık AI kredinizin %${ai.percent} kadarını kullandınız`}
          action={<ButtonLink href="/app/paket" iconRight={ArrowRight}>Paketi incele</ButtonLink>}
        >
          Kalan {fmt(ai.remaining ?? 0)} kredi. Kredi bitse bile özellikler kapanmaz; daha yüksek aylık kredi için paketinizi inceleyin.
        </Alert>
      ) : null}
      {ai.state === "over" ? (
        <Alert
          tone="danger"
          title="Aylık AI krediniz doldu"
          action={<ButtonLink href="/app/paket" iconRight={ArrowRight}>Paketi incele</ButtonLink>}
        >
          Çalışmanız kesilmez; kullanım kayda geçmeye devam eder. Daha yüksek aylık kredi için paket sayfasından yükseltme yapabilirsiniz.
        </Alert>
      ) : null}
      {u.valuation.state === "over" ? (
        <Alert tone="warning" title="Aylık değerleme raporu kotanız doldu">
          Yeni raporlar oluşturulmaya devam eder; kota aşımı bir sonraki dönem paketinizle birlikte değerlendirilir.
        </Alert>
      ) : null}

      <StatRow
        label="AI kredi özeti"
        items={[
          { label: "Kullanılan kredi", value: fmt(ai.used), href: "#ozellik", hint: `${ai.calls} çağrı` },
          {
            label: "Kalan kredi",
            value: ai.remaining === null ? "Sınırsız" : fmt(Math.max(0, ai.remaining)),
            href: "/app/paket",
            hint: ai.quota === null ? "paketinizde sınır yok" : `kota ${fmt(ai.quota)}`,
            attention: ai.state === "warn" || ai.state === "over",
          },
          { label: "Kullanan kişi", value: ai.byUser.length, href: "#kullanici", hint: "bu ay" },
          {
            label: "Değerleme raporu",
            value: u.valuation.quota === null ? `${u.valuation.reports}` : `${u.valuation.reports}/${u.valuation.quota}`,
            href: "/app/degerleme",
            attention: u.valuation.state === "warn" || u.valuation.state === "over",
          },
        ]}
      />

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Aylık kredi durumu</CardTitle>
            <CardDescription>
              {ai.quota === null ? "Paketinizde aylık AI kredi sınırı tanımlı değil; kullanım yine de izlenir." : `Paket kotası: ${fmt(ai.quota)} kredi. Uyarı eşiği %80.`}
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {ai.quota === null ? (
            <p className="text-sm text-text-muted">Sınırsız kullanım. Bu ay {fmt(ai.used)} kredi harcandı.</p>
          ) : (
            <>
              <Progress value={ai.percent ?? 0} label="Aylık AI kredi kullanımı" tone={TONE[ai.state]} />
              <p className="numeric mt-2 text-sm text-text-muted">
                {fmt(ai.used)} / {fmt(ai.quota)} kredi (%{ai.percent})
              </p>
            </>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card id="ozellik">
          <CardHeader>
            <div>
              <CardTitle>Özelliğe göre</CardTitle>
              <CardDescription>Krediyi hangi AI özellikleri harcadı.</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <BucketList items={featureItems} total={ai.used} label="Özellik kırılımı" />
          </CardContent>
        </Card>
        <Card id="kullanici">
          <CardHeader>
            <div>
              <CardTitle>Kullanıcıya göre</CardTitle>
              <CardDescription>Krediyi ekipte kimler kullandı.</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <BucketList items={userItems} total={ai.used} label="Kullanıcı kırılımı" />
          </CardContent>
        </Card>
      </div>

      {u.truncated ? (
        <p className="text-xs text-text-muted">Kayıt sayısı çok yüksek olduğundan özet ilk 20.000 kayıtla sınırlıdır.</p>
      ) : null}
    </div>
  );
}
