"use client";

import { RouteError, type RouteErrorBoundaryProps } from "@/components/ui/route-error";

/** /app genel hata sınırı: modülün kendi error.tsx'i yoksa burası çizer (kanonik görünüm `ui/route-error`). */
export default function AppError(props: RouteErrorBoundaryProps) {
  return <RouteError {...props} moduleName="Bu sayfa" title="Bu sayfa yüklenemedi" />;
}
