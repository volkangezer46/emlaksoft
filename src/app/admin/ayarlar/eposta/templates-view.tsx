import { SettingField } from "@/components/settings/setting-field";
import { Badge } from "@/components/ui/badge";
import { composeTemplateEmail } from "@/lib/email/send";
import {
  DEFAULT_EMAIL_FOOTER,
  EMAIL_TEMPLATE_GROUPS,
  EMAIL_TEMPLATES,
  EMAIL_VARIABLES,
  hasEditableSubject,
  sampleVars,
  templateSettingKey,
  type EmailTemplateDef,
} from "@/lib/email/templates";
import { EMAIL_FOOTER_KEY } from "@/lib/settings/registry/email";
import { getPlatformSettingViews } from "@/lib/settings/read";
import type { SettingView } from "@/lib/settings/types";
import { TemplateSampleButton } from "./email-channel-tools";
import Link from "@/components/ui/smart-link";
import { INTEGRATIONS_HREF } from "@/lib/admin/integration-hub/model";
import { templateBadge } from "@/lib/email/template-status";

/**
 * Şablon merkezi: grup grup katalog; her şablonda değişken kataloğu, konu/gövde düzenleme (ayar defteri; tanımsız
 * değişken kaydedilemez), kayıtlı metnin örnek veriyle HTML önizlemesi (yalıtılmış iframe, betik yok) ve kendine
 * örnek gönderim. Ayar görünümleri TEK okumayla alınır (şablon başına sorgu yok).
 */
export async function TemplatesView({ canEdit, channelEnabled }: { canEdit: boolean; channelEnabled: boolean }) {
  const views = await getPlatformSettingViews();
  const byKey = new Map<string, SettingView>(views.map((v) => [v.key, v]));
  const footer = byKey.get(EMAIL_FOOTER_KEY)?.formValue || DEFAULT_EMAIL_FOOTER;

  const blocked = channelEnabled ? 0 : EMAIL_TEMPLATES.filter((t) => templateBadge(t, false).variant === "danger").length;

  return (
    <div className="space-y-8">
      {blocked > 0 ? (
        <p role="status" className="tone-danger rounded-[var(--radius-card)] px-4 py-3 text-sm font-semibold">
          E-posta kanalı kapalı: akışa bağlı {blocked} şablon şu an HİÇ gönderilmiyor (doğrulama, fatura, KVKK dahil).{" "}
          <Link href={`${INTEGRATIONS_HREF}#anahtar-eposta`} className="underline">
            Resend anahtarı ve gönderen alan adını girin →
          </Link>
        </p>
      ) : null}
      <section aria-labelledby="degiskenler-baslik" className="space-y-2 rounded-[var(--radius-panel)] border border-line bg-surface p-5">
        <h2 id="degiskenler-baslik" className="text-base font-semibold text-ink-950">
          Değişken kataloğu
        </h2>
        <p className="text-xs text-text-muted">
          Şablonlarda yalnız şablonun kendi listesindeki değişkenler kullanılabilir; listede olmayan değişken içeren metin kaydedilmez. Tek
          başına satırdaki bağlantı değişkeni e-postada düğme olur. Ortak marka yerleşimi (başlık + alt bilgi) tüm e-postalarda aynıdır; alt
          bilgi &quot;Kanal&quot; sekmesinden değişir.
        </p>
        <ul className="flex flex-wrap gap-1.5">
          {Object.entries(EMAIL_VARIABLES).map(([name, v]) => (
            <li key={name} className="rounded-full border border-line bg-canvas px-2 py-0.5 text-xs">
              <code className="font-semibold text-ink-950">{`{${name}}`}</code> <span className="text-text-muted">{v.label}</span>
            </li>
          ))}
        </ul>
      </section>

      {EMAIL_TEMPLATE_GROUPS.map((g) => {
        const list = EMAIL_TEMPLATES.filter((t) => t.group === g.id);
        if (list.length === 0) return null;
        return (
          <section key={g.id} aria-labelledby={`grup-${g.id}`} className="space-y-3">
            <h2 id={`grup-${g.id}`} className="text-sm font-bold uppercase tracking-wide text-text-muted">
              {g.label}
            </h2>
            {g.id === "auth" ? (
              <p className="text-xs text-text-muted">
                Bu e-postaları Supabase Auth (GoTrue) gönderir; metin bu uçtan çekilir: <code>/api/auth-templates/&lt;tip&gt;</code>. Konu satırı
                sunucu ortamından (GOTRUE_MAILER_SUBJECTS_*) gelir. Değişiklik deploy gerektirmez, en geç ~1 dakikada yansır.
              </p>
            ) : null}
            <div className="space-y-2">
              {list.map((t) => (
                <TemplateCard key={t.key} t={t} byKey={byKey} footer={footer} canEdit={canEdit} channelEnabled={channelEnabled} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function TemplateCard({
  t,
  byKey,
  footer,
  canEdit,
  channelEnabled,
}: {
  t: EmailTemplateDef;
  byKey: Map<string, SettingView>;
  footer: string;
  canEdit: boolean;
  channelEnabled: boolean;
}) {
  const subjectView = hasEditableSubject(t) ? byKey.get(templateSettingKey(t.key, "subject")) : undefined;
  const bodyView = byKey.get(templateSettingKey(t.key, "body"));
  const subject = subjectView?.formValue || t.defaultSubject;
  const body = bodyView?.formValue || t.defaultBody;
  const preview = composeTemplateEmail(t.key, { subject, body, footer }, sampleVars(t.key));
  const customized = Boolean((subjectView && !subjectView.isDefault) || (bodyView && !bodyView.isDefault));
  const badge = templateBadge(t, channelEnabled);

  return (
    <details id={t.key} className="group scroll-mt-24 rounded-[var(--radius-panel)] border border-line bg-surface">
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 px-5 py-3.5">
        <span className="font-semibold text-ink-950">{t.label}</span>
        <Badge variant={badge.variant} size="sm">
          {badge.label}
        </Badge>
        {customized ? (
          <Badge variant="info" size="sm">
            Özelleştirildi
          </Badge>
        ) : null}
        <span className="ml-auto text-xs text-text-faint group-open:hidden">Düzenle ▾</span>
      </summary>
      <div className="space-y-4 border-t border-line px-5 py-4">
        <p className="text-xs text-text-muted">Gönderen akış: {t.usedBy}</p>
        <p className="flex flex-wrap items-center gap-1.5 text-xs text-text-muted">
          Değişkenler:
          {t.variables.map((v) => (
            <code key={v} className="rounded bg-canvas px-1.5 py-0.5 text-ink-950" title={EMAIL_VARIABLES[v].label}>
              {`{${v}}`}
            </code>
          ))}
        </p>
        <div className="grid gap-3">
          {subjectView ? <SettingField view={subjectView} canEdit={canEdit} /> : null}
          {bodyView ? <SettingField view={bodyView} canEdit={canEdit} /> : null}
        </div>
        <div className="space-y-2">
          <p className="text-xs font-semibold text-text-muted">
            Önizleme (kayıtlı metin, örnek veri){hasEditableSubject(t) ? <> · Konu: <span className="text-ink-950">{preview.subject}</span></> : null}
          </p>
          <iframe
            title={`${t.label} önizleme`}
            sandbox=""
            srcDoc={preview.html}
            loading="lazy"
            className="h-[420px] w-full rounded-[var(--radius-control)] border border-line bg-white"
          />
        </div>
        {canEdit ? <TemplateSampleButton templateKey={t.key} disabled={!channelEnabled} /> : null}
      </div>
    </details>
  );
}
