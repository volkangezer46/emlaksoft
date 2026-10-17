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
import { MULTI_DEVICE_MIN, collapseUserSessions, groupOfficeSessions, summarizeOfficeSessions, type OfficeDeviceGroup } from "@/lib/admin/ops/office-sessions";
import { OFFICE_SESSIONS_LIMIT, loadOfficeSessions } from "@/lib/admin/ops/office-sessions-read";
import { OpsCard, OpsKpis, num } from "../_components/ops-kit";
import { SessionCloseButton } from "./session-close-button";
import "@/app/app/_home/kurumsal/home.css";

export const metadata = { title: "Ofis oturumları" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OFFICE_CARDS_MAX = 40;
/** Katlanmış cihaz grubunun açılır ayrıntısında tek tek gösterilen en çok oturum (fazlası "Tümünü kapat" ile). */
const GROUP_DETAIL_MAX = 20;
const BASE = "/admin/ofis-oturumlari";

/** Süzgeç bağlantısı: ofis + demo/test görünürlüğü URL'de iki yönlü taşınır. */
function hrefOf(o: { ofis?: string | null; ic?: boolean }): string {
  const q = new URLSearchParams();
  if (o.ofis) q.set("ofis", o.ofis);
  if (o.ic) q.set("ic", "goster");
  const s = q.toString();
  return s ? `${BASE}?${s}` : BASE;
}

/**
 * OFİS OTURUMLARI (platform geneli, ofis kullanıcıları). Kaynak `platform_list_office_sessions` (SECURITY DEFINER;
 * members modülünü gören personel; oturumlu istemci): ofis → kullanıcı → oturum, son etkinlik, AAL, MASKELİ IP ve
 * user agent özeti. Aynı cihaz + IP'deki oturumlar TEK satıra katlanır (sayı + son görülme, açılır ayrıntı), kullanıcı
 * başına en çok 3 cihaz grubu görünür. Belirteç hiçbir aşamada okunmaz. Eylemler: tek oturumu kapat / kullanıcının tüm
 * oturumlarını kapat (süper admin + operasyon, gerekçe, doğrulayıcı kodu, hız sınırı, isteğe bağlı dört göz, denetim
 * kaydı). Süzgeçler sunucu sorgusuna gider: `?ofis=<kimlik>`, `?ic=goster` (demo/test ofisleri varsayılan GİZLİ).
 * Personel oturumları Personel > Güvenlik politikası'ndadır.
 */
export default async function OfficeSessionsPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const staff = await requirePlatformModule("members");
  const canRevoke = (staff.role === "super_admin" || staff.role === "ops") && platformCan(staff, "members", "write");
  const sp = (await searchParams) ?? {};
  const rawOffice = Array.isArray(sp.ofis) ? sp.ofis[0] : sp.ofis;
  const officeFilter = rawOffice && UUID_RE.test(rawOffice) ? rawOffice : null;
  const rawIc = Array.isArray(sp.ic) ? sp.ic[0] : sp.ic;
  // Tek ofis süzgecinde (Ofis 360'tan gelinir) demo/test ofisi de gösterilir; genel listede varsayılan gizli.
  const showInternal = rawIc === "goster" || Boolean(officeFilter);

  const d = await loadOfficeSessions({ actorStaffId: staff.id, tenantId: officeFilter, hideInternal: !showInternal });
  const s = summarizeOfficeSessions(d.rows, now());
  const groups = groupOfficeSessions(d.rows);
  const shown = groups.slice(0, OFFICE_CARDS_MAX);
  const filteredName = officeFilter ? (groups[0]?.tenantName ?? "Seçili ofis") : null;

  return (
    <div className="space-y-6">
      <AdminPageHeader
        art="shield"
        icon={MonitorSmartphone}
        eyebrow="Güvenlik ve veri"
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

          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-text-muted">
            {filteredName ? (
              <>
                <span className="min-w-0 truncate">
                  Süzgeç: <span className="font-semibold text-[var(--heading)]">{filteredName}</span>
                </span>
                <Link href={hrefOf({ ic: rawIc === "goster" })} className="focus-ring inline-flex min-h-11 items-center rounded-sm font-semibold text-accent-text hover:underline">
                  Süzgeci kaldır
                </Link>
              </>
            ) : (
              <>
                <span className="min-w-0">{showInternal ? "Demo ve test ofisleri dahil." : "Demo ve test ofisleri gizli."}</span>
                <Link href={hrefOf({ ic: !showInternal })} className="focus-ring inline-flex min-h-11 items-center rounded-sm font-semibold text-accent-text hover:underline">
                  {showInternal ? "Demo ve test ofislerini gizle" : "Demo ve test ofislerini göster"}
                </Link>
              </>
            )}
          </p>

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
                        <Link href={hrefOf({ ofis: g.tenantId })} className="focus-ring rounded-sm text-xs font-semibold text-accent-text hover:underline">
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
                        <UserDevices name={u.name} userId={u.userId} sessions={u.sessions} canRevoke={canRevoke} />
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

/** Kullanıcının oturumları: aynı cihaz + IP katlanır; en çok 3 grup görünür, kalanı ve grup ayrıntısı açılır listede. */
function UserDevices({ name, userId, sessions, canRevoke }: { name: string; userId: string; sessions: Parameters<typeof collapseUserSessions>[0]; canRevoke: boolean }) {
  const { shown, more } = collapseUserSessions(sessions);
  return (
    <div className="mt-2 border-l-2 border-line pl-3">
      <ul className="space-y-1.5" aria-label={`${name} cihazları`}>
        {shown.map((g) => (
          <DeviceRow key={g.key} name={name} userId={userId} g={g} canRevoke={canRevoke} />
        ))}
      </ul>
      {more.length > 0 ? (
        <details className="mt-1.5">
          <summary className="focus-ring inline-flex min-h-11 cursor-pointer items-center rounded-sm text-xs font-semibold text-accent-text">
            {num(more.length)} cihaz grubu daha ({num(more.reduce((n, g) => n + g.count, 0))} oturum)
          </summary>
          <ul className="mt-1.5 space-y-1.5" aria-label={`${name} diğer cihazları`}>
            {more.map((g) => (
              <DeviceRow key={g.key} name={name} userId={userId} g={g} canRevoke={canRevoke} />
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

function DeviceRow({ name, userId, g, canRevoke }: { name: string; userId: string; g: OfficeDeviceGroup; canRevoke: boolean }) {
  const single = g.count === 1 ? g.sessions[0]! : null;
  const detail = g.sessions.slice(0, GROUP_DETAIL_MAX);
  return (
    <li className="grid grid-cols-[minmax(0,1fr)] items-center gap-x-3 gap-y-1.5 sm:grid-cols-[minmax(0,1fr)_auto]">
      <div className="min-w-0">
        <span className="block truncate text-xs font-semibold text-[var(--heading)]" title={g.device}>
          {g.device}
          {g.count > 1 ? <span className="ml-1 font-medium text-text-muted">×{num(g.count)}</span> : null}
        </span>
        <span className="kh-clamp2 block text-xs text-text-muted">
          {g.lastActiveAt ? `Son etkinlik ${relativeTimeTR(g.lastActiveAt)}` : "Etkinlik yok"}
          {g.firstCreatedAt ? ` · ${g.count > 1 ? "ilk açılış" : "açılış"} ${relativeTimeTR(g.firstCreatedAt)}` : ""}
          {g.ipMasked ? ` · IP ${g.ipMasked}` : ""}
        </span>
        {g.count > 1 ? (
          <details className="mt-1">
            <summary className="focus-ring inline-flex min-h-11 cursor-pointer items-center rounded-sm text-xs font-semibold text-accent-text">Oturumları göster</summary>
            <ul className="mt-1 space-y-1" aria-label={`${name} · ${g.device} oturumları`}>
              {detail.map((x) => (
                <li key={x.sessionId} className="flex min-w-0 flex-wrap items-center justify-between gap-2 text-xs text-text-muted">
                  <span className="min-w-0 truncate">
                    {x.lastActiveAt ? `Son ${relativeTimeTR(x.lastActiveAt)}` : "Etkinlik yok"}
                    {x.createdAt ? ` · açılış ${relativeTimeTR(x.createdAt)}` : ""} · {x.aal === "aal2" ? "2FA" : "Parola"}
                  </span>
                  {canRevoke ? <SessionCloseButton mode="one" sessionId={x.sessionId} userId={userId} label={`${name} · ${g.device}`} /> : null}
                </li>
              ))}
            </ul>
            {g.count > detail.length ? (
              <p className="mt-1 text-xs text-text-faint">
                İlk {num(detail.length)} oturum gösteriliyor; hepsi için &quot;Tümünü kapat&quot;ı kullanın.
              </p>
            ) : null}
          </details>
        ) : null}
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-2 sm:justify-end">
        <StatusPill tone={g.aal2 === g.count ? "success" : "neutral"}>{g.aal2 === g.count ? "2FA" : g.aal2 > 0 ? `${num(g.aal2)} 2FA` : "Parola"}</StatusPill>
        {canRevoke && single ? <SessionCloseButton mode="one" sessionId={single.sessionId} userId={userId} label={`${name} · ${g.device}`} /> : null}
      </div>
    </li>
  );
}
