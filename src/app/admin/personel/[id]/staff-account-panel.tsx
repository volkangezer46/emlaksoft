"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useState, useTransition } from "react";
import type { FormEvent } from "react";
import { Check, Copy, Eye, EyeOff, KeyRound, Loader2, LogOut, RefreshCw, Save } from "lucide-react";
import {
  generateStaffResetLink,
  resetStaffPassword,
  signOutStaffSessions,
  updateStaffProfile,
} from "@/app/actions/platform-staff";
import { EmailInput } from "@/components/ui/email-input";
import { FormField, FormInput } from "@/components/ui/form-controls";
import { generatePassword } from "../staff-model";

type Notice = { tone: "ok" | "error"; text: string } | null;

function secureRandomInt(max: number): number {
  const buf = new Uint32Array(1);
  const limit = Math.floor(0x100000000 / max) * max;
  do {
    crypto.getRandomValues(buf);
  } while (buf[0] >= limit);
  return buf[0] % max;
}

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

/**
 * Personel hesabı (yalnız süper admin görür): ad/e-posta düzenle, sıfırlama bağlantısı, geçici parola.
 * Popup yok: onaylar satır içidir. Geçici parola yalnız bellekte tutulur; kayda yazılmaz.
 */
export function StaffAccountPanel({
  id,
  fullName,
  email,
  mustChangePassword,
  onChanged,
}: {
  id: string;
  fullName: string;
  email: string;
  mustChangePassword: boolean;
  onChanged: () => Promise<void> | void;
}) {
  const [pending, start] = useTransition();
  const [notice, setNotice] = useState<Notice>(null);
  const [link, setLink] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<"link" | "pw" | null>(null);
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [confirmPw, setConfirmPw] = useState(false);
  const [confirmSignOut, setConfirmSignOut] = useState(false);

  function onProfile(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    fd.set("id", id);
    setNotice(null);
    start(async () => {
      const res = await updateStaffProfile(fd);
      if (res.error) setNotice({ tone: "error", text: res.error });
      else {
        setNotice({ tone: "ok", text: "Personel bilgileri kaydedildi." });
        await onChanged();
      }
    });
  }

  function makeLink() {
    const fd = new FormData();
    fd.set("id", id);
    setNotice(null);
    start(async () => {
      const res = await generateStaffResetLink(fd);
      if (res.error || !res.link) setNotice({ tone: "error", text: res.error ?? "Bağlantı üretilemedi." });
      else {
        setLink(res.link);
        setNotice({ tone: "ok", text: "Sıfırlama bağlantısı üretildi." });
      }
    });
  }

  function applyPassword() {
    const fd = new FormData();
    fd.set("id", id);
    fd.set("temp_password", password);
    setNotice(null);
    setConfirmPw(false);
    start(async () => {
      const res = await resetStaffPassword(fd);
      if (res.error) setNotice({ tone: "error", text: res.error });
      else {
        setNotice({ tone: "ok", text: "Geçici parola atandı. Personel ilk girişte parolasını değiştirmek zorundadır." });
        await onChanged();
      }
    });
  }

  function signOutAll() {
    const fd = new FormData();
    fd.set("id", id);
    setNotice(null);
    setConfirmSignOut(false);
    start(async () => {
      const res = await signOutStaffSessions(fd);
      if (res.error) setNotice({ tone: "error", text: res.error });
      else setNotice({ tone: "ok", text: "Personelin açık oturumları kapatıldı." });
    });
  }

  async function copy(text: string, key: "link" | "pw") {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey(null), 1500);
    } catch {
      /* pano erişimi yoksa kullanıcı alanı elle kopyalar */
    }
  }

  return (
    <section className="space-y-5 rounded-[var(--radius-panel)] border border-line bg-surface p-5">
      <div>
        <h2 className="font-display font-bold text-ink-950">Hesap ve güvenlik</h2>
        <p className="text-xs text-text-muted">
          Zorunlu parola değişimi:{" "}
          <strong className={mustChangePassword ? "text-amber-700" : "text-ink-950"}>
            {mustChangePassword ? "bekliyor (ilk girişte parola değiştirecek)" : "yok"}
          </strong>
        </p>
      </div>
      <NoticeLine notice={notice} />

      <form onSubmit={onProfile} className="space-y-3">
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Ad soyad" htmlFor="staff_full_name" required>
            <FormInput id="staff_full_name" name="full_name" defaultValue={fullName} required minLength={2} maxLength={120} autoComplete="off" />
          </FormField>
          <FormField label="Giriş e-postası" htmlFor="staff_email" required hint="Değişirse personel yeni e-postayla girer.">
            <EmailInput id="staff_email" name="email" defaultValue={email} required />
          </FormField>
        </div>
        <Button type="submit" disabled={pending} variant="navy" size="sm">
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Bilgileri kaydet
        </Button>
      </form>

      <div className="space-y-3 border-t border-line pt-4">
        <p className="text-sm font-semibold text-ink-950">Davet / sıfırlama bağlantısı</p>
        <p className="text-xs text-text-muted">
          Bağlantı hesabı ele geçirmeye yeter: yalnız güvenli bir kanaldan iletin; bu ekran kapanınca yeniden görünmez.
        </p>
        <Button type="button" disabled={pending} onClick={makeLink} variant="outline" size="sm">
          <KeyRound className="h-3.5 w-3.5" /> Bağlantı üret
        </Button>
        {link ? (
          <div className="flex gap-2">
            <input readOnly value={link} aria-label="Sıfırlama bağlantısı" onFocus={(e) => e.currentTarget.select()} className="numeric focus-ring w-full min-w-0 rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2 text-xs" />
            <Button type="button" onClick={() => copy(link, "link")} aria-label="Bağlantıyı kopyala" variant="outline" size="sm">
              {copiedKey === "link" ? <Check className="h-3.5 w-3.5 text-mint-600" /> : <Copy className="h-3.5 w-3.5" />}
            </Button>
          </div>
        ) : null}
      </div>

      <div className="space-y-3 border-t border-line pt-4">
        <p className="text-sm font-semibold text-ink-950">Açık oturumlar</p>
        {confirmSignOut ? (
          <span className="inline-flex flex-wrap items-center gap-2 rounded-[var(--radius-control)] border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-xs font-semibold text-amber-800">
            Personelin tüm açık oturumları kapatılsın mı?
            <Button type="button" onClick={signOutAll} variant="navy" size="sm">Evet, kapat</Button>
            <Button type="button" onClick={() => setConfirmSignOut(false)} variant="outline" size="sm">Vazgeç</Button>
          </span>
        ) : (
          <Button type="button" disabled={pending} onClick={() => setConfirmSignOut(true)} variant="outline" size="sm">
            <LogOut className="h-3.5 w-3.5" /> Oturumları kapat
          </Button>
        )}
      </div>

      <div className="space-y-3 border-t border-line pt-4">
        <p className="text-sm font-semibold text-ink-950">Geçici parola ata</p>
        <p className="text-xs text-text-muted">
          Parola hemen değişir; personel bir sonraki girişte kendi parolasını belirlemeden yönetim paneline giremez.
        </p>
        <div className="flex flex-wrap gap-2">
          <Input
 type={showPw ? "text" : "password"}
 value={password}
 onChange={(e) => {
 setPassword(e.target.value);
 setConfirmPw(false);
 }}
 maxLength={72}
 autoComplete="new-password"
 aria-label="Geçici parola"
 placeholder="En az 10 karakter"
 className="numeric min-w-0 flex-1 basis-56 font-mono" />
          <Button type="button" onClick={() => setShowPw((v) => !v)} aria-label={showPw ? "Parolayı gizle" : "Parolayı göster"} aria-pressed={showPw} variant="outline" size="sm" className="text-text-muted">
            {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </Button>
          <Button type="button" onClick={() => copy(password, "pw")} disabled={!password} aria-label="Parolayı kopyala" variant="outline" size="sm" className="text-text-muted">
            {copiedKey === "pw" ? <Check className="h-4 w-4 text-mint-600" /> : <Copy className="h-4 w-4" />}
          </Button>
          <Button
            type="button"
            onClick={() => {
              setPassword(generatePassword(secureRandomInt));
              setShowPw(true);
              setConfirmPw(false);
            }}
            variant="outline" size="sm"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Üret
          </Button>
        </div>
        {confirmPw ? (
          <span className="inline-flex flex-wrap items-center gap-2 rounded-[var(--radius-control)] border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-xs font-semibold text-amber-800">
            Personelin parolası bu geçici parolayla değiştirilsin mi?
            <Button type="button" onClick={applyPassword} variant="navy" size="sm">
              Evet, ata
            </Button>
            <Button type="button" onClick={() => setConfirmPw(false)} variant="outline" size="sm">
              Vazgeç
            </Button>
          </span>
        ) : (
          <Button
            type="button"
            disabled={pending || password.length < 10}
            onClick={() => setConfirmPw(true)}
            variant="outline" size="sm" className="border-danger-500/40 text-danger-600"
          >
            Geçici parolayı ata
          </Button>
        )}
      </div>
    </section>
  );
}
