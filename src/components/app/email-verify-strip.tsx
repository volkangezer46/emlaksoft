"use client";

import dynamic from "next/dynamic";

/**
 * E-posta doğrulama şeridi — tembel sarmalayıcı. Şerit yalnız doğrulanmamış hesapta çizilir; kodu her /app rotasının
 * ilk yük JS'inden çıkar. Sunucu çıktısı aynen basılır (ssr açık, CLS yok); düğmeler parça inince canlanır.
 */
export const EmailVerifyStrip = dynamic(() => import("./email-verify-strip-live").then((m) => m.EmailVerifyStrip));
