"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { KeyRound, Mail, Power, Save, Send } from "lucide-react";
import {
  resendMemberInvite,
  sendMemberPasswordReset,
  updateMemberProfile,
  type MemberAdminResult,
} from "@/app/actions/team-member-admin";
import { updateTeamMember } from "@/app/actions/team";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { FormField, FormInput } from "@/components/ui/form-controls";
import { PhoneInput } from "@/components/ui/phone-input";

const initial: MemberAdminResult = {};

function ResultAlert({ state }: { state: MemberAdminResult }) {
  if (state.error) return <Alert tone="danger">{state.error}</Alert>;
  if (state.ok && state.message) return <Alert tone="success">{state.message}</Alert>;
  return null;
}

function fmtDate(iso: string | null) {
  if (!iso) return null;
  return new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
}

/**
 * "Bilgiler" sekmesi (P0-11, P1-B3): üye bilgisi düzenleme, erişim (parola sıfırlama / davet),
 * pasifleştirme. Popup yok; onay satır içidir. E-posta yalnız gösterilir (auth kimliği; güvenli
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
}: {
  memberId: string;
  fullName: string;
  phone: string | null;
  title: string | null;
  isActive: boolean;
  email: string | null;
  lastSignInAt: string | null;
  neverSignedIn: boolean;
}) {
  const [saveState, saveAction, saving] = useActionState(updateMemberProfile, initial);
  const [resetState, resetAction, resetting] = useActionState(sendMemberPasswordReset, initial);
  const [inviteState, inviteAction, inviting] = useActionState(resendMemberInvite, initial);
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
            <FormField label="E-posta (giriş kimliği)" htmlFor="mi-giris" className="sm:col-span-2" hint="E-posta değişikliği için güvenli doğrulama akışı henüz yok; değişiklik gerekirse destek ile iletişime geçin.">
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
              <div className="space-y-3 rounded-[var(--radius-control)] border border-danger-500/30 bg-danger-500/5 p-3">
                <p className="text-sm text-text">
                  Üye pasife alınırsa oturumları kapanır ve giriş yapamaz. Müşteri, portföy ve görevleri üyede kalır;
                  önce <Link href={`/app/ekip/devir?from=${memberId}`} className="font-semibold text-brand-600 underline">iş yükünü devretmeniz</Link> önerilir.
                </p>
                <form action={activeAction} className="flex flex-wrap gap-2">
                  <input type="hidden" name="id" value={memberId} />
                  <input type="hidden" name="is_active" value="false" />
                  <Button type="submit" variant="danger" icon={Power} loading={toggling}>Evet, pasife al</Button>
                  <Button type="button" variant="secondary" onClick={() => setConfirmingOff(false)}>Vazgeç</Button>
                </form>
              </div>
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
