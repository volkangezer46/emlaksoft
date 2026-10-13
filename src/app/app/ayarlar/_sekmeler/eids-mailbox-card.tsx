import Link from "@/components/ui/smart-link";
import { KeyRound, MailCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { msSince } from "@/lib/clock";
import { formatDateTimeTr } from "@/lib/format";
import { Alert } from "@/components/ui/alert";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { CopyTextButton } from "@/components/app/copy-text-button";
import { EidsForwardingGuide } from "@/components/eids/forwarding-guide";
import { loadAddressView } from "@/lib/eids/inbound-address";
import { loadMailboxSummary, type InboundListItem } from "@/lib/eids/inbound-read";
import { EIDS_ADDRESS_ROLES, EIDS_INBOX_HREF, MATCH_STATUS_LABELS } from "@/lib/eids/inbound-policy";
import { MAIL_AUTH_LABELS } from "@/lib/eids/mail-auth";
import { EidsAddressActions, EidsConfirmationPoller } from "./eids-mailbox-actions";

const QUIET_DAYS = 90;

const KIND_LABEL: Record<string, string> = {
  grant: "Yetki verildi",
  revoke: "Yetki iptal",
  unknown: "Tanınmayan biçim",
  forward_confirmation: "İletme onayı",
};
const VIA_LABEL: Record<string, string> = { smtp: "iletim", eml_upload: ".eml", paste: "yapıştırma", resend: "iletim" };
const PROVIDER_LABEL: Record<string, string> = { gmail: "Gmail", yandex: "Yandex", outlook: "Outlook" };

function statusBadge(i: InboundListItem): { label: string; variant: BadgeVariant } {
  if (i.auth_result === "rejected") return { label: "Reddedildi", variant: "danger" };
  if (i.parse_kind === "forward_confirmation") return { label: "Onay kodu", variant: "info" };
  if (i.parse_kind === "unknown") return { label: "Okunamadı", variant: "warning" };
  const s = i.match_status;
  if (s === "applied") return { label: "Uygulandı", variant: "success" };
  if (s === "queued" || s === "candidate" || s === "no_match") return { label: "Kuyrukta", variant: "warning" };
  return { label: s ? MATCH_STATUS_LABELS[s] : "Kaydedildi", variant: "neutral" };
}

function rowHref(i: InboundListItem): string {
  if (i.match_status === "applied" && i.property_id) return `/app/portfoyler/${i.property_id}`;
  return EIDS_INBOX_HREF;
}

/**
 * Ayarlar > Entegrasyonlar: "Bakanlık (EİDS) e-postaları" kartı (EP3). Alma adresi + kopyala, adresi yenile
 * (owner/gm), iletme onay kodu (24 saat), son alınan e-posta, son 10 e-postanın durumu ve sağlayıcı sekmeli kurulum
 * (EP5 `EidsForwardingGuide`, adres prop'tan gelir; yenileyince aynı render'da güncellenir). Okuma oturumlu istemciyle
 * (RLS); anahtar mühürü sunucuda çözülür, istemciye yalnız adres gider.
 */
export async function EidsMailboxCard({ canEdit }: { canEdit: boolean }) {
  const { tenantId, role } = await requireModulePage("settings");
  if (!tenantId) return null;
  const supabase = await createClient();
  const [addr, summary] = await Promise.all([loadAddressView(supabase, tenantId), loadMailboxSummary(supabase, tenantId)]);
  const canManage = canEdit && (EIDS_ADDRESS_ROLES as readonly string[]).includes(role);
  const address = addr.state === "active" ? addr.address : null;
  const last = summary.available ? summary.lastReceivedAt : null;
  const connected = Boolean(last ?? (addr.state === "active" ? addr.lastReceivedAt : null));
  const quiet = last ? msSince(last) > QUIET_DAYS * 86_400_000 : false;
  const waitingConfirmation = addr.state === "active" && !connected;

  return (
    <section id="eids-eposta" className="dashboard-panel scroll-mt-24 rounded-[var(--radius-panel)] border border-line bg-surface p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line pb-4">
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-[var(--radius-card)] bg-brand-500/10 text-brand-600">
            <MailCheck className="h-5 w-5" />
          </span>
          <div>
            <h2 className="font-display font-bold text-ink-950">Bakanlık (EİDS) e-postaları</h2>
            <p className="text-xs text-text-muted">eids.yetki@ticaret.gov.tr adresinden gelen yetki verme ve iptal bildirimleri</p>
          </div>
        </div>
        {addr.state === "active" ? (
          <Badge variant={quiet ? "warning" : connected ? "success" : "info"} size="sm">
            {quiet ? `${QUIET_DAYS} gündür e-posta yok` : connected ? "Bağlı" : "İlk e-posta bekleniyor"}
          </Badge>
        ) : null}
      </div>

      <div className="mt-5 space-y-5">
        {addr.state === "schema_pending" ? (
          <Alert tone="info" title="Kurulum bekleniyor">
            Bakanlık e-postası alımı için sistem güncellemesi henüz uygulanmadı. Bu sırada yetkiyi portföy ekranından elle işaretleyebilirsiniz.
          </Alert>
        ) : addr.state === "key_missing" ? (
          <Alert tone="warning" title="Alma adresi şu an üretilemiyor">
            Sunucuda e-posta şifreleme anahtarı tanımlı değil. EmlakSoft ekibine bildirin; bu sırada e-postayı{" "}
            <Link href={EIDS_INBOX_HREF} className="font-semibold underline">
              İlan Kontrol &gt; Yetki
            </Link>{" "}
            ekranından .eml olarak yükleyebilir ya da metnini yapıştırabilirsiniz.
          </Alert>
        ) : (
          <div className="flex flex-wrap items-center gap-3 rounded-[var(--radius-card)] border border-line bg-canvas px-3 py-3">
            <div className="min-w-0 flex-1">
              <p className="text-xs text-text-muted">Ofisinize özel alma adresi</p>
              {address ? (
                <p className="break-all font-mono text-sm font-semibold text-ink-950">{address}</p>
              ) : (
                <p className="text-sm text-text-muted">Henüz oluşturulmadı.</p>
              )}
              {addr.state === "active" ? (
                <p className="mt-1 text-xs text-text-muted">
                  Oluşturuldu: {formatDateTimeTr(addr.createdAt)} · Son alınan e-posta: {last ? formatDateTimeTr(last) : "henüz yok"}
                </p>
              ) : null}
            </div>
            <div className="flex flex-wrap items-start gap-2">
              {address ? <CopyTextButton text={address} label="Kopyala" doneMessage="Adres kopyalandı" /> : null}
              <EidsAddressActions hasAddress={Boolean(address)} canManage={canManage} />
            </div>
          </div>
        )}

        {summary.available && summary.confirmation ? (
          <div className="rounded-[var(--radius-card)] border border-line bg-canvas px-3 py-3">
            <p className="flex items-center gap-1.5 text-sm font-semibold text-ink-950">
              <KeyRound className="h-4 w-4 text-brand-600" aria-hidden />
              {PROVIDER_LABEL[summary.confirmation.provider] ?? "Posta"} iletme onayı
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {summary.confirmation.code ? (
                <>
                  <span className="font-mono text-lg font-bold tracking-wider text-ink-950">{summary.confirmation.code}</span>
                  <CopyTextButton text={summary.confirmation.code} label="Kodu kopyala" doneMessage="Onay kodu kopyalandı" />
                </>
              ) : null}
              {summary.confirmation.url ? (
                <a href={summary.confirmation.url} target="_blank" rel="noopener noreferrer" className="focus-ring rounded text-sm font-semibold text-accent-text underline">
                  Onay bağlantısını aç
                </a>
              ) : null}
            </div>
            <p className="mt-1 text-xs text-text-muted">
              Alındı: {formatDateTimeTr(summary.confirmation.receivedAt)} · Kod 24 saat sonra bu karttan silinir.
            </p>
          </div>
        ) : waitingConfirmation ? (
          <p className="text-xs text-text-muted">
            Gmail iletme adresini ekleyince onay kodu birkaç dakika içinde burada görünür (kart kendiliğinden yenilenir).
          </p>
        ) : null}
        <EidsConfirmationPoller active={waitingConfirmation && !(summary.available && summary.confirmation)} />

        {summary.available && summary.recent.length > 0 ? (
          <div>
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-ink-950">Son e-postalar</h3>
              {summary.pendingCount > 0 ? (
                <Link href={EIDS_INBOX_HREF} className="focus-ring rounded text-xs font-semibold text-accent-text hover:underline">
                  {summary.pendingCount} e-posta kontrol bekliyor →
                </Link>
              ) : null}
            </div>
            <ul className="divide-y divide-line rounded-[var(--radius-card)] border border-line">
              {summary.recent.map((i) => {
                const b = statusBadge(i);
                return (
                  <li key={i.id}>
                    <Link href={rowHref(i)} className="focus-ring flex flex-wrap items-center gap-2 px-3 py-2.5 text-sm hover:bg-surface-hover">
                      <span className="min-w-0 flex-1 truncate">
                        <span className="font-medium text-ink-950">{i.parse_kind ? KIND_LABEL[i.parse_kind] : "Başka gönderici"}</span>
                        {i.eids_property_no ? <span className="ml-1.5 font-mono text-xs text-text-muted">{i.eids_property_no}</span> : null}
                        <span className="ml-1.5 text-xs text-text-muted">
                          {formatDateTimeTr(i.received_at)} · {VIA_LABEL[i.received_via] ?? i.received_via} · {MAIL_AUTH_LABELS[i.auth_result]}
                        </span>
                      </span>
                      <Badge variant={b.variant} size="sm">
                        {b.label}
                      </Badge>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}

        {addr.state === "active" || addr.state === "none" ? (
          <div>
            <h3 className="mb-2 text-sm font-semibold text-ink-950">Posta kutunuzda iletme kuralı kurun</h3>
            <EidsForwardingGuide address={address} showSetupLink={false} />
          </div>
        ) : null}
      </div>
    </section>
  );
}
