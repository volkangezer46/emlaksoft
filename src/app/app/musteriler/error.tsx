"use client";

import { RouteError, type RouteErrorBoundaryProps } from "@/components/ui/route-error";

export default function MusterilerError(props: RouteErrorBoundaryProps) {
  return <RouteError {...props} moduleName="Müşteriler" />;
}
