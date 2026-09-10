"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { LogoutButton } from "@/components/logout-button";
import { canViewActivity } from "@/lib/auth/membership-roles";
import { cn } from "@/lib/utils";

type NavItem = {
  href: string;
  label: string;
  visible: (role: string | null) => boolean;
};

const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Inicio", visible: () => true },
  { href: "/orders", label: "Pedidos", visible: () => true },
  { href: "/clients", label: "Clientes", visible: () => true },
  { href: "/services", label: "Servicios", visible: () => true },
  { href: "/team", label: "Equipo", visible: () => true },
  {
    href: "/activity",
    label: "Actividad",
    visible: (role) => canViewActivity(role),
  },
];

export function AppNav() {
  const [role, setRole] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const response = await fetch("/api/context");
        if (response.ok) {
          const context = await response.json();
          setRole(context?.membership?.role ?? null);
        }
      } finally {
        setReady(true);
      }
    }
    void load();
  }, []);

  return (
    <nav className="mb-6 flex flex-wrap items-center gap-1 border-b border-border pb-4 text-sm">
      {NAV_ITEMS.filter((item) => !ready || item.visible(role)).map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className={cn(
            "rounded-md px-2.5 py-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          )}
        >
          {item.label}
        </Link>
      ))}
      <LogoutButton className="ml-auto text-muted-foreground" />
    </nav>
  );
}
