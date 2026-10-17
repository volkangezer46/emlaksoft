import Link from "@/components/ui/smart-link";
import { redirect } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { FilterChip } from "@/components/ui/filter-chip";
import { requirePlatformStaff } from "@/lib/platform";
import { platformCanAccess } from "@/lib/platform-access";
import { createAdminClient } from "@/lib/supabase/admin";
import { now } from "@/lib/clock";
import {
  FOUR_EYES_KINDS,
  SENSITIVE_FOUR_EYES_KINDS,
  approvalDisplayStatus,
  approvalStatusLabel,
  checkDecision,
  decidableKinds,
  isFourEyesKind,
} from "@/lib/platform-security/four-eyes-policy";
import { readFourEyesConfig } from "@/lib/platform-security/four-eyes";
import { ApprovalActions } from "./approval-actions";

export const metadata = { title: "Onaylar" };

const DATE = new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", dateStyle: "medium", timeStyle: "short" });
const FILTERS = [
  { id: "bekleyen", label: "Onay bekleyen" },
  { id: "benim", label: "Taleplerim" },
  { id: "sonuclanan", label: "Sonuçlanan" },
] as const;
type FilterId = (typeof FILTERS)[number]["id"];

type Row = {
  id: string;
  kind: string;
  module: string;
  entity_type: string;
  entity_id: string;
  amount_try: number | null;
  summary: string;
  status: string;
  requested_by: string | null;
  requested_at: string;
  expires_at: string;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  result_error: string | null;
};

/** Talebin ilgili kaydına bağlantı (sıfır çıkmaz satır: her satır kaydına gider). */
function entityHref(r: Row): string | null {
  if (r.entity_type === "invoice") return `/admin/billing/faturalar/${r.entity_id}`;
  if (r.entity_type === "tenant") return `/admin/tenants/${r.entity_id}`;
  if (r.entity_type === "platform_staff") return `/admin/personel/${r.entity_id}`;
  if (r.entity_type === "profile") return `/admin/members/${r.entity_id}`;
  if (r.entity_type === "auth_session") return "/admin/ofis-oturumlari";
  if (r.entity_type === "queue") return "/admin/kuyruklar";
  if (r.entity_type === "tenant_flag") return `/admin/tenants/${r.entity_id.slice(0, 36)}?sekme=yonetim`;
  return null;
}

/**
 * Kontrol paneli > Onaylar (DG1 dört göz kuyruğu). Kritik işlem yapabilen personel (faturalama, ofisler ya da personel
 * modülü) kendi taleplerini; modülde "onayla" yetkisi olan personel o türün bekleyen taleplerini görür ve karar verir.
 * Karar eylemleri sunucuda yeniden denetlenir (talep eden onaylayamaz; DB CHECK ayrıca engeller).
 */
export default async function ApprovalsPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const staff = await requirePlatformStaff();
  if (!(["billing", "tenants", "personel", "members", "sistem"] as const).some((m) => platformCanAccess(staff, m))) redirect("/admin");

  const sp = (await searchParams) ?? {};
  const raw = Array.isArray(sp.durum) ? sp.durum[0] : sp.durum;
  const filter: FilterId = FILTERS.some((f) => f.id === raw) ? (raw as FilterId) : "bekleyen";
  const kinds = decidableKinds(staff);
  const nowMs = now();
  const nowIso = new Date(nowMs).toISOString();

  const admin = createAdminClient();
  // Görünürlük: kendi talepleri + karar verebildiği türler (sunucu süzgeci; istemci süzmez).
  const scope = kinds.length > 0 ? `requested_by.eq.${staff.id},kind.in.(${kinds.join(",")})` : `requested_by.eq.${staff.id}`;
  let q = admin
    .from("platform_approval_requests")
    .select("id, kind, module, entity_type, entity_id, amount_try, summary, status, requested_by, requested_at, expires_at, decided_by, decided_at, decision_note, result_error")
    .or(scope)
    .order("requested_at", { ascending: false })
    .limit(100);
  if (filter === "bekleyen") q = q.eq("status", "pending").gt("expires_at", nowIso);
  if (filter === "benim") q = q.eq("requested_by", staff.id);
  if (filter === "sonuclanan") q = q.neq("status", "pending");

  const [{ data, error }, cfg, pendingCount] = await Promise.all([
    q,
    readFourEyesConfig(),
    admin
      .from("platform_approval_requests")
      .select("id", { count: "exact", head: true })
      .or(scope)
      .eq("status", "pending")
      .gt("expires_at", nowIso),
  ]);
  const rows = (data ?? []) as Row[];
  const ids = [...new Set(rows.flatMap((r) => [r.requested_by, r.decided_by]).filter((v): v is string => !!v))];
  const { data: people } = ids.length
    ? await admin.from("platform_staff").select("id, full_name").in("id", ids)
    : { data: [] as { id: string; full_name: string }[] };
  const nameOf = new Map((people ?? []).map((p) => [p.id as string, p.full_name as string]));

  const active = [
    cfg.refundThresholdTry > 0 ? `İade ≥ ₺${cfg.refundThresholdTry.toLocaleString("tr-TR")}` : null,
    cfg.creditThresholdTry > 0 ? `Hesap kredisi ≥ ₺${cfg.creditThresholdTry.toLocaleString("tr-TR")}` : null,
    cfg.officeClose ? "Ofis askıya alma / arşivleme" : null,
    cfg.staffRole ? "Personel rol değişikliği" : null,
    ...SENSITIVE_FOUR_EYES_KINDS.filter((k) => cfg.sensitive[k]).map((k) => `${FOUR_EYES_KINDS[k].label} (süper admin onayı, bir kez kullanılır)`),
  ].filter(Boolean);

  return (
    <div className="space-y-5">
      <AdminPageHeader
        eyebrow="Dört göz"
        icon={ShieldCheck}
        title="Onaylar"
        description="Kritik işlemler ikinci bir yetkilinin onayıyla yürür. Talebi açan onaylayamaz; her karar denetim izine yazılır."
        art="shield"
      />

      <section className="rounded-[var(--radius-card)] border border-line bg-surface p-4 text-xs text-text-muted">
        {active.length > 0 ? (
          <p>
            <span className="font-semibold text-ink-950">İkinci onaya düşen işlemler:</span> {active.join(" · ")}. Talep{" "}
            {cfg.expiryHours} saat içinde karara bağlanmazsa düşer.
          </p>
        ) : (
          <p>
            Dört göz onayı şu an hiçbir işlem için açık değil; kritik işlemler tek yetkiliyle (doğrulayıcı koduyla) yürür.
          </p>
        )}
        {/* B116: eşikler burada düzenlenmez (kuyruk sayfası); tek düzenleme yeri Ayar merkezi > Güvenlik (yalnız süper admin). */}
        <p className="mt-1.5">
          Eşikleri değiştirmek için:{" "}
          <Link href="/admin/ayarlar?kategori=guvenlik" className="focus-ring -my-3 rounded-sm py-3 font-semibold text-accent-text hover:underline">
            Ayar merkezi &gt; Güvenlik
          </Link>{" "}
          (yalnız süper admin).
        </p>
      </section>

      <nav aria-label="Talep süzgeci" className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <FilterChip key={f.id} href={f.id === "bekleyen" ? "/admin/onaylar" : `/admin/onaylar?durum=${f.id}`} active={filter === f.id} count={f.id === "bekleyen" ? (pendingCount.count ?? undefined) : undefined}>
            {f.label}
          </FilterChip>
        ))}
      </nav>

      {error ? (
        <p role="status" className="rounded-[var(--radius-card)] border border-line bg-surface p-5 text-sm text-text-muted">
          Onay kuyruğu henüz kurulmadı (veritabanı güncellemesi bekliyor).
        </p>
      ) : rows.length === 0 ? (
        <p role="status" className="rounded-[var(--radius-card)] border border-line bg-surface p-5 text-sm text-text-muted">
          {filter === "bekleyen" ? "Onay bekleyen işlem yok." : filter === "benim" ? "Henüz onaya gönderdiğiniz bir işlem yok." : "Sonuçlanan talep yok."}
        </p>
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => {
            const kindLabel = isFourEyesKind(r.kind) ? FOUR_EYES_KINDS[r.kind].label : r.kind;
            const status = approvalDisplayStatus(r, nowMs);
            const statusText = approvalStatusLabel(r, nowMs);
            const href = entityHref(r);
            const canDecide = checkDecision(r, staff.id, staff, "approve", nowMs).ok;
            const canCancel = checkDecision(r, staff.id, staff, "cancel", nowMs).ok;
            return (
              <li key={r.id} className="space-y-2 rounded-[var(--radius-card)] border border-line bg-surface p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-wide text-text-faint">{kindLabel}</p>
                    {href ? (
                      <Link href={href} className="focus-ring font-semibold text-ink-950 hover:text-brand-600">
                        {r.summary}
                      </Link>
                    ) : (
                      <p className="font-semibold text-ink-950">{r.summary}</p>
                    )}
                  </div>
                  <span className="max-w-full rounded-full bg-ink-950/6 px-2.5 py-0.5 text-xs font-bold text-ink-950">{statusText}</span>
                </div>
                <p className="text-xs text-text-muted">
                  Talep eden: {r.requested_by ? (nameOf.get(r.requested_by) ?? "Personel") : "Silinmiş personel"} · {DATE.format(new Date(r.requested_at))}
                  {status === "pending" ? ` · son geçerlilik ${DATE.format(new Date(r.expires_at))}` : ""}
                  {r.decided_by ? ` · Karar: ${nameOf.get(r.decided_by) ?? "Personel"}${r.decided_at ? `, ${DATE.format(new Date(r.decided_at))}` : ""}` : ""}
                </p>
                {r.decision_note ? <p className="text-xs text-text-muted">Not: {r.decision_note}</p> : null}
                {r.result_error ? <p className="text-xs font-semibold text-danger-600">Yürütme hatası: {r.result_error}</p> : null}
                {status === "pending" && (canDecide || canCancel) ? <ApprovalActions id={r.id} canDecide={canDecide} canCancel={canCancel} /> : null}
                {status === "pending" && !canDecide && r.requested_by !== staff.id ? (
                  <p className="text-xs text-text-faint">Bu talebe karar verme yetkiniz yok.</p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
