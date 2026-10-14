import Link from "@/components/ui/smart-link";
import { MailCheck } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { formatDateTimeTr, formatDateTr } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { ControlUnavailable } from "@/components/listing-control/ui-parts";
import { loadReviewQueue } from "@/lib/eids/inbound-read";
import { EIDS_REVIEW_ROLES, MATCH_STATUS_LABELS } from "@/lib/eids/inbound-policy";
import { MAIL_AUTH_LABELS, isVerifiedAuth } from "@/lib/eids/mail-auth";
import { EidsMailDialog } from "./eids-mail-dialog";
import { EidsReviewActions } from "./eids-review-actions";

const VIA_LABEL: Record<string, string> = { smtp: "İletim", eml_upload: ".eml yükleme", paste: "Yapıştırma", resend: "İletim" };
const DEAL_LABEL: Record<string, string> = { sale: "satış", rent: "kiralama" };
const TX_LABEL = (t: string | null) => (t ? ` · ${t}` : "");

/**
 * İlan Kontrol > Yetki > "Bakanlık e-postaları" sekmesi (EP3): "Bakanlık e-postası ekle" diyaloğu + kontrol bekliyor
 * kuyruğu (doğrulanamayan, yapıştırılan, belirsiz ya da eşleşmeyen yetki e-postaları). Onay owner/gm/branch_manager.
 * Okuma oturumlu istemciyle (RLS). Kılavuz bağlantısı: Ayarlar > Entegrasyonlar kartı.
 */
export async function EidsInboxSection({ tenantId, role, canEdit }: { tenantId: string | null | undefined; role: string; canEdit: boolean }) {
  if (!tenantId) return <ControlUnavailable />;
  const supabase = await createClient();
  const res = await loadReviewQueue(supabase, tenantId);
  const canReview = canEdit && (EIDS_REVIEW_ROLES as readonly string[]).includes(role);

  const head = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-text-muted">
        Alma adresi ve iletme kurulumu:{" "}
        <Link href="/app/ayarlar?sekme=entegrasyon#eids-eposta" className="focus-ring rounded font-semibold text-accent-text hover:underline">
          Ayarlar &gt; Entegrasyonlar
        </Link>
      </p>
      <EidsMailDialog canEdit={canEdit} />
    </div>
  );

  if (!res.available) {
    return (
      <div className="space-y-3">
        {head}
        <EmptyState
          icon={MailCheck}
          variant="panel"
          title="Bakanlık e-postası alımı kurulum bekliyor"
          description="Sistem güncellemesi uygulanınca doğrulanamayan ya da eşleşmeyen e-postalar burada onay bekler. Bu sırada yetkiyi portföyden elle işaretleyin."
        />
      </div>
    );
  }
  if (res.items.length === 0) {
    return (
      <div className="space-y-3">
        {head}
        <EmptyState
          icon={MailCheck}
          variant="panel"
          title="Kontrol bekleyen e-posta yok"
          description="Doğrulanan ve tek portföyle eşleşen e-postalar kendiliğinden uygulanır; kalanlar onay için burada listelenir."
        />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {head}
      <p className="text-sm text-text-muted">{res.total} e-posta kontrol bekliyor</p>
      <ul className="space-y-2.5">
        {res.items.map((i) => (
          <li key={i.id} className="rounded-[var(--radius-card)] border border-line bg-surface p-4 shadow-[var(--shadow-xs)]">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div className="min-w-0 space-y-1.5">
                <p className="font-semibold text-ink-950">
                  {i.parse_kind === "grant" ? "Yetki verildi" : "Yetki iptal edildi"}
                  <span className="ml-1.5 font-mono text-xs text-text-muted">Taşınmaz no {i.eids_property_no}</span>
                </p>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge variant={isVerifiedAuth(i.auth_result) ? "success" : "warning"} size="sm">
                    {MAIL_AUTH_LABELS[i.auth_result]}
                  </Badge>
                  {i.match_status ? (
                    <Badge variant="outline" size="sm">
                      {MATCH_STATUS_LABELS[i.match_status]}
                    </Badge>
                  ) : null}
                  <Badge variant="outline" size="sm">
                    {VIA_LABEL[i.received_via] ?? i.received_via}
                  </Badge>
                </div>
                <p className="text-sm text-text-muted">
                  {i.deal_kind ? `${DEAL_LABEL[i.deal_kind]} yetkisi` : "yetki"} · malik {i.grantor_masked ?? "-"}
                  {i.valid_until ? ` · bitiş ${formatDateTr(i.valid_until)}` : ""}
                </p>
                <p className="text-xs text-text-muted">Alındı: {formatDateTimeTr(i.received_at)}</p>
              </div>
              <EidsReviewActions
                messageId={i.id}
                canReview={canReview}
                options={i.options.map((o) => ({ id: o.id, label: `${o.code ?? "-"} ${o.title ?? "Portföy"}${TX_LABEL(o.transaction_type)}`.trim() }))}
              />
            </div>
          </li>
        ))}
      </ul>
      {res.total > res.items.length ? <p className="text-xs text-text-muted">İlk {res.items.length} kayıt gösteriliyor; onayladıkça sıradakiler gelir.</p> : null}
    </div>
  );
}
