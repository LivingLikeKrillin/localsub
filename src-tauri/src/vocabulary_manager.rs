use std::fs;
use crate::error::AppError;
use crate::state::Vocabulary;
use crate::utils::{app_data_dir, atomic_write};

fn vocabularies_dir() -> Result<std::path::PathBuf, AppError> {
    let dir = app_data_dir()?.join("vocabularies");
    fs::create_dir_all(&dir)
        .map_err(|e| AppError::Config(format!("Failed to create vocabularies dir: {}", e)))?;
    Ok(dir)
}

fn vocab_path(id: &str) -> Result<std::path::PathBuf, AppError> {
    Ok(vocabularies_dir()?.join(format!("{}.json", id)))
}

pub fn load_vocabularies() -> Result<Vec<Vocabulary>, AppError> {
    let dir = vocabularies_dir()?;
    let mut vocabs = Vec::new();

    let entries = fs::read_dir(&dir)
        .map_err(|e| AppError::Config(format!("Failed to read vocabularies dir: {}", e)))?;

    for entry in entries {
        let entry = entry
            .map_err(|e| AppError::Config(format!("Failed to read dir entry: {}", e)))?;
        let path = entry.path();
        if path.extension().map_or(false, |ext| ext == "json") {
            let data = fs::read_to_string(&path)
                .map_err(|e| AppError::Config(format!("Failed to read vocabulary file: {}", e)))?;
            match serde_json::from_str::<Vocabulary>(&data) {
                Ok(vocab) => vocabs.push(vocab),
                Err(e) => {
                    log::warn!("Skipping malformed vocabulary {:?}: {}", path, e);
                }
            }
        }
    }

    vocabs.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(vocabs)
}

pub fn save_vocabulary(vocab: &Vocabulary) -> Result<(), AppError> {
    let path = vocab_path(&vocab.id)?;
    atomic_write(&path, vocab)
}

pub fn add_vocabulary(vocab: Vocabulary) -> Result<Vec<Vocabulary>, AppError> {
    save_vocabulary(&vocab)?;
    load_vocabularies()
}

pub fn update_vocabulary(updated: Vocabulary) -> Result<Vec<Vocabulary>, AppError> {
    let path = vocab_path(&updated.id)?;
    if !path.exists() {
        return Err(AppError::Config(format!("Vocabulary not found: {}", updated.id)));
    }
    save_vocabulary(&updated)?;
    load_vocabularies()
}

pub fn remove_vocabulary(id: &str) -> Result<Vec<Vocabulary>, AppError> {
    let path = vocab_path(id)?;
    if !path.exists() {
        return Err(AppError::Config(format!("Vocabulary not found: {}", id)));
    }
    fs::remove_file(&path)
        .map_err(|e| AppError::Config(format!("Failed to delete vocabulary: {}", e)))?;
    load_vocabularies()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_vocabulary() -> Vocabulary {
        Vocabulary {
            id: "test-vocab-1".to_string(),
            name: "Test Vocab".to_string(),
            description: "A test vocabulary".to_string(),
            source_lang: "en".to_string(),
            target_lang: "ko".to_string(),
            entries: vec![],
            created_at: "2026-01-01T00:00:00Z".to_string(),
            updated_at: "2026-01-01T00:00:00Z".to_string(),
        }
    }

    #[test]
    fn test_vocabulary_serialization_roundtrip() {
        let vocab = test_vocabulary();
        let json = serde_json::to_string(&vocab).unwrap();
        let restored: Vocabulary = serde_json::from_str(&json).unwrap();
        assert_eq!(restored.id, "test-vocab-1");
        assert_eq!(restored.name, "Test Vocab");
        assert!(restored.entries.is_empty());
    }
}
