"use client";

import { LogoutButton } from "@/components/logout-button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { HeaderIdentity } from "@/lib/nav/identity";
import { cn } from "@/lib/utils";

function InitialsAvatar({
  initials,
  className,
}: {
  initials: string;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[0.6875rem] font-semibold tracking-wide text-primary ring-1 ring-inset ring-primary/20",
        className
      )}
    >
      {initials}
    </span>
  );
}

export function SessionIdentity({
  identity,
}: {
  identity: HeaderIdentity | null;
}) {
  if (!identity) {
    return <LogoutButton className="text-muted-foreground" />;
  }

  return (
    <>
      <div className="hidden min-w-0 items-center gap-2 sm:flex">
        <div className="flex min-w-0 items-center gap-2">
          <InitialsAvatar initials={identity.initials} />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium leading-tight text-foreground">
              {identity.name}
            </p>
            <p className="truncate text-xs leading-tight text-muted-foreground">
              {identity.roleLabel}
            </p>
          </div>
        </div>
        <LogoutButton className="text-muted-foreground" />
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex min-w-0 max-w-[12.5rem] items-center gap-2 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:hidden"
            aria-label={`${identity.name}, ${identity.roleLabel}`}
          >
            <InitialsAvatar initials={identity.initials} />
            <span className="min-w-0 truncate text-sm font-medium text-foreground">
              {identity.name}
            </span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64 p-2">
          <div className="flex items-start gap-2 px-1 py-1.5">
            <InitialsAvatar initials={identity.initials} />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-foreground">
                {identity.name}
              </p>
              {identity.email ? (
                <p className="truncate text-xs text-muted-foreground">
                  {identity.email}
                </p>
              ) : null}
              <p className="mt-0.5 text-xs text-muted-foreground">
                {identity.roleLabel}
              </p>
            </div>
          </div>
          <div className="mt-1 border-t border-border/70 pt-2">
            <LogoutButton className="w-full justify-start text-muted-foreground" />
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
