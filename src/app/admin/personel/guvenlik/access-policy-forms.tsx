"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormField, FormInput, FormTextarea } from "@/components/ui/form-controls";
import { revokeStaffSession, saveAdminAccessPolicy } from "@/app/actions/platform-access-policy";
import { validateAllowlist } from "@/lib/platform-security/admin-access";
import { ReasonDialog } from "./reason-dialog";

type Policy = { allowlist: string; idleMinutes: number; maxHours: number; stepUp: boolean };

/**
 * AD11 yönetim erişim politikası formu (yalnız süper admin görür; eylem sunucuda yeniden denetler). Kaydet gerekçe
 * ister; liste şu anki IP'yi dışarıda bırakıyorsa sunucu reddeder, açık onayla yeniden gönderilir.
 */
export function AccessPolicyForm({ initial, currentIp }: { initial: Policy; currentIp: string | null }) {
  const router = useRouter();
  const [p, setP] = useState<Policy>(initial);
  const [open, setOpen] = useState(false);
  const [confirmLockout, setConfirmLockout] = useState(false);
  const [lockoutAsk, setLockoutAsk] = useState(false);
  const [code, setCode] = useState("");
  const [saved, setSaved] = useState(false);
  const listError = p.allowlist.trim() ? validateAllowlist(p.allowlist) : null;
  const changed =
    p.allowlist.trim() !== initial.allowlist.trim() ||
    p.idleMinutes !== initial.idleMinutes ||
    p.maxHours !== initial.maxHours ||
    p.stepUp !== initial.stepUp;
  const numOk = (n: number, max: number) => Number.isInteger(n) && n >= 0 && n <= max;
  const valid = !listError && numOk(p.idleMinutes, 1440) && numOk(p.maxHours, 168);

  return (
    <div className="space-y-4">
      <FormField
        label="IP izin listesi"
        htmlFor="acc-allowlist"
        hint={`Satır ya da virgülle IPv4/IPv6 adres veya CIDR; # sonrası açıklama. Boş = her IP. Şu anki IP'niz: ${currentIp ?? "bilinmiyor"}.`}
      >
        <FormTextarea
          id="acc-allowlist"
          rows={4}
          value={p.allowlist}
          onChange={(e) => {
            setSaved(false);
            setP({ ...p, allowlist: e.target.value });
          }}
          placeholder={"203.0.113.7   # ofis\n10.8.0.0/16   # VPN"}
          className="font-mono text-xs"
        />
      </FormField>
      {listError ? <p role="alert" className="text-xs font-semibold text-danger-600">{listError}</p> : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="Boşta kalma süresi (dk)" htmlFor="acc-idle" hint="0 = kapalı. Varsayılan 60.">
          <FormInput
            id="acc-idle"
            type="number"
            min={0}
            max={1440}
            value={p.idleMinutes}
            onChange={(e) => {
              setSaved(false);
              setP({ ...p, idleMinutes: Number(e.target.value) });
            }}
          />
        </FormField>
        <FormField label="Oturum en uzun ömrü (saat)" htmlFor="acc-max" hint="0 = sınırsız. Varsayılan 12.">
          <FormInput
            id="acc-max"
            type="number"
            min={0}
            max={168}
            value={p.maxHours}
            onChange={(e) => {
              setSaved(false);
              setP({ ...p, maxHours: Number(e.target.value) });
            }}
          />
        </FormField>
      </div>
      <label className="flex items-start gap-2.5 text-sm">
        <input
          type="checkbox"
          className="mt-1"
          checked={p.stepUp}
          onChange={(e) => {
            setSaved(false);
            setP({ ...p, stepUp: e.target.checked });
          }}
        />
        <span>
          <span className="font-semibold text-ink-950">Kritik işlemlerde doğrulayıcı kodu iste</span>
          <span className="block text-xs text-text-muted">İade, kredi, sahiplik devri, ofis kapatma ve rol değişikliği TOTP kodu olmadan tamamlanmaz.</span>
        </span>
      </label>
      {!p.stepUp && initial.stepUp ? (
        <FormField label="Kapatmak için doğrulayıcı kodu" htmlFor="acc-step-up" hint="Kritik işlem doğrulamasını kapatmak da kod ister.">
          <FormInput
            id="acc-step-up"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="max-w-[12rem] tabular-nums tracking-widest"
          />
        </FormField>
      ) : null}
      {lockoutAsk ? (
        <label className="tone-danger flex items-start gap-2.5 rounded-[var(--radius-control)] px-3.5 py-2 text-sm">
          <input type="checkbox" className="mt-1" checked={confirmLockout} onChange={(e) => setConfirmLockout(e.target.checked)} />
          <span>Şu anki IP adresim listede değil; bu cihazdan erişimimin kesileceğini biliyorum.</span>
        </label>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" disabled={!changed || !valid} onClick={() => setOpen(true)}>
          Erişim politikasını kaydet
        </Button>
        {saved ? <span className="text-xs font-semibold text-mint-600">Kaydedildi (en geç 30 sn içinde etkin).</span> : null}
      </div>
      <ReasonDialog
        open={open}
        onOpenChange={setOpen}
        title="Erişim politikası değişsin mi?"
        description="Yönetim paneline erişimi doğrudan etkiler; değişiklik gerekçesiyle denetim izine yazılır."
        tone="danger"
        confirmLabel="Kaydet"
        onConfirm={async (reason) => {
          const res = await saveAdminAccessPolicy({ ...p, reason, confirmLockout, stepUpCode: code });
          if (res.code === "lockout") setLockoutAsk(true);
          if (res.error) return { error: res.error };
          setSaved(true);
          setLockoutAsk(false);
          setConfirmLockout(false);
          setCode("");
          router.refresh();
        }}
      />
    </div>
  );
}

/** Tek personel oturumunu kapatma düğmesi (gerekçeli). */
export function RevokeSessionButton({ sessionId, label, current }: { sessionId: string; label: string; current: boolean }) {
  const router = useRouter();
  return (
    <ReasonDialog
      trigger={
        <Button variant="outline" size="sm" icon={LogOut} aria-label={`Oturumu kapat: ${label}`}>
          Kapat
        </Button>
      }
      title={current ? "Kendi oturumunuz kapatılsın mı?" : `${label} oturumu kapatılsın mı?`}
      description="Oturumun yenileme anahtarı hemen geçersiz olur; açık sayfa en geç bir saat içinde yeniden giriş ister."
      tone="danger"
      confirmLabel="Oturumu kapat"
      onConfirm={async (reason) => {
        const res = await revokeStaffSession({ sessionId, reason });
        if (res.error) return { error: res.error };
        router.refresh();
      }}
    />
  );
}
