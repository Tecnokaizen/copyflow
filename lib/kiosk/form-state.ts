import { fromDateTimeLocalValue } from "@/lib/orders/format";

export type KioskFormStep = "contact" | "order" | "confirmation";

export type KioskFormState = {
  submissionId: string;
  name: string;
  email: string;
  phone: string;
  serviceId: string;
  description: string;
  dueAt: string;
  observations: string;
  submitting: boolean;
  error: string | null;
};

export function createKioskFormState(submissionId: string): KioskFormState {
  return {
    submissionId,
    name: "",
    email: "",
    phone: "",
    serviceId: "",
    description: "",
    dueAt: "",
    observations: "",
    submitting: false,
    error: null,
  };
}

export function canAdvanceKioskStep(
  step: KioskFormStep,
  state: KioskFormState
) {
  if (step === "contact") {
    return Boolean(
      state.name.trim() && (state.email.trim() || state.phone.trim())
    );
  }
  if (step === "order") {
    return Boolean(state.serviceId && state.description.trim());
  }
  return true;
}

export function markKioskSubmissionFailed(
  state: KioskFormState,
  error: string
): KioskFormState {
  return { ...state, submitting: false, error };
}

export function kioskSubmissionPayload(state: KioskFormState) {
  return {
    submission_id: state.submissionId,
    contact: {
      name: state.name.trim(),
      email: state.email.trim() || null,
      phone: state.phone.trim() || null,
    },
    service_id: state.serviceId,
    description: state.description.trim(),
    due_at: fromDateTimeLocalValue(state.dueAt),
    observations: state.observations.trim() || null,
  };
}
