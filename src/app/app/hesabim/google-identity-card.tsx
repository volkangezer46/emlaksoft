"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { UserIdentity } from "@supabase/supabase-js";
import { Check, KeyRound, Link2, Unlink } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { GoogleGIcon, googleRedirectTo } from "@/components/auth/google-button";
import { canUnlinkGoogle } from "@/lib/auth/google-auth";
import { createClient } from "@/lib/supabase/client";

type Status = { tone: "success" | "danger"; text: string } | null;

/**
 * Hesabım > Giriş yöntemleri: Google hesabını bağla / kaldır (Supabase linkIdentity / unlinkIdentity).
 * Kural: en az bir giriş yöntemi kalmalı (`canUnlinkGoogle`; Supabase de son kimliği reddeder).
 * Bağlama için Supabase'de "Manual linking" açık olmalı (runbook: docs/runbooks/GOOGLE_GIRIS.md).
 */
export function GoogleIdentityCard() {
  const router = useRouter();
  const [identities, setIdentities] = useState<UserIdentity[] | null>(null);
  const [busy, setBusy] = useState<"link" | "unlink" | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [status, setStatus] = useState<Status>(null);

  useEffect(() => {
    let alive = true;
    createClient()
      .auth.getUserIdentities()
      .then(({ data, error }) => {
        if (!alive) return;
        if (error) {
          setStatus({ tone: "danger", text: "Giriş yöntemleri okunamadı. Sayfayı yenileyin." });
          setIdentities([]);
          return;
        }
        setIdentities(data?.identities ?? []);
      });
    return () => {
      alive = false;
    };
  }, []);

  const google = identities?.find((i) => i.provider === "google") ?? null;
  const googleEmail = typeof google?.identity_data?.email === "string" ? google.identity_data.email : null;
  const hasPasswordIdentity = Boolean(identities?.some((i) => i.provider === "email"));
  const unlinkRule = canUnlinkGoogle(identities);

  async function link() {
    setBusy("link");
    setStatus(null);
    const { error } = await createClient().auth.linkIdentity({
      provider: "google",
      options: {
        redirectTo: googleRedirectTo(window.location.origin, "/app/hesabim?sekme=parola", "link"),
        queryParams: { prompt: "select_account" },
      },
    });
    if (error) {
      console.error("google link", error.code ?? error.name);
      setStatus({
        tone: "danger",
        text:
          error.code === "manual_linking_disabled"
            ? "Google hesabı bağlama şu an kapalı. Lütfen destek ekibine yazın."
            : "Google bağlantısı başlatılamadı. Lütfen tekrar deneyin.",
      });
      setBusy(null);
    }
    // Başarılıysa tarayıcı Google'a yönlenir.
  }

  async function unlink() {
    if (!google || !unlinkRule.ok) return;
    setBusy("unlink");
    setStatus(null);
    const supabase = createClient();
    const { error } = await supabase.auth.unlinkIdentity(google);
    if (error) {
      console.error("google unlink", error.code ?? error.name);
      setStatus({ tone: "danger", text: "Google bağlantısı kaldırılamadı. En az bir giriş yöntemi kalmalı; lütfen tekrar deneyin." });
    } else {
      setIdentities((cur) => (cur ?? []).filter((i) => i.identity_id !== google.identity_id));
      setStatus({ tone: "success", text: "Google bağlantısı kaldırıldı. Artık e-posta ve şifrenizle giriş yapın." });
      await supabase.auth.refreshSession().catch(() => undefined);
      router.refresh();
    }
    setConfirming(false);
    setBusy(null);
  }

  return (
    <div className="space-y-3">
      <ul className="divide-y divide-line rounded-[var(--radius-control)] border border-line">
        <li className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm">
          <span className="flex items-center gap-2.5">
            <KeyRound className="h-4 w-4 text-text-muted" aria-hidden="true" />
            <span className="font-medium text-text">E-posta ve şifre</span>
          </span>
          <span className="text-xs text-text-muted">
            {identities === null ? "…" : hasPasswordIdentity ? "Etkin" : "Tanımlı değil"}
          </span>
        </li>
        <li className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5 text-sm">
          <span className="flex min-w-0 items-center gap-2.5">
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-white ring-1 ring-line">
              <GoogleGIcon className="h-3.5 w-3.5" />
            </span>
            <span className="min-w-0">
              <span className="block font-medium text-text">Google</span>
              {google ? (
                <span className="flex items-center gap-1 truncate text-xs text-text-muted">
                  <Check className="h-3 w-3 text-mint-600" aria-hidden="true" /> Bağlı{googleEmail ? ` · ${googleEmail}` : ""}
                </span>
              ) : (
                <span className="block text-xs text-text-muted">Bağlı değil</span>
              )}
            </span>
          </span>
          {identities === null ? null : google ? (
            confirming ? (
              <span className="flex items-center gap-2">
                <Button size="sm" variant="danger" loading={busy === "unlink"} onClick={unlink}>
                  Kaldır
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirming(false)} disabled={busy !== null}>
                  Vazgeç
                </Button>
              </span>
            ) : (
              <Button
                size="sm"
                variant="outline"
                icon={Unlink}
                onClick={() => setConfirming(true)}
                disabled={!unlinkRule.ok || busy !== null}
                title={unlinkRule.ok ? undefined : unlinkRule.reason}
              >
                Bağlantıyı kaldır
              </Button>
            )
          ) : (
            <Button size="sm" variant="outline" icon={Link2} loading={busy === "link"} onClick={link}>
              Google hesabını bağla
            </Button>
          )}
        </li>
      </ul>
      {google && !unlinkRule.ok && unlinkRule.reason ? <p className="text-xs text-text-muted">{unlinkRule.reason}</p> : null}
      {confirming ? (
        <p className="text-xs text-text-muted">Kaldırınca bu Google hesabıyla giriş yapamazsınız; e-posta ve şifreniz geçerli kalır.</p>
      ) : null}
      {status ? <Alert tone={status.tone}>{status.text}</Alert> : null}
    </div>
  );
}
