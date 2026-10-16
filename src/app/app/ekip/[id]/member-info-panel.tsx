"use client";

import { formatDateTimeTr } from "@/lib/format";
import { useActionState, useState } from "react";
import { KeyRound, Mail, Power, Save, Send } from "lucide-react";
import {
  requestMemberEmailChange,
  resendMemberInvite,
  sendMemberPasswordReset,
  updateMemberProfile,
  type MemberAdminResult,
} from "@/app/actions/team-member-admin";
import { updateTeamMember } from "@/app/actions/team";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { EmailInput } from "@/components/ui/email-input";
import { FormField, FormInput } from "@/components/ui/form-controls";
import { PhoneInput } from "@/components/ui/phone-input";
import type { HandoffScope } from "@/lib/team/handoff";
import { DeactivateWithHandoff } from "./member-handoff";

const initial: MemberAdminResult = {};

function ResultAlert({ state }: { state: MemberAdminResult }) {
  if (state.error) return <Alert tone="danger">{state.error}</Alert>;
  if (state.ok && state.message) return <Alert tone="success">{state.message}</Alert>;
  return null;
}

function fmtDate(iso: string | null) {
  if (!iso) return null;
  // Türkiye saatiyle (format.ts): timeZone'suz biçim tarayıcı saat dilimi TR dışındayken SSR ile uyuşmaz (React #418).
  return formatDateTimeTr(iso);
}

/**
 * "Bilgiler" sekmesi (P0-11, P1-B3): üye bilgisi düzenleme, erişim (parola sıfırlama / davet),
 * pasifleştirme. Popup yok; onay satır içidir. Pasife almadan önce açık iş sayımları gösterilir ve
 * "Devret ve pasife al" tek adımda sunulur (G5); devretmeden pasife alma açık onay ister. E-posta yalnız gösterilir (auth kimliği; güvenli
 * değişim akışı yok).
 */
export function MemberInfoPanel({
  memberId,
  fullName,
  phone,
  title,
  isActive,
  email,
  lastSignInAt,
  neverSignedIn,
  advisors,
  editableScopes,
}: {
  memberId: string;
  fullName: string;
  phone: string | null;
  title: string | null;
  isActive: boolean;
  email: string | null;
  lastSignInAt: string | null;
  neverSignedIn: boolean;
  /** Pasife alırken devralan seçimi için ofisin diğer aktif üyeleri. */
  advisors: { id: string; full_name: string }[];
  /** Yöneticinin devredebildiği kapsamlar (modül `edit` izni). */
  editableScopes: HandoffScope[];
}) {
  const [saveState, saveAction, saving] = useActionState(updateMemberProfile, initial);
  const [resetState, resetAction, resetting] = useActionState(sendMemberPasswordReset, initial);
  const [inviteState, inviteAction, inviting] = useActionState(resendMemberInvite, initial);
  const [emailState, emailAction, emailing] = useActionState(requestMemberEmailChange, initial);
  const [askingEmail, setAskingEmail] = useState(false);
  const [activeState, activeAction, toggling] = useActionState(
    async (_p: MemberAdminResult, fd: FormData): Promise<MemberAdminResult> => {
      const r = await updateTeamMember(fd);
      if (r.error) return { error: r.error };
      return { ok: true, message: fd.get("is_active") === "false" ? "Üye pasife alındı." : "Üye aktifleştirildi." };
    },
    initial,
  );
  const [confirmingOff, setConfirmingOff] = useState(false);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="lg:col-span-2">
        <CardHeader>
          <div>
            <CardTitle>Üye bilgileri</CardTitle>
            <CardDescription>Ad, telefon ve unvan düzeltilir; e-posta giriş kimliğidir.</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <form action={saveAction} className="grid gap-4 sm:grid-cols-2">
            <input type="hidden" name="id" value={memberId} />
            <FormField label="Ad soyad" htmlFor="mi-name" required>
              <FormInput id="mi-name" name="full_name" required maxLength={120} defaultValue={fullName} />
            </FormField>
            <FormField label="Telefon" htmlFor="mi-phone" hint="Cep telefonu (05XX XXX XX XX); iki adımlı doğrulama SMS'i bu numaraya gider.">
              <PhoneInput id="mi-phone" name="phone" defaultValue={phone ?? ""} />
            </FormField>
            <FormField label="Unvan" htmlFor="mi-title" className="sm:col-span-2" hint="Kartvizit ve ekip listesinde görünür.">
              <FormInput id="mi-title" name="title" maxLength={80} defaultValue={title ?? ""} placeholder="Gayrimenkul Danışmanı" />
            </FormField>
            <FormField label="E-posta (giriş kimliği)" htmlFor="mi-giris" className="sm:col-span-2" hint="Yönetici e-postayı doğrudan yazamaz; aşağıdaki Erişim kartından üyeden değişikliği istersiniz.">
              <FormInput id="mi-giris" value={email ?? "—"} readOnly disabled />
            </FormField>
            <div className="sm:col-span-2 flex flex-wrap items-center gap-3">
              <Button type="submit" icon={Save} loading={saving}>Kaydet</Button>
              <ResultAlert state={saveState} />
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Erişim</CardTitle>
            <CardDescription>
              {neverSignedIn ? "Üye henüz hiç giriş yapmadı." : `Son giriş: ${fmtDate(lastSignInAt)}`}
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="flex items-center gap-2 text-sm text-text">
            <Mail className="h-4 w-4 text-text-muted" /> {email ?? "E-posta bulunamadı"}
          </p>
          <div className="flex flex-wrap gap-2">
            <form action={resetAction}>
              <input type="hidden" name="id" value={memberId} />
              <Button type="submit" variant="secondary" icon={KeyRound} loading={resetting} disabled={!isActive || !email}>
                Parola sıfırlama bağlantısı gönder
              </Button>
            </form>
            {neverSignedIn ? (
              <form action={inviteAction}>
                <input type="hidden" name="id" value={memberId} />
                <Button type="submit" variant="secondary" icon={Send} loading={inviting} disabled={!isActive || !email}>
                  Daveti yeniden gönder
                </Button>
              </form>
            ) : null}
          </div>
          <ResultAlert state={resetState} />
          <ResultAlert state={inviteState} />
          {askingEmail ? (
            <form action={emailAction} className="space-y-3 rounded-[var(--radius-control)] border border-line p-3">
              <input type="hidden" name="id" value={memberId} />
              <FormField label="Yeni e-posta önerisi" htmlFor="mi-newmail" required hint="Üyeye bildirim gider; değişimi üye parola onayı ve doğrulama bağlantısıyla kendisi tamamlar. Onaylanana kadar eski adres geçerlidir.">
                <EmailInput id="mi-newmail" name="new_email" required />
              </FormField>
              <div className="flex flex-wrap gap-2">
                <Button type="submit" icon={Send} loading={emailing} disabled={!isActive}>Üyeden değişikliği iste</Button>
                <Button type="button" variant="secondary" onClick={() => setAskingEmail(false)}>Vazgeç</Button>
              </div>
            </form>
          ) : (
            <Button type="button" variant="secondary" icon={Mail} onClick={() => setAskingEmail(true)} disabled={!isActive}>
              E-posta değişikliği iste
            </Button>
          )}
          <ResultAlert state={emailState} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Hesap durumu</CardTitle>
            <CardDescription>
              {isActive ? "Üye aktif; giriş yapabilir." : "Üye pasif; giriş yapamaz, kayıtları korunur."}
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {isActive ? (
            confirmingOff ? (
              <DeactivateWithHandoff
                memberId={memberId}
                memberName={fullName}
                advisors={advisors}
                editableScopes={editableScopes}
                onCancel={() => setConfirmingOff(false)}
              />
            ) : (
              <Button type="button" variant="secondary" icon={Power} onClick={() => setConfirmingOff(true)}>
                Pasife al
              </Button>
            )
          ) : (
            <form action={activeAction}>
              <input type="hidden" name="id" value={memberId} />
              <input type="hidden" name="is_active" value="true" />
              <Button type="submit" icon={Power} loading={toggling}>Aktifleştir</Button>
            </form>
          )}
          <ResultAlert state={activeState} />
        </CardContent>
      </Card>
    </div>
  );
}
