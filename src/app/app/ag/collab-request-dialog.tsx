"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Handshake } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea, FormField } from "@/components/ui/input";
import { InlineTabbedPanel } from "@/components/ui/inline-tabbed-panel";
import { sendCollabRequest } from "@/app/actions/network/collab";
import type { NetworkResult } from "@/app/actions/network/shared";

const init: NetworkResult = {};

/** İş birliği talebi: popup yok, sayfa içi panel (InlineTabbedPanel). */
export function CollabRequestDialog({
  listingId,
  listingTitle,
  officeName,
}: {
  listingId: string;
  listingTitle: string;
  officeName: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const onSubmit = (formData: FormData) => {
    startTransition(async () => {
      const res = await sendCollabRequest(init, formData);
      if (res.error) {
        setError(res.error);
        return;
      }
      setError(null);
      setOpen(false);
      router.refresh();
    });
  };

  return (
    <InlineTabbedPanel
      open={open}
      onOpenChange={setOpen}
      title="İş birliği talebi"
      description={`${officeName} ofisine "${listingTitle}" ilanı için talep gönderilecek. İletişim bilgileri yalnız karşılıklı kabul sonrası açılır.`}
      icon={<Handshake />}
      onSubmit={onSubmit}
      pending={pending}
      error={error}
      submitLabel="Talebi gönder"
      fieldLabels={{ message: "Mesaj" }}
      trigger={({ onClick, ...aria }) => (
        <Button size="sm" variant="secondary" type="button" onClick={onClick} {...aria}>
          <Handshake className="h-4 w-4" /> İş birliği talep et
        </Button>
      )}
      hiddenFields={<input type="hidden" name="listing_id" value={listingId} />}
      tabs={[{ id: "mesaj", label: "Mesaj", icon: Handshake, fields: ["message"] }]}
      panels={{
        mesaj: (
          <FormField label="Mesajınız" htmlFor={`nw-msg-${listingId}`} required className="sm:col-span-2">
            <Textarea
              id={`nw-msg-${listingId}`}
              name="message"
              rows={4}
              required
              maxLength={1000}
              placeholder="Örn. Bu bölgede hazır alıcımız var, ortak çalışmak isteriz…"
            />
          </FormField>
        ),
      }}
    />
  );
}
