"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { now } from "@/lib/clock";
import {
  draftKeyPrefix,
  draftStorageKey,
  encodeDraft,
  parseDraft,
  pickDraftFields,
  type FormValues,
} from "@/lib/form-tabs";
import { readFormValues } from "@/components/app/use-form-values";

export type FormDraftConfig = {
  userId: string;
  formId: string;
  /** Beyaz liste: yalnız hassas OLMAYAN, kontrolsüz (native) alanlar. Telefon/e-posta/not yazılmaz. */
  fields: readonly string[];
};

const DEBOUNCE_MS = 800;

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** Tek formun taslağını siler (başarılı kayıtta çağır). Hata yutulur. */
export function clearFormDraft(userId: string, formId: string): void {
  try {
    storage()?.removeItem(draftStorageKey(userId, formId));
  } catch {
    /* depolama kapalı — sessiz geç */
  }
}

/** Kullanıcının TÜM taslaklarını siler (çıkış/hesap değişimi). */
export function clearAllFormDrafts(userId: string): void {
  try {
    const s = storage();
    if (!s) return;
    const prefix = draftKeyPrefix(userId);
    const keys: string[] = [];
    for (let i = 0; i < s.length; i += 1) {
      const k = s.key(i);
      if (k?.startsWith(prefix)) keys.push(k);
    }
    keys.forEach((k) => s.removeItem(k));
  } catch {
    /* sessiz */
  }
}

/** Değeri native setter ile yazıp input/change yayar: React ve useFormValues haberdar olur. */
function setNativeValue(el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, value: string) {
  const proto =
    el instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

export type FormDraftApi = {
  /** Açılışta geçerli (süresi dolmamış) bir taslak bulundu ve kullanıcı henüz karar vermedi. */
  restorable: boolean;
  /** Bulunan taslağın zaman damgası (ms). */
  restorableAt: number | null;
  /** Son otomatik kaydın zamanı (ms); henüz kaydedilmediyse null. */
  savedAt: number | null;
  restore: () => void;
  discard: () => void;
  clear: () => void;
  /** Taslağı şimdi yaz (yalnız beyaz liste + hassas olmayan alanlar). */
  saveNow: () => void;
};

/**
 * Sekmeli formların yerel taslağı. Anahtar: `emlaksoft:draft:v1:{userId}:{formId}`.
 *
 *  - Yalnız `fields` beyaz listesi ve hassas olmayan alanlar; TTL 7 gün; tüm erişim try/catch.
 *  - Otomatik GERİ YÜKLEME YOK: açılışta bant gösterilir, kullanıcı onaylar (hidratasyon + yanlış kayıt riski).
 *  - Bant kararı verilene kadar otomatik kayıt DURAKLAR (bulunan taslağı ezmemek için).
 *  - 800 ms debounce; yalnız kullanıcı etkileşiminden (isTrusted) sonra yazar.
 *  - Başarılı kayıtta `clear()` (kabuk, pending bitip hata yoksa kendiliğinden çağırır).
 */
export function useFormDraft(formRef: RefObject<HTMLFormElement | null>, config: FormDraftConfig | undefined): FormDraftApi {
  const userId = config?.userId;
  const formId = config?.formId;
  const fieldsKey = config ? config.fields.join("|") : "";
  const [found, setFound] = useState<{ at: number; values: FormValues } | null>(null);
  const [decided, setDecided] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const decidedRef = useRef(false);
  const foundRef = useRef(false);
  const writeRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!userId || !formId) return;
    // Açılışta bir kez oku; setState rAF içinde (efekt gövdesinde eşzamanlı değil).
    const frame = requestAnimationFrame(() => {
      try {
        const raw = storage()?.getItem(draftStorageKey(userId, formId));
        const draft = parseDraft(raw, now());
        if (draft) {
          foundRef.current = true;
          setFound({ at: draft.savedAt, values: draft.values });
        } else if (raw) {
          storage()?.removeItem(draftStorageKey(userId, formId)); // bozuk/süresi dolmuş
        }
      } catch {
        /* sessiz */
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [userId, formId]);

  useEffect(() => {
    const form = formRef.current;
    if (!form || !userId || !formId || !fieldsKey) return;
    const names = fieldsKey.split("|");
    let timer: ReturnType<typeof setTimeout> | undefined;
    const write = (force = false) => {
      if (!force && foundRef.current && !decidedRef.current) return; // karar bekleyen taslak ezilmez
      try {
        const picked = pickDraftFields(readFormValues(form, names), names);
        const s = storage();
        if (!s) return;
        const key = draftStorageKey(userId, formId);
        if (Object.keys(picked).length === 0) {
          s.removeItem(key);
          return;
        }
        const ts = now();
        s.setItem(key, encodeDraft(picked, ts));
        setSavedAt(ts);
      } catch {
        /* kota/gizli mod — sessiz */
      }
    };
    const onEdit = (e: Event) => {
      if (!e.isTrusted) return; // geri yüklemenin yaydığı olaylar taslağı yeniden yazmasın
      clearTimeout(timer);
      timer = setTimeout(write, DEBOUNCE_MS);
    };
    writeRef.current = () => {
      clearTimeout(timer);
      write(true);
      decidedRef.current = true;
    };
    form.addEventListener("input", onEdit);
    form.addEventListener("change", onEdit);
    return () => {
      writeRef.current = null;
      clearTimeout(timer);
      form.removeEventListener("input", onEdit);
      form.removeEventListener("change", onEdit);
    };
  }, [formRef, userId, formId, fieldsKey]);

  const restore = useCallback(() => {
    const form = formRef.current;
    if (form && found) {
      for (const [name, value] of Object.entries(found.values)) {
        const el = form.elements.namedItem(name);
        if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) {
          setNativeValue(el, value);
        }
      }
    }
    decidedRef.current = true;
    setDecided(true);
  }, [formRef, found]);

  const clear = useCallback(() => {
    if (userId && formId) clearFormDraft(userId, formId);
    setSavedAt(null);
  }, [userId, formId]);

  /** "Taslak kaydet" düğmesi: bekleyen debounce'u beklemeden beyaz liste alanlarını hemen yazar. */
  const saveNow = useCallback(() => {
    writeRef.current?.();
  }, []);

  const discard = useCallback(() => {
    clear();
    decidedRef.current = true;
    setDecided(true);
  }, [clear]);

  return {
    restorable: Boolean(found) && !decided,
    restorableAt: found?.at ?? null,
    savedAt,
    restore,
    discard,
    clear,
    saveNow,
  };
}
