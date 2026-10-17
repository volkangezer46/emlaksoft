import { Building2, Clock3, Fingerprint, Laptop, MonitorSmartphone, Users } from "lucide-react";
import Link from "@/components/ui/smart-link";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusPill } from "@/components/ui/list-kit/status-pill";
import { requirePlatformModule } from "@/lib/platform";
import { platformCan } from "@/lib/platform-access";
import { now } from "@/lib/clock";
import { relativeTimeTR } from "@/lib/admin-format";
import { roleLabel } from "@/lib/role-labels";
import { MULTI_DEVICE_MIN, groupOfficeSessions, summarizeOfficeSessions, summarizeUserAgent } from "@/lib/admin/ops/office-sessions";
import { OFFICE_SESSIONS_LIMIT, loadOfficeSessions } from "@/lib/admin/ops/office-sessions-read";
import { OpsCard, OpsKpis, num } from "../_components/ops-kit";
import { SessionCloseButton } from "./session-close-button";
import "@/app/app/_home/kurumsal/home.css";

export const metadata = { title: "Ofis oturumları" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OFFICE_CARDS_MAX = 40;
const BASE = "/admin/ofis-oturumlari";

/**
 * OFİS OTURUMLARI (platform geneli, ofis kullanıcıları). Kaynak `platform_list_office_sessions` (SECURITY DEFINER;
 * members modülünü gören personel; oturumlu istemci): ofis → kullanıcı → oturum, son etkinlik, AAL, MASKELİ IP ve
 * user agent özeti. Belirteç hiçbir aşamada okunmaz. Eylemler: tek oturumu kapat / kullanıcının tüm oturumlarını kapat
 * (süper admin + operasyon, gerekçe, doğrulayıcı kodu, hız sınırı, isteğe bağlı dört göz, denetim kaydı). Süzgeç
 * `?ofis=<kimlik>` sunucu sorgusuna gider. Personel oturumları Personel > Güvenlik politikası'ndadır.
 */
export default async function OfficeSessionsPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const staff = await requirePlatformModule("members");
  const canRevoke = (staff.role === "super_admin" || staff.role === "ops") && platformCan(staff, "members", "write");
  const sp = (await searchParams) ?? {};
  const rawOffice = Array.isArray(sp.ofis) ? sp.ofis[0] : sp.ofis;
  const officeFilter = rawOffice && UUID_RE.test(rawOffice) ? rawOffice : null;

  const d = await loadOfficeSessions({ tenantId: officeFilter });
  const s = summarizeOfficeSessions(d.rows, now());
  const groups = groupOfficeSessions(d.rows);
  const shown = groups.slice(0, OFFICE_CARDS_MAX);
  const filteredName = officeFilter ? (groups[0]?.tenantName ?? "Seçili ofis") : null;

  return (
    <div className="space-y-6">
      <AdminPageHeader
        art="shield"
        icon={MonitorSmartphone}
        eyebrow="Güvenlik & veri"
        title="Ofis oturumları"
        description="Ofis kullanıcılarının açık oturumları: cihaz, son etkinlik ve maskeli IP. Kaybolan cihazda tek oturumu, şüphede kullanıcının tüm oturumlarını kapatın."
      />

      {!d.ready ? (
        <EmptyState
          variant="panel"
          icon={MonitorSmartphone}
          title="Oturum listesi okunamadı"
          description="Oturum fonksiyonu bu ortamda henüz kurulmadı (veritabanı güncellemesi 20261025010000 bekliyor) ya da okunamadı. Oturum kapatma Üyeler > üye ekranından yapılabilir."
        />
      ) : (
        <>
          <OpsKpis
            label="Oturum göstergeleri"
            items={[
              { key: "s", title: "Açık oturum", value: num(s.sessions), href: "#ofisler", icon: MonitorSmartphone, tone: "brand", caption: d.truncated ? `İlk ${num(OFFICE_SESSIONS_LIMIT)} oturum (son etkinliğe göre)` : "Süresi dolmamış, kapatılmamış" },
              { key: "u", title: "Oturumu açık kullanıcı", value: num(s.users), href: "#ofisler", icon: Users, tone: "mint", caption: `${num(s.offices)} ofiste` },
              { key: "d", title: "Son 24 saatte etkin", value: num(s.active24h), href: "#ofisler", icon: Clock3, tone: "amber", caption: "Belirteç yenilemesi ya da giriş" },
              { key: "a", title: "2FA ile açılan", value: num(s.aal2), href: "#ofisler", icon: Fingerprint, tone: "slate", caption: "İki adımlı doğrulamalı (AAL2) oturum" },
              { key: "m", title: "Çok cihazlı kullanıcı", value: num(s.multiDeviceUsers), href: "#ofisler", icon: Laptop, tone: s.multiDeviceUsers ? "orange" : "slate", caption: `${MULTI_DEVICE_MIN}+ açık oturum` },
            ]}
          />

          {filteredName ? (
            <p className="flex flex-wrap items-center gap-2 text-sm text-text-muted">
              <span className="min-w-0 truncate">
                Süzgeç: <span className="font-semibold text-[var(--heading)]">{filteredName}</span>
              </span>
              <Link href={BASE} className="focus-ring rounded-sm font-semibold text-accent-text hover:underline">
                Süzgeci kaldır
              </Link>
            </p>
          ) : null}

          <div id="ofisler" className="scroll-mt-24 space-y-4">
            {shown.length === 0 ? (
              <EmptyState variant="panel" icon={MonitorSmartphone} title="Açık ofis oturumu yok" description="Bir ofis kullanıcısı giriş yaptığında oturumu burada görünür." />
            ) : (
              shown.map((g) => (
                <OpsCard
                  key={g.tenantId}
                  id={`ofis-${g.tenantId}`}
                  icon={Building2}
                  tone="brand"
                  title={g.tenantName}
                  sub={`${num(g.sessionCount)} oturum · ${num(g.users.length)} kullanıcı${g.lastActiveAt ? ` · son etkinlik ${relativeTimeTR(g.lastActiveAt)}` : ""}`}
                  right={
                    <>
                      {officeFilter ? null : (
                        <Link href={`${BASE}?ofis=${g.tenantId}`} className="focus-ring rounded-sm text-xs font-semibold text-accent-text hover:underline">
                          Yalnız bu ofis
                        </Link>
                      )}
                      <Link href={`/admin/tenants/${g.tenantId}`} className="focus-ring rounded-sm text-xs font-semibold text-accent-text hover:underline">
                        Ofis 360
                      </Link>
                    </>
                  }
                >
                  <ul className="divide-y divide-line" aria-label={`${g.tenantName} oturumları`}>
                    {g.users.map((u) => (
                      <li key={u.userId} className="py-3">
                        <div className="grid grid-cols-[minmax(0,1fr)] items-center gap-x-3 gap-y-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                          <Link href={`/admin/members/${u.userId}`} className="focus-ring min-w-0 rounded-[var(--radius-control)] hover:underline">
                            <span className="block truncate text-sm font-semibold text-[var(--heading)]" title={u.name}>
                              {u.name}
                            </span>
                            <span className="kh-clamp2 block text-xs text-text-muted">
                              {roleLabel(u.role) || "Rol yok"} · {num(u.sessions.length)} oturum
                              {u.lastActiveAt ? ` · son ${relativeTimeTR(u.lastActiveAt)}` : ""}
                            </span>
                          </Link>
                          <div className="flex min-w-0 flex-wrap items-center gap-2 sm:justify-end">
                            {u.sessions.length >= MULTI_DEVICE_MIN ? <StatusPill tone="warning">Çok cihaz</StatusPill> : null}
                            {canRevoke ? <SessionCloseButton mode="all" userId={u.userId} label={`${u.name} (${g.tenantName})`} /> : null}
                          </div>
                        </div>
                        <ul className="mt-2 space-y-1.5 border-l-2 border-line pl-3" aria-label={`${u.name} oturumları`}>
                          {u.sessions.map((x) => {
                            const device = summarizeUserAgent(x.userAgent);
                            return (
                              <li key={x.sessionId} className="grid grid-cols-[minmax(0,1fr)] items-center gap-x-3 gap-y-1.5 sm:grid-cols-[minmax(0,1fr)_auto]">
                                <div className="min-w-0">
                                  <span className="block truncate text-xs font-semibold text-[var(--heading)]" title={device}>
                                    {device}
                                  </span>
                                  <span className="kh-clamp2 block text-xs text-text-muted">
                                    {x.lastActiveAt ? `Son etkinlik ${relativeTimeTR(x.lastActiveAt)}` : "Etkinlik yok"}
                                    {x.createdAt ? ` · açılış ${relativeTimeTR(x.createdAt)}` : ""}
                                    {x.ipMasked ? ` · IP ${x.ipMasked}` : ""}
                                  </span>
                                </div>
                                <div className="flex min-w-0 flex-wrap items-center gap-2 sm:justify-end">
                                  <StatusPill tone={x.aal === "aal2" ? "success" : "neutral"}>{x.aal === "aal2" ? "2FA" : "Parola"}</StatusPill>
                                  {canRevoke ? <SessionCloseButton mode="one" sessionId={x.sessionId} userId={u.userId} label={`${u.name} · ${device}`} /> : null}
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                      </li>
                    ))}
                  </ul>
                </OpsCard>
              ))
            )}
            {groups.length > shown.length ? (
              <p className="text-xs text-text-muted">
                En çok oturumu olan {num(OFFICE_CARDS_MAX)} ofis gösteriliyor ({num(groups.length)} ofisten). Diğer ofis için Ofis 360 &gt; Ekip ya da ofis süzgeci kullanın.
              </p>
            ) : null}
          </div>

          {!canRevoke ? (
            <p className="text-xs text-text-faint">Oturum kapatma yalnız süper admin ve operasyon içindir.</p>
          ) : null}
        </>
      )}
    </div>
  );
}
