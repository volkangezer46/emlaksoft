"use client";

import { Button } from "@/components/ui/button";
import { useState, useTransition } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, KeyRound, Loader2, LogOut, Save, UserCheck, UserMinus } from "lucide-react";
import {
  generateMemberResetLink,
  setMemberActiveAsStaff,
  setMemberRoleAsStaff,
  signOutMemberSessions,
  updateMemberProfile,
  type MemberActionResult,
} from "@/app/actions/platform-members";
import { EmailInput } from "@/components/ui/email-input";
import { PhoneInput } from "@/components/ui/phone-input";
import { FormField, FormInput, FormSelect } from "@/components/ui/form-controls";
import { useStepUpPrompt } from "@/components/admin/step-up";
import { ROLE_LABELS } from "@/lib/role-labels";
import { DeactivateWizard, loadHandoffSnapshot, type HandoffSnapshot } from "./member-support-tools";

type Notice = { tone: "ok" | "error"; text: string } | null;

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

/** Bilgiler sekmesi: ad ve telefon. E-posta giriş kimliğidir; burada yalnız gösterilir. */
export function MemberInfoForm({
  id,
  fullName,
  phone,
  email,
}: {
  id: string;
  fullName: string;
  phone: string | null;
  email: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [notice, setNotice] = useState<Notice>(null);

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    fd.set("id", id);
    setNotice(null);
    start(async () => {
      const res = await updateMemberProfile(fd);
      if (res.error) setNotice({ tone: "error", text: res.error });
      else {
        setNotice({ tone: "ok", text: "Üye bilgileri kaydedildi." });
        router.refresh();
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 rounded-[var(--radius-panel)] border border-line bg-surface p-5">
      <div>
        <h2 className="font-display font-bold text-ink-950">Kimlik ve iletişim</h2>
        <p className="text-xs text-text-muted">Değişiklikler denetim kaydına eski ve yeni değerle yazılır.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Ad soyad" htmlFor="full_name" required>
          <FormInput name="full_name" defaultValue={fullName} required minLength={2} maxLength={120} autoComplete="off" />
        </FormField>
        <FormField label="Telefon" htmlFor="phone" hint="Boş bırakılırsa telefon silinir.">
          <PhoneInput id="phone" name="phone" defaultValue={phone} />
        </FormField>
        <FormField label="E-posta (giriş kimliği)" htmlFor="member_email" hint="Giriş e-postası bu ekrandan değiştirilmez.">
          <EmailInput id="member_email" defaultValue={email ?? ""} readOnly aria-readonly />
        </FormField>
      </div>
      <NoticeLine notice={notice} />
      <Button type="submit" disabled={pending} variant="navy" size="sm">
        {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Kaydet
      </Button>
    </form>
  );
}

const ROLE_OPTIONS: { value: string; label: string }[] = [
  { value: "gm", label: ROLE_LABELS.gm },
  { value: "branch_manager", label: ROLE_LABELS.branch_manager },
  { value: "team_lead", label: ROLE_LABELS.team_lead },
  { value: "advisor", label: ROLE_LABELS.advisor },
  { value: "call_center", label: ROLE_LABELS.call_center },
  { value: "accounting", label: ROLE_LABELS.accounting },
  { value: "readonly", label: ROLE_LABELS.readonly },
];

type Pending = "signout" | null;

/** Erişim sekmesi: rol, aktif/pasif, oturumları kapat, sıfırlama bağlantısı. Onaylar satır içidir. */
export function MemberAccessPanel({
  id,
  name,
  role,
  roleLabel,
  isActive,
  canRole,
  canActive,
  canReset,
}: {
  id: string;
  name: string;
  role: string;
  roleLabel: string;
  isActive: boolean;
  canRole: boolean;
  canActive: boolean;
  canReset: boolean;
}) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [notice, setNotice] = useState<Notice>(null);
  const [confirming, setConfirming] = useState<Pending>(null);
  const [roleValue, setRoleValue] = useState(role);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [wizard, setWizard] = useState<HandoffSnapshot | null>(null);

  const isOwner = role === "owner";
  const stepUp = useStepUpPrompt();

  function run(action: (fd: FormData) => Promise<MemberActionResult>, extra: Record<string, string>, okText: string) {
    const fd = new FormData();
    fd.set("id", id);
    for (const [k, v] of Object.entries(extra)) fd.set(k, v);
    setNotice(null);
    setConfirming(null);
    start(async () => {
      const res = await action(fd);
      if (res.error) setNotice({ tone: "error", text: res.error });
      else if (res.notice) setNotice({ tone: "ok", text: res.notice });
      else {
        if (res.link) setLink(res.link);
        setNotice({ tone: "ok", text: okText });
        router.refresh();
      }
    });
  }

  /** Pasifleştir: önce iş yükü sayımı (tıklamada), sonra devir sihirbazı. */
  function openWizard() {
    setNotice(null);
    start(async () => {
      const res = await loadHandoffSnapshot(id);
      if (res.error || !res.snapshot) setNotice({ tone: "error", text: res.error ?? "İş yükü okunamadı." });
      else setWizard(res.snapshot);
    });
  }

  async function copyLink() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* pano erişimi yoksa kullanıcı alanı elle kopyalar */
    }
  }

  return (
    <div className="space-y-5">
      {stepUp.dialog}
      <NoticeLine notice={notice} />

      <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-5">
        <h2 className="font-display font-bold text-ink-950">Rol</h2>
        <p className="text-xs text-text-muted">
          Şu an: <strong className="text-ink-950">{roleLabel}</strong>.
          {isOwner ? " Ofis sahibinin rolü bu ekrandan değiştirilmez." : ""}
        </p>
        {canRole && !isOwner ? (
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <FormField label="Yeni rol" htmlFor="member_role" className="min-w-52">
              <FormSelect id="member_role" value={roleValue} onChange={(e) => setRoleValue(e.target.value)}>
                {ROLE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </FormSelect>
            </FormField>
            <Button
              type="button"
              disabled={busy || roleValue === role}
              onClick={async () => {
                const code = await stepUp.ask("Rol değişikliği");
                if (code) run(setMemberRoleAsStaff, { role: roleValue, step_up_code: code }, "Rol güncellendi.");
              }}
              variant="navy" size="sm"
            >
              Rolü kaydet
            </Button>
          </div>
        ) : !canRole ? (
          <p className="mt-3 text-xs text-text-faint">Rol değiştirme yalnız süper admin içindir.</p>
        ) : null}
      </section>

      <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-5">
        <h2 className="font-display font-bold text-ink-950">Hesap durumu</h2>
        <p className="text-xs text-text-muted">
          Pasif üye giriş yapamaz; pasifleştirmede açık oturumlar kapatılır. Kayıt silinmez.
        </p>
        {canActive ? (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {isActive ? (
              wizard ? null : (
                <Button type="button" disabled={busy} onClick={openWizard} variant="outline" size="sm" className="border-danger-500/40 text-danger-600">
                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserMinus className="h-3.5 w-3.5" />} Pasifleştir
                </Button>
              )
            ) : (
              <Button type="button" disabled={busy} onClick={() => run(setMemberActiveAsStaff, { is_active: "true" }, "Üye aktifleştirildi.")} variant="navy" size="sm">
                <UserCheck className="h-3.5 w-3.5" /> Aktifleştir
              </Button>
            )}

            {confirming === "signout" ? (
              <span className="inline-flex flex-wrap items-center gap-2 rounded-[var(--radius-control)] border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-xs font-semibold text-amber-800">
                Tüm açık oturumlar kapatılsın mı?
                <Button
                  type="button"
                  onClick={async () => {
                    const code = await stepUp.ask("Oturumları kapatma");
                    if (code) run(signOutMemberSessions, { step_up_code: code }, "Açık oturumlar kapatıldı.");
                  }}
                  variant="navy"
                  size="sm"
                >
                  Evet, kapat
                </Button>
                <Button type="button" onClick={() => setConfirming(null)} variant="outline" size="sm">
                  Vazgeç
                </Button>
              </span>
            ) : (
              <Button type="button" disabled={busy} onClick={() => setConfirming("signout")} variant="outline" size="sm">
                <LogOut className="h-3.5 w-3.5" /> Oturumları kapat
              </Button>
            )}
          </div>
        ) : (
          <p className="mt-3 text-xs text-text-faint">Durum değiştirme süper admin ve operasyon içindir.</p>
        )}
        {canActive && isActive && wizard ? <DeactivateWizard id={id} name={name} initial={wizard} onCancel={() => setWizard(null)} /> : null}
      </section>

      <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-5">
        <h2 className="font-display font-bold text-ink-950">Parola sıfırlama</h2>
        <p className="text-xs text-text-muted">
          Tek kullanımlık bağlantı üretir. Bağlantı hesabı ele geçirmeye yeter: yalnız güvenli bir kanaldan üyeye iletin;
          bu ekran kapanınca yeniden görünmez.
        </p>
        {canReset ? (
          <div className="mt-3 space-y-3">
            <Button type="button" disabled={busy} onClick={() => run(generateMemberResetLink, {}, "Sıfırlama bağlantısı üretildi.")} variant="outline" size="sm">
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <KeyRound className="h-3.5 w-3.5" />} Bağlantı üret
            </Button>
            {link ? (
              <div className="flex gap-2">
                <input readOnly value={link} aria-label="Sıfırlama bağlantısı" onFocus={(e) => e.currentTarget.select()} className="numeric focus-ring w-full min-w-0 rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2 text-xs" />
                <Button type="button" onClick={copyLink} aria-label="Bağlantıyı kopyala" variant="outline" size="sm">
                  {copied ? <Check className="h-3.5 w-3.5 text-mint-600" /> : <Copy className="h-3.5 w-3.5" />}
                </Button>
              </div>
            ) : null}
          </div>
        ) : (
          <p className="mt-3 text-xs text-text-faint">Sıfırlama bağlantısı yalnız süper admin içindir.</p>
        )}
      </section>
    </div>
  );
}
