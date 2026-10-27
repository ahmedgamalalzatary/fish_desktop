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

/// Whether this PC may use the app; see `crate::activation`.
pub struct Activation {
    pub device_code: String,
    dir: PathBuf,
    active: AtomicBool,
}

impl Activation {
    pub fn new(dir: PathBuf, device_code: String, active: bool) -> Self {
        Self {
            device_code,
            dir,
            active: AtomicBool::new(active),
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
}
