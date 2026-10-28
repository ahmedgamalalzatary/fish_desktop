use crate::error::{AppError, AppResult};
use rusqlite::Connection;
use serde::Serialize;
use std::path::PathBuf;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};

#[derive(Debug, Clone, Serialize)]
pub struct SessionUser {
    pub id: i64,
    pub name: String,
    pub username: String,
    pub role: String,
}

impl SessionUser {
    pub fn is_admin(&self) -> bool {
        self.role == "admin"
    }
}

/// Whether this PC may use the app, and a forgotten admin password's reset; see `crate::activation`.
pub struct Activation {
    pub device_code: String,
    dir: PathBuf,
    active: AtomicBool,
    /// The owner's reset reply was accepted, so one admin password may be set without signing in.
    reset_allowed: AtomicBool,
}

impl Activation {
    pub fn new(dir: PathBuf, device_code: String, active: bool) -> Self {
        Self {
            device_code,
            dir,
            active: AtomicBool::new(active),
            reset_allowed: AtomicBool::new(false),
        }
    }

    pub fn is_active(&self) -> bool {
        self.active.load(Ordering::Relaxed)
    }

    pub fn require(&self) -> AppResult<()> {
        if self.is_active() {
            Ok(())
        } else {
            Err(AppError::Invalid("البرنامج غير مفعّل على هذا الجهاز".into()))
        }
    }

    /// Checks the code against this PC and keeps it, so the PC stays activated.
    pub fn activate(&self, code: &str) -> AppResult<()> {
        if !crate::activation::verify(&self.device_code, code) {
            return Err(AppError::Invalid(
                "كود التفعيل غير صحيح لهذا الجهاز. تأكد أنك نسخته كاملاً.".into(),
            ));
        }
        crate::activation::save(&self.dir, code).map_err(|e| AppError::Other(e.to_string()))?;
        self.active.store(true, Ordering::Relaxed);
        Ok(())
    }

    /// The code this PC shows for a forgotten admin password.
    pub fn reset_code(&self) -> AppResult<String> {
        self.require()?;
        crate::activation::reset_code(&self.dir, &self.device_code)
            .map_err(|e| AppError::Other(e.to_string()))
    }

    /// Checks the owner's reply to the reset code; once it passes, `finish_reset` may set a password.
    pub fn allow_reset(&self, reply: &str) -> AppResult<()> {
        self.require()?;
        if !crate::activation::verify_reset(&self.dir, &self.device_code, reply) {
            return Err(AppError::Invalid(
                "كود الاستعادة غير صحيح لهذا الطلب. تأكد أنك نسخته كاملاً.".into(),
            ));
        }
        self.reset_allowed.store(true, Ordering::Relaxed);
        Ok(())
    }

    /// Runs `set_password` if a reply was accepted, then ends the reset so the reply never works again.
    pub fn finish_reset<T>(&self, set_password: impl FnOnce() -> AppResult<T>) -> AppResult<T> {
        if !self.reset_allowed.load(Ordering::Relaxed) {
            return Err(AppError::Forbidden);
        }
        let done = set_password()?;
        self.reset_allowed.store(false, Ordering::Relaxed);
        crate::activation::reset_done(&self.dir).map_err(|e| AppError::Other(e.to_string()))?;
        Ok(done)
    }
}

pub struct AppState {
    pub db: Mutex<Connection>,
    pub session: Mutex<Option<SessionUser>>,
    pub activation: Activation,
}

impl AppState {
    pub fn new(conn: Connection, activation: Activation) -> Self {
        Self {
            db: Mutex::new(conn),
            session: Mutex::new(None),
            activation,
        }
    }

    pub fn user(&self) -> AppResult<SessionUser> {
        self.session
            .lock()
            .unwrap()
            .clone()
            .ok_or(AppError::Unauthorized)
    }

    pub fn admin(&self) -> AppResult<SessionUser> {
        let user = self.user()?;
        if user.is_admin() {
            Ok(user)
        } else {
            Err(AppError::Forbidden)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn inactive() -> Activation {
        let dir = std::env::temp_dir().join(format!("pos-state-activation-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        Activation::new(dir, "ABCD-EFGH-JKLM-NPQR".into(), false)
    }

    #[test]
    fn a_pc_that_is_not_activated_refuses_to_be_used() {
        assert!(inactive().require().is_err());
        assert!(
            Activation::new(std::env::temp_dir(), "X".into(), true)
                .require()
                .is_ok()
        );
    }

    #[test]
    fn a_wrong_code_does_not_activate_the_pc() {
        let activation = inactive();
        assert!(activation.activate("AAAAA-BBBBB").is_err());
        assert!(activation.require().is_err());
    }

    #[test]
    fn a_password_is_reset_only_after_a_good_reply_and_only_once() {
        let dir = std::env::temp_dir().join(format!("pos-state-reset-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let activation = Activation::new(dir.clone(), "ABCD-EFGH-JKLM-NPQR".into(), true);
        assert!(activation.finish_reset(|| Ok(())).is_err(), "no reply yet");
        activation.reset_code().unwrap();
        assert!(activation.allow_reset("AAAAA-BBBBB").is_err());
        assert!(
            activation.finish_reset(|| Ok(())).is_err(),
            "a wrong reply allows nothing"
        );
        assert!(
            inactive().reset_code().is_err(),
            "the PC must be activated first"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }
}
