"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Store } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { FormField, FormInput } from "@/components/ui/form-controls";
import { formatDateTimeTr } from "@/lib/format";
import { MEMBERSHIP_STATUS_LABEL, MEMBERSHIP_STATUSES, type CurrentPortal, type MembershipStatus } from "@/lib/portals/catalog";
import { savePortalMemberships } from "@/app/actions/portal-memberships";

/**
 * "Portal üyelikleri" kartı (Ayarlar > Entegrasyonlar ve Kurulum > Vitrin ve portallar). Her portal için: üyelik
 * (var / yok / bilmiyorum), mağaza veya hesap adı, mağaza bağlantısı, otomatik kontrol açık/kapalı, abonelik bitişi.
 * Beyan yoksa öneriler (canlı ilan, portal gideri, portal kaynaklı talep) İŞARETLİ gelir ama KAYDEDİLMEZ: sahip/genel müdür
 * "Onayla ve kaydet" deyince yazılır. Düzenleme yalnız owner/gm; diğer roller salt okur.
 */

export type PortalMembershipCardItem = {
  portal: CurrentPortal;
  label: string;
  /** Formun başlangıç seçimi (beyan varsa beyan, yoksa öneri). */
  status: MembershipStatus;
  declared: boolean;
  /** Öneri işaretli geldi mi (beyan yok, kanıt var). */
  suggested: boolean;
  evidence: { liveListings: number; expenses: number; leads: number } | null;
  checkEnabled: boolean;
  accountLabel: string;
  storeUrl: string;
  planEndsAt: string;
  lastLoginOkAt: string | null;
  lastLoginFailAt: string | null;
  loginFailStreak: number;
};

function evidenceText(e: PortalMembershipCardItem["evidence"]): string | null {
  if (!e) return null;
  const parts: string[] = [];
  if (e.liveListings > 0) parts.push(`${e.liveListings} canlı ilan`);
  if (e.expenses > 0) parts.push(`${e.expenses} portal gideri`);
  if (e.leads > 0) parts.push(`${e.leads} portal kaynaklı talep`);
  return parts.length > 0 ? parts.join(", ") : null;
}

export function PortalMembershipsCard({
  items,
  canEdit,
  available,
  awaitingConfirmation,
  question = false,
}: {
  items: PortalMembershipCardItem[];
  canEdit: boolean;
  /** Tablo var mı (migration uygulandı mı). */
  available: boolean;
  /** Hiçbir portal için beyan yok: öneriler sahibin onayını bekliyor. */
  awaitingConfirmation: boolean;
  /** Kurulum adımı görünümü ("Hangi portallarda ilan veriyorsunuz?"). */
  question?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [rows, setRows] = useState(items);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const update = (portal: CurrentPortal, patch: Partial<PortalMembershipCardItem>) => {
    setSaved(false);
    setRows((list) => list.map((r) => (r.portal === portal ? { ...r, ...patch } : r)));
  };

  function save() {
    setError(null);
    setSaved(false);
    start(async () => {
      const res = await savePortalMemberships(
        rows.map((r) => ({
          portal: r.portal,
          status: r.status,
          checkEnabled: r.checkEnabled,
          accountLabel: r.accountLabel,
          storeUrl: r.storeUrl,
          planEndsAt: r.planEndsAt,
        })),
      );
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSaved(true);
      router.refresh();
    });
  }

  const disabled = !canEdit || !available || pending;

  return (
    <div className="space-y-4">
      {question ? <p className="text-sm font-semibold text-ink-950">Hangi portallarda ilan veriyorsunuz?</p> : null}
      {!available ? (
        <Alert tone="info">Portal üyelikleri için sistem güncellemesi bekleniyor. Şimdilik portallar ofisteki canlı ilan ve gider kayıtlarına göre tahmin ediliyor.</Alert>
      ) : awaitingConfirmation && canEdit ? (
        <Alert tone="warning" title="Önerileri onaylayın">
          İşaretli seçimler ofisteki canlı ilan, portal gideri ve talep kayıtlarından önerildi; henüz kaydedilmedi. Kontrol edip
          “Onayla ve kaydet”e basın. Üye olmadığınız portala eklenti hiç istek atmaz.
        </Alert>
      ) : null}
      {!canEdit ? <p className="text-xs text-text-muted">Portal üyeliklerini ofis sahibi ya da genel müdür düzenler.</p> : null}

      <ul className="divide-y divide-line rounded-[var(--radius-card)] border border-line">
        {rows.map((r) => {
          const ev = evidenceText(r.evidence);
          const groupName = `portal-uyelik-${r.portal}`;
          return (
            <li key={r.portal} className="space-y-3 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="flex items-center gap-2 text-sm font-semibold text-ink-950">
                  <Store className="h-4 w-4 text-brand-600" aria-hidden /> {r.label}
                  {r.suggested && !r.declared ? <Badge variant="info" size="sm">Öneri</Badge> : null}
                  {r.declared ? <Badge variant="neutral" size="sm">Kayıtlı</Badge> : null}
                </p>
                {ev ? <p className="text-xs text-text-muted">Kanıt: {ev}</p> : null}
              </div>

              <fieldset disabled={disabled}>
                <legend className="sr-only">{r.label} üyeliği</legend>
                <div className="flex flex-wrap gap-2">
                  {MEMBERSHIP_STATUSES.map((s) => (
                    <label
                      key={s}
                      className={`inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-[var(--radius-control)] border px-3 text-sm ${
                        r.status === s ? "border-brand-400 bg-brand-600/8 font-semibold text-ink-950" : "border-line text-text-muted"
                      }`}
                    >
                      <input type="radio" name={groupName} value={s} checked={r.status === s} onChange={() => update(r.portal, { status: s })} />
                      {MEMBERSHIP_STATUS_LABEL[s]}
                    </label>
                  ))}
                </div>
              </fieldset>

              {r.status === "active" ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <FormField label="Mağaza / hesap adı" htmlFor={`${groupName}-ad`} hint="İsteğe bağlı">
                    <FormInput
                      value={r.accountLabel}
                      maxLength={120}
                      disabled={disabled}
                      onChange={(e) => update(r.portal, { accountLabel: e.target.value })}
                      autoComplete="off"
                    />
                  </FormField>
                  <FormField label="Mağaza bağlantısı" htmlFor={`${groupName}-url`} hint="https:// ile başlayan mağaza sayfası">
                    <FormInput
                      type="url"
                      value={r.storeUrl}
                      maxLength={500}
                      disabled={disabled}
                      placeholder="https://"
                      onChange={(e) => update(r.portal, { storeUrl: e.target.value })}
                    />
                  </FormField>
                  <FormField label="Abonelik bitişi" htmlFor={`${groupName}-bitis`} hint="İsteğe bağlı">
                    <FormInput type="date" value={r.planEndsAt} disabled={disabled} onChange={(e) => update(r.portal, { planEndsAt: e.target.value })} />
                  </FormField>
                  <label className="flex min-h-11 items-center gap-2 self-end text-sm text-ink-950">
                    <Checkbox checked={r.checkEnabled} disabled={disabled} onChange={(e) => update(r.portal, { checkEnabled: e.target.checked })} />
                    Otomatik kontrol açık (eklenti bu portalda ilanlarımı kontrol etsin)
                  </label>
                </div>
              ) : r.status === "none" ? (
                <p className="text-xs text-text-muted">Eklenti bu portala istek atmaz; aktarım ve eksik portal listelerinde önerilmez.</p>
              ) : (
                <p className="text-xs text-text-muted">Bilinmiyor: kanıt varsa geçici olarak üye sayılır, yoksa eklenti bu portala istek atmaz.</p>
              )}

              {r.lastLoginFailAt && r.loginFailStreak > 0 ? (
                <p className="text-xs text-text-muted">
                  Eklenti son {r.loginFailStreak} denemede mağaza sayfanızı açamadı (portal giriş istedi; son: {formatDateTimeTr(r.lastLoginFailAt)}).
                </p>
              ) : r.lastLoginOkAt ? (
                <p className="text-xs text-text-muted">Eklentinin son başarılı mağaza okuması: {formatDateTimeTr(r.lastLoginOkAt)}</p>
              ) : null}
            </li>
          );
        })}
      </ul>

      {error ? <Alert tone="danger">{error}</Alert> : null}
      {saved ? (
        <p role="status" className="flex items-center gap-1.5 text-sm text-mint-600">
          <CheckCircle2 className="h-4 w-4" aria-hidden /> Portal üyelikleri kaydedildi.
        </p>
      ) : null}
      {canEdit && available ? (
        <Button type="button" onClick={save} loading={pending} icon={CheckCircle2}>
          {awaitingConfirmation ? "Onayla ve kaydet" : "Kaydet"}
        </Button>
      ) : null}
    </div>
  );
}
