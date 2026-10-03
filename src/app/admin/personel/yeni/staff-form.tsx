"use client";

import { startTransition, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Eye, EyeOff, RefreshCw } from "lucide-react";
import { TAB_ICONS as TI } from "@/lib/icons";
import { addPlatformStaff } from "@/app/actions/platform-staff";
import { EmailInput } from "@/components/ui/email-input";
import { FormField, FormInput } from "@/components/ui/form-controls";
import { SummaryGroup, SummaryRow, TabbedFormShell, type FormTab, type TabbedSummaryContext } from "@/components/ui/tabbed-form-shell";
import { cn } from "@/lib/utils";
import type { PlatformRole } from "@/lib/platform-access";
import { generatePassword, passwordStrength, PLATFORM_ROLES, roleSummary } from "../staff-model";
import { STAFF_TABS } from "./staff-tabs";

const TAB_ICONS = { kimlik: TI.kisi, guvenlik: TI.guvenlik, rol: TI.rol } as const;
const FIELD_LABELS = { full_name: "Ad soyad", email: "E-posta", role: "Rol" };

function secureRandomInt(max: number): number {
  // Modulo yanlılığını önlemek için reddetmeli örnekleme.
  const buf = new Uint32Array(1);
  const limit = Math.floor(0x100000000 / max) * max;
  do {
    crypto.getRandomValues(buf);
  } while (buf[0] >= limit);
  return buf[0] % max;
}

const toneBar: Record<string, string> = {
  neutral: "bg-line",
  danger: "bg-danger-500",
  warn: "bg-amber-400",
  success: "bg-mint-500",
};
const toneText: Record<string, string> = {
  neutral: "text-text-faint",
  danger: "text-danger-600",
  warn: "text-amber-700",
  success: "text-mint-700",
};

export function StaffForm() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Parola yalnız bellekte tutulur: taslak ve tarayıcı depolaması yok.
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [copied, setCopied] = useState(false);
  const strength = passwordStrength(password);

  const tabs: FormTab[] = useMemo(
    () =>
      STAFF_TABS.map((t) => ({
        id: t.id,
        label: t.label,
        description: t.description,
        icon: TAB_ICONS[t.id],
        fields: [...t.fields],
        required: [...t.required],
      })),
    [],
  );

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (password && !strength.acceptable) {
      setError("Geçici parola en az 10 karakter olmalıdır.");
      return;
    }
    const fd = new FormData(e.currentTarget);
    setError(null);
    setPending(true);
    startTransition(async () => {
      const res = await addPlatformStaff(fd);
      setPending(false);
      if (res.error) {
        setError(res.error);
        return;
      }
      setPassword("");
      router.push("/admin/personel");
      router.refresh();
    });
  }

  async function copyPassword() {
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* pano erişimi yoksa kullanıcı alanı elle kopyalar */
    }
  }

  const tabPanels = {
    kimlik: (
      <>
        <FormField label="Ad soyad" htmlFor="full_name" required className="sm:col-span-2">
          <FormInput name="full_name" required maxLength={120} autoComplete="off" placeholder="Ahmet Yılmaz" />
        </FormField>
        <FormField
          label="E-posta"
          htmlFor="email"
          required
          className="sm:col-span-2"
          hint="Giriş e-postası. Kayıtlı bir hesap varsa doğrudan bağlanır; yoksa hesap açılır."
        >
          <EmailInput id="email" name="email" required placeholder="ornek@emlaksoft.com" />
        </FormField>
      </>
    ),
    guvenlik: (
      <div className="space-y-3 sm:col-span-2">
        <FormField
          label="Geçici parola (isteğe bağlı)"
          htmlFor="temp_password"
          inject={false}
          hint="Boş bırakırsanız personele davet e-postası gider. Parola taslağa veya tarayıcı belleğine yazılmaz."
        >
          <div className="flex gap-2">
            <FormInput
              id="temp_password"
              name="temp_password"
              type={showPw ? "text" : "password"}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              maxLength={72}
              className="numeric font-mono"
              placeholder="En az 10 karakter"
            />
            <button
              type="button"
              onClick={() => setShowPw((v) => !v)}
              aria-label={showPw ? "Parolayı gizle" : "Parolayı göster"}
              aria-pressed={showPw}
              className="focus-ring press inline-flex w-11 shrink-0 items-center justify-center rounded-[var(--radius-control)] border border-line bg-canvas text-text-muted transition hover:bg-surface"
            >
              {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
            <button
              type="button"
              onClick={copyPassword}
              disabled={!password}
              aria-label="Parolayı kopyala"
              className="focus-ring press inline-flex w-11 shrink-0 items-center justify-center rounded-[var(--radius-control)] border border-line bg-canvas text-text-muted transition hover:bg-surface disabled:opacity-40"
            >
              {copied ? <Check className="h-4 w-4 text-mint-600" /> : <Copy className="h-4 w-4" />}
            </button>
          </div>
        </FormField>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => {
              setPassword(generatePassword(secureRandomInt));
              setShowPw(true);
            }}
            className="focus-ring press inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border border-line bg-surface px-3 py-2 text-xs font-semibold text-ink-950 transition hover:bg-canvas"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Güçlü parola üret
          </button>
          <div className="min-w-40 flex-1" role="status" aria-live="polite">
            <div className="flex gap-1" aria-hidden>
              {[1, 2, 3, 4].map((i) => (
                <span
                  key={i}
                  className={cn("h-1.5 flex-1 rounded-full transition-colors", i <= strength.score ? toneBar[strength.tone] : "bg-line")}
                />
              ))}
            </div>
            <p className={cn("mt-1 text-xs font-semibold", toneText[strength.tone])}>Güç: {strength.label}</p>
          </div>
        </div>
        <ul className="grid gap-1 text-xs text-text-muted sm:grid-cols-2">
          {strength.checks.map((c) => (
            <li key={c.id} className={cn("flex items-center gap-1.5", c.ok && "text-mint-700")}>
              <Check className={cn("h-3 w-3", c.ok ? "opacity-100" : "opacity-25")} aria-hidden /> {c.label}
            </li>
          ))}
        </ul>
        <p className="rounded-[var(--radius-control)] border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs text-amber-800">
          Personel ilk girişte bu parolayı değiştirmelidir; parolayı yalnızca güvenli bir kanaldan iletin.
        </p>
      </div>
    ),
    rol: (
      <fieldset className="sm:col-span-2">
        <legend className="mb-2 text-sm font-medium text-ink-950">Departman rolü</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {PLATFORM_ROLES.map((r) => {
            const s = roleSummary(r);
            return (
              <label key={r} className="group cursor-pointer">
                <input type="radio" name="role" value={r} defaultChecked={r === "support"} className="peer sr-only" />
                <span className="block h-full rounded-[var(--radius-card)] border border-line bg-canvas p-3.5 transition peer-checked:border-brand-500 peer-checked:bg-brand-600/[0.06] peer-checked:ring-2 peer-checked:ring-brand-500/30 peer-focus-visible:ring-2 peer-focus-visible:ring-brand-500 group-hover:border-brand-300">
                  <span className="block text-sm font-bold text-ink-950">{s.label}</span>
                  <span className="mt-0.5 block text-xs text-text-muted">{s.tagline}</span>
                  <span className="mt-2 flex flex-wrap gap-1">
                    {s.allowed.slice(0, 6).map((m) => (
                      <span key={m} className="rounded-full bg-surface px-2 py-0.5 text-xs font-medium text-text-muted ring-1 ring-line">
                        {m}
                      </span>
                    ))}
                    {s.allowed.length > 6 ? (
                      <span className="rounded-full bg-surface px-2 py-0.5 text-xs font-semibold text-brand-700 ring-1 ring-line">
                        +{s.allowed.length - 6}
                      </span>
                    ) : null}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>
    ),
  };

  function renderSummary({ values }: TabbedSummaryContext) {
    const name = (values.full_name ?? "").trim();
    const email = (values.email ?? "").trim();
    const role = ((values.role as PlatformRole | undefined) ?? "support") as PlatformRole;
    const rs = roleSummary(PLATFORM_ROLES.includes(role) ? role : "support");
    return (
      <>
        <div className="rounded-[var(--radius-control)] border border-line bg-canvas/60 p-3">
          <p className="text-xs font-semibold text-text-muted">{rs.label}</p>
          <p className="truncate text-sm font-semibold text-ink-950">{name || "Ad soyad girilmedi"}</p>
        </div>
        <SummaryGroup title="Hesap özeti">
          <SummaryRow label="Ad soyad" value={name || "Zorunlu"} muted={!name} tab="kimlik" field="full_name" />
          <SummaryRow label="E-posta" value={email ? "Girildi" : "Zorunlu"} muted={!email} tab="kimlik" field="email" />
          <SummaryRow
            label="Giriş yöntemi"
            value={password ? `Geçici parola (${strength.label.toLocaleLowerCase("tr")})` : "Davet e-postası"}
            tab="guvenlik"
            field="temp_password"
          />
          <SummaryRow label="Rol" value={rs.label} tab="rol" field="role" />
        </SummaryGroup>
        <SummaryGroup title={`${rs.label} erişimi`}>
          <p className="px-2 pb-1 text-xs text-text-faint">{rs.allowed.length} ekran açık</p>
          <div className="flex flex-wrap gap-1 px-2 pb-1">
            {rs.allowed.map((m) => (
              <span key={m} className="rounded-full bg-mint-500/10 px-2 py-0.5 text-xs font-medium text-mint-700">
                {m}
              </span>
            ))}
          </div>
          {rs.denied.length > 0 ? (
            <div className="flex flex-wrap gap-1 px-2 pt-1">
              {rs.denied.map((m) => (
                <span key={m} className="rounded-full bg-canvas px-2 py-0.5 text-xs text-text-faint line-through ring-1 ring-line">
                  {m}
                </span>
              ))}
            </div>
          ) : null}
        </SummaryGroup>
      </>
    );
  }

  return (
    <TabbedFormShell
      title="Yeni personel hesabı"
      description="EmlakSoft çalışanı için platform hesabı: kimlik, giriş yöntemi ve departman rolü."
      eyebrow="Platform personeli"
      breadcrumbs={[{ label: "Personel", href: "/admin/personel" }, { label: "Yeni personel" }]}
      cancelHref="/admin/personel"
      submitLabel="Hesabı oluştur"
      pendingLabel="Oluşturuluyor…"
      pending={pending}
      error={error}
      onSubmit={onSubmit}
      tabs={tabs}
      tabPanels={tabPanels}
      summary={renderSummary}
      fieldLabels={FIELD_LABELS}
    />
  );
}
