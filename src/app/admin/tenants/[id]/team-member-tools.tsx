"use client";

import { formatDateTimeTr } from "@/lib/format";
import { useState, useTransition } from "react";
import { Check, ChevronDown, Copy, History, Loader2, RefreshCw } from "lucide-react";
import { generateMemberResetLink } from "@/app/actions/platform-members";
import { getMemberLoginLog, type LoginLogRow } from "@/app/actions/platform-member-access";
import { Button } from "@/components/ui/button";

/**
 * Ofis 360 > Ekip istemci araçları:
 *  - Daveti yenile: hiç giriş yapmamış üyeye tek kullanımlık parola belirleme bağlantısı üretir (yalnız süper admin;
 *    sunucu reddeder). Bağlantı hesabı ele geçirmeye yeter: yalnız bu ekranda gösterilir, güvenli kanaldan iletilir.
 *  - Giriş günlüğü: üye satırında tıklayınca son 15 giriş denemesi yüklenir (sayfa açılışını yavaşlatmaz).
 */

const RESULT: Record<string, { label: string; ok: boolean }> = {
  success: { label: "Başarılı giriş", ok: true },
  failed: { label: "Başarısız deneme", ok: false },
  "2fa_pending": { label: "2FA bekledi", ok: false },
  "2fa_failed": { label: "2FA başarısız", ok: false },
};
const fmt = (iso: string) => formatDateTimeTr(iso);

export function RenewInviteButton({ memberId, name }: { memberId: string; name: string }) {
  const [busy, start] = useTransition();
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function renew() {
    const fd = new FormData();
    fd.set("id", memberId);
    fd.set("purpose", "invite");
    setError(null);
    start(async () => {
      const res = await generateMemberResetLink(fd);
      if (res.error || !res.link) setError(res.error ?? "Bağlantı üretilemedi.");
      else setLink(res.link);
    });
  }

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* pano erişimi yoksa alan elle kopyalanır */
    }
  }

  return (
    <div className="relative z-10 flex min-w-0 flex-col items-end gap-1.5">
      {link ? (
        <div className="flex w-72 max-w-full gap-1.5">
          <input
            readOnly
            value={link}
            aria-label={`${name} için davet bağlantısı`}
            onFocus={(e) => e.currentTarget.select()}
            className="numeric focus-ring w-full min-w-0 rounded-[var(--radius-control)] border border-line bg-canvas px-2 py-1.5 text-xs"
          />
          <Button type="button" size="sm" variant="outline" onClick={copy} aria-label="Bağlantıyı kopyala">
            {copied ? <Check className="h-3.5 w-3.5 text-mint-600" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
          </Button>
        </div>
      ) : (
        <Button type="button" size="sm" variant="outline" disabled={busy} onClick={renew}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <RefreshCw className="h-3.5 w-3.5" aria-hidden />} Daveti yenile
        </Button>
      )}
      {error ? (
        <p role="alert" className="text-xs text-danger-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function MemberLoginLog({ memberId, name }: { memberId: string; name: string }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<LoginLogRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && rows === null) {
      start(async () => {
        const res = await getMemberLoginLog(memberId);
        if (res.error) setError(res.error);
        else setRows(res.rows ?? []);
      });
    }
  }

  return (
    <div className="relative z-10 w-full">
      <Button
        variant="ghost"
        size="xs"
        icon={History}
        onClick={toggle}
        aria-expanded={open}
        className="h-auto gap-1 rounded-sm px-0 text-accent-text hover:bg-transparent hover:text-accent-text hover:underline active:bg-transparent"
      >
        Giriş günlüğü
        <ChevronDown className={`h-3.5 w-3.5 transition ${open ? "rotate-180" : ""}`} aria-hidden />
      </Button>
      {open ? (
        <div className="mt-2 rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2" aria-label={`${name} giriş günlüğü`}>
          {busy && rows === null ? (
            <p className="flex items-center gap-2 text-xs text-text-muted">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Yükleniyor…
            </p>
          ) : error ? (
            <p role="alert" className="text-xs text-danger-600">
              {error}
            </p>
          ) : !rows?.length ? (
            <p className="text-xs text-text-muted">Giriş kaydı yok — üye henüz giriş yapmamış olabilir.</p>
          ) : (
            <ul className="divide-y divide-line/60">
              {rows.map((r) => {
                const meta = RESULT[r.result] ?? { label: r.result, ok: false };
                return (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5 text-xs">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className={`h-2 w-2 shrink-0 rounded-full ${meta.ok ? "bg-mint-500" : "bg-danger-500"}`} aria-hidden />
                      <span className="text-ink-950">{meta.label}</span>
                      {r.ip ? <span className="truncate text-text-faint">{r.ip}</span> : null}
                    </span>
                    <span className="tabular-nums text-text-muted">{fmt(r.created_at)}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
