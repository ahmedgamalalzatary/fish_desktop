//! One activation per PC. The app shows a device code made from the PC's Windows id and the shop's
//! identifier; the owner signs it (`npm run activation-code <device code>`) and the signature is the
//! activation code. The app holds only the public key, so it can check codes but never make them,
//! and a code is good on that one PC for that one shop, forever.
//!
//! A forgotten admin password works the same way: the app shows a reset code (this PC's device code
//! and a random value kept until the reset is done), the owner signs `reset:<reset code>`
//! (`npm run reset-code <reset code>`), and the app lets that reply set a new admin password once.

use ed25519_dalek::{Signature, VerifyingKey};
use rand_core::RngCore;
use sha2::{Digest, Sha256};
use std::path::Path;

/// The public half of %USERPROFILE%\.tauri\pos-activation.key (`npm run activation-code --public-key`).
pub const PUBLIC_KEY: [u8; 32] = [
    66, 24, 66, 160, 130, 253, 197, 33, 224, 254, 64, 37, 167, 84, 101, 229, 220, 170, 62, 12, 251,
    171, 162, 239, 159, 246, 133, 101, 68, 137, 6, 208,
];

const FILE: &str = "activation.txt";
const RESET_FILE: &str = "reset.txt";
const ALPHABET: &[u8; 32] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/// This PC's code for the shop with `identifier`: 16 base32 letters in groups of four.
pub fn device_code(identifier: &str, machine_id: &str) -> String {
    short_code(&format!("{identifier}:{machine_id}"))
}

/// 16 base32 letters in groups of four, from the start of the text's SHA-256.
fn short_code(text: &str) -> String {
    let hash = Sha256::digest(text);
    // 10 bytes are exactly 16 letters of 5 bits.
    let letters = base32(&hash[..10]);
    letters
        .as_bytes()
        .chunks(4)
        .map(|c| std::str::from_utf8(c).unwrap())
        .collect::<Vec<_>>()
        .join("-")
}

/// The device code of the PC this runs on.
pub fn this_device(identifier: &str) -> String {
    device_code(identifier, &machine_uid::get().unwrap_or_default())
}

/// Whether `code` is the owner's signature of `device_code`.
pub fn verify(device_code: &str, code: &str) -> bool {
    verify_with(&PUBLIC_KEY, device_code, code)
}

fn verify_with(public_key: &[u8; 32], device_code: &str, code: &str) -> bool {
    let Some(bytes) = base32_decode(code) else {
        return false;
    };
    let (Ok(key), Ok(signature)) = (
        VerifyingKey::from_bytes(public_key),
        Signature::from_slice(&bytes),
    ) else {
        return false;
    };
    key.verify_strict(device_code.as_bytes(), &signature)
        .is_ok()
}

/// Whether this PC was activated: its saved code is good for its device code.
pub fn saved(dir: &Path, device_code: &str) -> bool {
    saved_with(&PUBLIC_KEY, dir, device_code)
}

fn saved_with(public_key: &[u8; 32], dir: &Path, device_code: &str) -> bool {
    std::fs::read_to_string(dir.join(FILE))
        .is_ok_and(|code| verify_with(public_key, device_code, &code))
}

pub fn save(dir: &Path, code: &str) -> std::io::Result<()> {
    std::fs::write(dir.join(FILE), code.trim())
}

/// The reset code this PC shows for a forgotten admin password. It stays the same until the reset is
/// done (so the app may be closed while waiting for the reply), then the next one is new.
pub fn reset_code(dir: &Path, device_code: &str) -> std::io::Result<String> {
    let path = dir.join(RESET_FILE);
    let nonce = match std::fs::read_to_string(&path) {
        Ok(saved) if !saved.trim().is_empty() => saved.trim().to_string(),
        _ => {
            let mut bytes = [0u8; 16];
            rand_core::OsRng.fill_bytes(&mut bytes);
            let fresh = base32(&bytes);
            std::fs::write(&path, &fresh)?;
            fresh
        }
    };
    Ok(short_code(&format!("reset:{device_code}:{nonce}")))
}

/// Whether `reply` is the owner's signature of this PC's current reset code.
pub fn verify_reset(dir: &Path, device_code: &str, reply: &str) -> bool {
    verify_reset_with(&PUBLIC_KEY, dir, device_code, reply)
}

fn verify_reset_with(public_key: &[u8; 32], dir: &Path, device_code: &str, reply: &str) -> bool {
    // Never make a new reset code here: a reply can only match one the PC already showed.
    if !dir.join(RESET_FILE).exists() {
        return false;
    }
    reset_code(dir, device_code)
        .is_ok_and(|code| verify_with(public_key, &format!("reset:{code}"), reply))
}

/// Ends the reset, so its reply never works again and the next reset code is new.
pub fn reset_done(dir: &Path) -> std::io::Result<()> {
    match std::fs::remove_file(dir.join(RESET_FILE)) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e),
        _ => Ok(()),
    }
}

fn base32(bytes: &[u8]) -> String {
    let (mut bits, mut value, mut out) = (0u32, 0u32, String::new());
    for &b in bytes {
        value = (value << 8) | u32::from(b);
        bits += 8;
        while bits >= 5 {
            out.push(ALPHABET[((value >> (bits - 5)) & 31) as usize] as char);
            bits -= 5;
        }
    }
    if bits > 0 {
        out.push(ALPHABET[((value << (5 - bits)) & 31) as usize] as char);
    }
    out
}

/// Reads base32 typed or pasted in any case, with spaces or dashes; None for anything else.
fn base32_decode(input: &str) -> Option<Vec<u8>> {
    let (mut bits, mut value, mut out) = (0u32, 0u32, Vec::new());
    for c in input.chars().filter(|c| !c.is_whitespace() && *c != '-') {
        let digit = ALPHABET
            .iter()
            .position(|&a| a as char == c.to_ascii_uppercase())?;
        value = ((value << 5) | digit as u32) & 0xFFFF;
        bits += 5;
        if bits >= 8 {
            out.push((value >> (bits - 8)) as u8);
            bits -= 8;
        }
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::SigningKey;

    /// Same test key as `testKey` in tests/activation.test.ts: a seed of 32 bytes of 1.
    fn test_public_key() -> [u8; 32] {
        SigningKey::from_bytes(&[1; 32]).verifying_key().to_bytes()
    }

    /// Made by the owner's tool from the test key for ABCD-EFGH-JKLM-NPQR (pinned there too).
    /// The tool's reply (`resetReply`) for reset code ABCD-EFGH-JKLM-NPQR, pinned there too.
    const PINNED_RESET: &str = "HSQEY-VL4US-TQ3EI-NQ557-ZMGTQ-RQP6R-J2Z3M-R7RVB-YEAUY-TJB2S-RFQM5-ZUH7X-GARXS-XQ4IT-ERZTF-VFCB7-D2RWV-4EIVS-KXZKS-QWZH2-6DQ";

    const PINNED: &str = "CXHF2-7SJOZ-UMLKI-KLEVT-DQCO2-U4MOE-B6IER-JH4ZH-ZPF4U-MZTJ2-C2FUR-MVXQC-FOTXG-DQQ6Q-NODZL-CAMQD-FHHXN-73YRY-SQZIG-SKYLW-KCY";

    #[test]
    fn a_device_code_is_four_groups_of_code_letters_that_name_the_pc_and_the_shop() {
        let code = device_code("com.fishshop.pos", "machine-1");
        assert!(
            code.len() == 19
                && code.split('-').all(|g| g.len() == 4
                    && g.chars()
                        .all(|c| c.is_ascii_uppercase() || ('2'..='7').contains(&c))),
            "{code}"
        );
        assert_eq!(code, device_code("com.fishshop.pos", "machine-1"));
        assert_ne!(code, device_code("com.fishshop.pos", "machine-2"));
        assert_ne!(code, device_code("com.mobileshop.pos", "machine-1"));
    }

    #[test]
    fn accepts_the_tool_s_code_for_its_device_however_it_was_pasted() {
        let key = test_public_key();
        assert!(verify_with(&key, "ABCD-EFGH-JKLM-NPQR", PINNED));
        assert!(verify_with(
            &key,
            "ABCD-EFGH-JKLM-NPQR",
            &PINNED.to_lowercase()
        ));
        assert!(verify_with(
            &key,
            "ABCD-EFGH-JKLM-NPQR",
            &format!(" {} ", PINNED.replace('-', " "))
        ));
    }

    #[test]
    fn refuses_a_code_for_another_device_or_from_another_key_or_garbage() {
        let key = test_public_key();
        assert!(!verify_with(&key, "ABCD-EFGH-JKLM-NPQS", PINNED));
        assert!(!verify_with(&PUBLIC_KEY, "ABCD-EFGH-JKLM-NPQR", PINNED));
        assert!(!verify_with(&key, "ABCD-EFGH-JKLM-NPQR", "AAAA-BBBB"));
        assert!(!verify_with(&key, "ABCD-EFGH-JKLM-NPQR", ""));
    }

    #[test]
    fn an_activation_saved_on_this_pc_is_kept_and_checked_each_start() {
        let dir = std::env::temp_dir().join(format!("pos-activation-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let key = test_public_key();
        assert!(!saved_with(&key, &dir, "ABCD-EFGH-JKLM-NPQR"));
        save(&dir, PINNED).unwrap();
        assert!(saved_with(&key, &dir, "ABCD-EFGH-JKLM-NPQR"));
        assert!(
            !saved_with(&key, &dir, "WXYZ-EFGH-JKLM-NPQR"),
            "copied to another PC"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    fn temp_dir(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("pos-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// What the owner's tool replies to `reset_code`, made here with the test key.
    fn reply_to(reset_code: &str) -> String {
        use ed25519_dalek::Signer;
        let signature =
            SigningKey::from_bytes(&[1; 32]).sign(format!("reset:{reset_code}").as_bytes());
        base32(&signature.to_bytes())
    }

    #[test]
    fn the_app_accepts_the_tool_s_reset_reply_and_not_an_activation_code() {
        let key = test_public_key();
        assert!(verify_with(&key, "reset:ABCD-EFGH-JKLM-NPQR", PINNED_RESET));
        assert!(!verify_with(&key, "ABCD-EFGH-JKLM-NPQR", PINNED_RESET));
        assert!(!verify_with(&key, "reset:ABCD-EFGH-JKLM-NPQR", PINNED));
    }

    #[test]
    fn a_reset_code_stays_until_used_and_its_reply_works_once_on_this_pc() {
        let dir = temp_dir("reset");
        let key = test_public_key();
        assert!(
            !verify_reset_with(&key, &dir, "ABCD-EFGH-JKLM-NPQR", "AAAA"),
            "no code shown yet"
        );

        let code = reset_code(&dir, "ABCD-EFGH-JKLM-NPQR").unwrap();
        assert_eq!(code.len(), 19);
        assert_eq!(
            code,
            reset_code(&dir, "ABCD-EFGH-JKLM-NPQR").unwrap(),
            "kept across restarts"
        );
        assert_ne!(code, "ABCD-EFGH-JKLM-NPQR");
        assert_ne!(
            code,
            reset_code(&dir, "WXYZ-EFGH-JKLM-NPQR").unwrap(),
            "another PC"
        );

        let reply = reply_to(&code);
        assert!(
            !verify_reset_with(&key, &dir, "WXYZ-EFGH-JKLM-NPQR", &reply),
            "copied to another PC"
        );
        assert!(
            !verify_reset_with(&PUBLIC_KEY, &dir, "ABCD-EFGH-JKLM-NPQR", &reply),
            "another key"
        );
        assert!(verify_reset_with(&key, &dir, "ABCD-EFGH-JKLM-NPQR", &reply));

        reset_done(&dir).unwrap();
        assert!(
            !verify_reset_with(&key, &dir, "ABCD-EFGH-JKLM-NPQR", &reply),
            "used already"
        );
        assert_ne!(
            code,
            reset_code(&dir, "ABCD-EFGH-JKLM-NPQR").unwrap(),
            "the next code is new"
        );
        reset_done(&dir).unwrap();
        reset_done(&dir).unwrap();
        let _ = std::fs::remove_dir_all(&dir);
    }
}
