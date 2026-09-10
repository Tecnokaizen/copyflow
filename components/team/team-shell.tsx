"use client";

import { useEffect, useState } from "react";
import { AppNav } from "@/components/app-nav";
import { TeamSectionTabs } from "@/components/team/team-section-tabs";
import { canManageTenantAccess } from "@/lib/auth/membership-roles";

export function TeamShell({ children }: { children: React.ReactNode }) {
  const [showAccess, setShowAccess] = useState(false);

  useEffect(() => {
    async function load() {
      const response = await fetch("/api/context");
      if (!response.ok) {
        setShowAccess(false);
        return;
      }
      const context = await response.json();
      setShowAccess(canManageTenantAccess(context?.membership?.role));
    }
    void load();
  }, []);

  return (
    <main className="min-h-screen bg-background p-4 sm:p-6 lg:p-8">
      <div className="gc-page-inner">
        <AppNav />
        <TeamSectionTabs showAccess={showAccess} />
        {children}
      </div>
    </main>
  );
}
