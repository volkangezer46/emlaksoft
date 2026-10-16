"use client";

import { useSyncExternalStore } from "react";
import { Heart } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Portföy kartı kalp düğmesi (istemci adası): kullanıcının "takip ettiklerim" listesi YALNIZ bu cihazda tutulur
 * (localStorage, ofis+kullanıcı anahtarlı, try/catch korumalı; sunucuya yazılmaz). Basılı durum `aria-pressed`.
 */
const EVENT = "es-fav-change";
const keyOf = (scope: string) => `es-fav:${scope}`;
function read(scope: string): string[] {
  try {
    const raw = window.localStorage.getItem(keyOf(scope));
    const arr = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string").slice(0, 200) : [];
  } catch {
    return [];
  }
}
function subscribe(cb: () => void) {
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

export function FavoriKalp({ id, title, scope }: { id: string; title: string; scope: string }) {
  const on = useSyncExternalStore(subscribe, () => read(scope).includes(id), () => false);
  const toggle = () => {
    const cur = read(scope);
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [id, ...cur];
    try {
      window.localStorage.setItem(keyOf(scope), JSON.stringify(next.slice(0, 200)));
    } catch {
      // depolama kapalı: durum yalnız bu oturumda kalmaz (sessiz)
    }
    window.dispatchEvent(new Event(EVENT));
  };
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={toggle}
      aria-pressed={on}
      aria-label={on ? `${title}: takipten çıkar` : `${title}: takip et`}
      className={`kh-fav ${on ? "is-on" : ""}`}
    >
      <Heart className="h-4 w-4" aria-hidden />
    </Button>
  );
}
