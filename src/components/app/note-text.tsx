import Link from "@/components/ui/smart-link";
import { splitNoteLinks } from "@/lib/note-links";

/**
 * Not metni: içindeki `/app/...` yolları ve `[etiket](/app/...)` bağlantıları uygulama içi bağlantı olarak çizilir
 * (ham yol/UUID görünmez; çıplak yol "Aç" olur). Sunucu ve istemci bileşenlerinde kullanılabilir.
 */
export function NoteText({ text, className }: { text: string; className?: string }) {
  return (
    <span className={className}>
      {splitNoteLinks(text).map((p, i) =>
        p.kind === "text" ? (
          <span key={i}>{p.text}</span>
        ) : (
          <Link key={i} href={p.href} className="relative z-10 font-semibold text-brand-600 hover:underline">
            {p.label}
          </Link>
        ),
      )}
    </span>
  );
}
