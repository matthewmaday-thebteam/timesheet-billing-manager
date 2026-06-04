/**
 * appVersion - Single source of truth for the running Manifest build version.
 *
 * The value is injected at build time via Vite's `define` (see vite.config.ts),
 * sourced from the VITE_MANIFEST_VERSION env var with a '1.0.0.109' fallback.
 * This decouples the app version from the release-notes data array.
 */
export const MANIFEST_VERSION = __MANIFEST_VERSION__;
