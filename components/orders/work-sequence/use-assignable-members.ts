"use client";

import { useEffect, useRef, useState } from "react";

import { fetchAssignableMembers } from "@/lib/orders/work-sequence/client";
import type { AssignableMember } from "@/lib/orders/work-sequence/types";

/**
 * Assignable people (R6) for the step selects. Uses the list the page already
 * has when it passes one; otherwise loads /api/orders/options once, and only
 * when a dialog needs it.
 */
export function useAssignableMembers(
  provided: readonly AssignableMember[] | null | undefined,
  needed: boolean
) {
  const [fetched, setFetched] = useState<AssignableMember[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requested = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (provided || !needed || requested.current) {
      return;
    }
    requested.current = true;
    fetchAssignableMembers()
      .then((members) => {
        if (!mounted.current) return;
        setFetched(members);
        setError(null);
      })
      .catch((reason: unknown) => {
        requested.current = false;
        if (!mounted.current) return;
        setError(reason instanceof Error ? reason.message : "No se pudo cargar el personal.");
      });
  }, [provided, needed]);

  const members: readonly AssignableMember[] | null = provided ?? fetched;
  return { members, error: provided ? null : error };
}
