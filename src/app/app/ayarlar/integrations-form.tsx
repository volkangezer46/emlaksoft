"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, MessageSquareText, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, FormField } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  saveNetgsmCredentials,
  clearNetgsmCredentials,
  type TenantIntegrationResult,
} from "@/app/actions/tenant-integrations";

const init: TenantIntegrationResult = {};

export function IntegrationsForm({
  netgsm,
  platformConfigured,
}: {
  netgsm: { usercode: string; msgheader: string; hasPassword: boolean } | null;
  platformConfigured: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [clearError, setClearError] = useState<string | null>(null);

  // Sonucu effect'te değil eylem içinde işle (react-hooks/set-state-in-effect)
  const action = (formData: FormData) => {
    startTransition(async () => {
      const res = await saveNetgsmCredentials(init, formData);
      if (res.error) {
        setError(res.error);
        setSaved(false);
        return;
      }
      setError(null);
      setSaved(true);
      router.refresh();
      setTimeout(() => setSaved(false), 2500);
    });
  };

  async function onClear() {
    setClearError(null);
    const res = await clearNetgsmCredentials();
    if (res.error) setClearError(res.error);
    router.refresh();
  }

  return (
    <div className="rounded-[16px] border border-line bg-canvas p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-[11px] bg-mint-500/12 text-mint-600">
            <MessageSquareText className="h-4 w-4" />
          </span>
          <div>
            <h3 className="text-sm font-bold text-ink-950">Netgsm SMS</h3>
            <p className="text-[11px] text-text-muted">Kampanya ve bildirim SMS&apos;leri bu hesap üzerinden gönderilir.</p>
          </div>
        </div>
        {netgsm ? (
          <span className="rounded-full bg-mint-500/12 px-2.5 py-1 text-[11px] font-bold text-mint-600">Ofis hesabı tanımlı</span>
        ) : platformConfigured ? (
          <span className="rounded-full bg-ink-950/8 px-2.5 py-1 text-[11px] font-bold text-text-muted">Platform varsayılanı</span>
        ) : (
          <span className="rounded-full bg-amber-400/15 px-2.5 py-1 text-[11px] font-bold text-amber-600">Yapılandırılmadı</span>
        )}
      </div>

      <form action={action} className="mt-4 grid gap-3 sm:grid-cols-3">
        <FormField label="Kullanıcı kodu" htmlFor="netgsm-usercode" required>
          <Input
            id="netgsm-usercode"
            name="usercode"
            required
            defaultValue={netgsm?.usercode ?? ""}
            placeholder="8503021234"
            autoComplete="off"
          />
        </FormField>
        <FormField
          label="Şifre"
          htmlFor="netgsm-password"
          required={!netgsm?.hasPassword}
          hint={netgsm?.hasPassword ? "Kayıtlı — değiştirmeyecekseniz boş bırakın." : undefined}
        >
          <Input
            id="netgsm-password"
            name="password"
            type="password"
            placeholder={netgsm?.hasPassword ? "••••••••" : "API şifresi"}
            autoComplete="new-password"
          />
        </FormField>
        <FormField label="Onaylı başlık" htmlFor="netgsm-msgheader" required hint="Netgsm panelinde onaylı gönderici adı.">
          <Input
            id="netgsm-msgheader"
            name="msgheader"
            required
            defaultValue={netgsm?.msgheader ?? ""}
            placeholder="OFISADI"
            autoComplete="off"
          />
        </FormField>

        {error ? <p className="sm:col-span-3 text-sm text-danger-500" role="alert">{error}</p> : null}
        {clearError ? <p className="sm:col-span-3 text-sm text-danger-500" role="alert">{clearError}</p> : null}

        <div className="flex items-center justify-end gap-2 sm:col-span-3">
          {saved ? (
            <span className="flex items-center gap-1.5 text-sm font-semibold text-mint-600"><Check className="h-4 w-4" /> Kaydedildi</span>
          ) : null}
          {netgsm ? (
            <ConfirmDialog
              title="Netgsm hesabını kaldır"
              description="Ofise özel kimlik bilgileri silinecek; SMS gönderimi platform varsayılanına döner, o da yoksa kapalı kalır."
              confirmLabel="Kaldır"
              onConfirm={onClear}
              trigger={
                <Button type="button" variant="ghost" size="sm">
                  <Trash2 className="h-3.5 w-3.5" /> Kaldır
                </Button>
              }
            />
          ) : null}
          <Button type="submit" loading={pending}>
            <Save className="h-4 w-4" /> Kaydet
          </Button>
        </div>
      </form>
    </div>
  );
}
