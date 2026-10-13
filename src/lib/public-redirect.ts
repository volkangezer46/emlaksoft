import { NextResponse } from "next/server";
import { getBaseUrl } from "@/lib/base-url";

/**
 * Herkese açık mutlak URL ve yönlendirme üretimi — kök HER ZAMAN getBaseUrl().
 *
 * NEDEN: `new URL(path, req.url)` / `req.nextUrl.origin` ters vekil arkasında
 * konteynerin iç adresini (ör. http://0.0.0.0:3000) verir; Location başlığına
 * sızan bu adres kullanıcıyı kırık bir sayfaya götürür. Yalnız '/' ile başlayan
 * uygulama-içi yol kabul edilir: '//' (protokolsüz dış alan) ve şemalı girdi
 * (https:, javascript: ...) reddedilir — açık yönlendirme kapısı olmasın.
 * Sorgu parametreleri ve parça (#) korunur.
 */
export function publicUrl(path: string): URL {
  if (typeof path !== "string" || !path.startsWith("/") || path.startsWith("//") || path.startsWith("/\\")) {
    throw new Error(`publicUrl: yalnız '/' ile başlayan uygulama yolu kabul edilir (${String(path).slice(0, 40)})`);
  }
  return new URL(path, getBaseUrl());
}

/** Herkese açık kökle mutlak yönlendirme. Varsayılan 307 (yöntem korunur). */
export function publicRedirect(path: string, status = 307): NextResponse {
  return NextResponse.redirect(publicUrl(path), status);
}

/** Herkese açık kökün origin'i (şema + alan adı + port), sonda '/' olmadan. */
export function publicOrigin(): string {
  return new URL(getBaseUrl()).origin;
}
