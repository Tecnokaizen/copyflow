import { StatusBadge } from "@/components/gestcopy/status-badge";

/**
 * Informative only. Voice orders are announced as «En preparación»: no
 * microphone, no recording, no simulated flow and no call to action.
 */
export function EarlyAccessInfo() {
  return (
    <section className="gc-card" aria-labelledby="pro-voice-orders-title">
      <div className="space-y-2 border-b border-border/70 px-5 py-5 sm:px-6">
        <p className="text-[0.9375rem] leading-relaxed text-foreground">
          Tu plan y tu cuota no cambian. Este acceso no genera cargos
          adicionales.
        </p>
      </div>

      <div className="space-y-3 px-5 py-5 sm:px-6">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h2 id="pro-voice-orders-title" className="gc-section-title">
            Gestcopy AI — Pedidos por voz
          </h2>
          <StatusBadge tone="neutral">En preparación</StatusBadge>
        </div>
        <p className="max-w-2xl text-[0.9375rem] leading-relaxed text-muted-foreground">
          Estamos preparando una forma de dictar un pedido y revisar sus datos
          antes de guardarlo. Todavía no está disponible.
        </p>
      </div>
    </section>
  );
}
