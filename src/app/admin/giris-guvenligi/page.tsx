import { Fingerprint, Globe2, KeyRound, ShieldAlert, ShieldCheck, UserX } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusPill } from "@/components/ui/list-kit/status-pill";
import { requirePlatformModule } from "@/lib/platform";
import { platformCan } from "@/lib/platform-access";
import { relativeTimeTR } from "@/lib/admin-format";
import { IP_KIND_LABEL, LOGIN_THRESHOLDS } from "@/lib/admin/ops/login-security";
import { LOGIN_WINDOW_DAYS, loadLoginSecurity } from "@/lib/admin/ops/read";
import { OpsCard, OpsGrid, OpsKpis, OpsList, OpsRow, num, pct } from "../_components/ops-kit";
import { RevokeSessionsButton } from "./revoke-sessions-button";
import "@/app/app/_home/kurumsal/home.css";

export const metadata = { title: "Giriş güvenliği" };

const KIND_TONE = { kimlik_doldurma: "danger", kaba_kuvvet: "warning", izleniyor: "neutral" } as const;

/**
 * GİRİŞ GÜVENLİĞİ (platform geneli, ofis kullanıcıları). Kaynak `login_events` (son 7 gün; ham IP ekrana basılmaz,
 * son blok maskeli) + aktif profillerde SMS iki adımlı doğrulama. Kaba kuvvet / kimlik doldurma şüpheli IP'ler,
 * hedeflenen hesaplar (5+ başarısız; ardından başarılı giriş olduysa önce), 2FA açmayan ofisler. Eylem: hesabın tüm
 * oturumlarını kapatma (süper admin + operasyon, doğrulayıcı kodu, denetim kaydı, hız sınırı). Personel girişleri
 * Personel > Güvenlik politikası'ndadır.
 */
export default async function LoginSecurityPage() {
  const staff = await requirePlatformModule("members");
  const canRevoke = (staff.role === "super_admin" || staff.role === "ops") && platformCan(staff, "members", "write");
  const d = await loadLoginSecurity();
  const s = d.summary;
  const fail = s.totals.failed + s.totals["2fa_failed"];
  const suspicious = s.ips.filter((i) => i.kind !== "izleniyor").length;
  const compromised = s.users.filter((u) => u.succeededAfter).length;

  return (
    <div className="space-y-6">
      <AdminPageHeader
        art="shield"
        icon={KeyRound}
        eyebrow="Güvenlik ve veri"
        title="Giriş güvenliği"
        description={`Ofis kullanıcılarının son ${LOGIN_WINDOW_DAYS} gündeki giriş denemeleri. IP adresleri KVKK gereği maskelidir; şüpheli desenler otomatik işaretlenir.`}
      />

      {!d.ready ? (
        <EmptyState variant="panel" icon={KeyRound} title="Giriş günlüğü okunamadı" description="login_events tablosu bu ortamda yok ya da okunamadı; giriş akışı etkilenmez." />
      ) : (
        <>
          <OpsKpis
            label="Giriş göstergeleri"
            items={[
              { key: "fail", title: "Başarısız deneme", value: num(fail), href: "#ip", icon: UserX, tone: "rose", caption: `Oran ${pct(s.failureRate)} · ${num(s.totals["2fa_failed"])} 2FA hatası`, series: s.daily.map((x) => x.failures), seriesLabel: `Son ${LOGIN_WINDOW_DAYS} gün günlük başarısız giriş` },
              { key: "ok", title: "Başarılı giriş", value: num(s.totals.success), href: "/admin/members", icon: ShieldCheck, tone: "mint", caption: d.pending2fa === null ? "Son 7 gün" : `${num(d.pending2fa)} kod bekleyen` },
              { key: "ip", title: "Şüpheli IP", value: num(suspicious), href: "#ip", icon: Globe2, tone: suspicious ? "orange" : "slate", caption: `${LOGIN_THRESHOLDS.ipBrute}+ deneme ya da ${LOGIN_THRESHOLDS.ipDistinctUsers}+ hesap` },
              { key: "acct", title: "Hedeflenen hesap", value: num(s.users.length), href: "#hesaplar", icon: ShieldAlert, tone: compromised ? "rose" : "amber", caption: compromised ? `${num(compromised)} hesapta sonra başarılı giriş` : `${LOGIN_THRESHOLDS.userTargeted}+ başarısız deneme` },
              { key: "2fa", title: "2FA kullanan", value: pct(d.twoFactor.percent), href: "#iki-adim", icon: Fingerprint, tone: "brand", caption: `${num(d.twoFactor.enabled)} / ${num(d.twoFactor.users)} aktif kullanıcı` },
            ]}
          />

          <OpsGrid>
            <OpsCard id="hesaplar" icon={ShieldAlert} tone="rose" title="Hedeflenen hesaplar" sub="Son 7 günde 5+ başarısız deneme; ardından başarılı giriş olanlar önce (ele geçirme şüphesi)">
              {s.users.length === 0 ? (
                <EmptyState variant="compact" bare icon={ShieldCheck} title="Hedeflenen hesap yok" description="Bir hesaba tekrar tekrar başarısız giriş denendiğinde burada listelenir." />
              ) : (
                <OpsList label="Hedeflenen hesaplar">
                  {s.users.map((u) => {
                    const p = d.people.get(u.userId);
                    const office = d.names.get(u.tenantId ?? p?.tenantId ?? "") ?? "Ofis bilinmiyor";
                    return (
                      <OpsRow
                        key={u.userId}
                        primary={p?.name ?? "Kullanıcı"}
                        href={`/admin/members/${u.userId}`}
                        secondary={`${office} · ${num(u.failures)} başarısız (${num(u.twoFactorFailures)} 2FA) · ${num(u.distinctIps)} IP · son ${relativeTimeTR(u.lastAt)}`}
                        right={
                          <>
                            {u.succeededAfter ? <StatusPill tone="danger">Sonra girildi</StatusPill> : <StatusPill tone="warning">Deneniyor</StatusPill>}
                            {canRevoke && p?.active ? <RevokeSessionsButton userId={u.userId} name={p.name} /> : null}
                          </>
                        }
                      />
                    );
                  })}
                </OpsList>
              )}
            </OpsCard>

            <OpsCard id="ip" icon={Globe2} tone="orange" title="Şüpheli IP adresleri" sub="Maskeli adres; çok hesaba deneme (kimlik doldurma) en üstte. Giriş kısıtlayıcı bu IP'leri ayrıca yavaşlatır.">
              {s.ips.length === 0 ? (
                <EmptyState variant="compact" bare icon={Globe2} title="Şüpheli IP yok" description="Aynı adresten 5+ başarısız deneme olduğunda burada görünür." />
              ) : (
                <OpsList label="Şüpheli IP adresleri">
                  {s.ips.map((i) => (
                    <OpsRow
                      key={i.key}
                      primary={i.ipMasked}
                      secondary={`${num(i.failures)} başarısız · ${num(i.distinctUsers)} hesap · ${num(i.distinctTenants)} ofis · son ${relativeTimeTR(i.lastAt)}`}
                      right={<StatusPill tone={KIND_TONE[i.kind]}>{IP_KIND_LABEL[i.kind]}</StatusPill>}
                    />
                  ))}
                </OpsList>
              )}
            </OpsCard>
          </OpsGrid>

          <OpsCard id="iki-adim" icon={Fingerprint} tone="brand" title="İki adımlı doğrulama açmayan ofisler" sub="En az 3 aktif kullanıcısı olup hiç kimsenin SMS doğrulamasını açmadığı ofisler; ofis güvenlik politikası Ofis 360 > Yönetim'den zorunlu kılınabilir">
            {d.twoFactor.officesWithout.length === 0 ? (
              <EmptyState variant="compact" bare icon={Fingerprint} title="Tüm büyük ofislerde en az bir kullanıcı 2FA kullanıyor" />
            ) : (
              <OpsList label="2FA açmayan ofisler">
                {d.twoFactor.officesWithout.map((o) => (
                  <OpsRow
                    key={o.tenantId}
                    primary={d.names.get(o.tenantId) ?? "Ofis"}
                    href={`/admin/tenants/${o.tenantId}?sekme=yonetim`}
                    secondary="Güvenlik politikası: iki adımlı doğrulama zorunluluğu"
                    right={<span className="numeric text-sm font-bold text-[var(--heading)]">{num(o.users)} kullanıcı</span>}
                  />
                ))}
              </OpsList>
            )}
          </OpsCard>
          {d.truncated ? <p className="text-xs text-text-muted">Okuma üst sınırına ulaşıldı (10.000 başarısız deneme); sayılar alt sınırdır.</p> : null}
        </>
      )}
    </div>
  );
}
