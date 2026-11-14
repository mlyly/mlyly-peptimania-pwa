import {serwist} from "@serwist/next/config";

/**
 * Serwist configuration for the Next.js server build.
 *
 * Next 16 builds with Turbopack by default, and `@serwist/next`'s webpack
 * wrapper cannot run there. Serwist's Turbopack-compatible "configurator mode"
 * generates the worker from the files `next build` produced (see the `build`
 * script in package.json).
 *
 * `@serwist/next/config` fills in the Next-aware globs:
 * - `.next/static/**` for hashed assets,
 * - `public/**` for icons/manifest/static files,
 * - `.next/server/{app,pages}/**\/*.html` for prerendered routes.
 *
 * It also rewrites those HTML entries to clean route URLs (`/medications`),
 * rebases `_next` assets, and excludes the worker itself from the manifest.
 */
export default await serwist({
    swSrc: "app/sw.ts",
    // The worker is a public asset and must be served from the app origin.
    swDest: "public/sw.js",
    maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
    esbuildOptions: {
        // iOS/WebKit only supports classic service workers. The CLI defaults
        // to `esm`, which Safari refuses to register. Ship an IIFE instead.
        format: "iife",
        target: ["safari15"],
        // Serwist's development logging checks `process.env.NODE_ENV`; there
        // is no `process` inside a browser worker.
        define: {
            "process.env.NODE_ENV": '"production"',
        },
    },
});
