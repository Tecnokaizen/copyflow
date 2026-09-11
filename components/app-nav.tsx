"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { LogoutButton } from "@/components/logout-button";
import { canViewActivity } from "@/lib/auth/membership-roles";
import { cn } from "@/lib/utils";

type NavItem = {
  href: string;
  label: string;
  visible: (role: string | null) => boolean;
  match: (pathname: string) => boolean;
};

const NAV_ITEMS: NavItem[] = [
  {
    href: "/",
    label: "Inicio",
    visible: () => true,
    match: (pathname) => pathname === "/",
  },
  {
    href: "/orders",
    label: "Pedidos",
    visible: () => true,
    match: (pathname) =>
      pathname === "/orders" || pathname.startsWith("/orders/"),
  },
  {
    href: "/clients",
    label: "Clientes",
    visible: () => true,
    match: (pathname) =>
      pathname === "/clients" || pathname.startsWith("/clients/"),
  },
  {
    href: "/services",
    label: "Servicios",
    visible: () => true,
    match: (pathname) => pathname === "/services",
  },
  {
    href: "/team",
    label: "Equipo",
    visible: () => true,
    match: (pathname) => pathname === "/team" || pathname.startsWith("/team/"),
  },
  {
    href: "/activity",
    label: "Actividad",
    visible: (role) => canViewActivity(role),
    match: (pathname) => pathname === "/activity",
  },
];

type TenantLabel = {
  name: string;
  slug: string;
};

function AppNavFrame({
  pathname,
  role,
  tenant,
  ready,
}: {
  pathname: string;
  role: string | null;
  tenant: TenantLabel | null;
  ready: boolean;
}) {
  return (
    <header className="mb-6 border-b border-border/80 pb-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="min-w-0">
          {tenant ? (
            <p className="truncate text-sm font-semibold tracking-tight text-foreground">
              {tenant.name}
              {tenant.slug && tenant.slug !== tenant.name ? (
                <span className="ml-2 font-normal text-muted-foreground">
                  {tenant.slug}
                </span>
              ) : null}
            </p>
          ) : (
            <p className="text-sm font-semibold tracking-tight text-foreground">
              Gestcopy
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2 sm:justify-end">
          <LogoutButton className="text-muted-foreground" />
        </div>
      </div>

      <nav
        className="mt-3 flex flex-wrap items-center gap-1"
        aria-label="Navegación principal"
      >
        {NAV_ITEMS.filter((item) => item.visible(ready ? role : null)).map(
          (item) => {
            const active = item.match(pathname);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                  active
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                {item.label}
              </Link>
            );
          }
        )}
      </nav>
    </header>
  );
}

function AppNavContent() {
  const pathname = usePathname() || "/";
  const [role, setRole] = useState<string | null>(null);
  const [tenant, setTenant] = useState<TenantLabel | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const response = await fetch("/api/context");
        if (response.ok) {
          const context = await response.json();
          setRole(context?.membership?.role ?? null);
          const name =
            typeof context?.tenant?.name === "string"
              ? context.tenant.name
              : null;
          const slug =
            typeof context?.tenant?.slug === "string"
              ? context.tenant.slug
              : null;
          if (name || slug) {
            setTenant({
              name: name || slug || "",
              slug: slug || "",
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
      role={role}
      tenant={tenant}
      ready={ready}
    />
  );
}

export function AppNav() {
  return (
    <Suspense
      fallback={
        <AppNavFrame pathname="/" role={null} tenant={null} ready={false} />
      }
    >
      <AppNavContent />
    </Suspense>
  );
}
