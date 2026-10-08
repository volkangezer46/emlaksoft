"use client";

import { Button } from "@/components/ui/button";
import { useState, useTransition } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Loader2, Save, ShieldAlert } from "lucide-react";
import { changeOwnPassword, updateOwnProfile } from "@/app/actions/platform-account";
import { EmailInput } from "@/components/ui/email-input";
import { FormField, FormInput } from "@/components/ui/form-controls";
import { passwordStrength } from "../personel/staff-model";

type Notice = { tone: "ok" | "error"; text: string } | null;

const btn =
  "focus-ring press inline-flex items-center gap-1.5 rounded-[var(--radius-control)] px-4 py-2 text-xs font-semibold transition disabled:opacity-60";

function NoticeLine({ notice }: { notice: Notice }) {
  if (!notice) return null;
  return (
    <p
      role={notice.tone === "error" ? "alert" : "status"}
      className={`rounded-[var(--radius-control)] px-3 py-2 text-sm font-medium ${
        notice.tone === "error" ? "bg-danger-500/8 text-danger-600" : "bg-mint-500/10 text-mint-700"
      }`}
    >
      {notice.text}
    </p>
  );
}

/** Profil: ad soyad düzenlenir; e-posta ve rol yalnız gösterilir (süper admin değiştirir). */
export function OwnProfileForm({ fullName, email, roleLabel }: { fullName: string; email: string; roleLabel: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [notice, setNotice] = useState<Notice>(null);

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setNotice(null);
    start(async () => {
      const res = await updateOwnProfile(fd);
      if (res.error) setNotice({ tone: "error", text: res.error });
      else {
        setNotice({ tone: "ok", text: "Profil kaydedildi." });
        router.refresh();
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 rounded-[var(--radius-panel)] border border-line bg-surface p-5">
      <div>
        <h2 className="font-display font-bold text-ink-950">Profil</h2>
        <p className="text-xs text-text-muted">Rolünüz: <strong className="text-ink-950">{roleLabel}</strong></p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Ad soyad" htmlFor="own_full_name" required>
          <FormInput id="own_full_name" name="full_name" defaultValue={fullName} required minLength={2} maxLength={120} autoComplete="name" />
        </FormField>
        <FormField label="E-posta" htmlFor="own_email" hint="Giriş e-postanızı süper admin değiştirir.">
          <EmailInput id="own_email" defaultValue={email} readOnly aria-readonly />
        </FormField>
      </div>
      <NoticeLine notice={notice} />
      <button type="submit" disabled={pending} className={`${btn} bg-ink-950 text-white`}>
        {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Kaydet
      </button>
    </form>
  );
}

/** Parola değiştirme (hesabım sekmesi ve zorunlu değişim ekranı ortak kullanır). */
export function OwnPasswordForm({ forced = false }: { forced?: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [notice, setNotice] = useState<Notice>(null);
  const [next, setNext] = useState("");
  const [show, setShow] = useState(false);
  const strength = passwordStrength(next);

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    setNotice(null);
    start(async () => {
      const res = await changeOwnPassword(fd);
      if (res.error) {
        setNotice({ tone: "error", text: res.error });
        return;
      }
      form.reset();
      setNext("");
      setNotice({ tone: "ok", text: "Parolanız değiştirildi." });
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 rounded-[var(--radius-panel)] border border-line bg-surface p-5">
      <div>
        <h2 className="font-display font-bold text-ink-950">Parolayı değiştir</h2>
        <p className="text-xs text-text-muted">
          {forced
            ? "Hesabınız geçici parolayla açıldı. Devam etmeden önce kendi parolanızı belirleyin."
            : "En az 10 karakter. Mevcut parolanız doğrulanır."}
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label={forced ? "Geçici parola" : "Mevcut parola"} htmlFor="current_password" required className="sm:col-span-2">
          <FormInput id="current_password" name="current_password" type="password" autoComplete="current-password" required maxLength={72} />
        </FormField>
        <FormField label="Yeni parola" htmlFor="new_password" required>
          <div className="flex gap-2">
            <FormInput
              id="new_password"
              name="new_password"
              type={show ? "text" : "password"}
              autoComplete="new-password"
              required
              minLength={10}
              maxLength={72}
              value={next}
              onChange={(e) => setNext(e.target.value)}
            />
            <Button
              variant="outline"
              size="icon"
              type="button"
              onClick={() => setShow((v) => !v)}
              aria-label={show ? "Parolayı gizle" : "Parolayı göster"}
              aria-pressed={show}
              className="shrink-0"
            >
              {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </Button>
          </div>
        </FormField>
        <FormField label="Yeni parola (tekrar)" htmlFor="confirm_password" required>
          <FormInput id="confirm_password" name="confirm_password" type={show ? "text" : "password"} autoComplete="new-password" required minLength={10} maxLength={72} />
        </FormField>
      </div>
      {next ? <p className="text-xs font-semibold text-text-muted" role="status" aria-live="polite">Parola gücü: {strength.label}</p> : null}
      <NoticeLine notice={notice} />
      <button type="submit" disabled={pending} className={`${btn} bg-ink-950 text-white`}>
        {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldAlert className="h-3.5 w-3.5" />} Parolayı değiştir
      </button>
    </form>
  );
}
