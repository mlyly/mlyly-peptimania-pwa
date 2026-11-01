/**
 * Terms-of-service acceptance logic (see `public/TERMS.md`).
 *
 * The acceptance timestamp is persisted as the `legal.termsAcceptedAt`
 * setting in IndexedDB (schema v8 `settings` store). The startup gate is
 * shown when the terms have never been accepted, or when the recorded
 * acceptance is older than the re-confirmation window below.
 */

/** How long an acceptance stays valid before the gate re-appears. */
export const TERMS_RECONFIRM_DAYS = 30;

/** Path of the canonical terms document (pre-cached by the service worker). */
export const TERMS_URL = "/TERMS.md";

/** True if `acceptedAt` (ISO string or null) still covers the current moment. */
export function isTermsAccepted(
    acceptedAt: string | null,
    now: number = Date.now()
): boolean {
    if (!acceptedAt) return false;
    const time = Date.parse(acceptedAt);
    if (!Number.isFinite(time)) return false;
    const windowMs = TERMS_RECONFIRM_DAYS * 24 * 60 * 60 * 1000;
    return now - time < windowMs && time <= now + 60_000; // small clock skew allowed
}

/**
 * Whether the startup gate must be shown. `loaded` guards against flashing
 * the gate before the database snapshot has been read (defaults resolve to
 * "not accepted", which would otherwise briefly render the overlay).
 */
export function needsTermsAcceptance(acceptedAt: string | null, loaded: boolean): boolean {
    return loaded && !isTermsAccepted(acceptedAt);
}
