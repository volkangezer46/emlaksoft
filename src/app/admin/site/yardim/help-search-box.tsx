"use client";

import { useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";

/** Arama kutusu: URL'yi (?q=) günceller, süzgeç sunucuda çalışır (filtre kontratı). Yazma akıcı kalsın diye geçişli. */
export function HelpSearchBox({ initialQ }: { initialQ: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [q, setQ] = useState(initialQ);
  const [, start] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const next = new URLSearchParams(params.toString());
    if (q.trim()) next.set("q", q.trim());
    else next.delete("q");
    const s = next.toString();
    start(() => router.replace(s ? `${pathname}?${s}` : pathname));
  }

  return (
    <form role="search" onSubmit={submit} className="relative max-w-md">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-faint" aria-hidden />
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        aria-label="Yardım maddelerinde ara"
        placeholder="Başlık, metin ya da kısa ad ara (Enter)"
        className="focus-ring min-h-11 w-full rounded-[var(--radius-control)] border border-line bg-surface py-2 pl-9 pr-3 text-sm text-text"
      />
    </form>
  );
}
