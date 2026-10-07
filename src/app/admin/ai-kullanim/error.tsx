"use client";

import { RouteError, type RouteErrorBoundaryProps } from "@/components/ui/route-error";

export default function AdminAiKullanimError(props: RouteErrorBoundaryProps) {
  return <RouteError {...props} moduleName="AI kullanımı" homeHref="/admin" homeLabel="Yönetim paneline dön" />;
}
