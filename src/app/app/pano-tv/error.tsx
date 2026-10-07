"use client";

import { RouteError, type RouteErrorBoundaryProps } from "@/components/ui/route-error";

export default function PanoTvError(props: RouteErrorBoundaryProps) {
  return <RouteError {...props} moduleName="Pano TV" />;
}
