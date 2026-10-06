"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { UserPlus } from "lucide-react";
import { addAdvisor } from "@/app/actions/office-center";
import { useToast } from "@/components/app/toast-provider";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { EmailInput } from "@/components/ui/email-input";
import { FormField, FormInput, FormSelect } from "@/components/ui/form-controls";
import { PhoneInput } from "@/components/ui/phone-input";
import { ROLE_LABELS } from "@/lib/role-labels";

/**
 * Hızlı davet (panel, popup değil): hesap açma + e-posta daveti MEVCUT ekip akışıdır (`createAdvisor`).
 * Hedef/unvan detayları için tam form: /app/ekip/yeni.
 */
export function QuickInvitePanel({ roles, branches }: { roles: readonly string[]; branches: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [pending, start] = useTransition();
  const router = useRouter();
  const { push } = useToast();

  function submit(form: HTMLFormElement) {
    const fd = new FormData(form);
    setError(null);
    setWarnings([]);
    start(async () => {
      const res = await addAdvisor({
        fullName: String(fd.get("full_name") ?? ""),
        email: String(fd.get("email") ?? ""),
        phone: String(fd.get("phone") ?? ""),
        title: String(fd.get("title") ?? ""),
        role: String(fd.get("role") ?? "advisor"),
        branchId: String(fd.get("branch_id") ?? ""),
      });
      if (res.error) {
        setError(res.error);
        return;
      }
      push(res.emailSent ? "Danışman eklendi; davet e-postası gönderildi." : "Danışman eklendi.", "ok");
      setWarnings(res.warnings ?? []);
      form.reset();
      if (!res.warnings?.length) setOpen(false);
      router.refresh();
    });
  }

  return (
    <div>
      <Button type="button" variant="primary" size="sm" icon={UserPlus} aria-expanded={open} aria-controls="oc-hizli-davet" onClick={() => setOpen((v) => !v)}>
        Danışman ekle
      </Button>
      {open ? (
        <form
          id="oc-hizli-davet"
          className="mt-3 grid gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            submit(e.currentTarget);
          }}
        >
          <FormField label="Ad soyad" htmlFor="oc-inv-name" required>
            <FormInput id="oc-inv-name" name="full_name" required maxLength={120} autoComplete="name" />
          </FormField>
          <FormField label="Unvan" htmlFor="oc-inv-title" required hint="Örn. Gayrimenkul Danışmanı">
            <FormInput id="oc-inv-title" name="title" required maxLength={80} />
          </FormField>
          <FormField label="E-posta" htmlFor="oc-inv-email" required hint="Davet bağlantısı bu adrese gider.">
            <EmailInput id="oc-inv-email" name="email" required />
          </FormField>
          <FormField label="Telefon" htmlFor="oc-inv-phone" inject={false}>
            <PhoneInput id="oc-inv-phone" name="phone" />
          </FormField>
          <FormField label="Rol" htmlFor="oc-inv-role" required>
            <FormSelect id="oc-inv-role" name="role" defaultValue="advisor">
              {roles.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r] ?? r}
                </option>
              ))}
            </FormSelect>
          </FormField>
          <FormField label="Şube" htmlFor="oc-inv-branch">
            <FormSelect id="oc-inv-branch" name="branch_id" defaultValue="">
              <option value="">Şubesiz</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </FormSelect>
          </FormField>
          {error ? (
            <div className="sm:col-span-2">
              <Alert tone="danger" title="Eklenemedi">
                {error}
              </Alert>
            </div>
          ) : null}
          {warnings.length ? (
            <div className="sm:col-span-2">
              <Alert tone="warning" title="Hesap açıldı, bazı adımlar tamamlanamadı">
                {warnings.join(" ")}
              </Alert>
            </div>
          ) : null}
          <div className="flex items-center gap-2 sm:col-span-2">
            <Button type="submit" loading={pending}>
              Davet gönder
            </Button>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Vazgeç
            </Button>
            <Link href="/app/ekip/yeni" className="ml-auto text-xs font-semibold text-brand-600 hover:underline">
              Hedefli tam form (Ekip &gt; Yeni danışman)
            </Link>
          </div>
        </form>
      ) : null}
    </div>
  );
}
