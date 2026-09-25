"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { ChevronDown, CircleHelp, Menu, X } from "lucide-react";

import { SessionIdentity } from "@/components/session-identity";
import { TenantBrand } from "@/components/tenant-brand";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  headerIdentityFromContext,
  type HeaderIdentity,
} from "@/lib/nav/identity";
import {
  navGroupIsActive,
  navItemIsActive,
  navStructureForRole,
  type AppNavEntry,
  type AppNavGroup,
  type AppNavItem,
  type NavLocation,
} from "@/lib/nav/items";
import { HELP_DOCS_URL } from "@/lib/help/catalog";
import { cn } from "@/lib/utils";

type TenantLabel = {
  displayName: string;
  logoUrl: string | null;
  brandColor: string | null;
};

function HelpLink({ className }: { className?: string }) {
  return (
    <a
      href={HELP_DOCS_URL}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "inline-flex min-h-10 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className
      )}
    >
      <CircleHelp className="size-4" aria-hidden="true" />
      Ayuda
    </a>
  );
}

function linkClass(active: boolean) {
  return cn(
    "inline-flex min-h-10 items-center rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
    active
      ? "bg-primary/10 text-primary"
      : "text-muted-foreground hover:bg-muted hover:text-foreground"
  );
}

function NavLinkItem({
  item,
  location,
  onNavigate,
  className,
}: {
  item: AppNavItem;
  location: NavLocation;
  onNavigate?: () => void;
  className?: string;
}) {
  const active = navItemIsActive(item, location);
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      onClick={onNavigate}
      className={cn(linkClass(active), className)}
    >
      {item.label}
    </Link>
  );
}

function DesktopNavGroup({
  group,
  location,
}: {
  group: AppNavGroup;
  location: NavLocation;
}) {
  const groupActive = navGroupIsActive(group, location);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(linkClass(groupActive), "gap-1")}
          aria-current={groupActive ? "true" : undefined}
        >
          {group.label}
          <ChevronDown className="size-3.5 opacity-70" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[12rem]">
        {group.items.map((item) => {
          const active = navItemIsActive(item, location);
          return (
            <DropdownMenuItem key={item.id} asChild>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "min-h-10 cursor-pointer",
                  active && "bg-accent text-accent-foreground"
                )}
              >
                {item.label}
              </Link>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function DesktopNav({
  entries,
  location,
}: {
  entries: AppNavEntry[];
  location: NavLocation;
}) {
  return (
    <nav
      className="hidden items-center gap-1 md:flex"
      aria-label="Navegación principal"
    >
      {entries.map((entry) =>
        entry.type === "link" ? (
          <NavLinkItem
            key={entry.item.id}
            item={entry.item}
            location={location}
          />
        ) : (
          <DesktopNavGroup
            key={entry.group.id}
            group={entry.group}
            location={location}
          />
        )
      )}
    </nav>
  );
}

function MobileNav({
  entries,
  location,
  open,
  onOpenChange,
}: {
  entries: AppNavEntry[];
  location: NavLocation;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <div className="md:hidden">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="min-h-11 gap-2"
        aria-expanded={open}
        aria-controls="app-mobile-nav"
        onClick={() => onOpenChange(!open)}
      >
        {open ? <X className="size-4" /> : <Menu className="size-4" />}
        Menú
      </Button>

      {open ? (
        <nav
          id="app-mobile-nav"
          className="mt-3 space-y-3 rounded-md border border-border bg-card p-3"
          aria-label="Navegación principal"
        >
          <HelpLink className="w-full justify-start md:hidden" />
          {entries.map((entry) => {
            if (entry.type === "link") {
              return (
                <NavLinkItem
                  key={entry.item.id}
                  item={entry.item}
                  location={location}
                  onNavigate={() => onOpenChange(false)}
                  className="w-full justify-start"
                />
              );
            }

            return (
              <div key={entry.group.id} className="space-y-1">
                <p className="px-2.5 pt-1 text-[0.6875rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  {entry.group.label}
                </p>
                <div className="flex flex-col gap-1">
                  {entry.group.items.map((item) => (
                    <NavLinkItem
                      key={item.id}
                      item={item}
                      location={location}
                      onNavigate={() => onOpenChange(false)}
                      className="w-full justify-start pl-4"
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </nav>
      ) : null}
    </div>
  );
}

function AppNavFrame({
  pathname,
  searchParams,
  role,
  tenant,
  identity,
  ready,
  quotesEnabled,
}: {
  pathname: string;
  searchParams: URLSearchParams;
  role: string | null;
  tenant: TenantLabel | null;
  identity: HeaderIdentity | null;
  ready: boolean;
  quotesEnabled: boolean;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const location: NavLocation = { pathname, searchParams };
  const entries = navStructureForRole(ready ? role : null, {
    quotes: quotesEnabled,
  });

  return (
    <header className="mb-6">
      <div className="flex items-center justify-between gap-3 border-b border-border/80 py-3">
        <TenantBrand
          displayName={tenant?.displayName ?? ""}
          logoUrl={tenant?.logoUrl}
          brandColor={tenant?.brandColor}
        />
        <div className="flex shrink-0 items-center gap-1 sm:gap-2">
          <HelpLink />
          <ThemeSwitcher />
          <SessionIdentity identity={ready ? identity : null} />
        </div>
      </div>

      <div className="border-b border-border/80 py-2">
        <DesktopNav entries={entries} location={location} />
        <MobileNav
          entries={entries}
          location={location}
          open={mobileOpen}
          onOpenChange={setMobileOpen}
        />
      </div>
    </header>
  );
}

function AppNavContent() {
  const pathname = usePathname() || "/";
  const searchParams = useSearchParams();
  const [role, setRole] = useState<string | null>(null);
  const [tenant, setTenant] = useState<TenantLabel | null>(null);
  const [identity, setIdentity] = useState<HeaderIdentity | null>(null);
  const [quotesEnabled, setQuotesEnabled] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const response = await fetch("/api/context");
        if (response.ok) {
          const context = await response.json();
          setRole(context?.membership?.role ?? null);
          setQuotesEnabled(context?.features?.quotes === true);
          setIdentity(headerIdentityFromContext(context));
          const tenantRecord = context?.tenant;
          const displayName =
            typeof tenantRecord?.display_name === "string"
              ? tenantRecord.display_name
              : typeof tenantRecord?.business_name === "string" &&
                  tenantRecord.business_name.trim()
                ? tenantRecord.business_name
                : typeof tenantRecord?.name === "string"
                  ? tenantRecord.name
                  : "";
          const brandColor =
            typeof tenantRecord?.branding?.brand_color === "string"
              ? tenantRecord.branding.brand_color
              : null;
          if (displayName || tenantRecord?.logo_url) {
            setTenant({
              displayName,
              logoUrl:
                typeof tenantRecord?.logo_url === "string"
                  ? tenantRecord.logo_url
                  : null,
              brandColor,
            });
          }
        }
      } finally {
        setReady(true);
      }
    }
    void load();
  }, []);

  return (
      <AppNavFrame
        pathname={pathname}
        searchParams={searchParams}
        role={role}
        tenant={tenant}
        identity={identity}
        ready={ready}
        quotesEnabled={quotesEnabled}
      />
  );
}

export function AppNav() {
  return (
    <Suspense
      fallback={
        <AppNavFrame
          pathname="/"
          searchParams={new URLSearchParams()}
          role={null}
          tenant={null}
          identity={null}
          ready={false}
          quotesEnabled={false}
        />
      }
    >
      <AppNavContent />
    </Suspense>
  );
}
