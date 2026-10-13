"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormInput } from "@/components/ui/form-controls";
import { setTenantTrust } from "@/app/actions/admin-portal-rules";
import { suggestedExclusion } from "@/lib/portal-rules/admin-model";

export type TrustTenant = {
  id: string;
  name: string;
  slug: string | null;
  status: string | null;
  samplePack: boolean;
  /** null = personel kararı yok (öğrenme varsayılan kuralla hesaplar). */
  eligible: boolean | null;
  reason: string | null;
};

function TrustRow({ t }: { t: TrustTenant }) {
  const router = useRouter();
  const suggestion = suggestedExclusion(t);
  const [reason, setReason] = useState(t.reason ?? (t.eligible === null && suggestion ? suggestion : ""));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const effective = t.eligible ?? null;

  const save = (eligible: boolean) => {
    if (reason.trim().length < 3) {
      setMsg({ ok: false, text: "Gerekçe yazın (en az 3 karakter)." });
      return;
    }
    setMsg(null);
    start(async () => {
      const r = await setTenantTrust({ tenantId: t.id, eligible, reason: reason.trim() });
      setMsg({ ok: !!r.ok, text: r.ok ? (r.notice ?? "Kaydedildi.") : (r.error ?? "Kaydedilemedi.") });
      if (r.ok) router.refresh();
    });
  };

  return (
    <li className="flex flex-wrap items-center gap-3 py-3">
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink-950">
          {t.name}
          {effective === true ? <Badge variant="success" size="sm">Uygun</Badge> : effective === false ? <Badge variant="danger" size="sm">Dışlandı</Badge> : <Badge variant="outline" size="sm">Varsayılan kural</Badge>}
          {t.samplePack ? <Badge variant="neutral" size="sm">Örnek veri</Badge> : null}
          {t.status && t.status !== "active" ? <Badge variant="warning" size="sm">{t.status}</Badge> : null}
          {effective === null && suggestion ? <Badge variant="warning" size="sm">Önerilen: dışla</Badge> : null}
        </p>
      </div>
      <FormInput
        aria-label={`${t.name} gerekçe`}
        className="w-full sm:w-64"
        placeholder="Gerekçe"
        maxLength={500}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      <div className="flex gap-2">
        <Button size="xs" variant={effective === true ? "secondary" : "outline"} loading={pending} onClick={() => save(true)}>
          Uygun
        </Button>
        <Button size="xs" variant={effective === false ? "secondary" : "outline"} loading={pending} onClick={() => save(false)}>
          Dışla
        </Button>
      </div>
      {msg ? (
        <p role={msg.ok ? "status" : "alert"} className={`w-full text-xs font-semibold ${msg.ok ? "text-mint-700" : "text-danger-600"}`}>
          {msg.text}
        </p>
      ) : null}
    </li>
  );
}

/**
 * Ofis uygunluğu (kiracı adı YALNIZ burada). Personel kararı yoksa öğrenme varsayılan kuralı uygular (aktif, örnek veri
 * yok, ≥14 gün, son 60 günde ≥3 yayınlanmış oturum). E2E Test Ofis, Demo Emlak Ofisi ve admin dışlanması önerilir.
 */
export function TrustPanel({ tenants }: { tenants: TrustTenant[] }) {
  return (
    <section aria-label="Ofis uygunluğu" className="rounded-[var(--radius-panel)] border border-line bg-surface p-5">
      <h2 className="font-display font-bold text-ink-950">Ofis uygunluğu</h2>
      <p className="mt-1 text-sm text-text-muted">
        Uygun olmayan ofisin oyu sayılmaz. Karar ve gerekçe denetim kaydına yazılır. Ofis adları yalnız bu panelde görünür.
      </p>
      {tenants.length === 0 ? (
        <p className="mt-4 text-sm text-text-muted">Ofis bulunamadı.</p>
      ) : (
        <ul className="mt-2 divide-y divide-line">
          {tenants.map((t) => (
            <TrustRow key={t.id} t={t} />
          ))}
        </ul>
      )}
    </section>
  );
}
