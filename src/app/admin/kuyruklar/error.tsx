"use client";

import { RouteError, type RouteErrorBoundaryProps } from "@/components/ui/route-error";

export default function AdminQueuesError(props: RouteErrorBoundaryProps) {
  return <RouteError {...props} moduleName="Kuyruklar" homeHref="/admin" homeLabel="Kontrol paneline dön" />;
}
