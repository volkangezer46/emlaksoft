"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, MessageCircle, MessageSquareText, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, FormField } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  saveNetgsmCredentials,
  clearNetgsmCredentials,
  saveWhatsAppCredentials,
  clearWhatsAppCredentials,
  type TenantIntegrationResult,
} from "@/app/actions/tenant-integrations";
import { WHATSAPP_GRAPH_VERSIONS } from "@/lib/messaging/whatsapp-contract";

const init: TenantIntegrationResult = {};

export function IntegrationsForm({
  netgsm,
  platformConfigured,
  whatsapp,
}: {
  netgsm: { usercode: string; msgheader: string; inboundReceiver: string; hasPassword: boolean } | null;
  platformConfigured: boolean;
  whatsapp: {
    phoneNumberId: string;
    wabaId: string;
    graphVersion: string;
    hasAccessToken: boolean;
    status: string;
  } | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [clearError, setClearError] = useState<string | null>(null);
  const [whatsAppPending, startWhatsAppTransition] = useTransition();
  const [whatsAppError, setWhatsAppError] = useState<string | null>(null);
  const [whatsAppSaved, setWhatsAppSaved] = useState(false);
  const [whatsAppClearError, setWhatsAppClearError] = useState<string | null>(null);

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

  const whatsAppAction = (formData: FormData) => {
    startWhatsAppTransition(async () => {
      const res = await saveWhatsAppCredentials(init, formData);
      if (res.error) {
        setWhatsAppError(res.error);
        setWhatsAppSaved(false);
        router.refresh();
        return;
      }
      setWhatsAppError(null);
      setWhatsAppClearError(null);
      setWhatsAppSaved(true);
      router.refresh();
      setTimeout(() => setWhatsAppSaved(false), 2500);
    });
  };

  async function onWhatsAppClear() {
    setWhatsAppClearError(null);
    const res = await clearWhatsAppCredentials();
    if (res.error) setWhatsAppClearError(res.error);
    else setWhatsAppError(null);
    router.refresh();
  }

  return (
    <div className="space-y-4">
    <div className="rounded-[var(--radius-card)] border border-line bg-canvas p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-[var(--radius-control)] bg-mint-500/12 text-mint-600">
            <MessageSquareText className="h-4 w-4" />
          </span>
          <div>
            <h3 className="text-sm font-bold text-ink-950">Netgsm SMS</h3>
            <p className="text-xs text-text-muted">Kampanya ve bildirim SMS&apos;leri bu hesap üzerinden gönderilir.</p>
          </div>
        </div>
        {netgsm ? (
          <span className="rounded-full bg-mint-500/12 px-2.5 py-1 text-xs font-bold text-mint-600">Ofis hesabı tanımlı</span>
        ) : platformConfigured ? (
          <span className="rounded-full bg-ink-950/8 px-2.5 py-1 text-xs font-bold text-text-muted">Platform varsayılanı</span>
        ) : (
          <span className="rounded-full bg-amber-400/15 px-2.5 py-1 text-xs font-bold text-amber-600">Yapılandırılmadı</span>
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
          label="Gelen SMS abone numarası"
          htmlFor="netgsm-inbound-receiver"
          required
          hint="Netgsm Gelen SMS bildirimindeki subscriberNumber. Yanlış ofise mesaj düşmesini engelleyen kesin hesap eşlemesidir."
        >
          <Input
            id="netgsm-inbound-receiver"
            name="inbound_receiver"
            required
            inputMode="numeric"
            autoComplete="off"
            defaultValue={netgsm?.inboundReceiver ?? ""}
            placeholder="850XXXXXXX"
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
              description="Ofise özel kimlik bilgileri silinecek. Açık bir platform fallback politikası yoksa SMS gönderimi kapalı kalır."
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

    <div className="rounded-[var(--radius-card)] border border-line bg-canvas p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-[var(--radius-control)] bg-brand-600/10 text-brand-600">
            <MessageCircle className="h-4 w-4" />
          </span>
          <div>
            <h3 className="text-sm font-bold text-ink-950">WhatsApp Cloud API</h3>
            <p className="text-xs text-text-muted">
              Kampanyalar onaylı Meta şablonlarıyla bu ofise ait numaradan gönderilir.
            </p>
          </div>
        </div>
        {whatsapp?.hasAccessToken && whatsapp.status === "healthy" ? (
          <span className="rounded-full bg-mint-500/12 px-2.5 py-1 text-xs font-bold text-mint-600">
            Meta sahipliği doğrulandı · sağlıklı
          </span>
        ) : whatsapp?.hasAccessToken ? (
          <span className="rounded-full bg-amber-400/15 px-2.5 py-1 text-xs font-bold text-amber-600">
            Yeniden doğrulama gerekli
          </span>
        ) : (
          <span className="rounded-full bg-amber-400/15 px-2.5 py-1 text-xs font-bold text-amber-600">
            Yapılandırılmadı
          </span>
        )}
      </div>

      <form action={whatsAppAction} className="mt-4 grid gap-3 sm:grid-cols-2">
        <FormField
          label="Telefon numarası kimliği"
          htmlFor="whatsapp-phone-number-id"
          required
          hint="Meta WhatsApp Manager'daki Phone number ID. Gelen webhook yönlendirmesi bu kimlikle ofise sabitlenir."
        >
          <Input
            id="whatsapp-phone-number-id"
            name="phone_number_id"
            required
            inputMode="numeric"
            pattern="[0-9]{5,32}"
            minLength={5}
            maxLength={32}
            autoComplete="off"
            defaultValue={whatsapp?.phoneNumberId ?? ""}
            placeholder="123456789012345"
          />
        </FormField>

        <FormField
          label="WhatsApp Business hesabı kimliği"
          htmlFor="whatsapp-waba-id"
          required
          hint="Onaylı mesaj şablonlarının listelendiği WABA ID."
        >
          <Input
            id="whatsapp-waba-id"
            name="waba_id"
            required
            inputMode="numeric"
            pattern="[0-9]{5,32}"
            minLength={5}
            maxLength={32}
            autoComplete="off"
            defaultValue={whatsapp?.wabaId ?? ""}
            placeholder="123456789012345"
          />
        </FormField>

        <FormField
          label="Meta Graph API sürümü"
          htmlFor="whatsapp-graph-version"
          required
          hint="Yalnız uygulamanın test ettiği sürümler kullanılabilir."
        >
          <select
            id="whatsapp-graph-version"
            name="graph_api_version"
            required
            defaultValue={whatsapp?.graphVersion || WHATSAPP_GRAPH_VERSIONS.at(-1)}
            className="h-10 w-full rounded-[var(--radius-control)] border border-line bg-surface px-3 text-sm text-ink-950 outline-none focus:border-brand-300"
          >
            {WHATSAPP_GRAPH_VERSIONS.map((version) => (
              <option key={version} value={version}>{version}</option>
            ))}
          </select>
        </FormField>

        <FormField
          label="Kalıcı erişim anahtarı"
          htmlFor="whatsapp-access-token"
          required={!whatsapp?.hasAccessToken}
          hint={whatsapp?.hasAccessToken
            ? "Kayıtlı ve maskeli — değiştirmeyecekseniz boş bırakın."
            : "Meta sistem kullanıcısı için gerekli izinlere sahip kalıcı erişim anahtarı."}
        >
          <Input
            id="whatsapp-access-token"
            name="access_token"
            type="password"
            required={!whatsapp?.hasAccessToken}
            minLength={20}
            maxLength={4096}
            autoComplete="new-password"
            placeholder={whatsapp?.hasAccessToken ? "••••••••••••••••" : "Erişim anahtarı"}
          />
        </FormField>

        {whatsAppError ? (
          <p className="text-sm text-danger-500 sm:col-span-2" role="alert">{whatsAppError}</p>
        ) : null}
        {whatsAppClearError ? (
          <p className="text-sm text-danger-500 sm:col-span-2" role="alert">{whatsAppClearError}</p>
        ) : null}

        <div className="flex items-center justify-end gap-2 sm:col-span-2">
          {whatsAppSaved ? (
            <span className="flex items-center gap-1.5 text-sm font-semibold text-mint-600">
              <Check className="h-4 w-4" /> Kaydedildi
            </span>
          ) : null}
          {whatsapp ? (
            <ConfirmDialog
              title="WhatsApp Cloud API bağlantısını kaldır"
              description="Ofise ait yönlendirme bilgileri ve erişim anahtarı silinecek. Açıkça etkinleştirilmiş bir platform fallback politikası yoksa WhatsApp gönderimi kapalı kalır."
              confirmLabel="Kaldır"
              onConfirm={onWhatsAppClear}
              trigger={
                <Button type="button" variant="ghost" size="sm">
                  <Trash2 className="h-3.5 w-3.5" /> Kaldır
                </Button>
              }
            />
          ) : null}
          <Button type="submit" loading={whatsAppPending}>
            <Save className="h-4 w-4" /> Kaydet
          </Button>
        </div>
      </form>
    </div>
    </div>
  );
}
