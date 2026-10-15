"use client";

import { RouteError, type RouteErrorBoundaryProps } from "@/components/ui/route-error";

export default function AdminTaskQueueError(props: RouteErrorBoundaryProps) {
  return <RouteError {...props} moduleName="Görevler" homeHref="/admin/tenants" homeLabel="Ofislere dön" />;
}
