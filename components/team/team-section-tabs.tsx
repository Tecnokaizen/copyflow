"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/team", label: "Personal", exact: true },
  { href: "/team/access", label: "Usuarios y permisos", exact: false },
] as const;

type TeamSectionTabsProps = {
  showAccess: boolean;
};

export function TeamSectionTabs({ showAccess }: TeamSectionTabsProps) {
  const pathname = usePathname();
  const tabs = showAccess ? TABS : TABS.filter((tab) => tab.href === "/team");

  return (
    <div className="mb-8 border-b border-border/80">
      <nav className="-mb-px flex flex-wrap gap-1" aria-label="Secciones de equipo">
        {tabs.map((tab) => {
          const active = tab.exact
            ? pathname === tab.href
            : pathname === tab.href || pathname.startsWith(`${tab.href}/`);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={cn(
                "rounded-t-md px-3.5 py-3 text-[0.9375rem] font-medium transition-colors",
                active
                  ? "border-b-2 border-primary text-primary"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
