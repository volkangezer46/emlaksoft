"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "@/components/ui/smart-link";
import { Plus, Tag, X } from "lucide-react";
import { updateTicketTags } from "@/app/actions/support-desk";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** Bilet etiketleri: ekle (virgülle birden çok) / çıkar. Etiket tıklanınca aynı etiketli talepler listelenir. */
export function TicketTagsEditor({ ticketId, tags }: { ticketId: string; tags: string[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [current, setCurrent] = useState(tags);
  const [error, setError] = useState<string | null>(null);

  function send(add: string, remove: string, onOk?: () => void) {
    setError(null);
    const fd = new FormData();
    fd.set("id", ticketId);
    fd.set("add", add);
    fd.set("remove", remove);
    start(async () => {
      const r = await updateTicketTags(fd);
      if (r.error) {
        setError(r.error);
        return;
      }
      setCurrent(r.tags ?? []);
      onOk?.();
      router.refresh();
    });
  }

  return (
    <section className="rounded-[var(--radius-card)] border border-line bg-surface p-4">
      <h2 className="flex items-center gap-2 font-display text-sm font-bold text-ink-950">
        <Tag className="h-4 w-4 text-brand-600" aria-hidden /> Etiketler
      </h2>
      {current.length ? (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {current.map((t) => (
            <li key={t} className="inline-flex items-center gap-1 rounded-full border border-line bg-canvas py-0.5 pl-2.5 pr-1 text-xs">
              <Link href={`/admin/tickets?etiket=${encodeURIComponent(t)}`} className="font-semibold text-ink-950 hover:text-brand-600">
                #{t}
              </Link>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={pending}
                onClick={() => send("", t)}
                aria-label={`${t} etiketini kaldır`}
                className="rounded-full text-text-faint hover:text-danger-600"
              >
                <X className="h-3 w-3" />
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-xs text-text-faint">Etiket yok.</p>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const form = e.currentTarget;
          const value = String(new FormData(form).get("tag") ?? "");
          send(value, "", () => form.reset());
        }}
        className="mt-3 flex gap-2"
      >
        <Input name="tag" aria-label="Yeni etiket" maxLength={200} placeholder="fatura, iade" className="h-9 min-w-0 flex-1 text-xs" />
        <Button type="submit" size="sm" icon={Plus} loading={pending}>Ekle</Button>
      </form>
      {error ? <p role="alert" className="mt-2 text-xs font-semibold text-danger-600">{error}</p> : null}
    </section>
  );
}
