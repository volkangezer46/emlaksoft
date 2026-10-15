"use client";

import { useState, useSyncExternalStore } from "react";
import { BookUser } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PickedContact } from "@/lib/vcard-import";

/**
 * "Rehberden seç" — Contact Picker API (Android Chrome). Destek yoksa (iOS Safari, masaüstü) HİÇ çizilmez.
 * Kişi seçimi tamamen kullanıcı başlatır; tarayıcı yalnız seçilen kişilerin ad/telefon/e-postasını verir (KVKK: toplu
 * rehber okuma yok). Çağıran sonucu forma ya da içe aktarma tablosuna çevirir.
 */

type ContactsManager = {
  select: (props: ("name" | "tel" | "email")[], opts?: { multiple?: boolean }) => Promise<PickedContact[]>;
};

function contactsManager(): ContactsManager | null {
  if (typeof window === "undefined" || typeof navigator === "undefined") return null;
  const nav = navigator as Navigator & { contacts?: ContactsManager };
  return "ContactsManager" in window && nav.contacts && typeof nav.contacts.select === "function" ? nav.contacts : null;
}

const noopSubscribe = () => () => {};

export function useContactPickerSupported(): boolean {
  return useSyncExternalStore(noopSubscribe, () => contactsManager() !== null, () => false);
}

export function ContactPickButton({
  multiple = false,
  onPick,
  label = "Rehberden seç",
  className,
  size = "md",
  variant = "outline",
}: {
  multiple?: boolean;
  onPick: (contacts: PickedContact[]) => void;
  label?: string;
  className?: string;
  size?: "sm" | "md";
  variant?: "outline" | "secondary";
}) {
  const supported = useContactPickerSupported();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!supported) return null;

  const pick = async () => {
    const mgr = contactsManager();
    if (!mgr) return;
    setBusy(true);
    setError("");
    try {
      const picked = await mgr.select(["name", "tel", "email"], { multiple });
      if (picked.length) onPick(picked);
    } catch {
      setError("Rehber açılamadı. Tarayıcı izinlerini kontrol edip tekrar deneyin.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={className}>
      <Button type="button" variant={variant} size={size} onClick={pick} loading={busy}>
        <BookUser className="h-4 w-4" aria-hidden="true" /> {label}
      </Button>
      {error ? (
        <p className="mt-1.5 text-xs text-danger-600" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
