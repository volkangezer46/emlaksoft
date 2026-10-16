"use client";

import { RouteError, type RouteErrorBoundaryProps } from "@/components/ui/route-error";

export default function FinansError(props: RouteErrorBoundaryProps) {
  return <RouteError {...props} moduleName="Finans" />;
}
