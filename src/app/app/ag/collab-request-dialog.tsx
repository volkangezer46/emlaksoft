"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Handshake } from "lucide-react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea, FormField } from "@/components/ui/input";
import { sendCollabRequest, type NetworkResult } from "@/app/actions/network";

const init: NetworkResult = {};

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

  const action = (formData: FormData) => {
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
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="secondary">
          <Handshake className="h-4 w-4" /> İş birliği talep et
        </Button>
      </DialogTrigger>

      <DialogContent size="sm">
        <DialogHeader
          icon={<Handshake />}
          title="İş birliği talebi"
          description={`${officeName} ofisine "${listingTitle}" ilanı için talep gönderilecek. İletişim bilgileri yalnız karşılıklı kabul sonrası açılır.`}
        />
        <form action={action} className="space-y-4 p-6">
          <input type="hidden" name="listing_id" value={listingId} />

          <FormField label="Mesajınız" htmlFor={`nw-msg-${listingId}`} required>
            <Textarea
              id={`nw-msg-${listingId}`}
              name="message"
              rows={4}
              required
              maxLength={1000}
              placeholder="Örn. Bu bölgede hazır alıcımız var, ortak çalışmak isteriz…"
            />
          </FormField>

          {error ? (
            <p className="rounded-[8px] bg-danger-500/8 px-3 py-2 text-sm font-medium text-danger-600" role="alert">
              {error}
            </p>
          ) : null}

          <div className="hairline-t flex justify-end gap-2 pt-4">
            <DialogClose asChild>
              <Button type="button" variant="secondary">Vazgeç</Button>
            </DialogClose>
            <Button type="submit" loading={pending}>
              <Handshake className="h-4 w-4" /> Talebi gönder
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
