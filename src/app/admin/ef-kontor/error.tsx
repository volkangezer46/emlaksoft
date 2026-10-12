"use client";

import { RouteError, type RouteErrorBoundaryProps } from "@/components/ui/route-error";

export default function AdminEfKontorError(props: RouteErrorBoundaryProps) {
  return <RouteError {...props} moduleName="Analiz tarifesi" homeHref="/admin" homeLabel="Yönetim paneline dön" />;
}
