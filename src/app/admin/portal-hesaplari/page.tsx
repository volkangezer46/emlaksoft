import { AlertTriangle, CalendarClock, Link2, ListChecks, SearchCheck } from "lucide-react";
import Link from "@/components/ui/smart-link";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusPill } from "@/components/ui/list-kit/status-pill";
import { requirePlatformModule } from "@/lib/platform";
import { formatDateTr } from "@/lib/format";
import { relativeTimeTR } from "@/lib/admin-format";
import { LISTING_STATES, LISTING_STATE_LABEL, LISTING_STATE_TONE, PORTAL_ISSUE_LABEL, PORTAL_ISSUE_TONE, PORTAL_LABEL } from "@/lib/admin/ops/portal-accounts";
import { loadPortalAccounts } from "@/lib/admin/ops/read";
import { OpsCard, OpsGrid, OpsKpis, OpsList, OpsRow, num } from "../_components/ops-kit";
import "@/app/app/_home/kurumsal/home.css";

export const metadata = { title: "Portal hesapları" };

/**
 * PORTAL HESAPLARI VE İLAN DOĞRULAMA (sahibinden.com · Hepsiemlak · Emlakjet). Kaynaklar: `tenant_portal_accounts`
 * (ofisin portal hesabı, paket bitişi, tarayıcı eklentisinin son başarılı/başarısız girişi, ardışık hata) ve
 * `portal_listing_health` (ilan portalda hâlâ yayında mı). Sorunlu hesaplar (giriş hatası, biten/bitecek paket,
 * kapalı kontrol, hiç doğrulanmamış), portal bazında özet ve kalkmış/şüpheli ilanı en çok olan ofisler. Satırlar Ofis
 * 360'a gider; portal kuralları ve eklenti sürümü Entegrasyonlar'dadır. Portal parolası bu ekrana hiç gelmez.
 */
export default async function PortalAccountsPage() {
  await requirePlatformModule("sistem");
  const d = await loadPortalAccounts();
  const o = d.overview;
  const loginFails = o.portals.reduce((s, p) => s + p.issues.giris_hatasi, 0);
  const planIssues = o.portals.reduce((s, p) => s + p.issues.paket_bitti + p.issues.paket_bitiyor, 0);
  const missing = (d.listingStates.probable_missing ?? 0) + (d.listingStates.confirmed_missing ?? 0);
  const checked = LISTING_STATES.reduce((s, k) => s + (d.listingStates[k] ?? 0), 0);

  return (
    <div className="space-y-6">
      <AdminPageHeader
        art="globe"
        icon={Link2}
        eyebrow="AI & entegrasyon"
        title="Portal hesapları"
        description="Ofislerin ilan portalı hesapları ve ilan doğrulama durumu: giriş hatası, biten paket ve portaldan kalkmış ilanlar tek listede."
        actions={
          <Link href="/admin/sistem?sekme=entegrasyonlar" className="kh-seeall is-pill focus-ring">
            Portal kuralları
          </Link>
        }
      />

      {!d.ready ? (
        <EmptyState variant="panel" icon={Link2} title="Portal hesap tablosu okunamadı" description="tenant_portal_accounts tablosu bu ortamda yok; veritabanı güncellemesi uygulanınca dolar." />
      ) : (
        <>
          <OpsKpis
            label="Portal göstergeleri"
            items={[
              { key: "acc", title: "Bağlı hesap", value: num(o.accounts), href: "#portallar", icon: Link2, tone: "brand", caption: `${num(o.portals.reduce((s, p) => s + p.offices, 0))} ofis × portal` },
              { key: "login", title: "Giriş hatası", value: num(loginFails), href: "#sorunlar", icon: AlertTriangle, tone: loginFails ? "rose" : "slate", caption: "3+ ardışık başarısız eklenti girişi" },
              { key: "plan", title: "Paket bitişi", value: num(planIssues), href: "#sorunlar", icon: CalendarClock, tone: planIssues ? "amber" : "slate", caption: "Bitti ya da 7 gün içinde" },
              { key: "miss", title: "Kalkmış ilan", value: num(missing), href: "#ilanlar", icon: SearchCheck, tone: missing ? "orange" : "mint", caption: `${num(d.listingStates.suspect)} şüpheli` },
              { key: "chk", title: "Doğrulanan ilan", value: num(d.listingStates.verified), href: "#ilanlar", icon: ListChecks, tone: "mint", caption: `${num(checked)} izlenen ilan` },
            ]}
          />

          <OpsCard id="portallar" icon={Link2} tone="brand" title="Portal bazında" sub="Etkin hesap ve sorun dağılımı">
            <OpsList label="Portallar">
              {o.portals.map((p) => {
                const issues = Object.entries(p.issues).filter(([, n]) => n > 0) as [keyof typeof PORTAL_ISSUE_LABEL, number][];
                return (
                  <OpsRow
                    key={p.portal}
                    primary={PORTAL_LABEL[p.portal]}
                    secondary={issues.length ? issues.map(([k, n]) => `${num(n)} ${PORTAL_ISSUE_LABEL[k].toLocaleLowerCase("tr-TR")}`).join(" · ") : "Sorun yok"}
                    right={<span className="numeric text-sm font-bold text-[var(--heading)]">{num(p.active)} hesap</span>}
                  />
                );
              })}
            </OpsList>
          </OpsCard>

          <OpsGrid>
            <OpsCard id="sorunlar" icon={AlertTriangle} tone="rose" title="Sorunlu hesaplar" sub="Önem sırasıyla; ofis desteği için Ofis 360'ı açın">
              {o.issueRows.length === 0 ? (
                <EmptyState variant="compact" bare icon={Link2} title="Sorunlu portal hesabı yok" description="Eklenti girişi başarısız olduğunda ya da portal paketi bitmek üzereyken burada listelenir." />
              ) : (
                <OpsList label="Sorunlu portal hesapları">
                  {o.issueRows.map((r) => (
                    <OpsRow
                      key={`${r.tenantId}-${r.portal}`}
                      primary={d.names.get(r.tenantId) ?? "Ofis"}
                      href={`/admin/tenants/${r.tenantId}`}
                      secondary={`${PORTAL_LABEL[r.portal]}${r.issue === "giris_hatasi" ? ` · ${num(r.loginFailStreak)} ardışık hata${r.lastLoginFailAt ? `, son ${relativeTimeTR(r.lastLoginFailAt)}` : ""}` : ""}${r.planEndsAt && (r.issue === "paket_bitti" || r.issue === "paket_bitiyor") ? ` · paket bitişi ${formatDateTr(r.planEndsAt)}` : ""}`}
                      right={<StatusPill tone={PORTAL_ISSUE_TONE[r.issue]}>{PORTAL_ISSUE_LABEL[r.issue]}</StatusPill>}
                    />
                  ))}
                </OpsList>
              )}
            </OpsCard>

            <OpsCard id="ilanlar" icon={SearchCheck} tone="orange" title="İlan doğrulama" sub="Portaldaki ilanın yayında olup olmadığı; kalkmış ilanı en çok olan ofisler altta">
              <OpsList label="Doğrulama durumları">
                {LISTING_STATES.filter((k) => (d.listingStates[k] ?? 0) > 0 || k === "verified").map((k) => (
                  <OpsRow key={k} primary={LISTING_STATE_LABEL[k]} right={<StatusPill tone={LISTING_STATE_TONE[k]}>{num(d.listingStates[k])}</StatusPill>} />
                ))}
              </OpsList>
              {d.problemOffices.length > 0 ? (
                <>
                  <h3 className="mt-4 text-sm font-semibold text-[var(--heading)]">Kalkmış ya da şüpheli ilanı en çok olan ofisler</h3>
                  <OpsList label="Sorunlu ilanı olan ofisler">
                    {d.problemOffices.map((p) => (
                      <OpsRow
                        key={p.tenantId}
                        primary={d.names.get(p.tenantId) ?? "Ofis"}
                        href={`/admin/tenants/${p.tenantId}?sekme=kullanim`}
                        secondary={`${num(p.missing)} kalkmış · ${num(p.suspect)} şüpheli`}
                      />
                    ))}
                  </OpsList>
                </>
              ) : null}
            </OpsCard>
          </OpsGrid>
          {d.truncated ? <p className="text-xs text-text-muted">Okuma üst sınırına ulaşıldı; sayılar alt sınırdır.</p> : null}
        </>
      )}
    </div>
  );
}
