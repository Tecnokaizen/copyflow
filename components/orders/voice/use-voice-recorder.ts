"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type VoiceRecorderPhase =
  | "idle"
  | "requesting_permission"
  | "recording"
  | "stopping"
  | "error";

function pickMimeType() {
  if (typeof MediaRecorder === "undefined") return null;
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/mp4",
    "audio/webm",
  ];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? null;
}

export function useVoiceRecorder(maxClipSeconds: number) {
  const [phase, setPhase] = useState<VoiceRecorderPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [mimeType, setMimeType] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const timerRef = useRef<number | null>(null);
  const startedAtRef = useRef<number>(0);

  const cleanupTracks = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    mediaRecorderRef.current = null;
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => {
    function onHidden() {
      if (document.visibilityState === "hidden" && mediaRecorderRef.current) {
        try {
          mediaRecorderRef.current.stop();
        } catch {
          /* ignore */
        }
        cleanupTracks();
        setPhase("idle");
        setBlob(null);
      }
    }

    document.addEventListener("visibilitychange", onHidden);
    return () => {
      document.removeEventListener("visibilitychange", onHidden);
      cleanupTracks();
    };
  }, [cleanupTracks]);

  const start = useCallback(async () => {
    setError(null);
    setBlob(null);
    const type = pickMimeType();
    if (!type || typeof navigator === "undefined" || !navigator.mediaDevices) {
      setError("Este dispositivo no permite grabar audio. Puedes escribir el pedido.");
      setPhase("error");
      return;
    }

    setPhase("requesting_permission");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      streamRef.current = stream;
      chunksRef.current = [];
      const recorder = new MediaRecorder(stream, {
        mimeType: type,
        audioBitsPerSecond: 48_000,
      });
      mediaRecorderRef.current = recorder;
      setMimeType(type);

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };
      recorder.onstop = () => {
        const next = new Blob(chunksRef.current, { type });
        setBlob(next);
        cleanupTracks();
        setPhase("idle");
      };

      recorder.start();
      startedAtRef.current = Date.now();
      setElapsedMs(0);
      setPhase("recording");
      timerRef.current = window.setInterval(() => {
        const elapsed = Date.now() - startedAtRef.current;
        setElapsedMs(elapsed);
        if (elapsed >= maxClipSeconds * 1000) {
          setPhase("stopping");
          try {
            recorder.stop();
          } catch {
            /* ignore */
          }
        }
      }, 200);
    } catch (err) {
      cleanupTracks();
      const name = err instanceof DOMException ? err.name : "";
      if (name === "NotAllowedError") {
        setError("Permiso de micrófono denegado. Actívalo en el navegador para dictar.");
      } else if (name === "NotFoundError") {
        setError("No se encontró un micrófono.");
      } else if (name === "NotReadableError") {
        setError("El micrófono está ocupado por otra aplicación.");
      } else if (name === "SecurityError") {
        setError("Se necesita HTTPS para usar el micrófono.");
      } else {
        setError("No se pudo iniciar la grabación.");
      }
      setPhase("error");
    }
  }, [cleanupTracks, maxClipSeconds]);

  const stop = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === "inactive") return;
    setPhase("stopping");
    try {
      recorder.stop();
    } catch {
      cleanupTracks();
      setPhase("idle");
    }
  }, [cleanupTracks]);

  const cancel = useCallback(() => {
    try {
      mediaRecorderRef.current?.stop();
    } catch {
      /* ignore */
    }
    cleanupTracks();
    chunksRef.current = [];
    setBlob(null);
    setElapsedMs(0);
    setPhase("idle");
    setError(null);
  }, [cleanupTracks]);

  const clearBlob = useCallback(() => {
    setBlob(null);
    setElapsedMs(0);
  }, []);

  return {
    phase,
    error,
    elapsedMs,
    blob,
    mimeType,
    supported: typeof MediaRecorder !== "undefined",
    start,
    stop,
    cancel,
    clearBlob,
  };
}
