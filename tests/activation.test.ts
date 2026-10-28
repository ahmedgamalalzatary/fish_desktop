import { createPrivateKey, createPublicKey, verify } from "node:crypto";
import { describe, expect, test } from "vitest";
import { activationCode, base32, keyFromSeed, normalizeDeviceCode, resetReply } from "../scripts/activation.ts";

// The same test key as `TEST_SEED` in src-tauri/src/activation.rs: 32 bytes of 1.
const testKey = keyFromSeed(Buffer.alloc(32, 1));

describe("base32", () => {
  test("is RFC 4648 without padding", () => {
    expect(base32(Buffer.from("foobar"))).toBe("MZXW6YTBOI");
    expect(base32(Buffer.from("f"))).toBe("MY");
  });
});

describe("normalizeDeviceCode", () => {
  test("accepts the code however it was typed", () => {
    expect(normalizeDeviceCode(" abcd efgh-jklm_npqr ")).toBe("ABCD-EFGH-JKLM-NPQR");
  });

  test("refuses anything that is not 16 code letters", () => {
    expect(() => normalizeDeviceCode("ABCD-EFGH")).toThrow(/device code/);
    expect(() => normalizeDeviceCode("ABCD-EFGH-JKLM-NPQ1")).toThrow(/device code/);
  });
});

describe("activationCode", () => {
  test("is the device code signed with the key, in groups of five", () => {
    const code = activationCode(testKey, "abcd-efgh-jklm-npqr");
    expect(code).toMatch(/^[A-Z2-7]{5}(-[A-Z2-7]{1,5}){20}$/);
    const signature = Buffer.from(base32Decode(code.replaceAll("-", "")));
    expect(verify(null, Buffer.from("ABCD-EFGH-JKLM-NPQR"), createPublicKey(testKey), signature)).toBe(true);
  });

  test("is the same every time, so the app's test can pin it", () => {
    expect(activationCode(testKey, "ABCD-EFGH-JKLM-NPQR")).toBe(PINNED);
  });

  test("the test key is a real Ed25519 key", () => {
    expect(createPrivateKey(testKey.export({ format: "pem", type: "pkcs8" })).asymmetricKeyType).toBe(
      "ed25519",
    );
  });
});

describe("resetReply", () => {
  test("is `reset:<reset code>` signed with the key, so it never doubles as an activation code", () => {
    const reply = resetReply(testKey, " abcd efgh jklm npqr ");
    const signature = Buffer.from(base32Decode(reply.replaceAll("-", "")));
    const key = createPublicKey(testKey);
    expect(verify(null, Buffer.from("reset:ABCD-EFGH-JKLM-NPQR"), key, signature)).toBe(true);
    expect(verify(null, Buffer.from("ABCD-EFGH-JKLM-NPQR"), key, signature)).toBe(false);
    expect(reply).toBe(PINNED_RESET);
  });

  test("refuses anything that is not a reset code", () => {
    expect(() => resetReply(testKey, "ABCD")).toThrow(/reset code/);
  });
});

// Pinned in src-tauri/src/activation.rs too: the app must accept what this tool makes.
const PINNED =
  "CXHF2-7SJOZ-UMLKI-KLEVT-DQCO2-U4MOE-B6IER-JH4ZH-ZPF4U-MZTJ2-C2FUR-MVXQC-FOTXG-DQQ6Q-NODZL-CAMQD-FHHXN-73YRY-SQZIG-SKYLW-KCY";

const PINNED_RESET =
  "HSQEY-VL4US-TQ3EI-NQ557-ZMGTQ-RQP6R-J2Z3M-R7RVB-YEAUY-TJB2S-RFQM5-ZUH7X-GARXS-XQ4IT-ERZTF-VFCB7-D2RWV-4EIVS-KXZKS-QWZH2-6DQ";

function base32Decode(s: string): number[] {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const c of s) {
    value = (value << 5) | alphabet.indexOf(c);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return out;
}
