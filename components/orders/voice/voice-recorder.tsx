"use client";

import { useVoiceRecorder } from "@/components/orders/voice/use-voice-recorder";

type VoiceRecorderProps = {
  maxClipSeconds: number;
  disabled?: boolean;
  onRecorded: (blob: Blob, mimeType: string) => void;
  onCancel?: () => void;
};

function formatElapsed(ms: number) {
  const total = Math.floor(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function VoiceRecorder({
  maxClipSeconds,
  disabled,
  onRecorded,
  onCancel,
}: VoiceRecorderProps) {
  const recorder = useVoiceRecorder(maxClipSeconds);

  return (
    <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-3">
      <div className="flex flex-wrap items-center gap-2">
        {recorder.phase !== "recording" && recorder.phase !== "stopping" ? (
          <button
            type="button"
            className="gc-cta min-h-11 px-4"
            disabled={disabled || !recorder.supported}
            aria-pressed={false}
            onClick={() => void recorder.start()}
          >
            Dictar pedido
          </button>
        ) : (
          <button
            type="button"
            className="gc-cta min-h-11 px-4"
            aria-pressed={true}
            onClick={() => recorder.stop()}
          >
            Detener
          </button>
        )}
        <button
          type="button"
          className="min-h-11 rounded-md border border-border px-3 text-sm"
          disabled={recorder.phase === "idle" && !recorder.blob}
          onClick={() => {
            recorder.cancel();
            onCancel?.();
          }}
        >
          Cancelar
        </button>
        {recorder.blob ? (
          <button
            type="button"
            className="min-h-11 rounded-md border border-border px-3 text-sm"
            disabled={disabled}
            onClick={() => {
              if (recorder.blob && recorder.mimeType) {
                onRecorded(recorder.blob, recorder.mimeType);
              }
            }}
          >
            Usar grabación
          </button>
        ) : null}
        <span className="text-sm tabular-nums text-muted-foreground" aria-live="polite">
          {formatElapsed(recorder.elapsedMs)} / {formatElapsed(maxClipSeconds * 1000)}
        </span>
      </div>
      {!recorder.supported ? (
        <p className="text-sm text-muted-foreground">
          La grabación no está disponible. Usa el texto.
        </p>
      ) : null}
      {recorder.error ? (
        <p className="text-sm text-destructive" role="alert">
          {recorder.error}
        </p>
      ) : null}
    </div>
  );
}
