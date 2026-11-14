/**
 * Build-time application info. `APP_BUILD_TIME` is injected by `next.config.ts`
 * when the build starts, so it reflects when this bundle was built.
 */

const buildDate = new Date(process.env.APP_BUILD_TIME ?? Date.now());

const pad = (value: number) => String(value).padStart(2, "0");

/** Build date as ISO `YYYY-MM-DD`. */
export const LAST_MODIFIED: string = `${buildDate.getFullYear()}-${pad(buildDate.getMonth() + 1)}-${pad(buildDate.getDate())}`;

/** Build time as `HH:mm`. */
export const LAST_MODIFIED_TIME: string = `${pad(buildDate.getHours())}:${pad(buildDate.getMinutes())}`;
