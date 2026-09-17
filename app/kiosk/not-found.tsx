export default function KioskNotFound() {
  return (
    <main className="grid min-h-svh place-items-center bg-muted/25 px-4 py-10">
      <section className="w-full max-w-lg rounded-2xl border bg-card p-7 text-center shadow-sm">
        <h1 className="text-2xl font-bold">Kiosk no disponible</h1>
        <p className="mt-3 text-muted-foreground">
          Comprueba la dirección o contacta con la copistería.
        </p>
      </section>
    </main>
  );
}
