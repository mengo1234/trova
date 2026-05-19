use base64::Engine;
use image::{DynamicImage, Pixel};
use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use reqwest::{blocking::Client, StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    env,
    fs,
    io::Read,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{Mutex, OnceLock},
    time::{Duration, UNIX_EPOCH},
};
use tauri::Manager;
use walkdir::WalkDir;
use zip::ZipArchive;

const MAX_TEXT_BYTES: usize = 700_000;
const MAX_RESULTS: usize = 250;
const MAX_INDEX_FILE_BYTES: u64 = 100 * 1024 * 1024;
const MAX_PDF_VISUAL_PAGES: u32 = 12;
const TYPESENSE_COLLECTION: &str = "trova_files";

static WATCHER_STATE: OnceLock<Mutex<LiveWatcher>> = OnceLock::new();
static LOCAL_API_CHILD: OnceLock<Mutex<Option<Child>>> = OnceLock::new();

#[derive(Default)]
struct LiveWatcher {
    watcher: Option<RecommendedWatcher>,
    paths: Vec<WatchPath>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LocalApiBootStatus {
    ok: bool,
    already_running: bool,
    port: u16,
    pid: Option<u32>,
    command: String,
    script_path: String,
    data_dir: String,
    message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct IndexedFile {
    id: String,
    name: String,
    path: String,
    kind: String,
    extension: String,
    size: u64,
    modified: Option<i64>,
    snippet: String,
    page_hint: Option<u32>,
    score: i32,
    source: Option<String>,
    visual_preview: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ScanSummary {
    indexed: usize,
    skipped: usize,
    results: Vec<IndexedFile>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FileTypeFilter {
    mode: String,
    extensions: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WatchPath {
    id: String,
    path: String,
    enabled: bool,
    recursive: bool,
    is_excluded: bool,
    file_type_filter: Option<FileTypeFilter>,
    gemini_enabled: bool,
    auto_index: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct IndexStatus {
    running: bool,
    phase: String,
    files_discovered: usize,
    files_indexed: usize,
    files_skipped: usize,
    progress: u8,
    watcher_active: bool,
    index_size_bytes: u64,
    tika_available: bool,
    typesense_available: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SearchRequest {
    text_query: Option<String>,
    image_query: Option<Vec<f32>>,
    image_queries: Option<Vec<Vec<f32>>>,
    mode: String,
    filters: Vec<String>,
    use_local: bool,
    use_gemini: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct VisualAsset {
    file_path: String,
    page_number: Option<u32>,
    asset_kind: String,
    thumbnail_path: Option<String>,
    #[serde(default)]
    embedding: Vec<f32>,
    embedding_model: Option<String>,
    #[serde(default)]
    visual_embeddings: Vec<VisualEmbedding>,
    face_embedding: Option<Vec<f32>>,
    face_embedding_model: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct VisualEmbedding {
    model: String,
    vector: Vec<f32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LocalVisionAsset {
    asset_id: String,
    file_path: String,
    image_path: String,
    asset_kind: String,
    page_number: Option<u32>,
    embedding_model: Option<String>,
    embedding_models: Vec<String>,
    face_embedding_model: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct KeyDiscovery {
    gemini_found: bool,
    gemini_key: Option<String>,
    gemini_source: Option<String>,
    nvidia_found: bool,
    nvidia_source: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NvidiaRerankRequest {
    query: String,
    results: Vec<NvidiaRerankItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NvidiaRerankItem {
    id: String,
    name: String,
    kind: String,
    snippet: String,
    score: i32,
    visual_preview: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NvidiaRerankResponse {
    ordered_ids: Vec<String>,
    model: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GeminiCandidate {
    path: String,
    name: String,
    mime_type: String,
    size: u64,
    modified: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LocalVisionStatus {
    total_assets: usize,
    embedded_assets: usize,
    face_embedded_assets: usize,
    model: String,
    models: Vec<LocalVisionModelStatus>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LocalVisionModelStatus {
    model: String,
    label: String,
    embedded_assets: usize,
    total_assets: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FilePreviewPayload {
    data_url: String,
    mime_type: String,
    size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct IndexEntry {
    file_path: String,
    name: String,
    kind: String,
    extension: String,
    size: u64,
    modified: Option<i64>,
    created: Option<i64>,
    file_hash: String,
    content: String,
    title: Option<String>,
    author: Option<String>,
    language: Option<String>,
    chunks: Vec<String>,
    visual_assets: Vec<VisualAsset>,
    source_watch_path: String,
    gemini_enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct AppState {
    watch_paths: Vec<WatchPath>,
    index: Vec<IndexEntry>,
    #[serde(default)]
    default_paths_upgraded: bool,
}

#[tauri::command]
fn get_default_watch_paths() -> Result<Vec<WatchPath>, String> {
    Ok(default_watch_paths())
}

#[tauri::command]
fn load_watch_paths() -> Result<Vec<WatchPath>, String> {
    let mut state = load_state();
    if state.watch_paths.is_empty() {
        Ok(default_watch_paths())
    } else {
        if upgrade_default_watch_paths(&mut state) {
            save_state(&state)?;
        }
        Ok(state.watch_paths)
    }
}

#[tauri::command]
fn save_watch_paths(paths: Vec<WatchPath>) -> Result<Vec<WatchPath>, String> {
    let mut state = load_state();
    state.watch_paths = normalize_watch_paths(paths);
    save_state(&state)?;
    Ok(state.watch_paths)
}

#[tauri::command]
fn pick_folder() -> Result<Option<String>, String> {
    let mut dialog = rfd::FileDialog::new().set_title("Scegli cartella per Trova");
    if let Some(home) = dirs::home_dir() {
        dialog = dialog.set_directory(home);
    }
    Ok(dialog.pick_folder().map(|path| path.display().to_string()))
}

#[tauri::command]
fn ensure_local_api(app: tauri::AppHandle) -> Result<LocalApiBootStatus, String> {
    let port = env::var("TROVA_LOCAL_API_PORT")
        .ok()
        .and_then(|value| value.parse::<u16>().ok())
        .unwrap_or(17654);

    if local_api_is_alive(port) {
        return Ok(LocalApiBootStatus {
            ok: true,
            already_running: true,
            port,
            pid: None,
            command: "already-running".into(),
            script_path: String::new(),
            data_dir: data_dir().display().to_string(),
            message: format!("API locale gia pronta su 127.0.0.1:{port}"),
        });
    }

    // Cerca prima il sidecar bundled (trova-backend-<triple>[.exe]) — zero dipendenze sul PC dell'utente.
    let sidecar = locate_local_api_sidecar(&app);
    let (command_path, command_args, root_dir) = if let Some(binary) = sidecar.clone() {
        let parent = binary
            .parent()
            .map(Path::to_path_buf)
            .unwrap_or_else(|| PathBuf::from("."));
        (binary, Vec::<PathBuf>::new(), parent)
    } else {
        // Fallback in dev / per chi ha Node installato: esegue lo script .mjs.
        let script_path = locate_local_api_script(&app)?;
        let root = script_path
            .parent()
            .and_then(Path::parent)
            .unwrap_or_else(|| Path::new("."))
            .to_path_buf();
        let node = env::var("TROVA_NODE_PATH").unwrap_or_else(|_| "node".into());
        (PathBuf::from(node), vec![script_path], root)
    };

    let data_path = data_dir();
    fs::create_dir_all(&data_path).map_err(|e| e.to_string())?;

    let mut cmd = Command::new(&command_path);
    for arg in &command_args {
        cmd.arg(arg);
    }
    let mut child = cmd
        .current_dir(&root_dir)
        .env("TROVA_ROOT", &root_dir)
        .env("TROVA_DATA_DIR", &data_path)
        .env("TROVA_LOCAL_API_PORT", port.to_string())
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("Impossibile avviare backend Trova: {e}"))?;

    let pid = Some(child.id());
    let command_label = command_path.display().to_string();
    let script_label = command_args
        .first()
        .map(|p| p.display().to_string())
        .unwrap_or_else(|| command_path.display().to_string());
    for _ in 0..30 {
        if local_api_is_alive(port) {
            let slot = LOCAL_API_CHILD.get_or_init(|| Mutex::new(None));
            *slot.lock().map_err(|e| e.to_string())? = Some(child);
            return Ok(LocalApiBootStatus {
                ok: true,
                already_running: false,
                port,
                pid,
                command: command_label,
                script_path: script_label,
                data_dir: data_path.display().to_string(),
                message: format!("API locale avviata su 127.0.0.1:{port}"),
            });
        }
        std::thread::sleep(Duration::from_millis(150));
    }

    let exit_status = child.try_wait().map_err(|e| e.to_string())?;
    let detail = exit_status
        .map(|status| format!(" processo terminato: {status}"))
        .unwrap_or_else(|| " processo ancora in avvio ma non raggiungibile".into());
    Err(format!("API locale non raggiungibile dopo l'avvio:{detail}"))
}

#[tauri::command]
fn start_indexing(paths: Vec<WatchPath>) -> Result<IndexStatus, String> {
    let normalized = normalize_watch_paths(paths);
    let mut state = load_state();
    state.watch_paths = normalized.clone();
    let mut discovered = 0usize;
    let mut indexed = 0usize;
    let mut skipped = 0usize;
    let mut entries = Vec::new();

    let typesense_ready = reset_typesense_collection().is_ok();

    for watch_path in normalized.iter().filter(|p| p.enabled && !p.is_excluded) {
        let root = PathBuf::from(&watch_path.path);
        if !root.exists() {
            skipped += 1;
            continue;
        }

        let mut walker = WalkDir::new(&root).follow_links(false);
        if !watch_path.recursive {
            walker = walker.max_depth(1);
        }

        for entry in walker.into_iter().filter_map(Result::ok) {
            let path = entry.path();
            if !entry.file_type().is_file() {
                continue;
            }

            discovered += 1;
            if should_skip_file(path, &normalized, Some(watch_path)) {
                skipped += 1;
                continue;
            }

            match index_file(path, watch_path) {
                Ok(Some(index_entry)) => {
                    if typesense_ready {
                        let _ = upsert_typesense_entry(&index_entry);
                    }
                    entries.push(index_entry);
                    indexed += 1;
                }
                Ok(None) => skipped += 1,
                Err(_) => skipped += 1,
            }
        }
    }

    state.index = entries;
    save_state(&state)?;
    Ok(status_from_counts(discovered, indexed, skipped, false))
}

#[tauri::command]
fn start_watcher(paths: Vec<WatchPath>) -> Result<IndexStatus, String> {
    let normalized = normalize_watch_paths(paths);
    save_watch_paths(normalized.clone())?;

    let watched_paths: Vec<WatchPath> = normalized
        .iter()
        .filter(|path| path.enabled && !path.is_excluded && path.auto_index)
        .cloned()
        .collect();

    if watched_paths.is_empty() {
        stop_watcher()?;
        return get_index_status();
    }

    let callback_paths = normalized.clone();
    let mut watcher = RecommendedWatcher::new(
        move |event| {
            if let Ok(event) = event {
                handle_fs_event(event, &callback_paths);
            }
        },
        Config::default(),
    )
    .map_err(|e| e.to_string())?;

    for watch_path in &watched_paths {
        let mode = if watch_path.recursive {
            RecursiveMode::Recursive
        } else {
            RecursiveMode::NonRecursive
        };
        watcher
            .watch(Path::new(&watch_path.path), mode)
            .map_err(|e| format!("{}: {}", watch_path.path, e))?;
    }

    let mut live = watcher_state().lock().map_err(|e| e.to_string())?;
    live.paths = normalized;
    live.watcher = Some(watcher);
    drop(live);
    get_index_status()
}

#[tauri::command]
fn stop_watcher() -> Result<IndexStatus, String> {
    let mut live = watcher_state().lock().map_err(|e| e.to_string())?;
    live.paths.clear();
    live.watcher = None;
    drop(live);
    get_index_status()
}

#[tauri::command]
fn get_index_status() -> Result<IndexStatus, String> {
    let state = load_state();
    let index_size_bytes = fs::metadata(index_path()).map(|m| m.len()).unwrap_or(0);
    Ok(IndexStatus {
        running: false,
        phase: "idle".into(),
        files_discovered: state.index.len(),
        files_indexed: state.index.len(),
        files_skipped: 0,
        progress: if state.index.is_empty() { 0 } else { 100 },
        watcher_active: watcher_is_active(),
        index_size_bytes,
        tika_available: service_ok("http://127.0.0.1:9998/tika"),
        typesense_available: service_ok(&format!("{}/health", typesense_base_url())),
    })
}

#[tauri::command]
fn search_index(request: SearchRequest) -> Result<Vec<IndexedFile>, String> {
    let state = load_state();
    let query = request
        .text_query
        .clone()
        .unwrap_or_default()
        .trim()
        .to_lowercase();
    let mut image_queries = request.image_queries.clone().unwrap_or_default();
    if let Some(query) = request.image_query.clone().filter(|query| !query.is_empty()) {
        image_queries.push(query);
    }
    let mut results = if request.use_local {
        search_typesense(&request)
    } else {
        Vec::new()
    };

    if !request.use_local {
        return Ok(results);
    }
    let visual_threshold = if request.mode == "text" && !query.is_empty() {
        0.24
    } else {
        0.35
    };

    for entry in state.index {
        if !matches_result_filter(&entry.kind, &request.filters) {
            continue;
        }

        let haystack = format!(
            "{} {} {} {} {}",
            entry.name,
            entry.file_path,
            entry.extension,
            entry.title.clone().unwrap_or_default(),
            entry.content
        )
        .to_lowercase();
        let text_score = score_match(&haystack, &query, &entry.name, &entry.content, &entry.kind);
        let mut score = text_score;
        let mut visual_score = 0.0_f32;

        if !image_queries.is_empty() {
            visual_score = entry
                .visual_assets
                .iter()
                .flat_map(|asset| {
                    image_queries.iter().map(move |image_query| {
                        visual_vectors(asset)
                            .map(|vector| visual_similarity(image_query, vector))
                            .fold(0.0_f32, f32::max)
                    })
                })
                .fold(0.0_f32, f32::max);
            if visual_score > visual_threshold {
                score += (visual_score * 140.0) as i32;
            }
            if request.mode == "person" && visual_score > 0.5 {
                score += 40;
            }
        }

        if query.is_empty() && image_queries.is_empty() {
            score = 1;
        }

        if score > 0 {
            results.push(IndexedFile {
                id: entry.file_path.clone(),
                name: entry.name.clone(),
                path: entry.file_path.clone(),
                kind: entry.kind.clone(),
                extension: entry.extension.clone(),
                size: entry.size,
                modified: entry.modified,
                snippet: if text_score == 0 && visual_score > visual_threshold && !query.is_empty() {
                    visual_match_snippet(&query, &entry.kind, visual_score)
                } else {
                    make_snippet(&entry.content, &query, &entry.kind)
                },
                page_hint: guess_page(&entry.content, &query),
                score,
                source: Some("local".into()),
                visual_preview: entry
                    .visual_assets
                    .first()
                    .and_then(|asset| asset.thumbnail_path.clone())
                    .or_else(|| (entry.kind == "image").then(|| entry.file_path.clone())),
            });
        }
    }

    results.sort_by(|a, b| b.score.cmp(&a.score).then_with(|| a.name.cmp(&b.name)));
    dedupe_results(&mut results);
    results.truncate(MAX_RESULTS);
    Ok(results)
}

#[tauri::command]
fn clear_index() -> Result<IndexStatus, String> {
    let mut state = load_state();
    state.index.clear();
    save_state(&state)?;
    let _ = delete_typesense_collection();
    get_index_status()
}

#[tauri::command]
fn visual_embedding_from_data_url(data_url: String) -> Result<Vec<f32>, String> {
    let (_, payload) = data_url
        .split_once(',')
        .ok_or_else(|| "Formato immagine non valido".to_string())?;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(payload)
        .map_err(|e| e.to_string())?;
    let image = image::load_from_memory(&bytes).map_err(|e| e.to_string())?;
    Ok(image_embedding(&image))
}

#[tauri::command]
fn list_visual_assets() -> Result<Vec<LocalVisionAsset>, String> {
    let state = load_state();
    let assets = state
        .index
        .into_iter()
        .flat_map(|entry| {
            entry.visual_assets.into_iter().filter_map(|asset| {
                let image_path = asset
                    .thumbnail_path
                    .clone()
                    .unwrap_or_else(|| asset.file_path.clone());
                Path::new(&image_path).exists().then(|| {
                    let asset_id = visual_asset_id(&asset);
                    let embedding_models = visual_embedding_models(&asset);
                    LocalVisionAsset {
                        asset_id,
                        file_path: asset.file_path,
                        image_path,
                        asset_kind: asset.asset_kind,
                        page_number: asset.page_number,
                        embedding_models,
                        embedding_model: asset.embedding_model,
                        face_embedding_model: asset.face_embedding_model,
                    }
                })
            })
        })
        .collect();
    Ok(assets)
}

#[tauri::command]
fn get_local_vision_status() -> Result<LocalVisionStatus, String> {
    let state = load_state();
    let mut total_assets = 0usize;
    let mut face_embedded_assets = 0usize;
    let models = local_vision_models();
    let mut model_counts = vec![0usize; models.len()];
    let mut fully_embedded_assets = 0usize;

    for asset in state.index.iter().flat_map(|entry| entry.visual_assets.iter()) {
        total_assets += 1;
        if asset.face_embedding_model.is_some() {
            face_embedded_assets += 1;
        }
        let asset_models = visual_embedding_models(asset);
        let mut has_all = true;
        for (index, model) in models.iter().enumerate() {
            if asset_models.iter().any(|candidate| candidate == &model.id) {
                model_counts[index] += 1;
            } else {
                has_all = false;
            }
        }
        if has_all && !models.is_empty() {
            fully_embedded_assets += 1;
        }
    }

    Ok(LocalVisionStatus {
        total_assets,
        embedded_assets: fully_embedded_assets,
        face_embedded_assets,
        model: local_vision_models_label(),
        models: models
            .iter()
            .enumerate()
            .map(|(index, model)| LocalVisionModelStatus {
                model: model.id.into(),
                label: model.label.into(),
                embedded_assets: model_counts[index],
                total_assets,
            })
            .collect(),
    })
}

#[tauri::command]
fn discover_api_keys() -> Result<KeyDiscovery, String> {
    let gemini_names = [
        "GEMINI_API_KEY",
        "GOOGLE_API_KEY",
        "GOOGLE_GENERATIVE_AI_API_KEY",
        "VITE_GEMINI_API_KEY",
        "NEXT_PUBLIC_GEMINI_API_KEY",
    ];
    let nvidia_names = ["NVIDIA_API_KEY", "NVIDIA_NIM_API_KEY", "NGC_API_KEY"];

    let gemini = discover_named_key(&gemini_names);
    let nvidia = discover_named_key(&nvidia_names);

    Ok(KeyDiscovery {
        gemini_found: gemini.is_some(),
        gemini_key: gemini.as_ref().map(|found| found.0.clone()),
        gemini_source: gemini.as_ref().map(|found| found.1.clone()),
        nvidia_found: nvidia.is_some(),
        nvidia_source: nvidia.as_ref().map(|found| found.1.clone()),
    })
}

#[tauri::command]
fn rerank_with_nvidia(request: NvidiaRerankRequest) -> Result<NvidiaRerankResponse, String> {
    let query = request.query.trim();
    if query.is_empty() || request.results.len() < 2 {
        return Ok(NvidiaRerankResponse {
            ordered_ids: request.results.into_iter().map(|item| item.id).collect(),
            model: "local-order".into(),
        });
    }

    let nvidia_names = ["NVIDIA_API_KEY", "NVIDIA_NIM_API_KEY", "NGC_API_KEY"];
    let Some((api_key, _source)) = discover_named_key(&nvidia_names) else {
        return Err("NVIDIA_API_KEY non trovata".into());
    };

    let candidates: Vec<NvidiaRerankItem> = request.results.into_iter().take(18).collect();
    let allowed_ids: HashSet<String> = candidates.iter().map(|item| item.id.clone()).collect();
    let id_by_index: Vec<String> = candidates.iter().map(|item| item.id.clone()).collect();
    let passages: Vec<Value> = candidates
        .iter()
        .map(|item| {
            let mut text = format!(
                "File: {}\nTipo: {}\nScore locale: {}\nEstratto: {}",
                item.name,
                item.kind,
                item.score,
                item.snippet.chars().take(1400).collect::<String>()
            );
            if text.trim().is_empty() {
                text = item.name.clone();
            }

            let mut passage = json!({ "text": text });
            if let Some(data_url) = item
                .visual_preview
                .as_deref()
                .and_then(|path| image_path_to_data_url(path).ok())
            {
                passage["image"] = Value::String(data_url);
            }
            passage
        })
        .collect();

    let payload = json!({
        "model": "nvidia/llama-nemotron-rerank-vl-1b-v2",
        "query": { "text": query },
        "passages": passages,
        "truncate": "END"
    });

    let client = Client::builder()
        .timeout(Duration::from_secs(45))
        .build()
        .map_err(|e| e.to_string())?;

    let mut urls = Vec::new();
    if let Ok(value) = env::var("NVIDIA_RERANK_URL") {
        if !value.trim().is_empty() {
            urls.push(value.trim().trim_end_matches('/').to_string());
        }
    }
    urls.push("https://ai.api.nvidia.com/v1/retrieval/nvidia/llama-nemotron-rerank-vl-1b-v2/reranking".into());
    urls.push("http://127.0.0.1:8000/v1/ranking".into());

    let mut last_error = String::new();
    for url in urls {
        let mut request_builder = client.post(&url).json(&payload);
        if url.starts_with("https://") {
            request_builder = request_builder.bearer_auth(&api_key);
        }
        let response = match request_builder.send() {
            Ok(response) => response,
            Err(err) => {
                last_error = err.to_string();
                continue;
            }
        };
        if !response.status().is_success() {
            last_error = response
                .text()
                .unwrap_or_else(|_| "NVIDIA rerank non riuscito".into());
            continue;
        }
        let body = response.json::<Value>().map_err(|e| e.to_string())?;
        let ordered_ids = ordered_ids_from_nvidia_response(&body, &id_by_index, &allowed_ids);
        if !ordered_ids.is_empty() {
            return Ok(NvidiaRerankResponse {
                ordered_ids,
                model: "nvidia/llama-nemotron-rerank-vl-1b-v2".into(),
            });
        }
        last_error = format!("Risposta NVIDIA senza ranking valido: {body}");
    }

    Err(if last_error.is_empty() {
        "NVIDIA rerank non disponibile".into()
    } else {
        last_error
    })
}

#[tauri::command]
fn list_gemini_candidates() -> Result<Vec<GeminiCandidate>, String> {
    let state = load_state();
    Ok(state
        .index
        .iter()
        .filter(|entry| entry.gemini_enabled && is_supported_gemini_extension(&entry.extension))
        .filter(|entry| entry.size <= 40 * 1024 * 1024)
        .take(120)
        .map(|entry| GeminiCandidate {
            path: entry.file_path.clone(),
            name: entry.name.clone(),
            mime_type: mime_for_gemini_extension(&entry.extension).into(),
            size: entry.size,
            modified: entry.modified,
        })
        .collect())
}

#[tauri::command]
fn read_file_base64(path: String) -> Result<String, String> {
    let path = PathBuf::from(path);
    if !path.exists() {
        return Err("File non trovato".into());
    }
    if fs::metadata(&path).map(|meta| meta.len() > 40 * 1024 * 1024).unwrap_or(true) {
        return Err("File troppo grande per la sincronizzazione Gemini automatica".into());
    }
    let bytes = fs::read(&path).map_err(|e| e.to_string())?;
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

#[tauri::command]
fn read_image_data_url(path: String) -> Result<String, String> {
    let path = PathBuf::from(path);
    if !path.exists() {
        return Err("Immagine non trovata".into());
    }
    let bytes = fs::read(&path).map_err(|e| e.to_string())?;
    let mime = mime_from_extension(&extension(&path));
    let payload = base64::engine::general_purpose::STANDARD.encode(bytes);
    Ok(format!("data:{};base64,{}", mime, payload))
}

#[tauri::command]
fn read_file_data_url(path: String) -> Result<FilePreviewPayload, String> {
    let path = PathBuf::from(path);
    if !path.exists() {
        return Err("File non trovato".into());
    }
    let metadata = fs::metadata(&path).map_err(|e| e.to_string())?;
    if metadata.len() > 120 * 1024 * 1024 {
        return Err("File troppo grande per la preview integrata".into());
    }
    let bytes = fs::read(&path).map_err(|e| e.to_string())?;
    let mime_type = mime_from_extension(&extension(&path)).to_string();
    let payload = base64::engine::general_purpose::STANDARD.encode(bytes);
    Ok(FilePreviewPayload {
        data_url: format!("data:{};base64,{}", mime_type, payload),
        mime_type,
        size: metadata.len(),
    })
}

#[tauri::command]
fn open_in_folder(path: String) -> Result<(), String> {
    let file_path = PathBuf::from(path);
    if !file_path.exists() {
        return Err("File non trovato".into());
    }

    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .arg(format!("/select,{}", file_path.display()))
            .spawn()
            .map_err(|e| e.to_string())?;
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg("-R")
            .arg(&file_path)
            .spawn()
            .map_err(|e| e.to_string())?;
        return Ok(());
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        let folder = file_path
            .parent()
            .ok_or_else(|| "Cartella del file non trovata".to_string())?;
        Command::new("xdg-open")
            .arg(folder)
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}

#[tauri::command]
fn update_visual_asset_embedding(
    asset_id: String,
    embedding: Vec<f32>,
    model: String,
) -> Result<LocalVisionStatus, String> {
    if embedding.is_empty() {
        return Err("Embedding vuoto".into());
    }

    let mut state = load_state();
    let mut updated = false;
    for asset in state
        .index
        .iter_mut()
        .flat_map(|entry| entry.visual_assets.iter_mut())
    {
        if visual_asset_id(asset) == asset_id {
            let normalized = normalize_vector(embedding.clone());
            upsert_visual_embedding(asset, model.clone(), normalized);
            updated = true;
            break;
        }
    }

    if !updated {
        return Err("Asset visuale non trovato".into());
    }

    save_state(&state)?;
    get_local_vision_status()
}

#[tauri::command]
fn scan_folder(root: String, query: String, filter: String) -> Result<ScanSummary, String> {
    let root_path = PathBuf::from(root);
    if !root_path.exists() {
        return Err("Cartella non trovata".into());
    }

    let query = query.trim().to_lowercase();
    let mut indexed = 0usize;
    let mut skipped = 0usize;
    let mut results = Vec::new();

    for entry in WalkDir::new(root_path)
        .follow_links(false)
        .into_iter()
        .filter_map(Result::ok)
    {
        let path = entry.path();
        if !entry.file_type().is_file() {
            continue;
        }

        let ext = extension(path);
        let kind = classify(&ext);
        if !matches_filter(kind, &filter) {
            skipped += 1;
            continue;
        }

        indexed += 1;
        let Some(name) = path
            .file_name()
            .and_then(|v| v.to_str())
            .map(str::to_string)
        else {
            skipped += 1;
            continue;
        };

        let searchable = extract_searchable_text(path, &ext).unwrap_or_default();
        let haystack = format!("{} {} {}", name, path.display(), searchable).to_lowercase();
        let score = score_match(&haystack, &query, &name, &searchable, kind);
        if query.is_empty() || score > 0 {
            let metadata = fs::metadata(path).ok();
            results.push(IndexedFile {
                id: path.display().to_string(),
                name,
                path: path.display().to_string(),
                kind: kind.to_string(),
                extension: ext,
                size: metadata.as_ref().map_or(0, |m| m.len()),
                modified: metadata
                    .and_then(|m| m.modified().ok())
                    .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                    .map(|d| d.as_secs() as i64),
                snippet: make_snippet(&searchable, &query, kind),
                page_hint: guess_page(&searchable, &query),
                score,
                source: Some("local".into()),
                visual_preview: None,
            });
        }
    }

    results.sort_by(|a, b| b.score.cmp(&a.score).then_with(|| a.name.cmp(&b.name)));
    results.truncate(MAX_RESULTS);

    Ok(ScanSummary {
        indexed,
        skipped,
        results,
    })
}

fn watcher_state() -> &'static Mutex<LiveWatcher> {
    WATCHER_STATE.get_or_init(|| Mutex::new(LiveWatcher::default()))
}

fn watcher_is_active() -> bool {
    watcher_state()
        .lock()
        .map(|live| live.watcher.is_some())
        .unwrap_or(false)
}

fn handle_fs_event(event: Event, watch_paths: &[WatchPath]) {
    let actionable = matches!(
        event.kind,
        EventKind::Create(_) | EventKind::Modify(_) | EventKind::Remove(_)
    );
    if !actionable {
        return;
    }

    for path in event.paths {
        if matches!(event.kind, EventKind::Remove(_)) {
            remove_indexed_path(&path);
            continue;
        }

        if !path.is_file() {
            continue;
        }

        let Some(owner) = owner_watch_path(&path, watch_paths) else {
            continue;
        };

        if should_skip_file(&path, watch_paths, Some(owner)) {
            continue;
        }

        if let Ok(Some(index_entry)) = index_file(&path, owner) {
            update_index_entry(index_entry);
        }
    }
}

fn owner_watch_path<'a>(path: &Path, watch_paths: &'a [WatchPath]) -> Option<&'a WatchPath> {
    watch_paths
        .iter()
        .filter(|candidate| {
            candidate.enabled
                && !candidate.is_excluded
                && path.starts_with(Path::new(&candidate.path))
        })
        .max_by_key(|candidate| candidate.path.len())
}

fn update_index_entry(entry: IndexEntry) {
    let mut state = load_state();
    state
        .index
        .retain(|existing| existing.file_path != entry.file_path);
    state.index.push(entry.clone());
    let _ = save_state(&state);
    let _ = upsert_typesense_entry(&entry);
}

fn remove_indexed_path(path: &Path) {
    let path_string = path.display().to_string();
    let mut state = load_state();
    let before = state.index.len();
    state.index.retain(|entry| entry.file_path != path_string);
    if state.index.len() != before {
        let _ = save_state(&state);
    }
    let _ = delete_typesense_path(&path_string);
}

fn default_watch_paths() -> Vec<WatchPath> {
    let mut paths = Vec::new();
    let mut seen = HashSet::new();
    if let Some(home) = dirs::home_dir() {
        for label in [
            "Desktop",
            "Documents",
            "Downloads",
            "Pictures",
            "Music",
            "Videos",
        ] {
            let path = home.join(label);
            if path.exists() {
                push_watch_path(&mut paths, &mut seen, path, true);
            }
        }
        push_watch_path(&mut paths, &mut seen, home, true);
    }
    for root in probable_roots() {
        if root.exists() {
            push_watch_path(&mut paths, &mut seen, root, false);
        }
    }
    paths
}

fn probable_roots() -> Vec<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        ('C'..='Z')
            .map(|letter| PathBuf::from(format!("{}:\\", letter)))
            .collect()
    }
    #[cfg(target_os = "macos")]
    {
        vec![PathBuf::from("/Volumes")]
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        vec![PathBuf::from("/mnt"), PathBuf::from("/media")]
    }
}

fn push_watch_path(
    paths: &mut Vec<WatchPath>,
    seen: &mut HashSet<String>,
    path: PathBuf,
    enabled: bool,
) {
    let path_string = path.display().to_string();
    if seen.insert(path_string.clone()) {
        paths.push(WatchPath {
            id: stable_id(&path_string),
            path: path_string,
            enabled,
            recursive: true,
            is_excluded: false,
            file_type_filter: None,
            gemini_enabled: false,
            auto_index: true,
        });
    }
}

fn normalize_watch_paths(paths: Vec<WatchPath>) -> Vec<WatchPath> {
    paths
        .into_iter()
        .map(|mut path| {
            if path.id.trim().is_empty() {
                path.id = stable_id(&path.path);
            }
            path
        })
        .collect()
}

fn upgrade_default_watch_paths(state: &mut AppState) -> bool {
    if state.default_paths_upgraded {
        return false;
    }
    let mut seen: HashSet<String> = state
        .watch_paths
        .iter()
        .map(|path| path.path.clone())
        .collect();
    for path in default_watch_paths() {
        if seen.insert(path.path.clone()) {
            state.watch_paths.push(path);
        }
    }
    state.default_paths_upgraded = true;
    true
}

fn index_file(path: &Path, watch_path: &WatchPath) -> Result<Option<IndexEntry>, String> {
    let metadata = fs::metadata(path).map_err(|e| e.to_string())?;
    if metadata.len() > MAX_INDEX_FILE_BYTES {
        return Ok(None);
    }
    let extension = extension(path);
    let kind = classify(&extension).to_string();
    let name = path
        .file_name()
        .and_then(|v| v.to_str())
        .unwrap_or_default()
        .to_string();
    let content = extract_with_tika(path)
        .unwrap_or_else(|| extract_searchable_text(path, &extension).unwrap_or_default());
    let visual_assets = visual_assets_for(path, &kind);
    let modified = metadata
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64);
    let created = metadata
        .created()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64);

    Ok(Some(IndexEntry {
        file_path: path.display().to_string(),
        name,
        kind,
        extension,
        size: metadata.len(),
        modified,
        created,
        file_hash: file_hash(path).unwrap_or_default(),
        content: content.clone(),
        title: None,
        author: None,
        language: None,
        chunks: chunk_text(&content, 900, 120),
        visual_assets,
        source_watch_path: watch_path.path.clone(),
        gemini_enabled: watch_path.gemini_enabled,
    }))
}

fn should_skip_file(path: &Path, all_paths: &[WatchPath], owner: Option<&WatchPath>) -> bool {
    if all_paths
        .iter()
        .filter(|wp| wp.enabled && wp.is_excluded)
        .any(|wp| path.starts_with(Path::new(&wp.path)))
    {
        return true;
    }

    let Some(owner) = owner else {
        return false;
    };

    if let Some(filter) = &owner.file_type_filter {
        let ext = format!(".{}", extension(path));
        let configured: HashSet<String> =
            filter.extensions.iter().map(|e| e.to_lowercase()).collect();
        if filter.mode == "include" && !configured.contains(&ext) {
            return true;
        }
        if filter.mode == "exclude" && configured.contains(&ext) {
            return true;
        }
    }
    false
}

fn chunk_text(text: &str, chunk_size: usize, overlap: usize) -> Vec<String> {
    let words: Vec<&str> = text.split_whitespace().collect();
    if words.is_empty() {
        return vec![String::new()];
    }
    let mut chunks = Vec::new();
    let mut start = 0usize;
    while start < words.len() {
        let end = (start + chunk_size).min(words.len());
        chunks.push(words[start..end].join(" "));
        if end == words.len() {
            break;
        }
        start = end.saturating_sub(overlap);
    }
    chunks
}

fn visual_assets_for(path: &Path, kind: &str) -> Vec<VisualAsset> {
    if kind == "image" {
        return match image::open(path) {
            Ok(image) => vec![VisualAsset {
                file_path: path.display().to_string(),
                page_number: None,
                asset_kind: "image".into(),
                thumbnail_path: Some(path.display().to_string()),
                embedding: image_embedding(&image),
                embedding_model: Some("trova-fingerprint-v1".into()),
                visual_embeddings: Vec::new(),
                face_embedding: None,
                face_embedding_model: None,
            }],
            Err(_) => Vec::new(),
        };
    }

    if extension(path) == "pdf" {
        return pdf_visual_assets(path);
    }

    Vec::new()
}

fn pdf_visual_assets(path: &Path) -> Vec<VisualAsset> {
    if !command_exists("pdftoppm") {
        return Vec::new();
    }

    let path_string = path.display().to_string();
    let cache_dir = data_dir()
        .join("visual-cache")
        .join(stable_id(&path_string));
    if fs::create_dir_all(&cache_dir).is_err() {
        return Vec::new();
    }

    let prefix = cache_dir.join("page");
    let status = Command::new("pdftoppm")
        .arg("-png")
        .arg("-r")
        .arg("72")
        .arg("-f")
        .arg("1")
        .arg("-l")
        .arg(MAX_PDF_VISUAL_PAGES.to_string())
        .arg(path)
        .arg(&prefix)
        .status();

    if !status.map(|s| s.success()).unwrap_or(false) {
        return Vec::new();
    }

    let mut rendered_pages: Vec<PathBuf> = fs::read_dir(&cache_dir)
        .ok()
        .into_iter()
        .flat_map(|entries| entries.filter_map(Result::ok))
        .map(|entry| entry.path())
        .filter(|candidate| extension(candidate) == "png")
        .collect();
    rendered_pages.sort();

    rendered_pages
        .into_iter()
        .filter_map(|thumbnail| {
            let image = image::open(&thumbnail).ok()?;
            let page_number = thumbnail
                .file_stem()
                .and_then(|stem| stem.to_str())
                .and_then(|stem| stem.rsplit('-').next())
                .and_then(|page| page.parse::<u32>().ok());

            Some(VisualAsset {
                file_path: path.display().to_string(),
                page_number,
                asset_kind: "pdf_page".into(),
                thumbnail_path: Some(thumbnail.display().to_string()),
                embedding: image_embedding(&image),
                embedding_model: Some("trova-fingerprint-v1".into()),
                visual_embeddings: Vec::new(),
                face_embedding: None,
                face_embedding_model: None,
            })
        })
        .collect()
}

#[derive(Debug, Clone, Copy)]
struct LocalVisionModel {
    id: &'static str,
    label: &'static str,
}

fn local_vision_models() -> Vec<LocalVisionModel> {
    vec![
        LocalVisionModel {
            id: "Xenova/clip-vit-base-patch32",
            label: "CLIP",
        },
        LocalVisionModel {
            id: "onnx-community/dinov3-vits16-pretrain-lvd1689m-ONNX",
            label: "DINOv3",
        },
        LocalVisionModel {
            id: "onnx-community/siglip2-base-patch16-224-ONNX",
            label: "SigLIP2",
        },
    ]
}

fn local_vision_models_label() -> String {
    local_vision_models()
        .iter()
        .map(|model| model.label)
        .collect::<Vec<_>>()
        .join(" + ")
}

fn visual_asset_id(asset: &VisualAsset) -> String {
    stable_id(&format!(
        "{}::{}::{}::{}",
        asset.file_path,
        asset.asset_kind,
        asset.page_number.unwrap_or(0),
        asset.thumbnail_path.clone().unwrap_or_default()
    ))
}

fn visual_vectors(asset: &VisualAsset) -> impl Iterator<Item = &[f32]> {
    std::iter::once(asset.embedding.as_slice())
        .filter(|embedding| !embedding.is_empty())
        .chain(
            asset
                .visual_embeddings
                .iter()
                .map(|embedding| embedding.vector.as_slice())
                .filter(|embedding| !embedding.is_empty()),
        )
}

fn visual_embedding_models(asset: &VisualAsset) -> Vec<String> {
    let mut models = Vec::new();
    if let Some(model) = &asset.embedding_model {
        if model != "trova-fingerprint-v1" {
            models.push(model.clone());
        }
    }
    for embedding in &asset.visual_embeddings {
        if !models.iter().any(|model| model == &embedding.model) {
            models.push(embedding.model.clone());
        }
    }
    models
}

fn upsert_visual_embedding(asset: &mut VisualAsset, model: String, vector: Vec<f32>) {
    if let Some(existing) = asset
        .visual_embeddings
        .iter_mut()
        .find(|embedding| embedding.model == model)
    {
        existing.vector = vector;
        return;
    }
    asset.visual_embeddings.push(VisualEmbedding { model, vector });
}

fn command_exists(name: &str) -> bool {
    let checker = if cfg!(target_os = "windows") {
        "where"
    } else {
        "which"
    };
    Command::new(checker)
        .arg(name)
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

fn image_embedding(image: &DynamicImage) -> Vec<f32> {
    let resized = image.thumbnail_exact(8, 8).to_rgb8();
    let mut embedding = Vec::with_capacity(64 * 3 + 6);
    let mut totals = [0.0_f32; 3];
    for pixel in resized.pixels() {
        let channels = pixel.channels();
        for channel in channels {
            embedding.push(*channel as f32 / 255.0);
        }
        totals[0] += channels[0] as f32;
        totals[1] += channels[1] as f32;
        totals[2] += channels[2] as f32;
    }
    let count = (resized.width() * resized.height()) as f32 * 255.0;
    embedding.extend([totals[0] / count, totals[1] / count, totals[2] / count]);
    normalize_vector(embedding)
}

fn normalize_vector(mut values: Vec<f32>) -> Vec<f32> {
    let norm = values.iter().map(|v| v * v).sum::<f32>().sqrt();
    if norm > 0.0 {
        for value in values.iter_mut() {
            *value /= norm;
        }
    }
    values
}

fn visual_similarity(a: &[f32], b: &[f32]) -> f32 {
    if a.is_empty() || b.is_empty() || a.len() != b.len() {
        return 0.0;
    }
    a.iter()
        .zip(b.iter())
        .map(|(x, y)| x * y)
        .sum::<f32>()
        .max(0.0)
}

fn matches_result_filter(kind: &str, filters: &[String]) -> bool {
    if filters.is_empty() || filters.iter().any(|f| f == "all") {
        return true;
    }
    filters.iter().any(|filter| match filter.as_str() {
        "text" => matches!(kind, "document" | "code"),
        "images" => kind == "image",
        "audio" => kind == "audio",
        "video" => kind == "video",
        "code" => kind == "code",
        "documents" => kind == "document",
        _ => true,
    })
}

fn dedupe_results(results: &mut Vec<IndexedFile>) {
    let mut seen = HashSet::new();
    results.retain(|result| seen.insert(result.path.clone()));
}

fn status_from_counts(
    discovered: usize,
    indexed: usize,
    skipped: usize,
    running: bool,
) -> IndexStatus {
    let progress = if discovered == 0 {
        0
    } else {
        ((indexed + skipped) * 100 / discovered).min(100) as u8
    };
    IndexStatus {
        running,
        phase: if running {
            "indexing".into()
        } else {
            "idle".into()
        },
        files_discovered: discovered,
        files_indexed: indexed,
        files_skipped: skipped,
        progress,
        watcher_active: watcher_is_active(),
        index_size_bytes: fs::metadata(index_path()).map(|m| m.len()).unwrap_or(0),
        tika_available: service_ok("http://127.0.0.1:9998/tika"),
        typesense_available: service_ok(&format!("{}/health", typesense_base_url())),
    }
}

fn service_ok(url: &str) -> bool {
    Client::builder()
        .timeout(Duration::from_millis(450))
        .build()
        .and_then(|client| client.get(url).send())
        .map(|response| response.status().is_success())
        .unwrap_or(false)
}

fn typesense_base_url() -> String {
    std::env::var("TYPESENSE_URL").unwrap_or_else(|_| "http://127.0.0.1:8108".into())
}

fn typesense_api_key() -> String {
    std::env::var("TYPESENSE_API_KEY").unwrap_or_else(|_| "trova-typesense-key".into())
}

fn typesense_client() -> Result<Client, String> {
    Client::builder()
        .timeout(Duration::from_secs(6))
        .build()
        .map_err(|e| e.to_string())
}

fn typesense_schema() -> Value {
    json!({
        "name": TYPESENSE_COLLECTION,
        "fields": [
            { "name": "file_path", "type": "string", "facet": true },
            { "name": "chunk_index", "type": "int32" },
            { "name": "chunk_total", "type": "int32" },
            { "name": "file_extension", "type": "string", "facet": true },
            { "name": "file_size", "type": "int64" },
            { "name": "mime_type", "type": "string", "facet": true },
            { "name": "modified_time", "type": "int64" },
            { "name": "content", "type": "string" },
            { "name": "file_hash", "type": "string" },
            { "name": "created_time", "type": "int64" },
            { "name": "indexed_at", "type": "int64" },
            { "name": "title", "type": "string" },
            { "name": "author", "type": "string", "facet": true },
            { "name": "language", "type": "string", "facet": true },
            {
                "name": "embedding",
                "type": "float[]",
                "embed": {
                    "from": ["title", "author", "content"],
                    "model_config": { "model_name": "ts/paraphrase-multilingual-mpnet-base-v2" }
                }
            }
        ],
        "default_sorting_field": "chunk_index"
    })
}

fn ensure_typesense_collection() -> Result<(), String> {
    let client = typesense_client()?;
    let key = typesense_api_key();
    let collection_url = format!(
        "{}/collections/{}",
        typesense_base_url(),
        TYPESENSE_COLLECTION
    );
    let response = client
        .get(&collection_url)
        .header("X-TYPESENSE-API-KEY", &key)
        .send()
        .map_err(|e| e.to_string())?;

    if response.status().is_success() {
        return Ok(());
    }
    if response.status() != StatusCode::NOT_FOUND {
        return Err(format!("Typesense non pronto: {}", response.status()));
    }

    let create_url = format!("{}/collections", typesense_base_url());
    let created = client
        .post(create_url)
        .header("X-TYPESENSE-API-KEY", key)
        .json(&typesense_schema())
        .send()
        .map_err(|e| e.to_string())?;
    created
        .status()
        .is_success()
        .then_some(())
        .ok_or_else(|| format!("Creazione schema Typesense fallita: {}", created.status()))
}

fn reset_typesense_collection() -> Result<(), String> {
    if !service_ok(&format!("{}/health", typesense_base_url())) {
        return Err("Typesense offline".into());
    }
    let _ = delete_typesense_collection();
    ensure_typesense_collection()
}

fn delete_typesense_collection() -> Result<(), String> {
    let client = typesense_client()?;
    let key = typesense_api_key();
    let url = format!(
        "{}/collections/{}",
        typesense_base_url(),
        TYPESENSE_COLLECTION
    );
    let response = client
        .delete(url)
        .header("X-TYPESENSE-API-KEY", key)
        .send()
        .map_err(|e| e.to_string())?;
    if response.status().is_success() || response.status() == StatusCode::NOT_FOUND {
        Ok(())
    } else {
        Err(format!("Reset Typesense fallito: {}", response.status()))
    }
}

fn upsert_typesense_entry(entry: &IndexEntry) -> Result<(), String> {
    ensure_typesense_collection()?;
    let _ = delete_typesense_path(&entry.file_path);

    let client = typesense_client()?;
    let key = typesense_api_key();
    let url = format!(
        "{}/collections/{}/documents",
        typesense_base_url(),
        TYPESENSE_COLLECTION
    );
    let chunks = if entry.chunks.is_empty() {
        vec![entry.content.clone()]
    } else {
        entry.chunks.clone()
    };
    let total = chunks.len().max(1) as i32;

    for (index, chunk) in chunks.iter().enumerate() {
        let doc = json!({
            "id": stable_id(&format!("{}::{}", entry.file_path, index)),
            "file_path": entry.file_path,
            "chunk_index": index as i32,
            "chunk_total": total,
            "file_extension": entry.extension,
            "file_size": entry.size as i64,
            "mime_type": mime_from_extension(&entry.extension),
            "modified_time": entry.modified.unwrap_or(0),
            "content": chunk,
            "file_hash": entry.file_hash,
            "created_time": entry.created.unwrap_or(0),
            "indexed_at": now_unix(),
            "title": entry.title.clone().unwrap_or_else(|| entry.name.clone()),
            "author": entry.author.clone().unwrap_or_default(),
            "language": entry.language.clone().unwrap_or_default()
        });

        let response = client
            .post(&url)
            .query(&[("action", "upsert")])
            .header("X-TYPESENSE-API-KEY", &key)
            .json(&doc)
            .send()
            .map_err(|e| e.to_string())?;

        if !response.status().is_success() {
            return Err(format!("Upsert Typesense fallito: {}", response.status()));
        }
    }
    Ok(())
}

fn delete_typesense_path(path: &str) -> Result<(), String> {
    ensure_typesense_collection()?;
    let client = typesense_client()?;
    let key = typesense_api_key();
    let url = format!(
        "{}/collections/{}/documents",
        typesense_base_url(),
        TYPESENSE_COLLECTION
    );
    let filter = format!("file_path:={}", typesense_string(path));
    let response = client
        .delete(url)
        .query(&[("filter_by", filter)])
        .header("X-TYPESENSE-API-KEY", key)
        .send()
        .map_err(|e| e.to_string())?;

    if response.status().is_success() || response.status() == StatusCode::NOT_FOUND {
        Ok(())
    } else {
        Err(format!("Delete Typesense fallito: {}", response.status()))
    }
}

fn search_typesense(request: &SearchRequest) -> Vec<IndexedFile> {
    let query = request.text_query.clone().unwrap_or_default();
    if query.trim().is_empty() || ensure_typesense_collection().is_err() {
        return Vec::new();
    }

    let client = match typesense_client() {
        Ok(client) => client,
        Err(_) => return Vec::new(),
    };
    let url = format!(
        "{}/collections/{}/documents/search",
        typesense_base_url(),
        TYPESENSE_COLLECTION
    );
    let response = client
        .get(url)
        .header("X-TYPESENSE-API-KEY", typesense_api_key())
        .query(&[
            ("q", query.as_str()),
            ("query_by", "content,title,file_path"),
            ("per_page", "50"),
            ("num_typos", "2"),
            ("highlight_full_fields", "content"),
        ])
        .send();

    let Ok(response) = response else {
        return Vec::new();
    };
    if !response.status().is_success() {
        return Vec::new();
    }

    let Ok(payload) = response.json::<Value>() else {
        return Vec::new();
    };

    payload
        .get("hits")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|hit| {
            let document = hit.get("document")?;
            let file_path = document.get("file_path")?.as_str()?.to_string();
            let extension = document
                .get("file_extension")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            let kind = classify(&extension).to_string();
            if !matches_result_filter(&kind, &request.filters) {
                return None;
            }
            let content = document
                .get("content")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            let page_hint = guess_page(&content, query.trim());
            let name = Path::new(&file_path)
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or(&file_path)
                .to_string();
            let score = hit
                .get("text_match")
                .and_then(Value::as_i64)
                .map(|score| (score / 100_000).clamp(1, 500) as i32 + 30)
                .unwrap_or(30);

            Some(IndexedFile {
                id: format!("typesense-{}", file_path),
                name,
                path: file_path.clone(),
                kind,
                extension,
                size: document
                    .get("file_size")
                    .and_then(Value::as_i64)
                    .unwrap_or(0) as u64,
                modified: document.get("modified_time").and_then(Value::as_i64),
                snippet: make_snippet(&content, query.trim(), "document"),
                page_hint,
                score,
                source: Some("local".into()),
                visual_preview: None,
            })
        })
        .collect()
}

fn typesense_string(value: &str) -> String {
    format!("`{}`", value.replace('`', "\\`"))
}

fn now_unix() -> i64 {
    std::time::SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or(0)
}

fn extract_with_tika(path: &Path) -> Option<String> {
    let bytes = fs::read(path).ok()?;
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(18))
        .build()
        .ok()?;
    let response = client
        .put("http://127.0.0.1:9998/tika")
        .header("Accept", "text/plain")
        .header("Content-Type", mime_from_extension(&extension(path)))
        .body(bytes)
        .send()
        .ok()?;
    response
        .status()
        .is_success()
        .then(|| response.text().ok())
        .flatten()
}

fn mime_from_extension(ext: &str) -> &'static str {
    match ext {
        "pdf" => "application/pdf",
        "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "pptx" => "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "mp4" => "video/mp4",
        "mov" => "video/quicktime",
        "webm" => "video/webm",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "ogg" => "audio/ogg",
        "flac" => "audio/flac",
        "txt" | "md" | "csv" | "json" | "toml" | "yaml" | "yml" | "html" | "css" | "js" | "jsx"
        | "ts" | "tsx" | "py" | "rs" | "go" | "java" | "c" | "cpp" | "h" => "text/plain",
        _ => "application/octet-stream",
    }
}

fn file_hash(path: &Path) -> Result<String, String> {
    let mut file = fs::File::open(path).map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 8192];
    loop {
        let read = file.read(&mut buffer).map_err(|e| e.to_string())?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn stable_id(value: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(value.as_bytes());
    format!("{:x}", hasher.finalize())[..16].to_string()
}

fn state_path() -> PathBuf {
    data_dir().join("state.json")
}

fn index_path() -> PathBuf {
    state_path()
}

fn data_dir() -> PathBuf {
    dirs::data_local_dir()
        .or_else(dirs::data_dir)
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")))
        .join("trova")
}

fn local_api_is_alive(port: u16) -> bool {
    let client = match Client::builder().timeout(Duration::from_millis(500)).build() {
        Ok(client) => client,
        Err(_) => return false,
    };
    client
        .post(format!("http://127.0.0.1:{port}/api/command"))
        .json(&json!({ "command": "get_index_status", "args": {} }))
        .send()
        .ok()
        .and_then(|response| response.json::<Value>().ok())
        .and_then(|payload| payload.get("ok").and_then(Value::as_bool))
        .unwrap_or(false)
}

/// Cerca il binary sidecar `trova-backend[-<triple>][.exe]` bundled da Tauri.
/// Tauri rinomina i sidecar in run-time togliendo il suffisso del target; cerchiamo entrambe le forme.
fn locate_local_api_sidecar(app: &tauri::AppHandle) -> Option<PathBuf> {
    let exe_suffix = if cfg!(windows) { ".exe" } else { "" };
    let base_names: &[&str] = &[
        "trova-backend",
        "trova-backend-x86_64-pc-windows-msvc",
        "trova-backend-aarch64-pc-windows-msvc",
        "trova-backend-x86_64-apple-darwin",
        "trova-backend-aarch64-apple-darwin",
        "trova-backend-x86_64-unknown-linux-gnu",
        "trova-backend-aarch64-unknown-linux-gnu",
    ];
    let mut candidate_dirs: Vec<PathBuf> = Vec::new();
    if let Ok(exe) = env::current_exe() {
        if let Some(parent) = exe.parent() {
            candidate_dirs.push(parent.to_path_buf());
            candidate_dirs.push(parent.join("..").join("Resources"));
        }
    }
    if let Ok(resource_dir) = app.path().resource_dir() {
        candidate_dirs.push(resource_dir);
    }
    if let Ok(cwd) = env::current_dir() {
        candidate_dirs.push(cwd.join("src-tauri").join("binaries"));
        candidate_dirs.push(cwd.join("binaries"));
    }
    for dir in candidate_dirs {
        for base in base_names {
            let candidate = dir.join(format!("{base}{exe_suffix}"));
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

fn locate_local_api_script(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let mut candidates = Vec::new();
    if let Ok(explicit) = env::var("TROVA_LOCAL_API_SCRIPT") {
        candidates.push(PathBuf::from(explicit));
    }
    if let Ok(cwd) = env::current_dir() {
        candidates.push(cwd.join("scripts").join("local-backend.mjs"));
        candidates.push(cwd.join("local-backend.mjs"));
    }
    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir.join("scripts").join("local-backend.mjs"));
        candidates.push(resource_dir.join("local-backend.mjs"));
    }
    if let Ok(exe) = env::current_exe() {
        if let Some(exe_dir) = exe.parent() {
            candidates.push(exe_dir.join("scripts").join("local-backend.mjs"));
            candidates.push(exe_dir.join("..").join("scripts").join("local-backend.mjs"));
            candidates.push(exe_dir.join("..").join("Resources").join("scripts").join("local-backend.mjs"));
        }
    }

    candidates
        .into_iter()
        .find(|candidate| candidate.is_file())
        .ok_or_else(|| "scripts/local-backend.mjs non trovato nelle risorse desktop.".into())
}

fn load_state() -> AppState {
    fs::read_to_string(state_path())
        .ok()
        .and_then(|content| serde_json::from_str(&content).ok())
        .unwrap_or_default()
}

fn save_state(state: &AppState) -> Result<(), String> {
    let dir = data_dir();
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let content = serde_json::to_string_pretty(state).map_err(|e| e.to_string())?;
    fs::write(state_path(), content).map_err(|e| e.to_string())
}

fn extension(path: &Path) -> String {
    path.extension()
        .and_then(|v| v.to_str())
        .unwrap_or("")
        .to_lowercase()
}

fn classify(ext: &str) -> &'static str {
    match ext {
        "pdf" | "doc" | "docx" | "txt" | "md" | "rtf" | "odt" | "pages" | "csv" | "xlsx"
        | "pptx" => "document",
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "tiff" | "bmp" | "heic" | "svg" => "image",
        "mp3" | "wav" | "flac" | "aac" | "ogg" | "m4a" => "audio",
        "mp4" | "mov" | "mkv" | "avi" | "webm" => "video",
        "rs" | "ts" | "tsx" | "js" | "jsx" | "py" | "go" | "java" | "kt" | "swift" | "html"
        | "css" | "json" | "toml" | "yaml" | "yml" | "sql" => "code",
        _ => "other",
    }
}

fn matches_filter(kind: &str, filter: &str) -> bool {
    match filter {
        "all" => true,
        "text" => matches!(kind, "document" | "code"),
        "images" => kind == "image",
        "audio" => kind == "audio",
        "video" => kind == "video",
        "code" => kind == "code",
        "documents" => kind == "document",
        _ => true,
    }
}

fn extract_searchable_text(path: &Path, ext: &str) -> Result<String, String> {
    match ext {
        "txt" | "md" | "rtf" | "csv" | "json" | "toml" | "yaml" | "yml" | "sql" | "html"
        | "css" | "js" | "jsx" | "ts" | "tsx" | "py" | "rs" | "go" | "java" | "kt" | "swift" => {
            read_text_file(path)
        }
        "docx" | "pptx" | "xlsx" => read_zipped_office_text(path),
        "pdf" => read_pdf_text(path),
        _ => Ok(String::new()),
    }
}

fn read_text_file(path: &Path) -> Result<String, String> {
    let mut file = fs::File::open(path).map_err(|e| e.to_string())?;
    let mut buf = Vec::new();
    file.by_ref()
        .take(MAX_TEXT_BYTES as u64)
        .read_to_end(&mut buf)
        .map_err(|e| e.to_string())?;
    Ok(String::from_utf8_lossy(&buf).into_owned())
}

fn read_zipped_office_text(path: &Path) -> Result<String, String> {
    let file = fs::File::open(path).map_err(|e| e.to_string())?;
    let mut zip = ZipArchive::new(file).map_err(|e| e.to_string())?;
    let mut text = String::new();

    for i in 0..zip.len() {
        let Ok(mut file) = zip.by_index(i) else {
            continue;
        };
        let name = file.name().to_string();
        if !name.ends_with(".xml") || text.len() > MAX_TEXT_BYTES {
            continue;
        }
        let mut xml = String::new();
        if file.read_to_string(&mut xml).is_ok() {
            text.push(' ');
            text.push_str(&strip_xml(&xml));
        }
    }

    Ok(text)
}

fn read_pdf_text(path: &Path) -> Result<String, String> {
    let document = lopdf::Document::load(path).map_err(|e| e.to_string())?;
    let mut text = String::new();
    for (page_number, _page_id) in document.get_pages() {
        if text.len() > MAX_TEXT_BYTES {
            break;
        }
        if let Ok(page_text) = document.extract_text(&[page_number]) {
            text.push_str(&format!("\n[Pagina {}]\n{}", page_number, page_text));
        }
    }
    Ok(text)
}

fn strip_xml(xml: &str) -> String {
    let mut out = String::with_capacity(xml.len() / 2);
    let mut in_tag = false;
    for ch in xml.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => {
                in_tag = false;
                out.push(' ');
            }
            _ if !in_tag => out.push(ch),
            _ => {}
        }
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn score_match(haystack: &str, query: &str, name: &str, body: &str, kind: &str) -> i32 {
    if query.is_empty() {
        return 0;
    }
    let mut score = 0;
    let name_lower = name.to_lowercase();
    let body_lower = body.to_lowercase();

    for term in query.split_whitespace() {
        if name_lower.contains(term) {
            score += 80;
        }
        if body_lower.contains(term) {
            score += 45;
        }
        if haystack.contains(term) {
            score += 15;
        }
    }

    if matches!(kind, "image" | "audio" | "video") && name_lower.contains(query) {
        score += 50;
    }

    score
}

fn make_snippet(text: &str, query: &str, kind: &str) -> String {
    if text.trim().is_empty() {
        return match kind {
            "image" => "Corrispondenza visiva o metadata immagine.".into(),
            "audio" => "Corrispondenza su nome file, percorso o metadati audio.".into(),
            "video" => "Corrispondenza su nome file, percorso o metadati video.".into(),
            _ => "Nessuna anteprima testuale disponibile.".into(),
        };
    }

    let normalized = text.split_whitespace().collect::<Vec<_>>().join(" ");
    let lower = normalized.to_lowercase();
    let idx = query
        .split_whitespace()
        .find_map(|term| lower.find(term))
        .unwrap_or(0);
    let start = idx.saturating_sub(90);
    let end = (idx + 240).min(normalized.len());
    normalized[start..end].trim().to_string()
}

fn visual_match_snippet(query: &str, kind: &str, visual_score: f32) -> String {
    let confidence = (visual_score * 100.0).round() as i32;
    match kind {
        "image" => format!(
            "Immagine associata a \"{}\" tramite ricerca visuale locale. Somiglianza {}%.",
            query, confidence
        ),
        "document" => format!(
            "Documento con pagina o preview visuale associata a \"{}\". Somiglianza {}%.",
            query, confidence
        ),
        _ => format!(
            "Corrispondenza visuale locale associata a \"{}\". Somiglianza {}%.",
            query, confidence
        ),
    }
}

fn ordered_ids_from_nvidia_response(
    body: &Value,
    id_by_index: &[String],
    allowed_ids: &HashSet<String>,
) -> Vec<String> {
    let mut ids = Vec::new();

    if let Some(rankings) = body.get("rankings").and_then(Value::as_array) {
        for ranking in rankings {
            if let Some(index) = ranking.get("index").and_then(Value::as_u64) {
                if let Some(id) = id_by_index.get(index as usize) {
                    ids.push(id.clone());
                }
            }
        }
    }

    if ids.is_empty() {
        if let Some(items) = body.get("data").and_then(Value::as_array) {
            let mut ranked = Vec::new();
            for item in items {
                let index = item
                    .get("index")
                    .or_else(|| item.get("passage_index"))
                    .and_then(Value::as_u64);
                let score = item
                    .get("logit")
                    .or_else(|| item.get("score"))
                    .and_then(Value::as_f64)
                    .unwrap_or(0.0);
                if let Some(index) = index {
                    if let Some(id) = id_by_index.get(index as usize) {
                        ranked.push((id.clone(), score));
                    }
                }
            }
            ranked.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
            ids.extend(ranked.into_iter().map(|item| item.0));
        }
    }

    let mut seen = HashSet::new();
    ids.into_iter()
        .filter(|id| allowed_ids.contains(id) && seen.insert(id.clone()))
        .collect()
}

fn image_path_to_data_url(path: &str) -> Result<String, String> {
    let path = PathBuf::from(path);
    if !path.exists() || fs::metadata(&path).map(|meta| meta.len() > 3_000_000).unwrap_or(true) {
        return Err("preview non disponibile".into());
    }
    let bytes = fs::read(&path).map_err(|e| e.to_string())?;
    let mime = mime_for_image_path(&path);
    Ok(format!(
        "data:{};base64,{}",
        mime,
        base64::engine::general_purpose::STANDARD.encode(bytes)
    ))
}

fn mime_for_image_path(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_lowercase()
        .as_str()
    {
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        _ => "image/png",
    }
}

fn is_supported_gemini_extension(extension: &str) -> bool {
    matches!(
        extension.trim_start_matches('.').to_lowercase().as_str(),
        "txt" | "md" | "pdf" | "docx" | "png" | "jpg" | "jpeg"
    )
}

fn mime_for_gemini_extension(extension: &str) -> &'static str {
    match extension.trim_start_matches('.').to_lowercase().as_str() {
        "pdf" => "application/pdf",
        "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "md" => "text/markdown",
        _ => "text/plain",
    }
}

fn discover_named_key(names: &[&str]) -> Option<(String, String)> {
    for name in names {
        if let Ok(value) = env::var(name) {
            if looks_like_api_key(&value) {
                return Some((value, format!("env:{name}")));
            }
        }
    }

    for root in key_search_roots() {
        if !root.exists() {
            continue;
        }
        let mut checked_files = 0usize;
        for entry in WalkDir::new(root).max_depth(5).into_iter().filter_map(Result::ok) {
            let path = entry.path();
            if !entry.file_type().is_file() || !is_candidate_key_file(path) {
                continue;
            }
            checked_files += 1;
            if checked_files > 500 {
                break;
            }
            if fs::metadata(path).map(|m| m.len() > 1_000_000).unwrap_or(true) {
                continue;
            }
            let Ok(content) = fs::read_to_string(path) else {
                continue;
            };
            if let Some(value) = extract_key_from_text(&content, names) {
                return Some((value, path.display().to_string()));
            }
        }
    }

    None
}

fn key_search_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Some(home) = dirs::home_dir() {
        roots.push(home.join("Documenti").join("Claude"));
        roots.push(home.join("Documents").join("Claude"));
        roots.push(home.join(".cache").join("normeai"));
    }
    roots
}

fn is_candidate_key_file(path: &Path) -> bool {
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_lowercase();
    name.starts_with(".env")
        || name.contains("key")
        || name.contains("google")
        || name.contains("gemini")
        || name.contains("nvidia")
        || matches!(
            path.extension()
                .and_then(|value| value.to_str())
                .unwrap_or_default()
                .to_lowercase()
                .as_str(),
            "env" | "json" | "toml" | "yaml" | "yml" | "py" | "js" | "ts" | "md"
        )
}

fn extract_key_from_text(content: &str, names: &[&str]) -> Option<String> {
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('#') || trimmed.starts_with("//") {
            continue;
        }
        for name in names {
            if let Some(value) = parse_key_assignment(trimmed, name) {
                if looks_like_api_key(&value) {
                    return Some(value);
                }
            }
        }
    }
    None
}

fn parse_key_assignment(line: &str, name: &str) -> Option<String> {
    let normalized = line.strip_prefix("export ").unwrap_or(line).trim();
    let direct = normalized
        .strip_prefix(name)
        .and_then(|tail| tail.trim_start().strip_prefix('='))
        .map(clean_key_value);
    if direct.as_ref().is_some_and(|value| !value.is_empty()) {
        return direct;
    }

    let quoted = format!("\"{name}\"");
    normalized
        .strip_prefix(&quoted)
        .and_then(|tail| tail.trim_start().strip_prefix(':'))
        .map(clean_key_value)
        .filter(|value| !value.is_empty())
}

fn clean_key_value(value: &str) -> String {
    value
        .trim()
        .trim_end_matches(',')
        .trim_matches('"')
        .trim_matches('\'')
        .to_string()
}

fn looks_like_api_key(value: &str) -> bool {
    let trimmed = value.trim();
    trimmed.len() >= 20
        && !trimmed.contains(' ')
        && !trimmed.contains('<')
        && !trimmed.eq_ignore_ascii_case("your_api_key")
        && !trimmed.eq_ignore_ascii_case("changeme")
}

fn guess_page(text: &str, query: &str) -> Option<u32> {
    if query.is_empty() {
        return None;
    }
    let lower = text.to_lowercase();
    let idx = query.split_whitespace().find_map(|term| lower.find(term))?;
    let prefix = &text[..idx.min(text.len())];
    prefix
        .rmatch_indices("[Pagina ")
        .next()
        .and_then(|(_, tail)| tail.strip_prefix("[Pagina "))
        .and_then(|tail| tail.split(']').next())
        .and_then(|n| n.parse::<u32>().ok())
}

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            clear_index,
            discover_api_keys,
            ensure_local_api,
            get_default_watch_paths,
            get_index_status,
            list_gemini_candidates,
            load_watch_paths,
            pick_folder,
            read_file_base64,
            save_watch_paths,
            scan_folder,
            rerank_with_nvidia,
            search_index,
            start_indexing,
            start_watcher,
            stop_watcher,
            get_local_vision_status,
            list_visual_assets,
            open_in_folder,
            read_image_data_url,
            read_file_data_url,
            update_visual_asset_embedding,
            visual_embedding_from_data_url
        ])
        .run(tauri::generate_context!())
        .expect("error while running Trova");
}
