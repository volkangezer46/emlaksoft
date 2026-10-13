"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Save, ShieldOff, Undo2, Unlock } from "lucide-react";
import Link from "@/components/ui/smart-link";
import { Button } from "@/components/ui/button";
import { FormError, FormField, FormInput, FormSelect, FormTextarea } from "@/components/ui/form-controls";
import { useToast } from "@/components/app/toast-provider";
import {
  overrideAuthorityBlock,
  setAuthorityExemption,
  setPropertyAuthority,
  undoAuthorityChange,
  type AuthorityActionResult,
} from "@/app/actions/authority-queue";
import {
  EIDS_EXEMPT_LABELS,
  EIDS_EXEMPT_REASONS,
  EIDS_EXEMPT_RISK,
  EIDS_MANUAL_SOURCES,
  EIDS_MANUAL_STATUSES,
  EIDS_SOURCE_LABELS,
  EIDS_STATUS_LABELS,
  type EidsExemptReason,
  type EidsVerifyStatus,
} from "@/lib/eids/authority-status";
import { MIN_AUTHORITY_MONTHS } from "@/lib/eids/authority-term";

/**
 * "Yetki durumu" kartının istemci kısmı: elle giriş (durum, veriliş/bitiş tarihi, kaynak, e-Devlet ekran görüntüsü,
 * "Portalda doğrulandı"), istisna bayrakları (yanıltıcı beyan uyarısı + onay), son işlemi geri alma ve yalnız ofis
 * sahibi için gerekçeli yayın izni. Doğrulama sunucudadır; hatalar "ne oldu, ne yapmalı" biçiminde gösterilir.
 */
export function EidsAuthorityForm({
  propertyId,
  canEdit,
  isOwner,
  showOverride,
  initial,
  documents,
  undo,
}: {
  propertyId: string;
  canEdit: boolean;
  isOwner: boolean;
  showOverride: boolean;
  initial: { status: EidsVerifyStatus; source: string; validUntil: string; grantedOn: string; exempt: EidsExemptReason | null };
  documents: { id: string; label: string }[];
  undo: { id: string; label: string } | null;
}) {
  const router = useRouter();
  const { push } = useToast();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [status, setStatus] = useState<EidsVerifyStatus>(initial.status);
  const [source, setSource] = useState(initial.source);
  const [exempt, setExempt] = useState<string>(initial.exempt ?? "");
  const [ack, setAck] = useState(false);

  if (!canEdit) return <p className="mt-3 text-xs text-text-muted">Yetki durumunu değiştirmek için İlan Kontrol düzenleme izni gerekir.</p>;

  const run = (fn: () => Promise<AuthorityActionResult>, after?: () => void) => {
    setError(null);
    start(async () => {
      const r = await fn();
      if (r.error) {
        setError(r.error);
        return;
      }
      if (r.info) push(r.info, "ok");
      after?.();
      router.refresh();
    });
  };

  return (
    <div className="mt-4 space-y-3">
      <div className="flex flex-wrap gap-1.5">
        <Button size="sm" variant={editing ? "secondary" : "primary"} icon={Save} onClick={() => setEditing((v) => !v)} disabled={pending}>
          {editing ? "Vazgeç" : "Durumu güncelle"}
        </Button>
        {undo ? (
          <Button size="sm" variant="ghost" icon={Undo2} disabled={pending} title={`Geri al: ${undo.label}`} onClick={() => run(() => undoAuthorityChange(propertyId, undo.id))}>
            Son işlemi geri al
          </Button>
        ) : null}
      </div>

      {editing ? (
        <form
          className="grid gap-3 rounded-[var(--radius-card)] border border-line bg-canvas/50 p-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            run(
              () =>
                setPropertyAuthority(propertyId, {
                  status,
                  source,
                  validUntil: String(fd.get("valid_until") ?? ""),
                  grantedOn: String(fd.get("granted_on") ?? ""),
                  portalVerified: fd.get("portal_verified") === "1",
                  evidenceMediaId: String(fd.get("evidence_media_id") ?? ""),
                  note: String(fd.get("note") ?? ""),
                }),
              () => setEditing(false),
            );
          }}
        >
          <FormField label="Durum" htmlFor="ea-status" required>
            <FormSelect id="ea-status" value={status} onChange={(e) => setStatus(e.target.value as EidsVerifyStatus)}>
              {EIDS_MANUAL_STATUSES.map((s) => (
                <option key={s} value={s}>{EIDS_STATUS_LABELS[s]}</option>
              ))}
            </FormSelect>
          </FormField>
          <FormField label="Kaynak" htmlFor="ea-source" required>
            <FormSelect id="ea-source" value={source} onChange={(e) => setSource(e.target.value)}>
              {EIDS_MANUAL_SOURCES.map((s) => (
                <option key={s} value={s}>{EIDS_SOURCE_LABELS[s]}</option>
              ))}
            </FormSelect>
          </FormField>
          {status === "approved" ? (
            <>
              <FormField label="Yetki veriliş tarihi" htmlFor="ea-granted" hint="Portföyün yetki başlangıcına yazılır. Boşsa kayıtlı başlangıç, o da yoksa bugün sayılır.">
                <FormInput id="ea-granted" name="granted_on" type="date" defaultValue={initial.grantedOn} />
              </FormField>
              <FormField label="Yetki bitiş tarihi" htmlFor="ea-until" required hint={`EİDS yetkisi en az ${MIN_AUTHORITY_MONTHS} ay olmalıdır.`}>
                <FormInput id="ea-until" name="valid_until" type="date" defaultValue={initial.validUntil} />
              </FormField>
            </>
          ) : null}
          <FormField
            label="e-Devlet ekran görüntüsü"
            htmlFor="ea-evidence"
            required={source === "document"}
            hint={
              documents.length === 0 ? (
                <>
                  Belge yok: <Link href={`/app/portfoyler/${propertyId}?sekme=medya`} className="font-semibold text-accent-text underline underline-offset-2">Medya sekmesinden</Link> yükleyip “belge” olarak işaretleyin.
                </>
              ) : (
                "Medya sekmesinde belge olarak işaretli dosyalar."
              )
            }
          >
            <FormSelect id="ea-evidence" name="evidence_media_id" defaultValue="">
              <option value="">Seçilmedi</option>
              {documents.map((d) => (
                <option key={d.id} value={d.id}>{d.label}</option>
              ))}
            </FormSelect>
          </FormField>
          <FormField label="Not" htmlFor="ea-note">
            <FormInput id="ea-note" name="note" maxLength={500} autoComplete="off" placeholder="İsteğe bağlı" />
          </FormField>
          <label className="flex items-start gap-2 text-sm sm:col-span-2">
            <input type="checkbox" name="portal_verified" value="1" className="mt-1 h-4 w-4" />
            <span>Portalda doğrulandı (ilan portalın EİDS kontrolünden geçti)</span>
          </label>
          <div className="sm:col-span-2">
            <Button type="submit" size="sm" loading={pending}>Kaydet</Button>
          </div>
        </form>
      ) : null}

      <div className="rounded-[var(--radius-card)] border border-line p-3">
        <FormField label="EİDS istisnası" htmlFor="ea-exempt" hint="İşaretli portföy EİDS kontrolünden (onay/iptal/bilinmiyor kuyrukları) çıkar.">
          <FormSelect
            id="ea-exempt"
            value={exempt}
            onChange={(e) => {
              setExempt(e.target.value);
              setAck(false);
            }}
          >
            <option value="">İstisna yok</option>
            {EIDS_EXEMPT_REASONS.map((r) => (
              <option key={r} value={r}>{EIDS_EXEMPT_LABELS[r]}</option>
            ))}
          </FormSelect>
        </FormField>
        {exempt ? (
          <div className="mt-2 rounded-[var(--radius-control)] bg-amber-500/10 px-3 py-2 text-xs text-ink-950">
            <p className="flex items-start gap-1.5">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {EIDS_EXEMPT_RISK}
            </p>
            <label className="mt-2 flex items-start gap-2">
              <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5 h-4 w-4" />
              <span>Uyarıyı okudum; bu portföy gerçekten EİDS onayı alınamayan bir taşınmaz.</span>
            </label>
          </div>
        ) : null}
        {exempt !== (initial.exempt ?? "") ? (
          <Button
            size="sm"
            variant="secondary"
            icon={ShieldOff}
            className="mt-2"
            disabled={pending || (Boolean(exempt) && !ack)}
            onClick={() => run(() => setAuthorityExemption(propertyId, exempt || null, ack))}
          >
            {exempt ? "İstisnayı kaydet" : "İstisnayı kaldır"}
          </Button>
        ) : null}
      </div>

      {showOverride && isOwner ? (
        <form
          className="space-y-2 rounded-[var(--radius-card)] border border-line p-3"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            run(() => overrideAuthorityBlock(propertyId, String(fd.get("reason") ?? "")));
          }}
        >
          <FormField label="Yayın engelini aş (yalnız ofis sahibi)" htmlFor="ea-override" required hint="Gerekçe yetki defterine yazılır; izin 24 saat geçerlidir.">
            <FormTextarea id="ea-override" name="reason" rows={2} maxLength={500} placeholder="Örn. Malik yeni yetkiyi e-Devlet'te verdi, e-posta henüz gelmedi." />
          </FormField>
          <Button type="submit" size="sm" variant="danger" icon={Unlock} loading={pending}>
            Gerekçeyle izin ver
          </Button>
        </form>
      ) : null}

      <FormError error={error} nextStep={null} />
    </div>
  );
}
