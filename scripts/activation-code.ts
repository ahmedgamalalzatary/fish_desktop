// Makes the activation code for a shop's PC: `npm run activation-code <device code>`.
// The device code is what the app shows on its activation screen. Needs the private key
// %USERPROFILE%\.tauri\pos-activation.key; `--new-key` creates it once (never again: the app only
// accepts codes from the key whose public half is in src-tauri/src/activation.rs).
import { createPrivateKey, createPublicKey, generateKeyPairSync } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import process from "node:process";
import { activationCode } from "./activation.ts";

const KEY_FILE = join(homedir(), ".tauri", "pos-activation.key");
const arg = process.argv[2] ?? "";

try {
  if (arg === "--new-key") {
    if (existsSync(KEY_FILE)) throw new Error(`${KEY_FILE} exists already; it must never be replaced.`);
    const { privateKey } = generateKeyPairSync("ed25519");
    mkdirSync(dirname(KEY_FILE), { recursive: true });
    writeFileSync(KEY_FILE, privateKey.export({ format: "pem", type: "pkcs8" }), { mode: 0o600 });
    console.log(`Created ${KEY_FILE}. Back it up.`);
  }
  if (!existsSync(KEY_FILE)) throw new Error(`No ${KEY_FILE}. Restore it from your backup.`);
  const key = createPrivateKey(readFileSync(KEY_FILE));
  if (arg === "--new-key" || arg === "--public-key") {
    const raw = createPublicKey(key).export({ format: "der", type: "spki" }).subarray(-32);
    console.log(`Public key for src-tauri/src/activation.rs:\n[${[...raw].join(", ")}]`);
  } else {
    console.log(activationCode(key, arg));
  }
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
