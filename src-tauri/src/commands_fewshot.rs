use crate::state::FewShotSet;
use crate::fewshot_manager;
use crate::error::AppError;

#[tauri::command]
pub fn get_fewshot_sets() -> Result<Vec<FewShotSet>, AppError> {
    fewshot_manager::load_fewshot_sets()
}

#[tauri::command]
pub fn add_fewshot_set(set: FewShotSet) -> Result<Vec<FewShotSet>, AppError> {
    fewshot_manager::add_fewshot_set(set)
}

#[tauri::command]
pub fn update_fewshot_set(set: FewShotSet) -> Result<Vec<FewShotSet>, AppError> {
    fewshot_manager::update_fewshot_set(set)
}

#[tauri::command]
pub fn remove_fewshot_set(id: String) -> Result<Vec<FewShotSet>, AppError> {
    fewshot_manager::remove_fewshot_set(&id)
}
