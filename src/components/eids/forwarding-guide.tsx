"use client";

import { useState } from "react";
import { ArrowRight, AtSign, Inbox } from "lucide-react";
import { CopyTextButton } from "@/components/app/copy-text-button";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  FORWARDING_PROVIDERS,
  fillForwardingText,
  isForwardingProviderId,
  type ForwardingProviderId,
} from "@/lib/eids/forwarding";
import { EIDS_SENDER_ADDRESS } from "@/lib/eids/legal-text";
import { EIDS_MAILBOX_SETTINGS_HREF } from "@/lib/eids/links";

function UnverifiedBadge() {
  return (
    <Badge variant="warning" size="sm" className="ml-1.5 align-middle">
      Doğrulanmadı
    </Badge>
  );
}

function CopyRow({ icon: Icon, label, value, copyLabel }: { icon: typeof Inbox; label: string; value: string; copyLabel: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-[var(--radius-card)] border border-line bg-canvas px-3 py-2.5">
      <Icon className="h-4 w-4 shrink-0 text-text-muted" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-xs text-text-muted">{label}</p>
        <p className="break-all font-mono text-sm font-semibold text-ink-950">{value}</p>
      </div>
      <CopyTextButton text={value} label={copyLabel} doneMessage={`${label} kopyalandı`} />
    </div>
  );
}

/**
 * Bakanlık (EİDS) e-postalarını EmlakSoft'a iletme kılavuzu: sağlayıcı sekmeleri (Gmail, Google Workspace, Outlook/Hotmail,
 * Microsoft 365, Yandex, cPanel). Ofisin alma adresi her adımda hazır yazılı gelir, adres ve gönderici kopyalanabilir.
 *
 * ADRES PROP'TAN GELİR (durumda tutulmaz): kart "Adresi yenile" ile yeni adresi verdiğinde bileşendeki tüm adımlar aynı
 * render'da güncellenir. Adres yoksa (henüz üretilmedi / bu ekran adresi okuyamıyor) adımlar yer tutucuyla çizilir ve
 * adresin alınacağı karta bağlantı gösterilir. Kullanım: Ayarlar > Entegrasyonlar kartı (EP3), İlan Kontrol > Yetki,
 * Kurulum sihirbazı "Bakanlık e-postaları" adımı.
 */
export function EidsForwardingGuide({
  address,
  defaultProvider = "gmail",
  setupHref = EIDS_MAILBOX_SETTINGS_HREF,
  showSetupLink = true,
}: {
  /** Ofisin geçerli alma adresi (yetki-…@eids.emlaksoft.com.tr); yoksa null. */
  address: string | null;
  defaultProvider?: ForwardingProviderId;
  /** Adresin üretildiği / yenilendiği yer. */
  setupHref?: string;
  /** Kartın kendi içinde kullanıldığında bağlantı gizlenir. */
  showSetupLink?: boolean;
}) {
  const [tab, setTab] = useState<ForwardingProviderId>(defaultProvider);
  const addr = address?.trim() || null;

  return (
    <div className="space-y-4">
      <div className="grid gap-2 md:grid-cols-2">
        {addr ? (
          <CopyRow icon={Inbox} label="EmlakSoft alma adresiniz" value={addr} copyLabel="Adresi kopyala" />
        ) : (
          <Alert
            tone="info"
            title="Alma adresiniz bu ekranda görünmüyor"
            action={
              showSetupLink ? (
                <ButtonLink href={setupHref} variant="secondary" size="sm" iconRight={ArrowRight}>
                  Adresi al
                </ButtonLink>
              ) : undefined
            }
          >
            Adres Ayarlar &gt; Entegrasyonlar &gt; Bakanlık (EİDS) e-postaları kartında üretilir. Adımlarda adresin yerine
            &quot;EmlakSoft alma adresiniz&quot; yazar; kurarken karttaki adresi kullanın.
          </Alert>
        )}
        <CopyRow icon={AtSign} label="Bakanlık gönderici adresi (yalnız bunu iletin)" value={EIDS_SENDER_ADDRESS} copyLabel="Göndericiyi kopyala" />
      </div>

      <Tabs value={tab} onValueChange={(v) => (isForwardingProviderId(v) ? setTab(v) : undefined)}>
        <TabsList aria-label="E-posta sağlayıcınız">
          {FORWARDING_PROVIDERS.map((p) => (
            <TabsTrigger key={p.id} value={p.id}>
              {p.label}
            </TabsTrigger>
          ))}
        </TabsList>
        {FORWARDING_PROVIDERS.map((p) => (
          <TabsContent key={p.id} value={p.id} className="space-y-3">
            <p className="text-sm text-text-muted">{p.fits}</p>
            <ol className="list-decimal space-y-2 pl-5 text-sm leading-relaxed text-text marker:font-bold marker:text-brand-600">
              {p.steps.map((s) => (
                <li key={s.text}>
                  {fillForwardingText(s.text, addr)}
                  {s.unverified ? <UnverifiedBadge /> : null}
                </li>
              ))}
            </ol>
            {p.warning ? (
              <Alert tone="warning" title={p.warning.title}>
                {p.warning.text}
                {p.warning.unverified ? <UnverifiedBadge /> : null}
              </Alert>
            ) : null}
          </TabsContent>
        ))}
      </Tabs>

      <p className="text-xs text-text-muted">
        Kural tüm gelen kutunuzu değil, yalnız {EIDS_SENDER_ADDRESS} adresinden gelenleri iletmelidir. EmlakSoft başka göndericiden
        gelen e-postayı okumadan siler. İlk gerçek e-posta ya da Gmail onay kodu geldiğinde kart &quot;Bağlı&quot; olur.
      </p>
    </div>
  );
}
