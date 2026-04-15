interface AntiFlapState {
  observingSince: number | null;
  failureCount: number;
}

const FLAP_STATES = new Map<string, AntiFlapState>();
const OBSERVE_WINDOW_MS = 20 * 60 * 1000;

export function isInObservation(providerId: string): boolean {
  const state = FLAP_STATES.get(providerId);
  if (!state || !state.observingSince) return false;
  return Date.now() - state.observingSince < OBSERVE_WINDOW_MS;
}

export function enterObservation(providerId: string): void {
  const state = FLAP_STATES.get(providerId) || { observingSince: null, failureCount: 0 };
  state.observingSince = Date.now();
  state.failureCount = 0;
  FLAP_STATES.set(providerId, state);
}

export function recordObservationFailure(providerId: string): boolean {
  const state = FLAP_STATES.get(providerId);
  if (!state) return false;
  state.failureCount++;
  if (state.failureCount >= 3) {
    state.observingSince = null;
    return true;
  }
  return false;
}

export function exitObservation(providerId: string): void {
  const state = FLAP_STATES.get(providerId);
  if (state) {
    state.observingSince = null;
    state.failureCount = 0;
  }
}

export function clearProvider(providerId: string): void {
  FLAP_STATES.delete(providerId);
}
