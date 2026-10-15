"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FilterChip } from "@/components/ui/filter-chip";
import { Switch } from "@/components/ui/switch";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FormField, FormInput, FormTextarea } from "@/components/ui/form-controls";
import { validateAllowlist } from "@/lib/platform-security/admin-access";
import { EXPORT_ROLE_IDS, IDLE_MAX_MINUTES, MFA_ROLE_IDS, SESSION_MAX_HOURS_LIMIT } from "@/lib/office-security/policy";
import { ROLE_LABELS } from "@/lib/role-labels";
import { revokeOfficeSession, saveOfficeSecurityPolicy } from "./policy-actions";

type Policy = {
  mfaRoles: string[];
  ipAllowlist: string;
  ipOwnerExempt: boolean;
  idleMinutes: number;
  maxHours: number;
  newDeviceAlert: boolean;
  exportRoles: string[];
};

const same = (a: Policy, b: Policy) =>
  a.mfaRoles.join(",") === b.mfaRoles.join(",") &&
  a.ipAllowlist.trim() === b.ipAllowlist.trim() &&
  a.ipOwnerExempt === b.ipOwnerExempt &&
  a.idleMinutes === b.idleMinutes &&
  a.maxHours === b.maxHours &&
  a.newDeviceAlert === b.newDeviceAlert &&
  a.exportRoles.join(",") === b.exportRoles.join(",");

/**
 * DG7 ofis güvenlik politikası formu (yalnız ofis sahibi düzenler; eylem sunucuda yeniden denetler). Liste şu anki
 * IP'yi dışarıda bırakıyor ve sahip muafiyeti kapalıysa sunucu reddeder; açık onayla yeniden gönderilir.
 */
export function OfficePolicyForm({ initial, currentIp, canEdit }: { initial: Policy; currentIp: string | null; canEdit: boolean }) {
  const router = useRouter();
  const [p, setP] = useState<Policy>(initial);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [lockoutAsk, setLockoutAsk] = useState(false);
  const [confirmLockout, setConfirmLockout] = useState(false);
  const listError = p.ipAllowlist.trim() ? validateAllowlist(p.ipAllowlist) : null;
  const numOk = (n: number, max: number) => Number.isInteger(n) && n >= 0 && n <= max;
  const valid = !listError && numOk(p.idleMinutes, IDLE_MAX_MINUTES) && numOk(p.maxHours, SESSION_MAX_HOURS_LIMIT);
  const update = (patch: Partial<Policy>) => {
    setSaved(false);
    setError(null);
    setP({ ...p, ...patch });
  };
  const toggleRole = (role: string) =>
    update({ mfaRoles: MFA_ROLE_IDS.filter((r) => (r === role ? !p.mfaRoles.includes(r) : p.mfaRoles.includes(r))) });
  // Ofis sahibi dışa aktarmadan çıkarılamaz (sunucu da her zaman ekler).
  const toggleExportRole = (role: string) =>
    role === "owner"
      ? undefined
      : update({ exportRoles: EXPORT_ROLE_IDS.filter((r) => r === "owner" || (r === role ? !p.exportRoles.includes(r) : p.exportRoles.includes(r))) });

  const save = () =>
    startTransition(async () => {
      const res = await saveOfficeSecurityPolicy({ ...p, confirmLockout });
      if (res.code === "lockout") setLockoutAsk(true);
      if (res.error) {
        setError(res.error);
        return;
      }
      setSaved(true);
      setLockoutAsk(false);
      setConfirmLockout(false);
      router.refresh();
    });

  return (
    <fieldset disabled={!canEdit} className="space-y-5">
      <div>
        <p className="text-sm font-semibold text-ink-950">İki adımlı doğrulama zorunlu roller</p>
        <p className="mb-2 text-xs text-text-muted">
          Seçilen roldeki kullanıcı SMS doğrulamasını kurmadan panele giremez; bir sonraki tıklamasında kurulum ekranına yönlenir.
        </p>
        <div className="flex flex-wrap gap-2" role="group" aria-label="2FA zorunlu roller">
          {MFA_ROLE_IDS.map((r) => (
            <FilterChip key={r} active={p.mfaRoles.includes(r)} onClick={() => toggleRole(r)} disabled={!canEdit}>
              {ROLE_LABELS[r] ?? r}
            </FilterChip>
          ))}
        </div>
      </div>

      <FormField
        label="İzinli IP adresleri (isteğe bağlı)"
        htmlFor="office-ip"
        hint={`Satır ya da virgülle IPv4/IPv6 adres veya CIDR; # sonrası açıklama. Boş = her ağdan giriş. Şu anki IP'niz: ${currentIp ?? "bilinmiyor"}.`}
      >
        <FormTextarea
          id="office-ip"
          rows={3}
          value={p.ipAllowlist}
          onChange={(e) => update({ ipAllowlist: e.target.value })}
          placeholder={"203.0.113.7   # ofis\n10.8.0.0/16   # VPN"}
          className="font-mono text-xs"
        />
      </FormField>
      {listError ? (
        <p role="alert" className="text-xs font-semibold text-danger-600">
          {listError}
        </p>
      ) : null}

      <label className="flex items-start justify-between gap-3 text-sm">
        <span>
          <span className="font-semibold text-ink-950">Ofis sahibi IP kısıtından muaf</span>
          <span className="block text-xs text-text-muted">Önerilir: liste yanlış girilse bile ofis kilitlenmez.</span>
        </span>
        <Switch checked={p.ipOwnerExempt} onCheckedChange={(v) => update({ ipOwnerExempt: v })} disabled={!canEdit} aria-label="Ofis sahibi IP kısıtından muaf" />
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="Boşta kalma süresi (dk)" htmlFor="office-idle" hint="İşlem yapılmazsa oturum kapanır. 0 = kapalı.">
          <FormInput
            id="office-idle"
            type="number"
            min={0}
            max={IDLE_MAX_MINUTES}
            value={p.idleMinutes}
            onChange={(e) => update({ idleMinutes: Number(e.target.value) })}
          />
        </FormField>
        <FormField label="En uzun oturum süresi (saat)" htmlFor="office-max" hint="Girişten sonra en çok bu kadar. 0 = sınırsız.">
          <FormInput
            id="office-max"
            type="number"
            min={0}
            max={SESSION_MAX_HOURS_LIMIT}
            value={p.maxHours}
            onChange={(e) => update({ maxHours: Number(e.target.value) })}
          />
        </FormField>
      </div>

      <label className="flex items-start justify-between gap-3 text-sm">
        <span>
          <span className="font-semibold text-ink-950">Yeni cihazdan giriş bildirimi</span>
          <span className="block text-xs text-text-muted">Son 90 günde görülmemiş cihaz/tarayıcıdan girişte kullanıcıya, ofis sahibine ve yöneticilere bildirim gider.</span>
        </span>
        <Switch checked={p.newDeviceAlert} onCheckedChange={(v) => update({ newDeviceAlert: v })} disabled={!canEdit} aria-label="Yeni cihazdan giriş bildirimi" />
      </label>

      <div>
        <p className="text-sm font-semibold text-ink-950">Dışa aktarma yapabilen roller</p>
        <p className="mb-2 text-xs text-text-muted">
          Seçili olmayan roldeki kullanıcı raporları ekranda görmeye devam eder ama Rapor merkezinden dosya (CSV/Excel/PDF) indiremez. Ofis sahibi her zaman indirebilir.
        </p>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Dışa aktarma yapabilen roller">
          {EXPORT_ROLE_IDS.map((r) => (
            <FilterChip
              key={r}
              active={r === "owner" || p.exportRoles.includes(r)}
              onClick={() => toggleExportRole(r)}
              disabled={!canEdit || r === "owner"}
            >
              {ROLE_LABELS[r] ?? r}
            </FilterChip>
          ))}
        </div>
      </div>

      {lockoutAsk ? (
        <label className="tone-danger flex items-start gap-2.5 rounded-[var(--radius-control)] px-3.5 py-2 text-sm">
          <input type="checkbox" className="mt-1" checked={confirmLockout} onChange={(e) => setConfirmLockout(e.target.checked)} />
          <span>Şu anki IP adresim listede değil; bu ağdan erişimimin kesileceğini biliyorum.</span>
        </label>
      ) : null}
      {error ? (
        <p role="alert" className="text-xs font-semibold text-danger-600">
          {error}
        </p>
      ) : null}

      {canEdit ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" loading={pending} disabled={same(p, initial) || !valid} onClick={save}>
            Politikayı kaydet
          </Button>
          {saved ? <span className="text-xs font-semibold text-mint-600">Kaydedildi (en geç 30 sn içinde tüm oturumlarda etkin).</span> : null}
        </div>
      ) : (
        <p className="text-xs text-text-muted">Politikayı yalnız ofis sahibi değiştirebilir.</p>
      )}
    </fieldset>
  );
}

/** Tek oturumu kapatma düğmesi (onaylı; yalnız ofis sahibi). */
export function RevokeOfficeSessionButton({ sessionId, label }: { sessionId: string; label: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-2">
      {error ? (
        <span role="alert" className="text-xs font-semibold text-danger-600">
          {error}
        </span>
      ) : null}
      <ConfirmDialog
        trigger={
          <Button variant="outline" size="sm" icon={LogOut} aria-label={`Oturumu kapat: ${label}`}>
            Kapat
          </Button>
        }
        title={`${label} oturumu kapatılsın mı?`}
        description="Oturumun yenileme anahtarı hemen geçersiz olur; açık sayfa en geç bir saat içinde yeniden giriş ister."
        confirmLabel="Oturumu kapat"
        onConfirm={async () => {
          const res = await revokeOfficeSession({ sessionId });
          setError(res.error ?? null);
          if (!res.error) router.refresh();
        }}
      />
    </span>
  );
}
