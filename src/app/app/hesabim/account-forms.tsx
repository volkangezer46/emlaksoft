"use client";

import { useActionState, useState } from "react";
import { KeyRound, LogOut, Save } from "lucide-react";
import {
  changeMyPassword,
  signOutOtherDevices,
  updateMyProfile,
  type AccountResult,
} from "@/app/actions/account";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FormField, FormInput } from "@/components/ui/form-controls";
import { PhoneInput } from "@/components/ui/phone-input";

const initial: AccountResult = {};

function Result({ state }: { state: AccountResult }) {
  if (state.error) return <Alert tone="danger">{state.error}</Alert>;
  if (state.ok && state.message) return <Alert tone="success">{state.message}</Alert>;
  return null;
}

export function ProfileForm({
  fullName,
  phone,
  title,
  email,
  twoFactorOn,
}: {
  fullName: string;
  phone: string | null;
  title: string | null;
  email: string;
  twoFactorOn: boolean;
}) {
  const [state, action, pending] = useActionState(updateMyProfile, initial);
  return (
    <form action={action} className="grid gap-4 sm:grid-cols-2">
      <FormField label="Ad soyad" htmlFor="hs-name" required>
        <FormInput id="hs-name" name="full_name" required maxLength={120} defaultValue={fullName} autoComplete="name" />
      </FormField>
      <FormField
        label="Cep telefonu"
        htmlFor="hs-phone"
        hint={twoFactorOn ? "İki adımlı doğrulama açık: telefonu değiştirmek için önce Güvenlik sayfasından kapatın." : "İki adımlı doğrulama SMS'i bu numaraya gider."}
      >
        <PhoneInput id="hs-phone" name="phone" defaultValue={phone ?? ""} />
      </FormField>
      <FormField label="Unvan" htmlFor="hs-title" hint="Kartvizit ve ekip listesinde görünür.">
        <FormInput id="hs-title" name="title" maxLength={80} defaultValue={title ?? ""} />
      </FormField>
      <FormField label="E-posta (giriş kimliği)" htmlFor="hs-giris" hint="E-posta değişikliği için destek ile iletişime geçin.">
        <FormInput id="hs-giris" value={email} readOnly disabled />
      </FormField>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <Button type="submit" icon={Save} loading={pending}>Kaydet</Button>
        <Result state={state} />
      </div>
    </form>
  );
}

export function PasswordForm() {
  const [state, action, pending] = useActionState(changeMyPassword, initial);
  return (
    <form action={action} className="grid max-w-xl gap-4">
      <FormField label="Mevcut parola" htmlFor="pw-cur" required>
        <FormInput id="pw-cur" name="current_password" type="password" required autoComplete="current-password" />
      </FormField>
      <FormField label="Yeni parola" htmlFor="pw-new" required hint="En az 8 karakter.">
        <FormInput id="pw-new" name="new_password" type="password" required minLength={8} autoComplete="new-password" />
      </FormField>
      <FormField label="Yeni parola (tekrar)" htmlFor="pw-conf" required>
        <FormInput id="pw-conf" name="confirm_password" type="password" required minLength={8} autoComplete="new-password" />
      </FormField>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" icon={KeyRound} loading={pending}>Parolayı değiştir</Button>
        <Result state={state} />
      </div>
      <p className="text-xs text-text-muted">Parola değişince bu cihaz dışındaki tüm oturumlar kapanır.</p>
    </form>
  );
}

export function OtherDevicesForm() {
  const [state, action, pending] = useActionState(signOutOtherDevices, initial);
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="space-y-3">
      {confirming ? (
        <form action={action} className="flex flex-wrap items-center gap-2 rounded-[var(--radius-control)] border border-danger-500/30 bg-danger-500/5 p-3">
          <p className="w-full text-sm text-text">Bu cihaz dışındaki tüm oturumlar kapatılacak; oralarda yeniden giriş gerekir.</p>
          <Button type="submit" variant="danger" icon={LogOut} loading={pending}>Evet, diğer cihazlardan çık</Button>
          <Button type="button" variant="secondary" onClick={() => setConfirming(false)}>Vazgeç</Button>
        </form>
      ) : (
        <Button type="button" variant="secondary" icon={LogOut} onClick={() => setConfirming(true)}>
          Diğer cihazlardan çık
        </Button>
      )}
      <Result state={state} />
    </div>
  );
}
