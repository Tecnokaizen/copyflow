import { cn } from "@/lib/utils";

export function FactRow({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid gap-1 border-b border-border/60 py-3.5 last:border-b-0 sm:grid-cols-[10.5rem_1fr] sm:gap-4",
        className
      )}
    >
      <div className="text-sm font-medium text-muted-foreground">{label}</div>
      <div className="min-w-0 text-sm text-foreground">{children}</div>
    </div>
  );
}

export function FactValue({
  value,
  empty = "—",
}: {
  value: string | null | undefined;
  empty?: string;
}) {
  if (!value || !String(value).trim()) {
    return <span className="text-muted-foreground">{empty}</span>;
  }
  return <span className="whitespace-pre-wrap break-words">{value}</span>;
}

export function DraftSelect({
  value,
  onChange,
  disabled,
  children,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      className={cn(
        "w-full max-w-md rounded-md border border-border bg-background px-3 py-2 text-sm",
        className
      )}
    >
      {children}
    </select>
  );
}

export function DraftInput({
  value,
  onChange,
  disabled,
  type = "text",
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  type?: string;
  className?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      className={cn(
        "w-full max-w-md rounded-md border border-border bg-background px-3 py-2 text-sm",
        className
      )}
    />
  );
}

export function DraftTextarea({
  value,
  onChange,
  disabled,
  rows = 4,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  rows?: number;
  className?: string;
}) {
  return (
    <textarea
      rows={rows}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      className={cn(
        "w-full rounded-md border border-border bg-background px-3 py-2 text-sm",
        className
      )}
    />
  );
}
