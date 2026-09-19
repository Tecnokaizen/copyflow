import { formatFactLabel } from "@/lib/orders/fact-label";
import { cn } from "@/lib/utils";

export function FactRow({
  label,
  children,
  className,
  emphasis = false,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
  emphasis?: boolean;
}) {
  return (
    <div
      className={cn(
        "grid gap-1 border-b border-border/60 py-3.5 last:border-b-0 sm:grid-cols-[9.5rem_minmax(0,1fr)] sm:items-stretch sm:gap-0",
        className
      )}
    >
      <div className="gc-fact-label sm:pr-4">{formatFactLabel(label)}</div>
      <div
        className={cn(
          "gc-fact-value sm:border-l sm:border-border/60 sm:pl-4",
          emphasis && "gc-fact-value-emphasis"
        )}
      >
        {children}
      </div>
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
    return <span className="font-normal text-muted-foreground">{empty}</span>;
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
        "min-h-11 w-full max-w-md rounded-md border border-border bg-background px-3 py-2 text-sm",
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
  placeholder,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  type?: string;
  placeholder?: string;
  className?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      disabled={disabled}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
      className={cn(
        "min-h-11 w-full max-w-md rounded-md border border-border bg-background px-3 py-2 text-sm",
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
        "min-h-24 w-full rounded-md border border-border bg-background px-3 py-2 text-sm",
        className
      )}
    />
  );
}
