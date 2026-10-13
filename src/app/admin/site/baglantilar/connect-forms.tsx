"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, ExternalLink, Link2Off, PlugZap, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FormField, FormInput } from "@/components/ui/form-controls";
import {
  disconnectGoogle,
  listGscProperties,
  saveAdsAccount,
  saveGoogleClient,
  selectGscProperty,
  startGoogleConnect,
  testAdsConnection,
  type GoogleActionResult,
} from "@/app/actions/google-connect";
import type { GscSite } from "@/lib/google/gsc";
import type { GoogleService } from "@/lib/google/keys";

/**
 * Bağlantılar sihirbazının etkileşimli parçaları (yalnız super_admin'e çizilir; ops salt okur).
 * Google'a giden her istek kullanıcı tıklamasıyla sunucu eyleminde yapılır; sayfa çiziminde dış çağrı yoktur.
 */

function Note({ res }: { res: GoogleActionResult | null }) {
  if (!res) return null;
  if (res.error) {
    return (
      <p role="alert" className="rounded-[var(--radius-control)] bg-danger-500/8 px-3 py-2 text-sm font-medium text-danger-600">
        {res.error}
      </p>
    );
  }
  return (
    <p role="status" className="flex items-center gap-1.5 text-sm font-medium text-success-strong">
      <CheckCircle2 className="h-4 w-4" aria-hidden /> {res.message ?? "Kaydedildi."}
    </p>
  );
}

function useAction() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [res, setRes] = useState<GoogleActionResult | null>(null);
  const run = (fn: () => Promise<GoogleActionResult>, after?: (r: GoogleActionResult) => void) =>
    start(async () => {
      const r = await fn();
      setRes(r);
      after?.(r);
      if (r.ok && !r.url) router.refresh();
    });
  return { pending, res, run };
}

export function ClientForm({ configured }: { configured: boolean }) {
  const { pending, res, run } = useAction();
  return (
    <form
      className="space-y-3"
      action={(fd) => run(() => saveGoogleClient(fd))}
    >
      <div className="grid gap-3 md:grid-cols-2">
        <FormField label="İstemci kimliği (Client ID)" htmlFor="g-client-id" hint="….apps.googleusercontent.com ile biter.">
          <FormInput id="g-client-id" name="clientId" autoComplete="off" spellCheck={false} maxLength={200} required />
        </FormField>
        <FormField
          label="İstemci sırrı (Client secret)"
          htmlFor="g-client-secret"
          hint={configured ? "Boş bırakırsanız kayıtlı sır korunur." : "Şifreli saklanır; bir daha gösterilmez."}
        >
          <FormInput id="g-client-secret" name="clientSecret" type="password" autoComplete="new-password" maxLength={200} />
        </FormField>
      </div>
      <Button type="submit" loading={pending}>
        {configured ? "İstemciyi güncelle" : "İstemciyi kaydet"}
      </Button>
      <Note res={res} />
    </form>
  );
}

export function ConnectButton({ service, label, reconnect }: { service: GoogleService; label: string; reconnect?: boolean }) {
  const { pending, res, run } = useAction();
  return (
    <div className="space-y-2">
      <Button
        icon={PlugZap}
        loading={pending}
        onClick={() =>
          run(
            () => startGoogleConnect(service),
            (r) => {
              if (r.ok && r.url) window.location.assign(r.url);
            },
          )
        }
      >
        {reconnect ? `${label} hizmetini yeniden bağla` : `${label} hizmetini bağla`}
      </Button>
      <Note res={res?.error ? res : null} />
    </div>
  );
}

export function GscPropertyPicker({ current }: { current: string | null }) {
  const list = useAction();
  const save = useAction();
  const [sites, setSites] = useState<GscSite[] | null>(null);
  const [picked, setPicked] = useState<string>(current ?? "");
  return (
    <div className="space-y-3">
      <Button
        variant="secondary"
        icon={Search}
        loading={list.pending}
        onClick={() =>
          list.run(listGscProperties, (r) => {
            if (r.sites) {
              setSites(r.sites);
              setPicked(current ?? r.suggested ?? "");
            }
          })
        }
      >
        Search Console mülklerini getir
      </Button>
      <Note res={list.res?.error ? list.res : null} />
      {sites ? (
        sites.length === 0 ? (
          <p role="status" className="text-sm text-text-muted">
            Bu Google hesabında doğrulanmış mülk yok. Search Console&apos;da emlaksoft.com.tr için Alan (Domain) mülkü ekleyip doğrulayın.
          </p>
        ) : (
          <form className="space-y-2" action={(fd) => save.run(() => selectGscProperty(fd))}>
            <fieldset className="space-y-1.5">
              <legend className="text-sm font-semibold text-ink-950">Mülk seçin</legend>
              {sites.map((s) => (
                <label key={s.siteUrl} className="flex items-center gap-2 text-sm">
                  <input type="radio" name="siteUrl" value={s.siteUrl} checked={picked === s.siteUrl} onChange={() => setPicked(s.siteUrl)} />
                  <span className="font-mono">{s.siteUrl}</span>
                  {s.siteUrl.startsWith("sc-domain:") ? <span className="rounded-full bg-mint-500/15 px-2 py-0.5 text-xs font-bold text-mint-700">Önerilen: Alan mülkü</span> : null}
                </label>
              ))}
            </fieldset>
            <Button type="submit" loading={save.pending} disabled={!picked}>
              Mülkü kaydet
            </Button>
            <Note res={save.res} />
          </form>
        )
      ) : null}
    </div>
  );
}

export function AdsAccountForm({ configured, apiVersion }: { configured: boolean; apiVersion: string }) {
  const { pending, res, run } = useAction();
  return (
    <form className="space-y-3" action={(fd) => run(() => saveAdsAccount(fd))}>
      <div className="grid gap-3 md:grid-cols-2">
        <FormField label="Müşteri kimliği" htmlFor="g-ads-cid" hint="Google Ads sağ üstteki 123-456-7890 biçimindeki numara.">
          <FormInput id="g-ads-cid" name="customerId" inputMode="numeric" autoComplete="off" maxLength={20} required />
        </FormField>
        <FormField label="Yönetici hesap (MCC) kimliği" htmlFor="g-ads-mcc" hint="Hesaba yönetici hesap üzerinden erişiyorsanız; yoksa boş bırakın.">
          <FormInput id="g-ads-mcc" name="loginCustomerId" inputMode="numeric" autoComplete="off" maxLength={20} />
        </FormField>
        <FormField
          label="Developer token"
          htmlFor="g-ads-token"
          hint={configured ? "Boş bırakırsanız kayıtlı token korunur." : "Şifreli saklanır. Basic erişim başvurusu günler sürebilir."}
        >
          <FormInput id="g-ads-token" name="developerToken" type="password" autoComplete="new-password" maxLength={100} />
        </FormField>
        <FormField label="API sürümü" htmlFor="g-ads-version" hint={`Boşsa ${apiVersion}. Google eski sürümleri yaklaşık 12 ayda kapatır.`}>
          <FormInput id="g-ads-version" name="apiVersion" placeholder={apiVersion} maxLength={5} autoComplete="off" />
        </FormField>
      </div>
      <Button type="submit" loading={pending}>
        {configured ? "Ads ayarlarını güncelle" : "Ads ayarlarını kaydet"}
      </Button>
      <Note res={res} />
    </form>
  );
}

export function TestAdsButton() {
  const { pending, res, run } = useAction();
  return (
    <div className="space-y-2">
      <Button variant="secondary" loading={pending} onClick={() => run(testAdsConnection)}>
        Ads hesabına erişimi dene
      </Button>
      <Note res={res} />
    </div>
  );
}

export function DisconnectButton({ service, label }: { service: GoogleService; label: string }) {
  const { pending, res, run } = useAction();
  return (
    <div className="space-y-2">
      <ConfirmDialog
        trigger={
          <Button variant="secondary" size="sm" loading={pending} icon={Link2Off}>
            Bağlantıyı kes
          </Button>
        }
        title={`${label} bağlantısı kesilsin mi?`}
        description="Kayıtlı belirteç silinir. Diğer Google hizmeti bağlı değilse Google'daki izin de iptal edilir; bağlıysa o hizmet etkilenmesin diye izin korunur ve son hizmeti kestiğinizde tümüyle iptal edilir. Toplanmış geçmiş veriler silinmez; yeniden bağlayınca akış kaldığı yerden sürer."
        confirmLabel="Bağlantıyı kes"
        onConfirm={() => run(() => disconnectGoogle(service))}
      />
      <Note res={res} />
    </div>
  );
}

export function DocLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold text-brand-700 hover:underline">
      {children}
      <ExternalLink className="h-3.5 w-3.5" aria-hidden />
    </a>
  );
}
