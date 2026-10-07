"use client";

import { RouteError, type RouteErrorBoundaryProps } from "@/components/ui/route-error";

export default function DenetimError(props: RouteErrorBoundaryProps) {
  return <RouteError {...props} moduleName="Denetim kaydı" />;
}
