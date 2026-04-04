use std::fs;
use crate::error::AppError;
use crate::state::FewShotSet;
use crate::utils::{app_data_dir, atomic_write};

fn fewshot_dir() -> Result<std::path::PathBuf, AppError> {
    let dir = app_data_dir()?.join("fewshot_sets");
    fs::create_dir_all(&dir)
        .map_err(|e| AppError::Config(format!("Failed to create fewshot_sets dir: {}", e)))?;
    Ok(dir)
}

fn fewshot_path(id: &str) -> Result<std::path::PathBuf, AppError> {
    Ok(fewshot_dir()?.join(format!("{}.json", id)))
}

pub fn load_fewshot_sets() -> Result<Vec<FewShotSet>, AppError> {
    let dir = fewshot_dir()?;
    let mut sets = Vec::new();

    let entries = fs::read_dir(&dir)
        .map_err(|e| AppError::Config(format!("Failed to read fewshot_sets dir: {}", e)))?;

    for entry in entries {
        let entry = entry
            .map_err(|e| AppError::Config(format!("Failed to read dir entry: {}", e)))?;
        let path = entry.path();
        if path.extension().map_or(false, |ext| ext == "json") {
            let data = fs::read_to_string(&path)
                .map_err(|e| AppError::Config(format!("Failed to read fewshot file: {}", e)))?;
            match serde_json::from_str::<FewShotSet>(&data) {
                Ok(set) => sets.push(set),
                Err(e) => {
                    log::warn!("Skipping malformed fewshot set {:?}: {}", path, e);
                }
            }
        }
    }

    sets.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(sets)
}

pub fn load_fewshot_set(id: &str) -> Result<FewShotSet, AppError> {
    let path = fewshot_path(id)?;
    if !path.exists() {
        return Err(AppError::Config(format!("FewShot set not found: {}", id)));
    }
    let data = fs::read_to_string(&path)
        .map_err(|e| AppError::Config(format!("Failed to read fewshot file: {}", e)))?;
    serde_json::from_str(&data)
        .map_err(|e| AppError::Config(format!("Failed to parse fewshot set: {}", e)))
}

fn save_fewshot_set(set: &FewShotSet) -> Result<(), AppError> {
    let path = fewshot_path(&set.id)?;
    atomic_write(&path, set)
}

pub fn add_fewshot_set(set: FewShotSet) -> Result<Vec<FewShotSet>, AppError> {
    save_fewshot_set(&set)?;
    load_fewshot_sets()
}

pub fn update_fewshot_set(updated: FewShotSet) -> Result<Vec<FewShotSet>, AppError> {
    let path = fewshot_path(&updated.id)?;
    if !path.exists() {
        return Err(AppError::Config(format!("FewShot set not found: {}", updated.id)));
    }
    save_fewshot_set(&updated)?;
    load_fewshot_sets()
}

pub fn remove_fewshot_set(id: &str) -> Result<Vec<FewShotSet>, AppError> {
    let path = fewshot_path(id)?;
    if !path.exists() {
        return Err(AppError::Config(format!("FewShot set not found: {}", id)));
    }
    fs::remove_file(&path)
        .map_err(|e| AppError::Config(format!("Failed to delete fewshot set: {}", e)))?;
    load_fewshot_sets()
}
