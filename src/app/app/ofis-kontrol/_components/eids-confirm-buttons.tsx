"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Mail, MessageCircle, MessageSquareText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/app/toast-provider";
import { sendAuthorityReminder, type AuthorityActionResult } from "@/app/actions/authority-queue";

/**
 * "Malikten teyit iste" düğmeleri (haftalık Yetki doğrula listesi). Sunucu eylemi yetki + İYS kapısını uygular; WhatsApp
 * için hazır bağlantı yeni sekmede açılır (danışmanın kendi hattı). Mesaj malikten e-Devlet ekran görüntüsünü ister.
 */
export function EidsConfirmButtons({ propertyId, hasPhone, hasEmail }: { propertyId: string; hasPhone: boolean; hasEmail: boolean }) {
  const router = useRouter();
  const { push } = useToast();
  const [pending, start] = useTransition();

  const run = (channel: "sms" | "whatsapp" | "email") =>
    start(async () => {
      let r: AuthorityActionResult;
      try {
        r = await sendAuthorityReminder(propertyId, channel, "confirm");
      } catch {
        push("Mesaj gönderilemedi: bağlantı sorunu olabilir; birkaç saniye sonra tekrar deneyin.", "err");
        return;
      }
      if (r.error) {
        push(r.error, "err");
        return;
      }
      if (r.waUrl) window.open(r.waUrl, "_blank", "noopener,noreferrer");
      if (r.info) push(r.info, "ok");
      router.refresh();
    });

  return (
    <div className="flex flex-wrap gap-1.5">
      <Button size="xs" variant="outline" icon={MessageCircle} disabled={pending || !hasPhone} onClick={() => run("whatsapp")} title={hasPhone ? "Malikten teyit iste (WhatsApp)" : "Malikin cep telefonu kayıtlı değil"}>
        WhatsApp
      </Button>
      <Button size="xs" variant="outline" icon={MessageSquareText} disabled={pending || !hasPhone} onClick={() => run("sms")} title={hasPhone ? "Malikten teyit iste (SMS)" : "Malikin cep telefonu kayıtlı değil"}>
        SMS
      </Button>
      <Button size="xs" variant="outline" icon={Mail} disabled={pending || !hasEmail} onClick={() => run("email")} title={hasEmail ? "Malikten teyit iste (e-posta)" : "Malikin e-posta adresi kayıtlı değil"}>
        E-posta
      </Button>
    </div>
  );
}
