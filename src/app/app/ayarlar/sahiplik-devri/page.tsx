import { PageHeader } from "@/components/ui/page-header";
import { Alert } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { requireModulePage } from "@/lib/require-module-page";
import { createClient } from "@/lib/supabase/server";
import { now } from "@/lib/clock";
import { formatDateTimeTr } from "@/lib/format";
import { roleLabel } from "@/lib/role-labels";
import { DEMOTE_ROLE_OPTIONS, OWNERSHIP_TRANSFER_HREF, OWNERSHIP_TRANSFER_TTL_HOURS, isTransferOpen } from "@/lib/ownership-transfer";
import { AcceptTransferPanel, CancelTransferButton, RequestTransferForm } from "./transfer-panels";

export const metadata = { title: "Sahiplik devri" };

type TransferRow = {
  id: string;
  from_user_id: string;
  to_user_id: string;
  demote_role: string;
  status: string;
  expires_at: string;
  created_at: string;
  resolved_at: string | null;
};

const STATUS_LABEL: Record<string, { label: string; tone: "neutral" | "attention" | "success" }> = {
  pending: { label: "Onay bekliyor", tone: "attention" },
  accepted: { label: "Tamamlandı", tone: "success" },
  declined: { label: "Reddedildi", tone: "neutral" },
  cancelled: { label: "İptal edildi", tone: "neutral" },
  expired: { label: "Süresi doldu", tone: "neutral" },
};

/**
 * Ofis sahipliği devri: sahip başlatır, devralacak kişi parolasıyla onaylar (tek işlemde rol takası).
 * Her üye açabilir (kapı "dashboard"): devralması istenen kişi talebi burada görür; başlatma yalnız sahibe açıktır
 * (asıl kapı RPC'dedir). Okuma RLS'li: yalnız devrin tarafları kendi taleplerini görür.
 */
export default async function OwnershipTransferPage() {
  const { userId, role, tenantId } = await requireModulePage("dashboard", OWNERSHIP_TRANSFER_HREF);
  const crumbs = [{ label: "Ayarlar", href: "/app/ayarlar" }, { label: "Sahiplik devri" }];
  const header = (
    <PageHeader
      eyebrow="Ayarlar"
      title="Sahiplik devri"
      description="Ofisin sahipliğini ekipten birine iki adımda devredin: siz başlatırsınız, devralacak kişi kendi parolasıyla onaylar. Onayla birlikte roller tek seferde değişir."
      breadcrumbs={crumbs}
    />
  );
  if (!tenantId) {
    return (
      <div className="mx-auto w-full max-w-3xl space-y-4">
        {header}
        <Alert tone="info">Bu işlem bir ofis hesabı içinde yapılır.</Alert>
      </div>
    );
  }

  const supabase = await createClient();
  const [transfersRes, membersRes] = await Promise.all([
    supabase
      .from("ownership_transfers")
      .select("id, from_user_id, to_user_id, demote_role, status, expires_at, created_at, resolved_at")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(10),
    supabase.from("profiles").select("id, full_name, role, is_active").eq("tenant_id", tenantId).limit(500),
  ]);

  if (transfersRes.error) {
    return (
      <div className="mx-auto w-full max-w-3xl space-y-4">
        {header}
        <Alert tone="info" title="Henüz etkin değil">
          Sahiplik devri bu ortamda henüz açılmadı. Acil bir devir için EmlakSoft destek ekibine yazabilirsiniz.
        </Alert>
      </div>
    );
  }

  const members = (membersRes.data ?? []) as { id: string; full_name: string | null; role: string; is_active: boolean }[];
  const nameOf = (id: string) => members.find((m) => m.id === id)?.full_name?.trim() || "Ekip üyesi";
  const nowMs = now();
  const transfers = (transfersRes.data ?? []) as TransferRow[];
  const open = transfers.find((t) => isTransferOpen(t, nowMs)) ?? null;
  const isOwner = role === "owner";
  const candidates = members
    .filter((m) => m.is_active && m.role !== "owner" && m.id !== userId)
    .map((m) => ({ id: m.id, label: `${m.full_name?.trim() || "Ekip üyesi"} (${roleLabel(m.role)})` }))
    .sort((a, b) => a.label.localeCompare(b.label, "tr"));

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5">
      {header}

      {open && open.to_user_id === userId ? (
        <AcceptTransferPanel
          transferId={open.id}
          fromName={nameOf(open.from_user_id)}
          demoteRoleLabel={roleLabel(open.demote_role)}
          expiresLabel={formatDateTimeTr(open.expires_at)}
        />
      ) : open && open.from_user_id === userId ? (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Devir onay bekliyor</CardTitle>
              <CardDescription>
                {nameOf(open.to_user_id)} onayladığında ofis sahibi olur; siz {roleLabel(open.demote_role)} rolüne geçersiniz.
              </CardDescription>
            </div>
            <StatusBadge tone="attention">Onay bekliyor</StatusBadge>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-text-muted">
              Talep {formatDateTimeTr(open.expires_at)} tarihine kadar geçerli. Devralacak kişiye uygulama içi bildirim gönderildi.
            </p>
            <CancelTransferButton transferId={open.id} />
          </CardContent>
        </Card>
      ) : isOwner ? (
        candidates.length > 0 ? (
          <RequestTransferForm candidates={candidates} roles={DEMOTE_ROLE_OPTIONS} ttlHours={OWNERSHIP_TRANSFER_TTL_HOURS} />
        ) : (
          <Alert tone="info" title="Devredilecek kimse yok">
            Sahipliği devretmek için önce ekibe aktif bir üye ekleyin (Ekip &gt; Kullanıcılar).
          </Alert>
        )
      ) : (
        <Alert tone="info">
          Sahiplik devrini yalnız ofis sahibi başlatır. Size bir devir talebi gelirse burada ve bildirimlerde görünür.
        </Alert>
      )}

      {transfers.length > 0 ? (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Geçmiş</CardTitle>
              <CardDescription>Taraf olduğunuz son devir talepleri. Her adım ofis denetim kaydına yazılır.</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-line">
              {transfers.map((t) => {
                const s = t.status === "pending" && !isTransferOpen(t, nowMs) ? STATUS_LABEL.expired! : STATUS_LABEL[t.status] ?? STATUS_LABEL.expired!;
                return (
                  <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                    <span className="text-text">
                      {nameOf(t.from_user_id)} → {nameOf(t.to_user_id)}
                      <span className="ml-2 text-xs text-text-faint">{formatDateTimeTr(t.created_at)}</span>
                    </span>
                    <StatusBadge tone={s.tone}>{s.label}</StatusBadge>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
