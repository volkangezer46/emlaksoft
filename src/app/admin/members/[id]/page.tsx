import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  ArrowUpRight,
  Building2,
  CalendarDays,
  History,
  KeyRound,
  Mail,
  Phone,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePlatformModule } from "@/lib/platform";
import { formatTurkishPhone } from "@/lib/phone";
import { auditActionLabel, relativeTimeTR } from "@/lib/admin-format";

const roleLabel: Record<string, string> = {
  owner: "Ofis sahibi",
  gm: "Genel müdür",
  branch_manager: "Şube müdürü",
  team_lead: "Takım lideri",
  advisor: "Danışman",
  call_center: "Çağrı merkezi",
  accounting: "Muhasebe",
  readonly: "Salt okunur",
};

type Rel = { name?: string } | { name?: string }[] | null;

function relName(value: Rel) {
  if (!value) return null;
  return Array.isArray(value) ? (value[0]?.name ?? null) : (value.name ?? null);
}

type LoginRow = { id?: string; created_at?: string; result?: string; ip?: string | null; user_agent?: string | null };

const LOGIN_RESULT_LABEL: Record<string, { label: string; ok: boolean }> = {
  success: { label: "Başarılı giriş", ok: true },
  failed: { label: "Başarısız deneme", ok: false },
  "2fa_pending": { label: "2FA doğrulaması bekledi", ok: false },
  "2fa_failed": { label: "2FA doğrulaması başarısız", ok: false },
};
type AuditRow = { id: string; action: string; entity_type: string | null; created_at: string };

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString("tr-TR", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function AdminMemberDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePlatformModule("members");
  const { id } = await params;
  const admin = createAdminClient();

  /*
   * login_events paralel bir migration ile geliyor — tablo yoksa sorgu hata döner,
   * `select("*")` + hata kontrolüyle bölüm sessizce "kayıt yok" gösterir.
   */
  const [{ data: profile }, authRes, loginRes, auditRes] = await Promise.all([
    admin
      .from("profiles")
      .select("id, full_name, phone, role, is_active, created_at, tenant_id, branch_id, tenant:tenants(name), branch:branches(name)")
      .eq("id", id)
      .maybeSingle(),
    admin.auth.admin.getUserById(id).catch(() => ({ data: { user: null } })),
    // Tablo yoksa supabase throw etmez — hata `error` alanında döner, bölüm boş gösterilir.
    admin
      .from("login_events")
      .select("*")
      .eq("user_id", id)
      .order("created_at", { ascending: false })
      .limit(20),
    admin
      .from("audit_logs")
      .select("id, action, entity_type, created_at")
      .eq("actor_id", id)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  if (!profile) notFound();

  const authUser = authRes.data?.user ?? null;
  const logins = (loginRes.data ?? []) as LoginRow[];
  const loginsAvailable = !loginRes.error && loginRes.data !== null;
  const audits = (auditRes.data ?? []) as AuditRow[];

  const lastSuccess = logins.find((l) => l.result === "success" && l.created_at);
  const tenantName = relName(profile.tenant as Rel);
  const branchName = relName(profile.branch as Rel);

  const facts: { icon: typeof Mail; label: string; value: React.ReactNode }[] = [
    { icon: Mail, label: "E-posta", value: authUser?.email ?? "—" },
    { icon: Phone, label: "Telefon", value: profile.phone ? formatTurkishPhone(profile.phone) : "—" },
    { icon: CalendarDays, label: "Kayıt tarihi", value: fmtDateTime(profile.created_at) },
    {
      icon: KeyRound,
      label: "Son giriş",
      value: lastSuccess?.created_at
        ? relativeTimeTR(lastSuccess.created_at)
        : authUser?.last_sign_in_at
          ? relativeTimeTR(authUser.last_sign_in_at)
          : "Hiç giriş yapmadı",
    },
  ];

  return (
    <div className="space-y-6">
      <Link href="/admin/members" className="inline-flex items-center gap-1.5 text-sm font-semibold text-text-muted hover:text-brand-600">
        <ArrowLeft className="h-4 w-4" /> Üye listesi
      </Link>

      <section className="theme-dark relative overflow-hidden rounded-[22px] bg-[image:var(--grad-ink)] p-6 text-white">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-35" />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div>
            <span className="flex items-center gap-2 text-xs font-semibold text-amber-400">
              <UserRound className="h-4 w-4" /> Kullanıcı detayı
            </span>
            <h1 className="mt-2 font-display text-3xl font-extrabold">{profile.full_name}</h1>
            <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-white/60">
              <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-[11px] font-bold text-white">
                {roleLabel[profile.role] ?? profile.role}
              </span>
              <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${profile.is_active ? "bg-mint-500/20 text-mint-300" : "bg-white/10 text-white/60"}`}>
                {profile.is_active ? "Aktif" : "Pasif"}
              </span>
              {branchName ? <span>Şube: {branchName}</span> : null}
            </p>
          </div>
          {profile.tenant_id ? (
            <Link
              href={`/admin/tenants/${profile.tenant_id}`}
              className="focus-ring press inline-flex items-center gap-2 rounded-[10px] bg-white px-4 py-2.5 text-sm font-semibold text-ink-950 transition hover:bg-white/90"
            >
              <Building2 className="h-4 w-4" /> {tenantName ?? "Ofis"} <ArrowUpRight className="h-4 w-4" />
            </Link>
          ) : null}
        </div>

        <div className="relative mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {facts.map((f) => (
            <div key={f.label} className="rounded-[14px] border border-white/10 bg-white/5 p-3 backdrop-blur">
              <span className="flex items-center gap-1.5 text-[11px] text-white/45">
                <f.icon className="h-3.5 w-3.5 text-mint-400" /> {f.label}
              </span>
              <p className="mt-1.5 truncate text-sm font-semibold text-white">{f.value}</p>
            </div>
          ))}
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Son girişler */}
        <section className="rounded-[20px] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
          <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
            <KeyRound className="h-4 w-4 text-brand-600" /> Son girişler
          </h2>
          <p className="text-xs text-text-muted">En son 20 giriş denemesi</p>
          {!loginsAvailable ? (
            <p className="mt-4 rounded-[12px] border border-dashed border-line-strong px-4 py-8 text-center text-sm text-text-muted">
              Giriş kayıtları henüz toplanmıyor.
            </p>
          ) : logins.length === 0 ? (
            <p className="mt-4 rounded-[12px] border border-dashed border-line-strong px-4 py-8 text-center text-sm text-text-muted">
              Hiç giriş kaydı yok — kullanıcı daveti henüz kabul etmemiş olabilir.
            </p>
          ) : (
            <ul className="mt-4 divide-y divide-line/60">
              {logins.map((l, i) => {
                const meta = LOGIN_RESULT_LABEL[l.result ?? ""] ?? { label: l.result ?? "—", ok: false };
                return (
                  <li key={l.id ?? i} className="flex items-center justify-between gap-3 py-2.5">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className={`h-2 w-2 shrink-0 rounded-full ${meta.ok ? "bg-mint-500" : "bg-danger-500"}`} />
                      <span className="text-sm text-ink-950">{meta.label}</span>
                      {l.ip ? <span className="truncate text-[11px] text-text-faint">{l.ip}</span> : null}
                    </span>
                    <span className="shrink-0 text-xs tabular-nums text-text-muted" title={l.created_at ? fmtDateTime(l.created_at) : undefined}>
                      {l.created_at ? relativeTimeTR(l.created_at) : "—"}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* Son işlemler (audit) */}
        <section className="rounded-[20px] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
          <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
            <History className="h-4 w-4 text-brand-600" /> Son işlemler
          </h2>
          <p className="text-xs text-text-muted">Kullanıcının denetim kaydındaki son 20 hareketi</p>
          {audits.length === 0 ? (
            <p className="mt-4 rounded-[12px] border border-dashed border-line-strong px-4 py-8 text-center text-sm text-text-muted">
              Denetim kaydı bulunamadı.
            </p>
          ) : (
            <ul className="mt-4 divide-y divide-line/60">
              {audits.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-3 py-2.5">
                  <span className="flex min-w-0 items-center gap-2">
                    <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-text-faint" />
                    <span className="truncate text-sm text-ink-950">{auditActionLabel(a.action)}</span>
                    {a.entity_type ? (
                      <span className="shrink-0 rounded-full bg-ink-950/6 px-2 py-0.5 text-[10px] font-semibold text-text-muted">
                        {a.entity_type}
                      </span>
                    ) : null}
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-text-muted" title={fmtDateTime(a.created_at)}>
                    {relativeTimeTR(a.created_at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
