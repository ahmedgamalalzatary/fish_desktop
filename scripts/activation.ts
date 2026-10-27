// Activation codes: a device code (shown by the app on a new PC) signed with the private key that
// only the owner holds. The app checks the signature with the public key in
// src-tauri/src/activation.rs, so it can check codes but never make them.
import { createPrivateKey, sign, type KeyObject } from "node:crypto";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** RFC 4648 base32, without padding. */
export function base32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

/** The device code as the app shows it (`XXXX-XXXX-XXXX-XXXX`), however it was typed or pasted. */
export function normalizeDeviceCode(input: string): string {
  const letters = input.toUpperCase().replace(/[\s_-]/g, "");
  if (!new RegExp(`^[${ALPHABET}]{16}$`).test(letters)) {
    throw new Error(
      `"${input}" is not a device code: it has 16 letters and digits 2-7, like ABCD-EFGH-JKLM-NPQR`,
    );
  }
  return letters.match(/.{4}/g)!.join("-");
}

/** The activation code for a device: its code signed with the key, in groups of five. */
export function activationCode(key: KeyObject, deviceCode: string): string {
  const signature = sign(null, Buffer.from(normalizeDeviceCode(deviceCode)), key);
  return base32(signature)
    .match(/.{1,5}/g)!
    .join("-");
}

/** An Ed25519 private key from its 32-byte seed. */
export function keyFromSeed(seed: Buffer): KeyObject {
  const pkcs8Prefix = Buffer.from("302e020100300506032b657004220420", "hex");
  return createPrivateKey({ key: Buffer.concat([pkcs8Prefix, seed]), format: "der", type: "pkcs8" });
}
