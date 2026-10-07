"use client";

import { useState, useTransition } from "react";
import Link from "@/components/ui/smart-link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Save } from "lucide-react";
import { FormField, FormInput, fieldClass } from "@/components/ui/form-controls";
import { useToast } from "@/components/app/toast-provider";
import { updateCampaign } from "@/app/actions/campaigns";

type Campaign = {
  id: string;
  title: string;
  channel: string;
  message: string;
  whatsappTemplateName: string;
  whatsappTemplateLanguage: string;
};

/** Taslak kampanya düzenleme sayfası (popup yok). Kanal ve hedef kitle alıcı kuyruğunu belirler; değişmez. */
export function EditCampaignForm({ campaign }: { campaign: Campaign }) {
  const router = useRouter();
  const { push } = useToast();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState(campaign.message);
  const isSms = campaign.channel === "sms";

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setError(null);
    startTransition(async () => {
      const res = await updateCampaign({}, fd);
      if (res.error) {
        setError(res.error);
        return;
      }
      push("Kampanya güncellendi", "ok");
      router.push(`/app/kampanyalar/${campaign.id}`);
    });
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <Link
        href={`/app/kampanyalar/${campaign.id}`}
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-text-muted transition hover:text-brand-600"
      >
        <ArrowLeft className="h-4 w-4" /> Kampanya detayına dön
      </Link>
      <form onSubmit={onSubmit} className="surface-card space-y-4 rounded-[var(--radius-panel)] p-5">
        <div>
          <h1 className="font-display text-xl font-bold text-ink-950">Taslağı düzenle</h1>
          <p className="mt-1 text-sm text-text-muted">
            Kanal ({isSms ? "SMS" : "WhatsApp"}) ve hedef kitle alıcı kuyruğunu belirlediği için değişmez; farklı bir kitle için yeni kampanya açın.
          </p>
        </div>
        <input type="hidden" name="id" value={campaign.id} />
        <FormField label="Kampanya başlığı" htmlFor="edit-kamp-title" required>
          <FormInput name="title" type="text" required defaultValue={campaign.title} />
        </FormField>
        {!isSms ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Onaylı şablon adı" htmlFor="edit-kamp-template" required>
              <FormInput
                name="whatsappTemplateName"
                type="text"
                required
                pattern="[a-z0-9_]{1,512}"
                maxLength={512}
                defaultValue={campaign.whatsappTemplateName}
              />
            </FormField>
            <FormField label="Dil kodu" htmlFor="edit-kamp-lang" required>
              <FormInput
                name="whatsappTemplateLanguage"
                type="text"
                required
                pattern="[a-z]{2,3}(_[A-Z]{2})?"
                maxLength={6}
                defaultValue={campaign.whatsappTemplateLanguage}
              />
            </FormField>
          </div>
        ) : null}
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <label htmlFor="edit-kamp-message" className="text-sm font-semibold text-ink-950">
              {isSms ? "Mesaj metni" : "Şablon gövde parametresi (isteğe bağlı)"}
            </label>
            <span className={`text-xs ${message.length > 160 ? "text-amber-600" : "text-text-faint"}`}>{message.length}/612 karakter</span>
          </div>
          <textarea
            id="edit-kamp-message"
            name="message"
            required={isSms}
            rows={5}
            maxLength={612}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            className={`${fieldClass} resize-none`}
          />
        </div>
        {error ? (
          <p role="alert" className="text-sm font-semibold text-danger-500">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Link
            href={`/app/kampanyalar/${campaign.id}`}
            className="focus-ring rounded-[var(--radius-control)] border border-line px-4 py-2 text-sm font-semibold text-text-muted transition hover:bg-canvas"
          >
            Vazgeç
          </Link>
          <button
            type="submit"
            disabled={pending}
            className="focus-ring press inline-flex items-center gap-2 rounded-[var(--radius-control)] bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-60"
          >
            <Save className="h-4 w-4" /> {pending ? "Kaydediliyor…" : "Kaydet"}
          </button>
        </div>
      </form>
    </div>
  );
}
