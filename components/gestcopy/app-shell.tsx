import { cn } from "@/lib/utils";

type AppShellProps = {
  children: React.ReactNode;
  className?: string;
  innerClassName?: string;
};

/** Shared light operational page shell for Gestcopy SaaS screens. */
export function AppShell({
  children,
  className,
  innerClassName,
}: AppShellProps) {
  return (
    <main className={cn("gc-page", className)}>
      <div className={cn("gc-page-inner", innerClassName)}>{children}</div>
    </main>
  );
}
