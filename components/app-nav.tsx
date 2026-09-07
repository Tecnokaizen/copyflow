import Link from "next/link";

export function AppNav() {
  return (
    <nav className="mb-6 flex gap-4 text-sm">
      <Link
        href="/orders"
        className="text-muted-foreground hover:underline"
      >
        Pedidos
      </Link>
      <Link
        href="/clients"
        className="text-muted-foreground hover:underline"
      >
        Clientes
      </Link>
    </nav>
  );
}
