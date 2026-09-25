"use client";

import { useState } from "react";
import { brandMarkUsesFill, monogramFromName } from "@/lib/tenant/branding";
import { cn } from "@/lib/utils";

export function TenantBrand({
  displayName,
  logoUrl,
  brandColor,
}: {
  displayName: string;
  logoUrl?: string | null;
  brandColor?: string | null;
}) {
  const [logoFailed, setLogoFailed] = useState(false);
  const name = displayName.trim();
  const showLogo = Boolean(logoUrl) && !logoFailed;
  const filled = brandMarkUsesFill(brandColor ?? null);
  const markStyle = brandColor
    ? filled
      ? { backgroundColor: brandColor, color: "#ffffff" }
      : { borderColor: brandColor }
    : undefined;

  return (
    <div className="flex min-w-0 items-center gap-2.5">
      {showLogo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={logoUrl ?? undefined}
          alt=""
          width={40}
          height={40}
          className="size-9 shrink-0 rounded-md border border-border/80 bg-card object-contain sm:size-10"
          style={brandColor ? { borderColor: brandColor } : undefined}
          onError={() => setLogoFailed(true)}
        />
      ) : (
        <span
          aria-hidden="true"
          className={cn(
            "inline-flex size-9 shrink-0 items-center justify-center rounded-md border border-border/80 bg-muted text-xs font-semibold text-foreground sm:size-10",
            filled && "border-transparent"
          )}
          style={markStyle}
        >
          {monogramFromName(name || "Gestcopy")}
        </span>
      )}
      <div
        className={cn("min-w-0", brandColor && "border-l-2 pl-2.5")}
        style={brandColor ? { borderLeftColor: brandColor } : undefined}
      >
        {name ? (
          <p className="truncate text-sm font-semibold tracking-tight text-foreground">
            {name}
          </p>
        ) : null}
        <p className="truncate text-[0.6875rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Gestcopy
        </p>
      </div>
    </div>
  );
}
