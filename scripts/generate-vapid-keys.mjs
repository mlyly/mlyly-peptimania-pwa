#!/usr/bin/env node
/**
 * Generates a VAPID key pair for the embedded notification relay.
 *
 * Usage:
 *   npm run vapid:generate
 *
 * Put the two base64url values in the deployment environment. The public key
 * is served to the browser through `GET /v1/config`; the private key must stay
 * server-side (Dokploy secret / `.env.local`, never committed).
 */
import {createRequire} from "node:module";

// `web-push` is CommonJS; a default import is not available to native ESM.
const require = createRequire(import.meta.url);
const webpush = require("web-push");

const {publicKey, privateKey} = webpush.generateVAPIDKeys();

console.log("");
console.log("VAPID keys generated. Add these to your deployment environment:");
console.log("");
console.log(`VAPID_PUBLIC_KEY=${publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${privateKey}`);
console.log('VAPID_SUBJECT=mailto:you@example.com   # required by the push spec');
console.log("");
console.log("Restart the server after changing keys. Rotating keys makes every");
console.log("existing browser subscription invalid; clients re-subscribe on the");
console.log("next sync automatically.");
console.log("");
