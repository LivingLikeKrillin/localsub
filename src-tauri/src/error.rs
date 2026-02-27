use serde::Serialize;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("Python server error: {0}")]
    PythonServer(String),

    #[error("HTTP error: {0}")]
    Http(#[from] reqwest::Error),

    #[error("Job not found: {0}")]
    JobNotFound(String),

    #[error("Invalid state: {0}")]
    InvalidState(String),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Setup error: {0}")]
    Setup(String),

    #[error("Config error: {0}")]
    Config(String),

    #[error("Hardware detection error: {0}")]
    Hardware(String),

    #[error("Download error: {0}")]
    Download(String),
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}
