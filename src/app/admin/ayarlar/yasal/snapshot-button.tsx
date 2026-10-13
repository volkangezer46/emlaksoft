"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Archive } from "lucide-react";
import { snapshotCodeLegalDocsAction } from "@/app/actions/legal-admin";
import { Button } from "@/components/ui/button";

/**
 * "Koddaki metinleri v1 olarak kaydet": 8 sayfanın koddaki metni DB'ye arşiv v1 olarak yazılır (yayın değişmez). Taşıma
 * ilk adımıdır; fark görünümü v1'e göre çalışır, belge sayfasındaki "Bu sürüme dön" v1'i DB'den yayınlar.
 */
export function CodeSnapshotButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <div className="flex flex-col items-start gap-1">
      <Button
        type="button"
        variant="outline"
        size="sm"
        icon={Archive}
        disabled={pending}
        onClick={() =>
          start(async () => {
            setMsg(null);
            const r = await snapshotCodeLegalDocsAction().catch(() => ({ ok: false as const, error: "Bağlantı hatası; tekrar deneyin." }));
            setMsg(r.ok ? { ok: true, text: r.message ?? "Tamam." } : { ok: false, text: r.error });
            if (r.ok) router.refresh();
          })
        }
      >
        {pending ? "Kaydediliyor…" : "Koddaki metinleri v1 olarak kaydet"}
      </Button>
      {msg ? (
        <p role="status" className={`text-xs ${msg.ok ? "text-mint-700" : "text-danger-600"}`}>
          {msg.text}
        </p>
      ) : null}
    </div>
  );
}
