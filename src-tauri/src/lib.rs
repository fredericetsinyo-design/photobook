// PhotoBook — application de bureau.
// L'interface et le moteur de composition sont les mêmes que la version Web ;
// Tauri ajoute l'accès natif aux dossiers (import d'un dossier entier, export direct sur le disque).

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .run(tauri::generate_context!())
        .expect("Erreur au démarrage de PhotoBook");
}
