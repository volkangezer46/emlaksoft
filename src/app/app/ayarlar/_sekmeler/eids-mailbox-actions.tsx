"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MailPlus, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/app/toast-provider";
import { issueEidsAddress } from "@/app/actions/eids-inbound";

/**
 * EİDS alma adresi eylemleri (istemci adası): ilk adresi oluştur / adresi yenile. Yenileme onay ister, çünkü eski
 * adres hemen geçersiz olur ve posta kutusundaki iletme kuralının güncellenmesi gerekir. Sunucu eylemi rol kapısını
 * (owner/gm) kendisi uygular; burada yalnız akış var.
 */
export function EidsAddressActions({ hasAddress, canManage }: { hasAddress: boolean; canManage: boolean }) {
  const router = useRouter();
  const { push } = useToast();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (!canManage) {
    return <p className="text-xs text-text-muted">Adresi ofis sahibi ya da genel müdür oluşturur ve yeniler.</p>;
  }

  const run = (renew: boolean) => {
    setError(null);
    start(async () => {
      const r = await issueEidsAddress(renew);
      if (r.error) {
        setError(r.error);
        return;
      }
      if (r.info) push(r.info, "ok");
      router.refresh();
    });
  };

  return (
    <div className="space-y-2">
      {hasAddress ? (
        <ConfirmDialog
          trigger={
            <Button type="button" size="sm" variant="outline" icon={RefreshCw} loading={pending}>
              Adresi yenile
            </Button>
          }
          title="Alma adresi yenilensin mi?"
          description="Eski adres hemen geçersiz olur ve ona gelen e-postalar reddedilir. Posta kutunuzdaki iletme kuralını yeni adresle güncellemeniz gerekir."
          confirmLabel="Yenile"
          tone="danger"
          onConfirm={() => run(true)}
        />
      ) : (
        <Button type="button" size="sm" variant="primary" icon={MailPlus} loading={pending} onClick={() => run(false)}>
          Alma adresi oluştur
        </Button>
      )}
      {error ? (
        <p role="alert" className="text-xs text-danger-text">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * İletme onay kodu beklenirken (adres yeni, henüz e-posta gelmedi) kartı 20 sn'de bir sessizce tazeler; en çok
 * 10 dakika. Gmail kodu genelde 1 dakika içinde gelir; kabul ölçütü "2 dakika içinde kartta görünür".
 */
export function EidsConfirmationPoller({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    let ticks = 0;
    const id = window.setInterval(() => {
      ticks += 1;
      if (document.visibilityState === "visible") router.refresh();
      if (ticks >= 30) window.clearInterval(id);
    }, 20_000);
    return () => window.clearInterval(id);
  }, [active, router]);
  return null;
}
