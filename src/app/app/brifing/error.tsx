"use client";

import { RouteError, type RouteErrorBoundaryProps } from "@/components/ui/route-error";

export default function BrifingError(props: RouteErrorBoundaryProps) {
  return <RouteError {...props} moduleName="Günlük brifing" />;
}
