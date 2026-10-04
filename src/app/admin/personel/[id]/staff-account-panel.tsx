"use client";

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

const btn =
  "focus-ring press inline-flex items-center gap-1.5 rounded-[var(--radius-control)] px-3.5 py-2 text-xs font-semibold transition disabled:opacity-60";

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
        <button type="submit" disabled={pending} className={`${btn} bg-ink-950 text-white`}>
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Bilgileri kaydet
        </button>
      </form>

      <div className="space-y-3 border-t border-line pt-4">
        <p className="text-sm font-semibold text-ink-950">Davet / sıfırlama bağlantısı</p>
        <p className="text-xs text-text-muted">
          Bağlantı hesabı ele geçirmeye yeter: yalnız güvenli bir kanaldan iletin; bu ekran kapanınca yeniden görünmez.
        </p>
        <button type="button" disabled={pending} onClick={makeLink} className={`${btn} border border-line text-ink-950`}>
          <KeyRound className="h-3.5 w-3.5" /> Bağlantı üret
        </button>
        {link ? (
          <div className="flex gap-2">
            <input readOnly value={link} aria-label="Sıfırlama bağlantısı" onFocus={(e) => e.currentTarget.select()} className="numeric focus-ring w-full min-w-0 rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2 text-xs" />
            <button type="button" onClick={() => copy(link, "link")} aria-label="Bağlantıyı kopyala" className={`${btn} border border-line text-ink-950`}>
              {copiedKey === "link" ? <Check className="h-3.5 w-3.5 text-mint-600" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
          </div>
        ) : null}
      </div>

      <div className="space-y-3 border-t border-line pt-4">
        <p className="text-sm font-semibold text-ink-950">Açık oturumlar</p>
        {confirmSignOut ? (
          <span className="inline-flex flex-wrap items-center gap-2 rounded-[var(--radius-control)] border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-xs font-semibold text-amber-800">
            Personelin tüm açık oturumları kapatılsın mı?
            <button type="button" onClick={signOutAll} className={`${btn} bg-ink-950 text-white`}>Evet, kapat</button>
            <button type="button" onClick={() => setConfirmSignOut(false)} className={`${btn} border border-line bg-surface text-ink-950`}>Vazgeç</button>
          </span>
        ) : (
          <button type="button" disabled={pending} onClick={() => setConfirmSignOut(true)} className={`${btn} border border-line text-ink-950`}>
            <LogOut className="h-3.5 w-3.5" /> Oturumları kapat
          </button>
        )}
      </div>

      <div className="space-y-3 border-t border-line pt-4">
        <p className="text-sm font-semibold text-ink-950">Geçici parola ata</p>
        <p className="text-xs text-text-muted">
          Parola hemen değişir; personel bir sonraki girişte kendi parolasını belirlemeden yönetim paneline giremez.
        </p>
        <div className="flex flex-wrap gap-2">
          <input
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
            className="numeric focus-ring min-w-0 flex-1 basis-56 rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2 font-mono text-sm"
          />
          <button type="button" onClick={() => setShowPw((v) => !v)} aria-label={showPw ? "Parolayı gizle" : "Parolayı göster"} aria-pressed={showPw} className={`${btn} border border-line text-text-muted`}>
            {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
          <button type="button" onClick={() => copy(password, "pw")} disabled={!password} aria-label="Parolayı kopyala" className={`${btn} border border-line text-text-muted`}>
            {copiedKey === "pw" ? <Check className="h-4 w-4 text-mint-600" /> : <Copy className="h-4 w-4" />}
          </button>
          <button
            type="button"
            onClick={() => {
              setPassword(generatePassword(secureRandomInt));
              setShowPw(true);
              setConfirmPw(false);
            }}
            className={`${btn} border border-line text-ink-950`}
          >
            <RefreshCw className="h-3.5 w-3.5" /> Üret
          </button>
        </div>
        {confirmPw ? (
          <span className="inline-flex flex-wrap items-center gap-2 rounded-[var(--radius-control)] border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-xs font-semibold text-amber-800">
            Personelin parolası bu geçici parolayla değiştirilsin mi?
            <button type="button" onClick={applyPassword} className={`${btn} bg-ink-950 text-white`}>
              Evet, ata
            </button>
            <button type="button" onClick={() => setConfirmPw(false)} className={`${btn} border border-line bg-surface text-ink-950`}>
              Vazgeç
            </button>
          </span>
        ) : (
          <button
            type="button"
            disabled={pending || password.length < 10}
            onClick={() => setConfirmPw(true)}
            className={`${btn} border border-danger-500/40 text-danger-600`}
          >
            Geçici parolayı ata
          </button>
        )}
      </div>
    </section>
  );
}
