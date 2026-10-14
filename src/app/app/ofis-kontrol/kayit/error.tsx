"use client";

import { RouteError, type RouteErrorBoundaryProps } from "@/components/ui/route-error";

export default function AuditLogError(props: RouteErrorBoundaryProps) {
  return <RouteError {...props} moduleName="Denetim kaydı" />;
}
