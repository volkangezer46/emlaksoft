"use client";

import { RouteError, type RouteErrorBoundaryProps } from "@/components/ui/route-error";

export default function AsistanError(props: RouteErrorBoundaryProps) {
  return <RouteError {...props} moduleName="AI asistan" />;
}
