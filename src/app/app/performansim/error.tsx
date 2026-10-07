"use client";

import { RouteError, type RouteErrorBoundaryProps } from "@/components/ui/route-error";

export default function PerformansimError(props: RouteErrorBoundaryProps) {
  return <RouteError {...props} moduleName="Performansım" />;
}
