"use client";

import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { createSupportTicket, type TicketResult } from "@/app/actions/tickets";
import { TicketAttachmentInput, uploadTicketFiles } from "../ticket-attachment-input";
import { Button, ButtonLink } from "@/components/ui/button";
import { FormActions, FormPage, FormSection } from "@/components/ui/form-page";
import { FormError, FormField, FormInput, FormSelect, FormTextarea } from "@/components/ui/form-controls";
import { useToast } from "@/components/app/toast-provider";

type CreateState = TicketResult & { warning?: string };
const initial: CreateState = {};

const DEFAULT_CATEGORY_OPTIONS: { value: string; label: string }[] = [
  { value: "general", label: "Genel" },
  { value: "billing", label: "Abonelik / fatura" },
  { value: "bug", label: "Hata bildirimi" },
  { value: "feature", label: "Özellik isteği" },
  { value: "compliance", label: "İYS / KVKK" },
  { value: "onboarding", label: "Kurulum" },
];

export function NewTicketForm({
  categoryOptions = DEFAULT_CATEGORY_OPTIONS,
}: {
  categoryOptions?: { value: string; label: string }[];
} = {}) {
  const [requestId, setRequestId] = useState("");
  const [attachmentKey, setAttachmentKey] = useState(0);
  const router = useRouter();
  const { push } = useToast();
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setRequestId(crypto.randomUUID()), 0);
    return () => window.clearTimeout(timer);
  }, []);

  const [state, action, pending] = useActionState<CreateState, FormData>(async (_previous, formData) => {
    const stableRequestId = String(formData.get("request_id") ?? "");
    if (!stableRequestId) return { error: "Güvenli gönderim kimliği hazırlanıyor. Lütfen tekrar deneyin." };

    const files = formData.getAll("files").filter((item): item is File => item instanceof File && item.size > 0);
    const ticketData = new FormData();
    for (const field of ["subject", "body", "category", "priority"] as const) {
      ticketData.set(field, String(formData.get(field) ?? ""));
    }
    ticketData.set("request_id", stableRequestId);

    const result = await createSupportTicket({}, ticketData);
    if (!result.ok) return result;
    if (!result.ticketId) return { error: "Talep oluşturuldu ancak güvenli referansı alınamadı." };

    const uploaded = await uploadTicketFiles({
      ticketId: result.ticketId,
      visibility: "public",
      files,
    });

    startTransition(() => {
      formRef.current?.reset();
      setAttachmentKey((value) => value + 1);
      setRequestId(crypto.randomUUID());
    });

    if (!uploaded.ok) {
      return {
        ...result,
        warning:
          uploaded.uploaded > 0
            ? `Talep oluşturuldu ve ${uploaded.uploaded} dosya eklendi; bazı dosyalar eklenemedi. ${uploaded.error ?? ""}`.trim()
            : `Talep oluşturuldu ancak dosya eklenemedi. ${uploaded.error ?? ""}`.trim(),
      };
    }

    startTransition(() => {
      push("Destek talebi oluşturuldu", "ok");
      router.push(`/app/destek/${result.ticketId}`);
      router.refresh();
    });
    return result;
  }, initial);

  return (
    <form ref={formRef} action={action}>
      <input type="hidden" name="request_id" value={requestId} />
      <FormPage
        title="Yeni destek talebi"
        description="Sorunu, beklenen sonucu ve denediğiniz adımları paylaşın."
        eyebrow="Destek merkezi"
        breadcrumbs={[{ label: "Destek", href: "/app/destek" }, { label: "Yeni talep" }]}
      >
        <FormSection title="Talep bilgileri">
          <FormField label="Konu" htmlFor="subject" required className="sm:col-span-2">
            <FormInput
              name="subject"
              required
              minLength={3}
              maxLength={200}
              placeholder="Örn. Portal ilanım yayına gitmiyor"
            />
          </FormField>
          <FormField label="Kategori" htmlFor="category">
            <FormSelect name="category" defaultValue="general">
              {categoryOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </FormSelect>
          </FormField>
          <FormField label="Öncelik" htmlFor="priority">
            <FormSelect name="priority" defaultValue="normal">
              <option value="low">Düşük</option>
              <option value="normal">Normal</option>
              <option value="high">Yüksek</option>
              <option value="urgent">Acil</option>
            </FormSelect>
          </FormField>
          <FormField label="Açıklama" htmlFor="body" required className="sm:col-span-2">
            <FormTextarea
              name="body"
              required
              minLength={3}
              maxLength={20_000}
              rows={8}
              className="resize-y leading-relaxed"
              placeholder="Ne oldu, ne olmasını bekliyordunuz ve hangi adımları denediniz?"
            />
          </FormField>
        </FormSection>

        <FormSection title="Ekler" description="İsteğe bağlı: ekran görüntüsü veya belge ekleyebilirsiniz.">
          <div className="sm:col-span-2">
            <TicketAttachmentInput key={attachmentKey} id="new-ticket-files" disabled={pending} />
            <p className="mt-2 flex items-center gap-1.5 text-xs text-text-faint">
              <ShieldCheck className="h-3.5 w-3.5 text-mint-600" aria-hidden /> Dosyalar private depoda içerik ve bütünlük denetiminden geçirilir.
            </p>
          </div>
        </FormSection>

        <FormError error={state.error} />
        {state.warning ? (
          <div className="rounded-[var(--radius-control)] border border-amber-400/30 bg-amber-400/10 p-3 text-sm text-amber-800" role="status">
            <p>{state.warning}</p>
            {state.ticketId ? <Link href={`/app/destek/${state.ticketId}`} className="mt-1 inline-block font-semibold underline">Oluşturulan talebe git</Link> : null}
          </div>
        ) : null}

        <FormActions>
          <ButtonLink href="/app/destek" variant="secondary">İptal</ButtonLink>
          <Button type="submit" loading={pending} disabled={pending || !requestId}>
            {pending ? "Gönderiliyor…" : "Talep oluştur"}
          </Button>
        </FormActions>
      </FormPage>
    </form>
  );
}
