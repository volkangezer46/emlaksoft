"use client";

import { useState, useTransition } from "react";
import { ArrowDown, ArrowUp, RefreshCw, Trash2, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormField, FormInput, FormSelect, FormTextarea } from "@/components/ui/form-controls";
import { PersonSelect } from "@/components/ui/person-select";
import { listAutomationWhatsAppTemplates } from "@/app/actions/automations";
import type { ActionOption } from "./labels";
import type { DraftAction } from "./wizard-actions";

/**
 * Sihirbazın 3. adımındaki TEK eylem kartı: tür seçimi + o türün alanları + sırala/kaldır. Kart sırası çalışma
 * sırasıdır ("danışmana ata" önce gelirse sonraki görev/bildirim o kişiye gider). Dokunma hedefleri mobilde ≥44 px
 * (Button `touch:` boyları); hover'a bağlı eylem yok.
 */
export function ActionCard({
  index,
  total,
  draft,
  options,
  staff,
  statusOptions,
  statusLabel,
  onChange,
  onMove,
  onRemove,
}: {
  index: number;
  total: number;
  draft: DraftAction;
  options: ActionOption[];
  staff: { id: string; full_name: string }[];
  statusOptions: readonly { value: string; label: string }[];
  statusLabel: string;
  onChange: (patch: Partial<DraftAction>) => void;
  onMove: (delta: -1 | 1) => void;
  onRemove: () => void;
}) {
  const id = (name: string) => `aw-${draft.uid}-${name}`;
  const selected = options.find((o) => o.value === draft.type);

  return (
    <li className="rounded-[var(--radius-card)] border border-line bg-surface shadow-[var(--shadow-xs)]">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2.5 sm:px-4">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-mint-500/12 text-xs font-extrabold text-mint-700">
          {index + 1}
        </span>
        <div className="min-w-0 flex-1">
          <FormSelect
            aria-label={`${index + 1}. eylemin türü`}
            value={draft.type}
            onChange={(e) => onChange({ type: e.target.value })}
            className="font-semibold"
          >
            <option value="">Eylem seçin…</option>
            {options.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </FormSelect>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button variant="ghost" size="icon" icon={ArrowUp} aria-label="Eylemi yukarı taşı" disabled={index === 0} onClick={() => onMove(-1)} />
          <Button variant="ghost" size="icon" icon={ArrowDown} aria-label="Eylemi aşağı taşı" disabled={index === total - 1} onClick={() => onMove(1)} />
          <Button variant="ghost" size="icon" icon={Trash2} aria-label="Eylemi kaldır" disabled={total <= 1} onClick={onRemove} />
        </div>
      </div>

      <div className="space-y-3 px-3 py-3 sm:px-4">
        {selected ? (
          <p className="flex items-start gap-1.5 text-xs leading-relaxed text-text-muted">
            <Zap className="mt-0.5 h-3 w-3 shrink-0 text-mint-600" aria-hidden="true" /> {selected.description}
          </p>
        ) : (
          <p className="text-xs text-text-faint">Bu adımda ne yapılacağını seçin.</p>
        )}

        {draft.type === "create_task" && (
          <div className="grid gap-3 sm:grid-cols-3">
            <FormField label="Görev başlığı" htmlFor={id("title")} required className="sm:col-span-3">
              <FormInput value={draft.title} onChange={(e) => onChange({ title: e.target.value })} placeholder="ör. Müşteriyi ara" maxLength={200} />
            </FormField>
            <FormField label="Öncelik" htmlFor={id("priority")}>
              <FormSelect value={draft.priority} onChange={(e) => onChange({ priority: e.target.value })}>
                <option value="low">Düşük</option>
                <option value="normal">Normal</option>
                <option value="high">Yüksek</option>
              </FormSelect>
            </FormField>
            <FormField label="Termin (gün)" htmlFor={id("due")} hint="Boş bırakırsanız terminsiz açılır.">
              <FormInput type="number" inputMode="numeric" min={1} max={365} value={draft.dueDays} onChange={(e) => onChange({ dueDays: e.target.value })} placeholder="ör. 2" />
            </FormField>
          </div>
        )}

        {draft.type === "send_sms" && (
          <FormField label="SMS metni" htmlFor={id("sms")} required hint="{{name}} müşteri adıyla değişir. Yalnız İYS izni olan müşteriye gider.">
            <FormTextarea value={draft.message} onChange={(e) => onChange({ message: e.target.value })} rows={3} maxLength={500} placeholder="Sayın {{name}}, …" />
          </FormField>
        )}

        {(draft.type === "notify_manager" || draft.type === "send_notification") && (
          <FormField label="Bildirim metni" htmlFor={id("notify")} required>
            <FormTextarea value={draft.message} onChange={(e) => onChange({ message: e.target.value })} rows={2} maxLength={500} placeholder="ör. İlgilenilmesi gereken bir kayıt var." />
          </FormField>
        )}

        {draft.type === "send_whatsapp" && (
          <WhatsAppTemplateFields
            value={{ templateName: draft.templateName, language: draft.language, bodyParam: draft.bodyParam }}
            idPrefix={`aw-${draft.uid}`}
            onChange={onChange}
          />
        )}

        {draft.type === "send_email" && (
          <div className="space-y-3">
            <FormField label="Konu" htmlFor={id("subject")} required>
              <FormInput value={draft.subject} onChange={(e) => onChange({ subject: e.target.value })} maxLength={200} placeholder="ör. Aradığınız eve uygun yeni portföyler" />
            </FormField>
            <FormField label="E-posta metni" htmlFor={id("body")} required hint="{{name}} müşteri adıyla değişir. Yalnız e-posta İYS izni olan müşteriye gider; e-posta kanalı kapalıysa atlanır.">
              <FormTextarea value={draft.body} onChange={(e) => onChange({ body: e.target.value })} rows={5} maxLength={4000} placeholder={"Merhaba {{name}},\n…"} />
            </FormField>
          </div>
        )}

        {draft.type === "assign_to_staff" && (
          <div className="max-w-sm">
            <label htmlFor={id("assignee")} className="mb-1.5 block text-sm font-medium text-ink-950">Atanacak danışman *</label>
            <PersonSelect
              id={id("assignee")}
              value={draft.assigneeId}
              onValueChange={(v) => onChange({ assigneeId: v })}
              people={staff.map((s) => ({ id: s.id, name: s.full_name }))}
              emptyLabel="Seçin…"
            />
          </div>
        )}

        {draft.type === "add_tag" && (
          <FormField label="Eklenecek etiket" htmlFor={id("tag")} required className="max-w-sm">
            <FormInput value={draft.tag} onChange={(e) => onChange({ tag: e.target.value })} maxLength={50} placeholder="ör. sıcak-müşteri" />
          </FormField>
        )}

        {draft.type === "change_status" && (
          <FormField label={statusLabel} htmlFor={id("status")} required className="max-w-sm">
            <FormSelect value={draft.targetStatus} onChange={(e) => onChange({ targetStatus: e.target.value })}>
              <option value="">Seçin…</option>
              {statusOptions.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </FormSelect>
          </FormField>
        )}
      </div>
    </li>
  );
}

/**
 * Onaylı WhatsApp şablonu alanları: ofisin Meta hesabından onaylı şablonlar tek dokunuşla getirilir; liste
 * okunamazsa ad ve dil elle girilebilir. Serbest metin YOK (iş başlatan WhatsApp yalnız onaylı şablondur).
 */
export type WhatsAppTemplateValue = { templateName: string; language: string; bodyParam: string };

export function WhatsAppTemplateFields({
  value: draft,
  idPrefix,
  onChange,
}: {
  value: WhatsAppTemplateValue;
  idPrefix: string;
  onChange: (patch: Partial<WhatsAppTemplateValue>) => void;
}) {
  const id = (name: string) => `${idPrefix}-${name}`;
  const [templates, setTemplates] = useState<{ name: string; language: string }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function load() {
    setError(null);
    startTransition(async () => {
      const res = await listAutomationWhatsAppTemplates();
      if (!res.ok) {
        setError(res.error);
        setTemplates([]);
        return;
      }
      setTemplates(res.templates);
    });
  }

  const current = draft.templateName && draft.language ? `${draft.templateName}:${draft.language}` : "";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1">
          {templates && templates.length > 0 ? (
            <FormField label="Onaylı şablon" htmlFor={id("wa-pick")}>
              <FormSelect
                value={current}
                onChange={(e) => {
                  const [name, language] = e.target.value.split(":");
                  onChange({ templateName: name ?? "", language: language ?? "tr" });
                }}
              >
                <option value="">Şablon seçin…</option>
                {templates.map((t) => (
                  <option key={`${t.name}:${t.language}`} value={`${t.name}:${t.language}`}>
                    {t.name} · {t.language}
                  </option>
                ))}
              </FormSelect>
            </FormField>
          ) : (
            <p className="text-xs leading-relaxed text-text-muted">
              Meta hesabınızdaki onaylı şablonu seçin ya da adını ve dilini aşağıya elle girin.
            </p>
          )}
        </div>
        <Button variant="outline" size="sm" icon={RefreshCw} loading={pending} onClick={load}>
          {templates ? "Yenile" : "Onaylı şablonları getir"}
        </Button>
      </div>
      {error ? (
        <p className="text-xs leading-relaxed text-amber-700" role="status">{error} Ad ve dili elle girebilirsiniz.</p>
      ) : templates && templates.length === 0 ? (
        <p className="text-xs text-text-faint" role="status">Hesapta onaylı şablon bulunamadı; Meta&apos;da onaylandıysa adı ve dili elle girin.</p>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-[1fr_7rem]">
        <FormField label="Şablon adı" htmlFor={id("wa-name")} required>
          <FormInput
            value={draft.templateName}
            onChange={(e) => onChange({ templateName: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "") })}
            maxLength={512}
            placeholder="ör. portfoy_duyurusu"
            autoCapitalize="none"
            spellCheck={false}
          />
        </FormField>
        <FormField label="Dil" htmlFor={id("wa-lang")} required>
          <FormInput value={draft.language} onChange={(e) => onChange({ language: e.target.value.trim() })} maxLength={6} placeholder="tr" autoCapitalize="none" spellCheck={false} />
        </FormField>
      </div>
      <FormField
        label="Şablondaki {{1}} değişkeni (isteğe bağlı)"
        htmlFor={id("wa-param")}
        hint="Şablon gövdesinde tek değişken varsa doldurun; {{name}} müşteri adıyla değişir. Şablonla uyuşmazsa ileti gönderilmez ve çalışma geçmişinde nedeni görünür."
      >
        <FormInput value={draft.bodyParam} onChange={(e) => onChange({ bodyParam: e.target.value })} maxLength={200} placeholder="ör. {{name}}" />
      </FormField>
    </div>
  );
}
