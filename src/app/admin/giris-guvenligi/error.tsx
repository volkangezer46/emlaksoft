"use client";

import { RouteError, type RouteErrorBoundaryProps } from "@/components/ui/route-error";

export default function AdminLoginSecurityError(props: RouteErrorBoundaryProps) {
  return <RouteError {...props} moduleName="Giriş güvenliği" homeHref="/admin" homeLabel="Kontrol paneline dön" />;
}
