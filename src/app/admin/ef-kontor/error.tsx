"use client";

import { RouteError, type RouteErrorBoundaryProps } from "@/components/ui/route-error";

export default function AdminEfKontorError(props: RouteErrorBoundaryProps) {
  return <RouteError {...props} moduleName="EmlakFiyati analiz bakiyesi" homeHref="/admin" homeLabel="Yönetim paneline dön" />;
}
