export const instant = false;

export default function EntitlementUnavailablePage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <div className="max-w-md text-center">
        <h1 className="text-2xl font-bold">No hemos podido comprobar el acceso</h1>
        <p className="mt-3 text-muted-foreground">
          No hemos podido verificar el acceso comercial de tu organización.
          Esto no significa que la suscripción esté cancelada. Inténtalo de
          nuevo en unos minutos.
        </p>
      </div>
    </main>
  );
}
