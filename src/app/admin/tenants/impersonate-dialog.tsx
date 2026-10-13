"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { ArrowRight, LifeBuoy } from "lucide-react";
import { startImpersonation } from "@/app/actions/platform";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTrigger } from "@/components/ui/dialog";
import { FormField, FormInput, FormTextarea } from "@/components/ui/form-controls";
import {
  IMPERSONATION_REASON_MAX,
  IMPERSONATION_REASON_MIN,
  IMPERSONATION_TICKET_MAX,
  parseImpersonationReason,
} from "@/lib/platform-security/impersonation-reason";

/**
 * "Ofise gir" (AD11): destek erişimi gerekçe + bilet no olmadan başlamaz. Sunucu aynı kuralı yeniden uygular;
 * ofis sahibi erişimi kendi denetim günlüğünde "EmlakSoft destek erişimi" olarak (gerekçe + bilet ile) görür.
 */
export function ImpersonateDialog({ tenantId, name }: { tenantId: string; name: string }) {
  const [reason, setReason] = useState("");
  const [ticket, setTicket] = useState("");
  const check = parseImpersonationReason(reason, ticket);
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button type="button" size="sm" variant="gold" icon={ArrowRight} aria-label={`Ofise gir: ${name}`} title="Destek oturumuyla ofis paneline gir">
          <span className="btn-text">Ofise gir</span>
        </Button>
      </DialogTrigger>
      <DialogContent size="sm">
        <DialogHeader
          icon={<LifeBuoy />}
          title={`${name} paneline destek erişimi`}
          description="Salt okunur, en çok 4 saat. Ofis sahibi bu erişimi gerekçe ve bilet numarasıyla kendi denetim günlüğünde görür."
        />
        <form action={startImpersonation}>
          <DialogBody className="space-y-3">
            <input type="hidden" name="tenant_id" value={tenantId} />
            <FormField label="Gerekçe" htmlFor={`imp-reason-${tenantId}`} required hint={`En az ${IMPERSONATION_REASON_MIN} karakter.`}>
              <FormTextarea
                id={`imp-reason-${tenantId}`}
                name="reason"
                rows={3}
                required
                minLength={IMPERSONATION_REASON_MIN}
                maxLength={IMPERSONATION_REASON_MAX}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Örn. Ofis sahibinin bildirdiği portföy listeleme sorunu inceleniyor"
              />
            </FormField>
            <FormField label="Destek bileti no" htmlFor={`imp-ticket-${tenantId}`} required hint="Destek talebi numarası (ör. #1042).">
              <FormInput
                id={`imp-ticket-${tenantId}`}
                name="ticket_id"
                required
                maxLength={IMPERSONATION_TICKET_MAX}
                autoComplete="off"
                value={ticket}
                onChange={(e) => setTicket(e.target.value)}
              />
            </FormField>
          </DialogBody>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="secondary">Vazgeç</Button>
            </DialogClose>
            <SubmitButton disabled={!check.ok} />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="gold" icon={ArrowRight} loading={pending} disabled={disabled}>
      Ofise gir
    </Button>
  );
}
