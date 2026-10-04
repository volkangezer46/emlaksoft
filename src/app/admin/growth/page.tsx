import Link from "next/link";
import { Handshake, Megaphone, Sprout, Users, Wallet } from "lucide-react";
import { requirePlatformModule } from "@/lib/platform";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { AdminStatCard, AdminStatGrid } from "@/components/admin/admin-stat-card";
import { AdminEmpty, AdminFilterChip, AdminPanel, AdminScrollArea } from "@/components/admin/admin-table";
import { describeRewardRule } from "@/lib/growth/settings";
import { getAdminGrowthOverview } from "@/lib/growth/store";
import { formatDateTr } from "@/lib/format";
import { FlagsForm, PartnerForm, PartnerStatus, RuleForm, RuleToggle } from "./growth-forms";

export const metadata = { title: "Büyüme" };

const SOURCE_LABEL: Record<string, string> = {
  referral: "Ofis daveti",
  partner: "Ortak",
  powered_by: "Vitrin imzası",
  none: "Yalnız kaynak etiketi",
};
const PARTNER_TYPE_LABEL: Record<string, string> = {
  trainer: "Eğitmen",
  agency: "Ajans",
  accountant: "Mali müşavir",
  creator: "İçerik üreticisi",
  institution: "Kurum",
  other: "Diğer",
};
const SHOW_LIMIT = 100;

function hrefFor(p: { kaynak?: string; ortak?: string }) {
  const q = new URLSearchParams();
  if (p.kaynak) q.set("kaynak", p.kaynak);
  if (p.ortak) q.set("ortak", p.ortak);
  const s = q.toString();
  return s ? `/admin/growth?${s}#kayitlar` : "/admin/growth#kayitlar";
}

export default async function AdminGrowthPage({
  searchParams,
}: {
  searchParams: Promise<{ kaynak?: string; ortak?: string }>;
}) {
  const staff = await requirePlatformModule("sales");
  const sp = await searchParams;
  const kaynak = sp.kaynak && (sp.kaynak in SOURCE_LABEL || sp.kaynak === "odeyen") ? sp.kaynak : "";
  const ortak = /^[0-9a-f-]{36}$/i.test(sp.ortak ?? "") ? (sp.ortak as string) : "";
  const isSuper = staff.role === "super_admin";

  const ov = await getAdminGrowthOverview();

  let rows = ov.rows;
  if (kaynak === "odeyen") rows = rows.filter((r) => r.paying);
  else if (kaynak) rows = rows.filter((r) => r.refKind === kaynak);
  if (ortak) rows = rows.filter((r) => r.partnerId === ortak);
  const shown = rows.slice(0, SHOW_LIMIT);

  return (
    <div className="space-y-6">
      <AdminPageHeader
        eyebrow="EmlakSoft · Organik büyüme"
        icon={Sprout}
        title="Büyüme"
        description="Kayıt kaynakları, ofis davetleri ve ortak bağlantılarının izlenmesi. Ödül kuralları yalnız burada tanımlanır; kodda sabit tutar yoktur."
        glow="mint"
      >
        <AdminStatGrid className="mt-5">
          <AdminStatCard label="Atıflı kayıt" value={ov.available ? ov.counts.total : null} href="/admin/growth#kayitlar" icon={Users} tone="dark" emptyHint="Tablolar etkin değil" />
          <AdminStatCard label="Ofis daveti" value={ov.available ? ov.counts.referral : null} href={hrefFor({ kaynak: "referral" })} icon={Megaphone} tone="dark" emptyHint="Tablolar etkin değil" />
          <AdminStatCard label="Ortak" value={ov.available ? ov.counts.partner : null} href={hrefFor({ kaynak: "partner" })} icon={Handshake} tone="dark" emptyHint="Tablolar etkin değil" />
          <AdminStatCard label="Ödeyen" value={ov.available ? ov.counts.payers : null} href={hrefFor({ kaynak: "odeyen" })} icon={Wallet} tone="dark" emptyHint="Tablolar etkin değil" />
        </AdminStatGrid>
      </AdminPageHeader>

      {!ov.available ? (
        <div role="status" className="rounded-[var(--radius-card)] border border-line bg-surface px-4 py-3 text-sm text-text-muted">
          Büyüme tabloları henüz etkin değil: taslak migration (<code>supabase/proposed/</code>) uygulanana kadar kayıt atfı yazılmaz ve
          sayılar gösterilmez. Uygulama normal çalışır.
        </div>
      ) : null}

      <AdminPanel title="Program anahtarları" description="Varsayılan kapalıdır; yalnız süper admin değiştirir.">
        <div className="p-5">
          {isSuper ? (
            <FlagsForm referral={ov.flags.referralEnabled} partner={ov.flags.partnerEnabled} />
          ) : (
            <p className="text-sm text-text-muted">
              Ofis daveti: {ov.flags.referralEnabled ? "açık" : "kapalı"} · Ortak bağlantıları: {ov.flags.partnerEnabled ? "açık" : "kapalı"}. Değiştirmek için süper admin gerekir.
            </p>
          )}
        </div>
      </AdminPanel>

      <AdminPanel
        title="Ödül kuralları"
        description="Ofislere yalnız aktif kuralın metni gösterilir. Kural yoksa ödül vaadi gösterilmez."
        bodyClassName="p-5 space-y-4"
      >
        {ov.rules.length === 0 ? (
          <p className="text-sm text-text-muted">Tanımlı kural yok.</p>
        ) : (
          <ul className="divide-y divide-line">
            {ov.rules.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span>
                  <strong className="text-ink-950">{r.name}</strong>{" "}
                  <span className="text-text-muted">
                    ({r.kind === "referral" ? "ofis daveti" : "ortak"}) · {describeRewardRule(r) ?? "değer yok"}
                    {r.monthly_cap_try != null ? ` · aylık tavan ${r.monthly_cap_try} TL` : ""}
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-text-muted">{r.is_active ? "Aktif" : "Kapalı"}</span>
                  {isSuper ? <RuleToggle id={r.id} active={r.is_active} /> : null}
                </span>
              </li>
            ))}
          </ul>
        )}
        {isSuper ? <RuleForm /> : null}
      </AdminPanel>

      <AdminPanel title="Ortaklar" description="Eğitmen, ajans, mali müşavir, içerik üreticisi, kurum. Bağlantı: /p/<kod>." bodyClassName="p-5 space-y-4">
        {ov.partners.length === 0 ? (
          <p className="text-sm text-text-muted">Henüz ortak tanımlı değil.</p>
        ) : (
          <AdminScrollArea minWidth={640}>
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-text-muted">
                <tr>
                  <th className="py-2 pr-3">Ortak</th>
                  <th className="py-2 pr-3">Tür</th>
                  <th className="py-2 pr-3">Kod</th>
                  <th className="py-2 pr-3">Kayıt</th>
                  <th className="py-2 pr-3">Ödeyen</th>
                  <th className="py-2">Durum</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {ov.partners.map((p) => (
                  <tr key={p.id}>
                    <td className="py-2 pr-3 font-semibold text-ink-950">{p.name}</td>
                    <td className="py-2 pr-3 text-text-muted">{PARTNER_TYPE_LABEL[p.type] ?? p.type}</td>
                    <td className="py-2 pr-3 font-mono text-xs">{p.code}</td>
                    <td className="py-2 pr-3">
                      <Link className="font-semibold text-brand-600 hover:underline" href={hrefFor({ ortak: p.id })}>
                        {p.signups}
                      </Link>
                    </td>
                    <td className="py-2 pr-3">{p.payers}</td>
                    <td className="py-2">{isSuper ? <PartnerStatus id={p.id} status={p.status} /> : p.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </AdminScrollArea>
        )}
        {isSuper ? <PartnerForm /> : null}
      </AdminPanel>

      <section id="kayitlar">
        <AdminPanel
          title="Kayıt kaynakları"
          description={ov.capped ? "Son 1000 atıflı kayıt üzerinden." : "Atıflı kayıtlar (ilk dokunuş)."}
          actions={
            kaynak || ortak ? (
              <AdminFilterChip href="/admin/growth#kayitlar">Filtreyi kaldır</AdminFilterChip>
            ) : undefined
          }
        >
          {shown.length === 0 ? (
            <AdminEmpty
              icon={Sprout}
              title={ov.available ? "Kayıt yok" : "Veri henüz yok"}
              description={
                ov.available
                  ? "Bu süzgece uyan atıflı kayıt bulunmuyor. Atıf, kayıt formuna gelen davet/ortak/UTM bilgisinden oluşur."
                  : "Taslak tablolar uygulanınca kayıt kaynakları burada listelenir."
              }
            />
          ) : (
            <AdminScrollArea minWidth={640}>
              <table className="w-full text-left text-sm">
                <thead className="text-xs text-text-muted">
                  <tr>
                    <th className="px-5 py-2">Ofis</th>
                    <th className="py-2 pr-3">Kaynak</th>
                    <th className="py-2 pr-3">UTM</th>
                    <th className="py-2 pr-3">Tarih</th>
                    <th className="py-2 pr-5">Durum</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {shown.map((r) => (
                    <tr key={r.tenantId}>
                      <td className="px-5 py-2">
                        <Link className="font-semibold text-brand-600 hover:underline" href={`/admin/tenants/${r.tenantId}`}>
                          {r.tenantName}
                        </Link>
                      </td>
                      <td className="py-2 pr-3 text-text-muted">
                        {SOURCE_LABEL[r.refKind] ?? r.refKind}
                        {r.partnerName ? ` · ${r.partnerName}` : ""}
                      </td>
                      <td className="py-2 pr-3 text-text-muted">{[r.utmSource, r.utmCampaign].filter(Boolean).join(" / ") || "-"}</td>
                      <td className="py-2 pr-3 text-text-muted">{formatDateTr(r.at)}</td>
                      <td className="py-2 pr-5">{r.paying ? "Ödeyen" : "Deneme/diğer"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </AdminScrollArea>
          )}
        </AdminPanel>
      </section>
    </div>
  );
}
