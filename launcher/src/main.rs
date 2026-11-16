//! SIMIA Desktop launcher.
//!
//! Sert l'interface SIMIA (dossier web) sur un port local stable, supervise un
//! processus `llama-server` (llama.cpp) et permet de changer de modele a chaud.
//!
//! Aucune dependance C/C++ : compile aussi bien avec la toolchain GNU que MSVC.

use std::env;
use std::fs;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use serde::Deserialize;
use tiny_http::{Header, Response, Server, StatusCode};

const APP_VERSION: &str = env!("CARGO_PKG_VERSION");
/// Contexte par defaut : 8192 tokens (~0,5 Go de cache KV en f16), soit le double
/// de l'ancienne valeur, ce qui laisse la place a un gros fichier de code.
const DEFAULT_CTX_SIZE: u32 = 8192;
const MIN_CTX_SIZE: u32 = 2048;
const MAX_OUTPUT: u32 = 1024;
/// Port fixe pour conserver les conversations (localStorage est lie a l'origine).
const DEFAULT_UI_PORT: u16 = 8170;
/// Le generateur d'images libere le GPU apres cette duree d'inactivite.
const IMAGE_IDLE: Duration = Duration::from_secs(300);
const DEFAULT_IMG_WIDTH: u32 = 1024;
const DEFAULT_IMG_STEPS: u32 = 8;
const HEURISTIC_WALK_UP: usize = 6;
const HEALTH_TIMEOUT: Duration = Duration::from_secs(240);

/// Modeles charges en priorite au premier demarrage, du plus souhaite au moins.
const PREFERRED_DEFAULTS: [&str; 4] = ["qwen3.5-2b", "qwen3-1.7b", "llama-3.2-1b", "qwen2.5-1.5b"];

#[derive(Clone)]
struct ModelEntry {
    id: String,
    name: String,
    category: String,
    size: String,
    path: PathBuf,
    bytes: u64,
    local: bool,
    url: Option<String>,
    mirror: Option<String>,
    hosted: bool,
    recommended: bool,
    /// Projecteur multimodal associe : rend le modele capable de lire une image.
    mmproj: Option<PathBuf>,
}

#[derive(Clone, Default)]
struct RemoteVersion {
    version: String,
    published: String,
    notes: String,
    reachable: bool,
}

struct Running {
    child: Child,
    model_id: String,
}

/// Un jeu de fichiers pour generer des images. `checkpoint` = un seul GGUF
/// autonome (SD 1.5, SDXS, SD-Turbo) ; `zimage` = DiT + encodeur + VAE separes.
#[derive(Clone, Deserialize)]
struct ImagePack {
    id: String,
    #[serde(default)]
    name: String,
    #[serde(default)]
    mode: String,
    #[serde(default)]
    size: String,
    #[serde(default)]
    note: String,
    #[serde(default)]
    license: String,
    #[serde(default)]
    recommended: bool,
    #[serde(default)]
    steps: u32,
    #[serde(default = "default_cfg")]
    cfg: f32,
    #[serde(default)]
    px: u32,
    #[serde(default)]
    model: String,
    #[serde(default)]
    diffusion: String,
    #[serde(default)]
    llm: String,
    #[serde(default)]
    vae: String,
    /// Telechargement automatique : uniquement pour les packs a fichier unique.
    #[serde(default)]
    url: String,
    /// LoRA de style pose sur le checkpoint, resolu dans `loras/`.
    #[serde(default)]
    lora: String,
    #[serde(default = "default_lora_weight", rename = "loraWeight")]
    lora_weight: f32,
    /// Texte ajoute devant chaque prompt pour activer le style (jeton declencheur).
    #[serde(default, rename = "promptPrefix")]
    prompt_prefix: String,
    #[serde(default)]
    lora_url: String,
}

fn default_cfg() -> f32 {
    1.0
}

fn default_lora_weight() -> f32 {
    0.8
}

#[derive(Deserialize)]
struct ImageCatalog {
    #[serde(default)]
    packs: Vec<ImagePack>,
}

impl ImagePack {
    fn file_names(&self) -> Vec<String> {
        let mut names = Vec::new();
        for value in [&self.model, &self.diffusion, &self.llm, &self.vae] {
            if !value.is_empty() {
                names.push(value.clone());
            }
        }
        names
    }

    fn steps_or(&self, fallback: u32) -> u32 {
        if self.steps > 0 { self.steps } else { fallback }
    }

    fn px_or(&self, fallback: u32) -> u32 {
        if self.px > 0 { self.px } else { fallback }
    }

    fn lora_file(&self) -> Option<&str> {
        if self.lora.is_empty() { None } else { Some(self.lora.as_str()) }
    }
}

/// Generateur d'images (stable-diffusion.cpp). Il partage le meme GPU que
/// llama-server : les deux ne tournent jamais en meme temps sur 6 Go de VRAM.
/// Le processus est demarre a la demande puis libere apres une periode d'inactivite.
struct ImageEngine {
    bin: Option<PathBuf>,
    /// Pourquoi le binaire ne peut pas demarrer sur ce systeme, s'il est present
    /// mais refuse par le chargeur dynamique (minos macOS, glibc Linux).
    probe: Option<String>,
    dir: PathBuf,
    packs: Vec<ImagePack>,
    selected: Option<String>,
    port: u16,
    child: Option<Child>,
    /// stopped | loading | ready | error
    state: String,
    message: String,
    last_used: Option<Instant>,
    size_override: Option<u32>,
    steps_override: Option<u32>,
}

impl ImageEngine {
    fn pack(&self, id: &str) -> Option<&ImagePack> {
        self.packs.iter().find(|pack| pack.id == id)
    }

    fn current(&self) -> Option<&ImagePack> {
        self.selected.as_deref().and_then(|id| self.pack(id))
    }

    fn path_of(&self, name: &str) -> PathBuf {
        self.dir.join(name)
    }

    fn loras_dir(&self) -> PathBuf {
        self.dir.join("loras")
    }

    fn missing_of(&self, pack: &ImagePack) -> Vec<String> {
        let mut missing: Vec<String> = pack
            .file_names()
            .into_iter()
            .filter(|name| !self.path_of(name).is_file())
            .collect();
        if let Some(lora) = pack.lora_file() {
            if !self.loras_dir().join(lora).is_file() {
                missing.push(format!("loras/{lora}"));
            }
        }
        missing
    }

    fn local_of(&self, pack: &ImagePack) -> bool {
        !pack.file_names().is_empty() && self.missing_of(pack).is_empty()
    }

    /// Un pack est disponible des que le binaire demarre et que tous ses
    /// fichiers sont la.
    fn available(&self) -> bool {
        self.bin.is_some()
            && self.probe.is_none()
            && self.current().map(|pack| self.local_of(pack)).unwrap_or(false)
    }

    fn missing_reason(&self) -> Option<String> {
        if self.bin.is_none() {
            return Some("sd-server introuvable (vendor/sd/<plateforme>/)".to_string());
        }
        if let Some(reason) = &self.probe {
            return Some(format!(
                "sd-server ne peut pas demarrer sur ce systeme : {reason} (voir les versions minimales du LISEZ-MOI)"
            ));
        }
        match self.current() {
            None => Some("aucun jeu de modeles d'image dans models/image/catalog.json".to_string()),
            Some(pack) => {
                let missing = self.missing_of(pack);
                if missing.is_empty() {
                    None
                } else {
                    Some(format!("fichiers absents : {}", missing.join(", ")))
                }
            }
        }
    }

    /// Choisit un pack disponible au demarrage : le dernier utilise, sinon le
    /// pack recommande s'il est complet, sinon le premier complet, sinon le premier declare.
    fn resolve_selection(&mut self) {
        if let Some(id) = self.selected.clone() {
            if self.pack(&id).is_some() {
                return;
            }
        }
        // Le choix fait dans l'interface survit au redemarrage. On ne le retient
        // que si le pack est toujours declare, pour ne pas bloquer sur un
        // catalogue modifie entre deux lancements.
        if let Some(saved) = read_image_selection(&self.dir) {
            if self.pack(&saved).is_some() {
                self.selected = Some(saved);
                return;
            }
        }
        self.selected = self
            .packs
            .iter()
            .find(|pack| pack.recommended && self.local_of(pack))
            .or_else(|| self.packs.iter().find(|pack| self.local_of(pack)))
            .or_else(|| self.packs.first())
            .map(|pack| pack.id.clone());
    }
}

#[derive(Clone, Deserialize)]
struct CatalogEntry {
    id: String,
    name: String,
    #[serde(default)]
    category: String,
    #[serde(default)]
    size: String,
    #[serde(default)]
    url: String,
    #[serde(default)]
    mirror: String,
    #[serde(default)]
    source: String,
    #[serde(default)]
    recommended: bool,
}

#[derive(Deserialize)]
struct Catalog {
    #[serde(default)]
    version: u32,
    #[serde(default, rename = "baseUrl")]
    base_url: String,
    models: Vec<CatalogEntry>,
}

#[derive(Clone)]
struct Progress {
    id: String,
    downloaded: u64,
    total: u64,
    stage: String,
    error: Option<String>,
}

struct AppState {
    web: PathBuf,
    models_dir: PathBuf,
    llama_port: u16,
    ctx_size: u32,
    llama_bin: PathBuf,
    image: ImageEngine,
    models: Vec<ModelEntry>,
    selected_model: String,
    running: Option<Running>,
    progress: Option<Progress>,
    catalog_base: String,
    catalog_version: u32,
    remote: Option<RemoteVersion>,
}

type Shared = Arc<Mutex<AppState>>;

fn main() {
    let mut web_arg: Option<String> = None;
    let mut model_arg: Option<String> = None;
    let mut llama_arg: Option<String> = None;
    let mut port_arg: Option<u16> = None;
    let mut ctx_arg: Option<u32> = None;
    let mut sd_arg: Option<String> = None;
    let mut image_port_arg: Option<u16> = None;
    let mut img_size_arg: Option<u32> = None;
    let mut img_steps_arg: Option<u32> = None;
    let mut no_browser = false;

    let mut args = env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--web" => web_arg = args.next(),
            "--model" => model_arg = args.next(),
            "--llama-server" => llama_arg = args.next(),
            "--sd-server" => sd_arg = args.next(),
            "--port" => port_arg = args.next().and_then(|value| value.parse().ok()),
            "--ctx" => ctx_arg = args.next().and_then(|value| value.parse().ok()),
            "--image-port" => image_port_arg = args.next().and_then(|value| value.parse().ok()),
            "--image-size" => img_size_arg = args.next().and_then(|value| value.parse().ok()),
            "--image-steps" => img_steps_arg = args.next().and_then(|value| value.parse().ok()),
            "--no-browser" => no_browser = true,
            "-h" | "--help" => {
                print_help();
                return;
            }
            other => eprintln!("Argument inconnu, ignore : {other}"),
        }
    }

    let Some(web) = find_web(web_arg.as_deref()) else {
        fail("Interface SIMIA introuvable. Utilisez --web <dossier contenant index.html et app.js>.");
    };

    let models_dir = find_models_dir(&web);
    let (catalog, catalog_base, catalog_version) = load_catalog(&models_dir);
    let models = build_model_list(&models_dir, &catalog, &catalog_base);
    if models.is_empty() {
        fail("Aucun modele disponible. Placez un fichier GGUF dans models/ ou verifiez models/catalog.json.");
    }
    let hosted_count = models.iter().filter(|model| model.hosted).count();

    let Some(llama_bin) = find_llama_server(llama_arg.as_deref()) else {
        fail("llama-server introuvable. Placez-le dans vendor/llama/<plateforme>/ ou utilisez --llama-server <chemin>.");
    };

    let ui_port = pick_port(port_arg.unwrap_or(DEFAULT_UI_PORT));
    let llama_port = pick_port(ui_port.wrapping_add(1));
    let image_port = match image_port_arg {
        Some(port) => pick_port(port),
        None => pick_port(llama_port.wrapping_add(1)),
    };
    let size_override = img_size_arg;
    let steps_override = img_steps_arg;
    let ctx_size = ctx_arg.unwrap_or(DEFAULT_CTX_SIZE).clamp(MIN_CTX_SIZE, 32768);
    // Au demarrage, on ne peut charger qu'un modele deja present sur le disque.
    let start = match model_arg.as_deref().and_then(|value| {
        models
            .iter()
            .find(|model| model.id == value || model.name.eq_ignore_ascii_case(value))
            .cloned()
    }) {
        Some(model) if model.local => model,
        _ => choose_default(&models),
    };
    if !start.local {
        let url = start.url.clone().unwrap_or_default();
        if url.is_empty() {
            fail("Aucun modele local et aucune URL de telechargement dans catalog.json.");
        }
        println!("Premier lancement : telechargement de {} ({}).", start.name, start.size);
        if let Err(err) = download_model(&start, &models_dir, |downloaded, total| {
            let pct = if total > 0 { downloaded * 100 / total } else { 0 };
            print!("\r  {} % ({} / {})      ", pct, human_size(downloaded), human_size(total));
            let _ = std::io::stdout().flush();
        }) {
            fail(&format!("Telechargement impossible : {err}"));
        }
        println!();
    }
    let start = if start.local {
        start
    } else {
        models
            .iter()
            .find(|model| model.id == start.id)
            .map(|model| ModelEntry { local: true, ..model.clone() })
            .unwrap_or(start)
    };
    let local_count = models.iter().filter(|model| model.local).count();
    let catalog_bytes: u64 = models.iter().map(|model| model.bytes).sum();

    println!("SIMIA Desktop {APP_VERSION}");
    println!("  interface   : {}", web.display());
    println!("  llama-server: {}", llama_bin.display());
    println!(
        "  modeles     : {local_count} local(aux) / {} au catalogue ({})",
        models.len(),
        human_size(catalog_bytes)
    );
    println!("  hebergement : {hosted_count} sur le serveur, {} en CDN", models.len() - hosted_count);
    if !catalog_base.is_empty() {
        println!("  catalogue   : v{catalog_version} ({catalog_base})");
    }
    println!("  backend     : 127.0.0.1:{llama_port}");
    println!("  contexte    : {ctx_size} tokens");

    let (mut child, llama_log) = match spawn_llama(&llama_bin, &start.path, start.mmproj.as_deref(), llama_port, ctx_size) {
        Ok(pair) => pair,
        Err(err) => fail(&format!("Impossible de demarrer llama-server : {err}")),
    };
    let pid_file = write_pid_file(llama_port, child.id());

    println!("Chargement de {} dans le GPU.", start.name);
    if let Err(reason) = wait_healthy(&mut child, llama_port, &llama_log) {
        let _ = fs::remove_file(&pid_file);
        fail(&format!(
            "{reason}\n\nVerifiez que le GPU est disponible (pilote Vulkan / Metal), que le modele n'est pas corrompu, et que le systeme satisfait les versions minimales indiquees dans le LISEZ-MOI."
        ));
    }

    let sd_bin = find_sd_server(sd_arg.as_deref());
    // Sonde une seule fois au demarrage : « sd-server --help » sort en quelques
    // millisecondes et ne charge aucun poids. C'est le moyen le moins couteux de
    // savoir si le chargeur dynamique accepte le binaire sur ce systeme.
    let sd_probe = sd_bin
        .as_ref()
        .and_then(|bin| probe_binary(bin, "--help", Duration::from_secs(15)).err());
    let image_dir = models_dir.join("image");
    let image_packs = load_image_packs(&image_dir);
    let mut image_engine = ImageEngine {
        bin: sd_bin,
        probe: sd_probe,
        dir: image_dir,
        packs: image_packs,
        selected: None,
        port: image_port,
        child: None,
        state: "stopped".to_string(),
        message: String::new(),
        last_used: None,
        size_override,
        steps_override,
    };
    image_engine.resolve_selection();
    let image_available = image_engine.available();
    let image_label = image_engine
        .current()
        .map(|pack| pack.name.clone())
        .unwrap_or_default();

    let state: Shared = Arc::new(Mutex::new(AppState {
        web,
        models_dir,
        llama_port,
        ctx_size,
        llama_bin: llama_bin.clone(),
        image: image_engine,
        models,
        selected_model: start.id.clone(),
        running: Some(Running { child, model_id: start.id.clone() }),
        progress: None,
        catalog_base: catalog_base.clone(),
        catalog_version,
        remote: None,
    }));

    println!(
        "  images      : {}",
        if image_available {
            format!("{image_label} sur 127.0.0.1:{image_port}")
        } else {
            "indisponibles (voir la bibliotheque : Image)".to_string()
        }
    );

    // Rendu du GPU : apres IMAGE_IDLE le generateur d'images est libere pour
    // que llama-server puisse reprendre la main sans attente.
    {
        let watcher = Arc::clone(&state);
        thread::spawn(move || loop {
            thread::sleep(Duration::from_secs(20));
            let expire = match watcher.lock() {
                Ok(guard) => match (guard.image.state.as_str(), guard.image.last_used) {
                    ("ready", Some(used)) => used.elapsed() >= IMAGE_IDLE,
                    _ => false,
                },
                Err(_) => false,
            };
            if expire {
                stop_image(&watcher);
            }
        });
    }

    // Veille de version non bloquante : le serveur publie versions.json.
    if !catalog_base.is_empty() {
        let remote = Arc::clone(&state);
        let base = catalog_base.clone();
        thread::spawn(move || {
            if let Some(found) = fetch_remote_version(&base) {
                if let Ok(mut guard) = remote.lock() {
                    guard.remote = Some(found);
                }
            }
        });
    }

    let url = format!("http://127.0.0.1:{ui_port}/");
    if !no_browser {
        match launch_browser(&url) {
            Some(_) => println!("Fenetre applicative ouverte : {url}"),
            None => println!("Ouvrez SIMIA dans votre navigateur : {url}"),
        }
    } else {
        println!("Interface disponible sur {url}");
    }
    println!("Changez de modele depuis la bibliotheque de SIMIA.");
    println!("Fermez cette fenetre ou appuyez sur Ctrl+C pour quitter.");

    let server = match Server::http(("127.0.0.1", ui_port)) {
        Ok(server) => server,
        Err(err) => {
            shutdown(&state);
            let _ = fs::remove_file(&pid_file);
            fail(&format!("Impossible d'ecouter sur le port {ui_port} : {err}"));
        }
    };

    for request in server.incoming_requests() {
        let state = Arc::clone(&state);
        let llama_bin = llama_bin.clone();
        thread::spawn(move || handle(state, llama_bin, request));
    }

    shutdown(&state);
    let _ = fs::remove_file(&pid_file);
}

fn print_help() {
    println!("SIMIA Desktop {APP_VERSION}");
    println!("  --web <dossier>         interface a servir (defaut : detection automatique)");
    println!("  --model <fichier.gguf>  modele charge au demarrage");
    println!("  --llama-server <chemin> binaire llama-server");
    println!("  --port <port>           port de l'interface (defaut : {DEFAULT_UI_PORT})");
    println!("  --ctx <tokens>          taille du contexte (defaut : {DEFAULT_CTX_SIZE}, min {MIN_CTX_SIZE})");
    println!("  --sd-server <chemin>    binaire sd-server (generation d'images)");
    println!("  --image-port <port>     port du generateur d'images (defaut : port llama + 1)");
    println!("  --image-size <pixels>   largeur et hauteur (defaut : {DEFAULT_IMG_WIDTH})");
    println!("  --image-steps <n>       pas de diffusion (defaut : {DEFAULT_IMG_STEPS})");
    println!("  --no-browser            ne pas ouvrir de fenetre");
}

fn fail(message: &str) -> ! {
    eprintln!("Erreur : {message}");
    std::process::exit(1)
}

fn write_pid_file(port: u16, pid: u32) -> PathBuf {
    let path = env::temp_dir().join(format!("simia-desktop-{port}.pid"));
    let _ = fs::write(&path, pid.to_string());
    path
}

fn shutdown(state: &Shared) {
    if let Ok(mut guard) = state.lock() {
        if let Some(mut child) = guard.image.child.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
        if let Some(mut running) = guard.running.take() {
            let _ = running.child.kill();
            let _ = running.child.wait();
        }
    }
}

// --------------------------------------------------------------------------
// Decouverte des fichiers
// --------------------------------------------------------------------------

fn exe_dir() -> PathBuf {
    env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(Path::to_path_buf))
        .unwrap_or_else(|| PathBuf::from("."))
}

fn looks_like_web(dir: &Path) -> bool {
    dir.join("index.html").is_file() && dir.join("app.js").is_file()
}

fn walk_up(start: &Path) -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    let mut current = start.to_path_buf();
    for _ in 0..HEURISTIC_WALK_UP {
        dirs.push(current.clone());
        if !current.pop() {
            break;
        }
    }
    dirs
}

fn find_web(explicit: Option<&str>) -> Option<PathBuf> {
    if let Some(value) = explicit {
        let dir = PathBuf::from(value);
        if looks_like_web(&dir) {
            return Some(dir);
        }
    }
    for base in walk_up(&exe_dir()) {
        for candidate in [base.clone(), base.join("web"), base.join("SIMIA")] {
            if looks_like_web(&candidate) {
                return Some(candidate);
            }
        }
    }
    let cwd = env::current_dir().ok()?;
    if looks_like_web(&cwd) {
        return Some(cwd);
    }
    None
}

fn model_binary_name() -> &'static str {
    if cfg!(windows) {
        "llama-server.exe"
    } else {
        "llama-server"
    }
}

fn find_llama_server(explicit: Option<&str>) -> Option<PathBuf> {
    if let Some(value) = explicit {
        let path = PathBuf::from(value);
        if path.is_file() {
            return Some(path);
        }
    }
    let mut found = Vec::new();
    for base in walk_up(&exe_dir()) {
        collect_binaries(&base.join("vendor").join("llama"), 0, &mut found);
    }
    let prefer = if cfg!(windows) {
        "win"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else {
        "ubuntu"
    };
    found.sort_by_key(|path| {
        let text = path.to_string_lossy().to_lowercase();
        if text.contains(prefer) {
            0
        } else {
            1
        }
    });
    found.into_iter().next()
}

fn image_binary_name() -> &'static str {
    if cfg!(windows) {
        "sd-server.exe"
    } else {
        "sd-server"
    }
}

fn find_sd_server(explicit: Option<&str>) -> Option<PathBuf> {
    if let Some(value) = explicit {
        let path = PathBuf::from(value);
        if path.is_file() {
            return Some(path);
        }
    }
    let mut found = Vec::new();
    for base in walk_up(&exe_dir()) {
        collect_named(&base.join("vendor").join("sd"), 0, image_binary_name(), &mut found);
    }
    found.into_iter().next()
}

fn collect_named(dir: &Path, depth: usize, name: &str, out: &mut Vec<PathBuf>) {
    if depth > 4 {
        return;
    }
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_named(&path, depth + 1, name, out);
        } else if path.file_name().map(|value| value == name).unwrap_or(false) {
            out.push(path);
        }
    }
}

/// Le pack d'images choisi est memorise dans `models/image/selected.json`, sinon
/// l'utilisateur retrouverait le pack recommande a chaque redemarrage.
fn image_selection_path(dir: &Path) -> PathBuf {
    dir.join("selected.json")
}

fn save_image_selection(dir: &Path, id: &str) {
    if fs::create_dir_all(dir).is_err() {
        return;
    }
    let body = format!("{{\"id\":{}}}\n", js_escape(id));
    let _ = fs::write(image_selection_path(dir), body);
}

fn read_image_selection(dir: &Path) -> Option<String> {
    let text = fs::read_to_string(image_selection_path(dir)).ok()?;
    let value: serde_json::Value = serde_json::from_str(&text).ok()?;
    let id = value.get("id")?.as_str()?.trim().to_string();
    if id.is_empty() { None } else { Some(id) }
}

/// Lit `models/image/catalog.json`. Un pack sans fichier exploitable est ignore
/// pour eviter une carte vide dans l'interface.
fn load_image_packs(dir: &Path) -> Vec<ImagePack> {
    let path = dir.join("catalog.json");
    let Ok(text) = fs::read_to_string(&path) else {
        return Vec::new();
    };
    match serde_json::from_str::<ImageCatalog>(&text) {
        Ok(catalog) => catalog
            .packs
            .into_iter()
            .filter(|pack| !pack.file_names().is_empty())
            .collect(),
        Err(error) => {
            eprintln!("models/image/catalog.json invalide ({error})");
            Vec::new()
        }
    }
}

fn pack_bytes(dir: &Path, pack: &ImagePack) -> u64 {
    let mut total: u64 = pack
        .file_names()
        .iter()
        .filter_map(|name| fs::metadata(dir.join(name)).ok())
        .map(|meta| meta.len())
        .sum();
    if let Some(lora) = pack.lora_file() {
        if let Ok(meta) = fs::metadata(dir.join("loras").join(lora)) {
            total += meta.len();
        }
    }
    total
}

fn collect_binaries(dir: &Path, depth: usize, out: &mut Vec<PathBuf>) {    if depth > 4 {
        return;
    }
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_binaries(&path, depth + 1, out);
        } else if path
            .file_name()
            .map(|name| name == model_binary_name())
            .unwrap_or(false)
        {
            out.push(path);
        }
    }
}

fn find_models_dir(web: &Path) -> PathBuf {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Some(parent) = web.parent() {
        candidates.push(parent.join("models"));
    }
    for base in walk_up(&exe_dir()) {
        candidates.push(base.join("models"));
    }
    candidates.push(exe_dir().join("models"));
    for candidate in &candidates {
        if candidate.join("catalog.json").is_file() || candidate.is_dir() {
            return candidate.clone();
        }
    }
    let fallback = candidates.first().cloned().unwrap_or_else(|| PathBuf::from("models"));
    let _ = fs::create_dir_all(&fallback);
    fallback
}

fn load_catalog(dir: &Path) -> (Vec<CatalogEntry>, String, u32) {
    let path = dir.join("catalog.json");
    let Ok(text) = fs::read_to_string(&path) else {
        eprintln!("catalog.json introuvable : {}", path.display());
        return (Vec::new(), String::new(), 0);
    };
    match serde_json::from_str::<Catalog>(&text) {
        Ok(catalog) => (catalog.models, catalog.base_url, catalog.version),
        Err(err) => {
            eprintln!("catalog.json invalide ({err}) : {}", path.display());
            (Vec::new(), String::new(), 0)
        }
    }
}

/// Le serveur heberge les modeles principaux : on tente `baseUrl + id.gguf` d'abord,
/// puis le miroir CDN. Les autres modeles passent directement par le CDN.
fn model_urls(model: &ModelEntry) -> Vec<String> {
    let mut urls = Vec::new();
    if model.hosted {
        if let Some(base) = model.url.as_ref() {
            urls.push(base.clone());
        }
        if let Some(mirror) = model.mirror.as_ref() {
            urls.push(mirror.clone());
        }
    } else if let Some(url) = model.url.as_ref() {
        urls.push(url.clone());
    } else if let Some(mirror) = model.mirror.as_ref() {
        urls.push(mirror.clone());
    }
    urls
}

/// Fusionne le catalogue distant et les fichiers reellement presents sur le disque.
fn build_model_list(dir: &Path, catalog: &[CatalogEntry], base: &str) -> Vec<ModelEntry> {
    let mut models: Vec<ModelEntry> = Vec::new();
    for entry in catalog {
        let path = dir.join(format!("{}.gguf", entry.id));
        let local = path.is_file();
        let hosted = entry.source == "server";
        let bytes = if local {
            total_gguf_bytes(&path)
        } else {
            parse_size(&entry.size)
        };
        let size = if local {
            format!("~{}", human_size(bytes))
        } else if entry.size.is_empty() {
            String::new()
        } else {
            entry.size.clone()
        };
        // Modeles heberges : le serveur d'abord, le CDN en secours.
        let primary = if hosted && !base.is_empty() {
            Some(format!("{}{}.gguf", base, entry.id))
        } else if !entry.url.is_empty() {
            Some(entry.url.clone())
        } else {
            None
        };
        let mirror = if !entry.mirror.is_empty() {
            Some(entry.mirror.clone())
        } else if hosted && !entry.url.is_empty() {
            Some(entry.url.clone())
        } else {
            None
        };
        models.push(ModelEntry {
            id: entry.id.clone(),
            name: entry.name.clone(),
            category: if entry.category.is_empty() { "Généraliste".to_string() } else { entry.category.clone() },
            size,
            path,
            bytes,
            local,
            url: primary,
            mirror,
            hosted,
            recommended: entry.recommended,
            mmproj: find_mmproj(&dir.join(format!("{}.gguf", entry.id))),
        });
    }

    // Modeles poses a la main dans models/ et absents du catalogue.
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|ext| ext.to_str()).map(|ext| ext.eq_ignore_ascii_case("gguf")) != Some(true) {
                continue;
            }
            let stem = path.file_stem().and_then(|value| value.to_str()).unwrap_or("model").to_string();
            if models.iter().any(|model| model.id == stem) || stem.contains("mmproj") {
                continue;
            }
            models.push(describe_model(&path));
        }
    }

    models.sort_by(|a, b| {
        a.category
            .cmp(&b.category)
            .then_with(|| a.bytes.cmp(&b.bytes))
    });
    models
}

/// "~1.2 GB" -> octets approximatifs, pour afficher une taille avant telechargement.
fn parse_size(value: &str) -> u64 {
    let cleaned = value.replace('~', "").replace(',', ".");
    let parts: Vec<&str> = cleaned.split_whitespace().collect();
    if parts.len() < 2 {
        return 0;
    }
    let number: f64 = parts[0].parse().unwrap_or(0.0);
    let unit = parts[1].to_uppercase();
    let factor = if unit.starts_with("GB") {
        1024.0 * 1024.0 * 1024.0
    } else if unit.starts_with("MB") {
        1024.0 * 1024.0
    } else {
        1.0
    };
    (number * factor) as u64
}

fn describe_model(path: &Path) -> ModelEntry {
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("model")
        .to_string();
    let (name, quant) = split_quant(&stem);
    let bytes = total_gguf_bytes(path);
    let size = match quant {
        Some(quant) => format!("~{} ({quant})", human_size(bytes)),
        None => format!("~{}", human_size(bytes)),
    };
    ModelEntry {
        id: stem,
        name,
        category: "Généraliste".to_string(),
        size,
        path: path.to_path_buf(),
        bytes,
        local: true,
        url: None,
        mirror: None,
        hosted: false,
        recommended: false,
        mmproj: find_mmproj(path),
    }
}

/// Associe un modele a son projecteur multimodal. Le rapprochement se fait sur
/// le nom : un mmproj ne doit jamais etre donne a un modele texte, sinon
/// llama-server refuse de demarrer.
fn find_mmproj(model_path: &Path) -> Option<PathBuf> {
    let dir = model_path.parent()?;
    let stem = normalize_key(model_path.file_stem()?.to_str()?);
    if stem.is_empty() {
        return None;
    }
    for entry in fs::read_dir(dir).ok()?.flatten() {
        let candidate = entry.path();
        let name = candidate.file_name().and_then(|value| value.to_str()).unwrap_or("");
        if !name.to_lowercase().ends_with(".gguf") || !name.to_lowercase().starts_with("mmproj") {
            continue;
        }
        if normalize_key(name).contains(&stem) {
            return Some(candidate);
        }
    }
    None
}

fn normalize_key(value: &str) -> String {
    value
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .map(|character| character.to_ascii_lowercase())
        .collect()
}

/// Pour un fichier decoupe en parties, additionne la taille de toutes les parties.
fn total_gguf_bytes(path: &Path) -> u64 {
    let name = path.file_name().and_then(|value| value.to_str()).unwrap_or("");
    if !name.contains("-00001-of-") {
        return fs::metadata(path).map(|meta| meta.len()).unwrap_or(0);
    }
    let dir = path.parent().unwrap_or_else(|| Path::new("."));
    let prefix = name.split("-00001-of-").next().unwrap_or("");
    fs::read_dir(dir)
        .map(|entries| {
            entries
                .flatten()
                .filter(|entry| {
                    entry
                        .file_name()
                        .to_str()
                        .map(|file| file.starts_with(prefix))
                        .unwrap_or(false)
                })
                .filter_map(|entry| fs::metadata(entry.path()).ok())
                .map(|meta| meta.len())
                .sum()
        })
        .unwrap_or(0)
}

/// Separe le nom lisible de son suffixe de quantification (Q4_K_M, IQ3_XS, F16...).
fn split_quant(stem: &str) -> (String, Option<String>) {
    let parts: Vec<&str> = stem.split('-').collect();
    if parts.len() < 2 {
        return (stem.replace(['_', '-'], " "), None);
    }
    let mut end = parts.len();
    while end > 1 && is_quant_part(parts[end - 1]) {
        end -= 1;
    }
    if end == parts.len() {
        return (parts.join(" "), None);
    }
    let quant = parts[end..].join("_");
    (parts[..end].join(" "), Some(quant))
}

fn is_quant_part(part: &str) -> bool {
    let lower = part.to_lowercase();
    let quant_prefix = lower.starts_with('q') || lower.starts_with("iq");
    let known = ["f16", "f32", "bf16", "fp16", "gguf"];
    quant_prefix || known.contains(&lower.as_str())
}

fn human_size(bytes: u64) -> String {
    let mb = bytes as f64 / (1024.0 * 1024.0);
    if mb >= 1024.0 {
        format!("{:.1} GB", mb / 1024.0)
    } else if mb >= 1.0 {
        format!("{:.0} MB", mb)
    } else {
        "0 MB".to_string()
    }
}

fn choose_default(models: &[ModelEntry]) -> ModelEntry {
    for preferred in PREFERRED_DEFAULTS {
        if let Some(found) = models
            .iter()
            .filter(|model| model.local)
            .find(|model| model.id.to_lowercase().contains(preferred))
        {
            return found.clone();
        }
    }
    if let Some(found) = models
        .iter()
        .filter(|model| model.local)
        .min_by_key(|model| model.bytes)
    {
        return found.clone();
    }
    models.first().cloned().expect("au moins un modele")
}

/// Telecharge un modele avec curl (present sur Windows 10+, macOS et Linux).
/// Plusieurs sources sont essayees dans l'ordre : serveur zigmoon.com puis CDN.
fn download_model<F>(model: &ModelEntry, dir: &Path, mut on_progress: F) -> Result<(), String>
where
    F: FnMut(u64, u64),
{
    let urls = model_urls(model);
    if urls.is_empty() {
        return Err(format!("aucune source pour {}", model.name));
    }
    let _ = fs::create_dir_all(dir);
    // Le chemin declare fait foi : les packs d'images rangent leurs poids dans un
    // sous-dossier (sd15/, sdturbo/...), contrairement aux modeles de texte.
    let target = if model.path.as_os_str().is_empty() {
        dir.join(format!("{}.gguf", model.id))
    } else {
        model.path.clone()
    };
    if let Some(parent) = target.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let partial = target.with_extension("part");
    let total = if model.bytes > 0 {
        model.bytes
    } else {
        parse_size(&model.size)
    };

    let mut last_error = String::new();
    for url in urls {
        let mut command = Command::new(if cfg!(windows) { "curl.exe" } else { "curl" });
        command
            .arg("-L")
            .arg("--fail")
            .arg("--retry")
            .arg("2")
            .arg("--connect-timeout")
            .arg("20")
            .arg("-o")
            .arg(&partial)
            .arg(&url)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            command.creation_flags(CREATE_NO_WINDOW);
        }

        let mut child = match command.spawn() {
            Ok(child) => child,
            Err(err) => {
                last_error = format!("curl indisponible : {err}");
                continue;
            }
        };
        let mut failed = false;
        loop {
            match child.try_wait() {
                Ok(Some(status)) => {
                    if !status.success() {
                        failed = true;
                    }
                    break;
                }
                Ok(None) => {
                    let downloaded = fs::metadata(&partial).map(|meta| meta.len()).unwrap_or(0);
                    on_progress(downloaded, total);
                    thread::sleep(Duration::from_millis(500));
                }
                Err(err) => {
                    let _ = child.kill();
                    last_error = err.to_string();
                    failed = true;
                    break;
                }
            }
        }

        if failed {
            let _ = fs::remove_file(&partial);
            continue;
        }
        fs::rename(&partial, &target).map_err(|err| format!("fichier non deplacable : {err}"))?;
        on_progress(total, total);
        return Ok(());
    }

    Err(if last_error.is_empty() {
        "toutes les sources ont echoue".to_string()
    } else {
        last_error
    })
}

/// Le serveur publie versions.json a cote des modeles : version, date et notes.
fn fetch_remote_version(base: &str) -> Option<RemoteVersion> {
    let url = format!("{}versions.json", base);
    let output = Command::new(if cfg!(windows) { "curl.exe" } else { "curl" })
        .arg("-sL")
        .arg("--fail")
        .arg("--max-time")
        .arg("15")
        .arg(&url)
        .output();
    let output = output.ok()?;
    if !output.status.success() {
        return Some(RemoteVersion { reachable: false, ..Default::default() });
    }
    let text = String::from_utf8_lossy(&output.stdout).to_string();
    let value: serde_json::Value = serde_json::from_str(&text).ok()?;
    let field = |key: &str| {
        value
            .get(key)
            .and_then(|item| item.as_str().map(|text| text.to_string()))
            .or_else(|| value.get(key).and_then(|item| item.as_u64().map(|number| number.to_string())))
            .unwrap_or_default()
    };
    Some(RemoteVersion {
        version: field("version"),
        published: field("published"),
        notes: field("notes"),
        reachable: true,
    })
}


// --------------------------------------------------------------------------
// Ports et cycle de vie du sidecar
// --------------------------------------------------------------------------

fn pick_port(preferred: u16) -> u16 {
    for offset in 0..12u16 {
        let port = preferred.saturating_add(offset);
        if TcpListener::bind(("127.0.0.1", port)).is_ok() {
            return port;
        }
    }
    TcpListener::bind("127.0.0.1:0")
        .ok()
        .and_then(|listener| listener.local_addr().ok())
        .map(|addr| addr.port())
        .unwrap_or(preferred)
}

/// Arrete le modele de langage sans oublier lequel etait charge : le GPU est
/// prete au generateur d'images, puis rendu a la premiere requete de texte.
fn stop_llama(state: &Shared) {
    if let Ok(mut guard) = state.lock() {
        if let Some(mut running) = guard.running.take() {
            let _ = running.child.kill();
            let _ = running.child.wait();
        }
    }
}

/// Relance llama-server sur le modele selectionne s'il ne tourne plus.
fn ensure_llama(state: &Shared) -> Result<(), String> {
    let (model_id, bin, port, ctx, already) = {
        let guard = state.lock().map_err(|_| "etat verrouille".to_string())?;
        (
            guard.selected_model.clone(),
            guard.llama_bin.clone(),
            guard.llama_port,
            guard.ctx_size,
            guard.running.is_some(),
        )
    };
    if already {
        return Ok(());
    }
    stop_image(state);
    let (path, mmproj) = {
        let guard = state.lock().map_err(|_| "etat verrouille".to_string())?;
        let entry = guard
            .models
            .iter()
            .find(|model| model.id == model_id)
            .ok_or_else(|| format!("modele inconnu : {model_id}"))?;
        (entry.path.clone(), entry.mmproj.clone())
    };
    let (mut child, log_path) = spawn_llama(&bin, &path, mmproj.as_deref(), port, ctx)
        .map_err(|error| format!("demarrage impossible : {error}"))?;
    if let Err(reason) = wait_healthy(&mut child, port, &log_path) {
        let _ = child.kill();
        let _ = child.wait();
        return Err(reason);
    }
    if let Ok(mut guard) = state.lock() {
        guard.running = Some(Running { child, model_id });
    }
    Ok(())
}

fn spawn_sd_server(
    bin: &Path,
    pack: &ImagePack,
    dir: &Path,
    port: u16,
    steps: u32,
    size: u32,
) -> std::io::Result<Child> {
    let mut command = Command::new(bin);
    if pack.mode == "zimage" {
        command
            .arg("--diffusion-model")
            .arg(dir.join(&pack.diffusion))
            .arg("--llm")
            .arg(dir.join(&pack.llm))
            .arg("--vae")
            .arg(dir.join(&pack.vae))
            // Sans ce drapeau, le DiT et l'encodeur ne tiennent pas ensemble dans 6 Go.
            .arg("--offload-to-cpu")
            .arg("--vae-tiling");
    } else {
        command.arg("-m").arg(dir.join(&pack.model));
    }
    if pack.lora_file().is_some() {
        command.arg("--lora-model-dir").arg(dir.join("loras"));
    }
    command
        .arg("--steps")
        .arg(steps.to_string())
        .arg("-W")
        .arg(size.to_string())
        .arg("-H")
        .arg(size.to_string())
        .arg("--listen-ip")
        .arg("127.0.0.1")
        .arg("--listen-port")
        .arg(port.to_string())
        .arg("--log-level")
        .arg("warn")
        .current_dir(bin.parent().unwrap_or_else(|| Path::new(".")))
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command.spawn()
}

fn stop_image(state: &Shared) {
    if let Ok(mut guard) = state.lock() {
        if let Some(mut child) = guard.image.child.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
        guard.image.state = "stopped".to_string();
        guard.image.message.clear();
        guard.image.last_used = None;
    }
}

/// Demarre sd-server en tache de fond : le chargement de 6 Go de poids prend
/// plusieurs dizaines de secondes, la page interroge l'etat pendant ce temps.
fn start_image(state: &Shared) -> String {
    let (bin, pack, dir, port, steps, size) = {
        let guard = match state.lock() {
            Ok(guard) => guard,
            Err(_) => return "error".to_string(),
        };
        if guard.image.state == "ready" || guard.image.state == "loading" {
            return guard.image.state.clone();
        }
        if let Some(reason) = guard.image.missing_reason() {
            drop(guard);
            if let Ok(mut guard) = state.lock() {
                guard.image.state = "error".to_string();
                guard.image.message = reason;
            }
            return "error".to_string();
        }
        let pack = match guard.image.current().cloned() {
            Some(pack) => pack,
            None => return "error".to_string(),
        };
        let steps = guard.image.steps_override.unwrap_or(pack.steps_or(DEFAULT_IMG_STEPS));
        let size = guard.image.size_override.unwrap_or(pack.px_or(DEFAULT_IMG_WIDTH));
        (
            guard.image.bin.clone().unwrap(),
            pack,
            guard.image.dir.clone(),
            guard.image.port,
            steps,
            size,
        )
    };

    stop_llama(state);
    if let Ok(mut guard) = state.lock() {
        guard.image.state = "loading".to_string();
        guard.image.message = "chargement du modele d'image".to_string();
    }

    let shared = Arc::clone(state);
    thread::spawn(move || {
        let child = match spawn_sd_server(&bin, &pack, &dir, port, steps, size) {
            Ok(child) => child,
            Err(error) => {
                if let Ok(mut guard) = shared.lock() {
                    guard.image.state = "error".to_string();
                    guard.image.message = format!("sd-server n'a pas demarre : {error}");
                }
                return;
            }
        };
        if let Ok(mut guard) = shared.lock() {
            guard.image.child = Some(child);
        }
        let deadline = Instant::now() + Duration::from_secs(600);
        while Instant::now() < deadline {
            if let Ok((200, _, body)) =
                http_call(port, "GET", "/sdcpp/v1/models/status", None, Duration::from_secs(4))
            {
                let text = String::from_utf8_lossy(&body).to_lowercase();
                if text.contains("\"ready\"") {
                    if let Ok(mut guard) = shared.lock() {
                        guard.image.state = "ready".to_string();
                        guard.image.message.clear();
                        guard.image.last_used = Some(Instant::now());
                    }
                    return;
                }
                if text.contains("\"error\"") && !text.contains("\"error\":null") {
                    if let Ok(mut guard) = shared.lock() {
                        guard.image.state = "error".to_string();
                        guard.image.message = "le modele d'image a signale une erreur".to_string();
                    }
                    return;
                }
            }
            let exited = {
                match shared.lock() {
                    Ok(mut guard) => match guard.image.child.as_mut() {
                        Some(child) => matches!(child.try_wait(), Ok(Some(_))),
                        None => true,
                    },
                    Err(_) => true,
                }
            };
            if exited {
                if let Ok(mut guard) = shared.lock() {
                    if guard.image.state == "loading" {
                        guard.image.state = "error".to_string();
                        guard.image.message =
                            "sd-server s'est arrete (VRAM insuffisante ?)".to_string();
                        guard.image.child = None;
                    }
                }
                return;
            }
            thread::sleep(Duration::from_millis(800));
        }
        if let Ok(mut guard) = shared.lock() {
            guard.image.state = "error".to_string();
            guard.image.message = "le modele d'image n'a pas fini de charger".to_string();
        }
    });
    "loading".to_string()
}

fn image_status_json(state: &Shared) -> String {
    match state.lock() {
        Ok(guard) => {
            let missing = guard.image.missing_reason();
            let available = missing.is_none();
            let pack = guard.image.current();
            let steps = pack.map(|item| guard.image.steps_override.unwrap_or(item.steps_or(DEFAULT_IMG_STEPS))).unwrap_or(0);
            let size = pack.map(|item| guard.image.size_override.unwrap_or(item.px_or(DEFAULT_IMG_WIDTH))).unwrap_or(0);
            format!(
                "{{\"available\":{},\"state\":{},\"message\":{},\"width\":{},\"height\":{},\"steps\":{},\"cfg\":{},\"pack\":{},\"reason\":{}}}",
                available,
                js_escape(&guard.image.state),
                js_escape(&guard.image.message),
                size,
                size,
                steps,
                pack.map(|item| item.cfg).unwrap_or(1.0),
                match pack {
                    Some(item) => js_escape(&item.id),
                    None => "null".to_string(),
                },
                match missing {
                    Some(reason) => js_escape(&reason),
                    None => "null".to_string(),
                }
            )
        }
        Err(_) => "{\"available\":false,\"state\":\"error\"}".to_string(),
    }
}

fn image_packs_json(state: &Shared) -> String {
    match state.lock() {
        Ok(guard) => {
            let selected = guard.image.selected.clone().unwrap_or_default();
            let entries = guard
                .image
                .packs
                .iter()
                .map(|pack| {
                    let local = guard.image.local_of(pack);
                    let bytes = pack_bytes(&guard.image.dir, pack);
                    format!(
                        "{{\"id\":{},\"name\":{},\"mode\":{},\"size\":{},\"note\":{},\"license\":{},\"steps\":{},\"cfg\":{},\"px\":{},\"local\":{},\"bytes\":{},\"downloadable\":{},\"recommended\":{},\"lora\":{},\"loraWeight\":{},\"promptPrefix\":{}}}",
                        js_escape(&pack.id),
                        js_escape(&pack.name),
                        js_escape(&pack.mode),
                        js_escape(&pack.size),
                        js_escape(&pack.note),
                        js_escape(&pack.license),
                        pack.steps,
                        pack.cfg,
                        pack.px,
                        local,
                        bytes,
                        local == false && (!pack.url.is_empty() || !pack.lora_url.is_empty()),
                        pack.recommended,
                        js_escape(&pack.lora),
                        pack.lora_weight,
                        js_escape(&pack.prompt_prefix)
                    )
                })
                .collect::<Vec<_>>()
                .join(",");
            format!(
                "{{\"selected\":{},\"bin\":{},\"packs\":[{}]}}",
                js_escape(&selected),
                guard.image.bin.is_some(),
                entries
            )
        }
        Err(_) => "{\"selected\":\"\",\"packs\":[]}".to_string(),
    }
}

/// Bascule le pack d'images. Le processus tourne peut-etre encore : on l'arrete
/// pour que le prochain chargement prenne les bons fichiers.
fn select_image_pack(state: &Shared, id: &str) -> Result<(), String> {
    let exists = match state.lock() {
        Ok(guard) => guard.image.pack(id).is_some(),
        Err(_) => false,
    };
    if !exists {
        return Err(format!("jeu d'images inconnu : {id}"));
    }
    stop_image(state);
    if let Ok(mut guard) = state.lock() {
        guard.image.selected = Some(id.to_string());
        guard.image.state = "stopped".to_string();
        guard.image.message.clear();
        save_image_selection(&guard.image.dir, id);
    }
    Ok(())
}

/// Telecharge un fichier d'un pack vers `dest` en suivant la progression.
fn fetch_pack_file(
    state: &Shared,
    id: &str,
    pack: &ImagePack,
    dest: &Path,
    url: &str,
    total: u64,
) -> Result<(), String> {
    let entry = ModelEntry {
        id: id.to_string(),
        name: pack.name.clone(),
        category: "Image".to_string(),
        size: pack.size.clone(),
        path: dest.to_path_buf(),
        bytes: total,
        local: false,
        url: Some(url.to_string()),
        mirror: None,
        hosted: false,
        recommended: false,
        mmproj: None,
    };
    let state_for_progress = Arc::clone(state);
    let progress_id = id.to_string();
    download_model(&entry, dest.parent().unwrap_or(Path::new(".")), |downloaded, known| {
        set_progress(&state_for_progress, &progress_id, downloaded, known, "image", None);
    })
}

/// Telecharge ce qui manque a un pack (checkpoint, puis LoRA) et le selectionne.
/// Seuls les packs a fichier unique sont concernes : Z-Image reste manuel.
fn download_image_pack(state: &Shared, id: &str) -> Result<(), String> {
    let (pack, dir) = {
        let guard = state.lock().map_err(|_| "etat verrouille".to_string())?;
        let pack = guard
            .image
            .pack(id)
            .cloned()
            .ok_or_else(|| format!("jeu d'images inconnu : {id}"))?;
        (pack, guard.image.dir.clone())
    };

    let checkpoint = if pack.model.is_empty() { None } else { Some(dir.join(&pack.model)) };
    let lora = pack.lora_file().map(|name| dir.join("loras").join(name));
    let needs_checkpoint = checkpoint.as_ref().map(|path| !path.is_file()).unwrap_or(false);
    let needs_lora = lora.as_ref().map(|path| !path.is_file()).unwrap_or(false);

    if !needs_checkpoint && !needs_lora {
        return select_image_pack(state, id);
    }

    let total = if needs_checkpoint { parse_size(&pack.size) } else { 1 };
    set_progress(state, id, 0, total, "image", None);

    let result = (|| -> Result<(), String> {
        if needs_checkpoint {
            if pack.url.is_empty() {
                return Err("ce jeu de fichiers n'a pas d'URL de telechargement".to_string());
            }
            fetch_pack_file(state, id, &pack, checkpoint.as_deref().unwrap(), &pack.url, total)?;
        }
        if needs_lora {
            if pack.lora_url.is_empty() {
                return Err("le style de ce jeu n'a pas d'URL de telechargement".to_string());
            }
            fetch_pack_file(state, id, &pack, lora.as_deref().unwrap(), &pack.lora_url, total)?;
        }
        Ok(())
    })();
    match result {
        Ok(()) => {
            set_progress(state, id, 1, 1, "image-ready", None);
            if let Ok(mut guard) = state.lock() {
                guard.progress = None;
                guard.image.selected = Some(id.to_string());
                save_image_selection(&guard.image.dir, id);
            }
            Ok(())
        }
        Err(error) => {
            set_progress(state, id, 0, total, "error", Some(error.clone()));
            Err(error)
        }
    }
}

/// Lance un binaire avec un argument d'information et rend Ok s'il demarre.
///
/// Sert a distinguer « binaire absent » de « binaire present mais refuse par le
/// systeme » : sur macOS, dyld refuse un binaire dont le `minos` depasse le
/// systeme ; sous Linux, ld.so refuse quand une version de glibc manque. Dans
/// les deux cas le processus sort en erreur aussitot, avec un message utile sur
/// stderr. Sans cette sonde, le lanceur attendait un serveur qui ne demarrerait
/// jamais et concluait a un probleme de GPU.
fn probe_binary(bin: &Path, arg: &str, timeout: Duration) -> Result<(), String> {
    let mut command = Command::new(bin);
    command
        .arg(arg)
        .current_dir(bin.parent().unwrap_or_else(|| Path::new(".")))
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    let mut child = command
        .spawn()
        .map_err(|err| format!("ne peut pas etre lance ({err})"))?;
    let deadline = Instant::now() + timeout;
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                if status.success() {
                    return Ok(());
                }
                let mut text = String::new();
                if let Some(stderr) = child.stderr.as_mut() {
                    let _ = stderr.read_to_string(&mut text);
                }
                if text.trim().is_empty() {
                    if let Some(stdout) = child.stdout.as_mut() {
                        let _ = stdout.read_to_string(&mut text);
                    }
                }
                let line = text
                    .lines()
                    .map(str::trim)
                    .find(|line| !line.is_empty())
                    .unwrap_or("sortie en erreur, sans message");
                return Err(line.to_string());
            }
            Ok(None) => {
                if Instant::now() >= deadline {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(format!("ne repond pas a {arg} apres {} s", timeout.as_secs()));
                }
                thread::sleep(Duration::from_millis(50));
            }
            Err(err) => return Err(format!("etat du processus illisible ({err})")),
        }
    }
}

/// Dernieres lignes utiles d'un journal de moteur, pour un message d'erreur qui
/// dise ce qui s'est reellement passe.
fn tail_of(path: &Path, lines: usize) -> String {
    let text = fs::read_to_string(path).unwrap_or_default();
    let all: Vec<&str> = text.lines().filter(|line| !line.trim().is_empty()).collect();
    let start = all.len().saturating_sub(lines);
    all[start..]
        .iter()
        .map(|line| line.trim())
        .collect::<Vec<_>>()
        .join(" | ")
}

fn spawn_llama(bin: &Path, model: &Path, mmproj: Option<&Path>, port: u16, ctx: u32) -> std::io::Result<(Child, PathBuf)> {
    let log_path = env::temp_dir().join(format!("simia-llama-{port}.log"));
    let log = fs::File::create(&log_path)?;
    let log_out = log.try_clone()?;
    let mut command = Command::new(bin);
    command
        .arg("-m")
        .arg(model);
    if let Some(mmproj) = mmproj {
        command.arg("--mmproj").arg(mmproj);
    }
    command
        .arg("-ngl")
        .arg("99")
        .arg("-c")
        .arg(ctx.to_string())
        .arg("-np")
        .arg("1")
        .arg("-n")
        .arg(MAX_OUTPUT.to_string())
        .arg("--host")
        .arg("127.0.0.1")
        .arg("--port")
        .arg(port.to_string())
        .arg("--no-webui")
        .current_dir(bin.parent().unwrap_or_else(|| Path::new(".")))
        .stdin(Stdio::null())
        // Les deux flux partent dans le meme journal plutot que dans le neant :
        // c'est la seule facon de rapporter pourquoi le moteur n'a pas demarre.
        .stdout(Stdio::from(log_out))
        .stderr(Stdio::from(log));
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command.spawn().map(|child| (child, log_path))
}

/// Attend que le moteur reponde, en s'arretant des que le processus meurt.
/// Un binaire incompatible sort en quelques millisecondes : l'ancienne boucle
/// attendait alors jusqu'a 240 s avant d'accuser le GPU.
fn wait_healthy(child: &mut Child, port: u16, log_path: &Path) -> Result<(), String> {
    print!("Chargement du modele dans le GPU");
    let _ = std::io::stdout().flush();
    let deadline = Instant::now() + HEALTH_TIMEOUT;
    while Instant::now() < deadline {
        if let Ok((200, _, _)) = http_call(port, "GET", "/health", None, Duration::from_secs(2)) {
            println!();
            return Ok(());
        }
        if let Ok(Some(status)) = child.try_wait() {
            println!();
            let detail = tail_of(log_path, 2);
            let mut message = format!("le moteur s'est arrete pendant le chargement ({status})");
            if !detail.is_empty() {
                message.push_str(" : ");
                message.push_str(&detail);
            }
            return Err(message);
        }
        print!(".");
        let _ = std::io::stdout().flush();
        thread::sleep(Duration::from_millis(400));
    }
    println!();
    let detail = tail_of(log_path, 2);
    Err(if detail.is_empty() {
        "le moteur n'a pas repondu dans le delai imparti".to_string()
    } else {
        format!("le moteur n'a pas repondu dans le delai imparti. {detail}")
    })
}

/// Arrete le modele courant, telecharge le modele demande s'il est absent du
/// disque, puis le demarre. Le verrou n'est jamais tenu pendant un transfert.
fn switch_model(state: &Shared, bin: &Path, model_id: &str) -> Result<(), String> {
    let (mut model, port, dir, ctx_size) = {
        let guard = state.lock().map_err(|_| "etat verrouille".to_string())?;
        let found = guard
            .models
            .iter()
            .find(|candidate| candidate.id == model_id)
            .cloned()
            .ok_or_else(|| format!("modele inconnu : {model_id}"))?;
        (found, guard.llama_port, guard.models_dir.clone(), guard.ctx_size)
    };

    if let Ok(guard) = state.lock() {
        if let Some(existing) = guard.running.as_ref() {
            if existing.model_id == model_id {
                return Ok(());
            }
        }
    }

    if !model.local {
        let total_size = model.bytes;
        set_progress(state, model_id, 0, total_size, "download", None);
        let state_for_progress = Arc::clone(state);
        let id = model.id.clone();
        let result = download_model(&model, &dir, |downloaded, total| {
            set_progress(&state_for_progress, &id, downloaded, total, "download", None);
        });
        if let Err(error) = result {
            set_progress(state, model_id, 0, total_size, "error", Some(error.clone()));
            return Err(error);
        }
        model.local = true;
        if let Ok(mut guard) = state.lock() {
            if let Some(entry) = guard.models.iter_mut().find(|candidate| candidate.id == model_id) {
                entry.local = true;
                entry.path = model.path.clone();
                entry.bytes = fs::metadata(&model.path).map(|meta| meta.len()).unwrap_or(entry.bytes);
            }
        }
    }

    // Le generateur d'images, s'il occupait le GPU, doit le rendre.
    stop_image(state);
    if let Ok(mut guard) = state.lock() {
        guard.selected_model = model_id.to_string();
        if let Some(mut running) = guard.running.take() {
            let _ = running.child.kill();
            let _ = running.child.wait();
        }
    }

    set_progress(state, model_id, 0, 0, "loading", None);
    let (mut child, log_path) = spawn_llama(bin, &model.path, model.mmproj.as_deref(), port, ctx_size).map_err(|err| {
        set_progress(state, model_id, 0, 0, "error", Some(err.to_string()));
        err.to_string()
    })?;

    if let Err(reason) = wait_healthy(&mut child, port, &log_path) {
        let _ = child.kill();
        let _ = child.wait();
        set_progress(state, model_id, 0, 0, "error", Some(reason.clone()));
        return Err(reason);
    }

    if let Ok(mut guard) = state.lock() {
        guard.selected_model = model_id.to_string();
        guard.running = Some(Running { child, model_id: model_id.to_string() });
        guard.progress = None;
    }
    Ok(())
}

fn set_progress(state: &Shared, id: &str, downloaded: u64, total: u64, stage: &str, error: Option<String>) {
    if let Ok(mut guard) = state.lock() {
        guard.progress = Some(Progress {
            id: id.to_string(),
            downloaded,
            total,
            stage: stage.to_string(),
            error,
        });
    }
}

// --------------------------------------------------------------------------
// Client HTTP minimal (evite une dependance reseau supplementaire)
// --------------------------------------------------------------------------

fn http_call(
    port: u16,
    method: &str,
    target: &str,
    body: Option<&[u8]>,
    timeout: Duration,
) -> std::io::Result<(u16, Vec<(String, String)>, Vec<u8>)> {
    let mut stream = TcpStream::connect(("127.0.0.1", port))?;
    stream.set_read_timeout(Some(timeout))?;
    stream.set_write_timeout(Some(Duration::from_secs(60)))?;

    let mut head = format!(
        "{method} {target} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\nAccept: */*\r\n"
    );
    if let Some(payload) = body {
        head.push_str("Content-Type: application/json\r\n");
        head.push_str(&format!("Content-Length: {}\r\n", payload.len()));
    }
    head.push_str("\r\n");

    stream.write_all(head.as_bytes())?;
    if let Some(payload) = body {
        stream.write_all(payload)?;
    }
    stream.flush()?;

    let mut raw = Vec::new();
    stream.read_to_end(&mut raw)?;
    parse_response(&raw)
}

fn parse_response(raw: &[u8]) -> std::io::Result<(u16, Vec<(String, String)>, Vec<u8>)> {
    let split = find(raw, b"\r\n\r\n").ok_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::InvalidData, "en-tetes HTTP incomplets")
    })?;
    let head = String::from_utf8_lossy(&raw[..split]).to_string();
    let mut body = raw[split + 4..].to_vec();

    let mut lines = head.lines();
    let status = lines.next().unwrap_or("");
    let code: u16 = status
        .split_whitespace()
        .nth(1)
        .and_then(|value| value.parse().ok())
        .unwrap_or(0);

    let mut headers = Vec::new();
    let mut chunked = false;
    let mut content_length: Option<usize> = None;
    for line in lines {
        if let Some((name, value)) = line.split_once(':') {
            let name = name.trim().to_lowercase();
            let value = value.trim().to_string();
            if name == "transfer-encoding" && value.to_lowercase().contains("chunked") {
                chunked = true;
            }
            if name == "content-length" {
                content_length = value.parse().ok();
            }
            headers.push((name, value));
        }
    }

    if chunked {
        body = dechunk(&body)?;
    } else if let Some(length) = content_length {
        if body.len() > length {
            body.truncate(length);
        }
    }

    Ok((code, headers, body))
}

fn dechunk(data: &[u8]) -> std::io::Result<Vec<u8>> {
    let mut cursor = data;
    let mut out = Vec::new();
    loop {
        let pos = find(cursor, b"\r\n")
            .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::InvalidData, "chunk tronque"))?;
        let header = String::from_utf8_lossy(&cursor[..pos]).to_string();
        let size_hex = header.split(';').next().unwrap_or("0").trim().to_string();
        let size = usize::from_str_radix(&size_hex, 16).map_err(|_| {
            std::io::Error::new(std::io::ErrorKind::InvalidData, "taille de chunk invalide")
        })?;
        cursor = &cursor[pos + 2..];
        if size == 0 {
            break;
        }
        if cursor.len() < size {
            out.extend_from_slice(cursor);
            break;
        }
        out.extend_from_slice(&cursor[..size]);
        let advance = (size + 2).min(cursor.len());
        cursor = &cursor[advance..];
    }
    Ok(out)
}

fn find(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    if needle.is_empty() || haystack.len() < needle.len() {
        return None;
    }
    haystack.windows(needle.len()).position(|window| window == needle)
}

// --------------------------------------------------------------------------
// Fenetre applicative
// --------------------------------------------------------------------------

fn launch_browser(url: &str) -> Option<Child> {
    let app = format!("--app={url}");
    let mut candidates: Vec<(String, Vec<String>)> = Vec::new();

    if cfg!(windows) {
        for exe in [
            "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
            "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
            "C:/Program Files/Google/Chrome/Application/chrome.exe",
            "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
        ] {
            candidates.push((
                exe.to_string(),
                vec![app.clone(), "--window-size=1280,900".to_string()],
            ));
        }
    } else if cfg!(target_os = "macos") {
        for browser in ["Google Chrome", "Microsoft Edge", "Brave Browser"] {
            candidates.push((
                "open".to_string(),
                vec![
                    "-na".to_string(),
                    browser.to_string(),
                    "--args".to_string(),
                    app.clone(),
                    "--window-size=1280,900".to_string(),
                ],
            ));
        }
    } else {
        for exe in ["google-chrome", "microsoft-edge", "chromium", "chromium-browser"] {
            candidates.push((
                exe.to_string(),
                vec![app.clone(), "--window-size=1280,900".to_string()],
            ));
        }
    }

    for (exe, args) in candidates {
        if exe.contains('/') && !Path::new(&exe).is_file() {
            continue;
        }
        let mut command = Command::new(&exe);
        command
            .args(&args)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        if let Ok(child) = command.spawn() {
            return Some(child);
        }
    }

    open_default(url);
    None
}

fn open_default(url: &str) {
    #[cfg(windows)]
    {
        let _ = Command::new("cmd").args(["/C", "start", "", url]).spawn();
    }
    #[cfg(target_os = "macos")]
    {
        let _ = Command::new("open").arg(url).spawn();
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let _ = Command::new("xdg-open").arg(url).spawn();
    }
}

// --------------------------------------------------------------------------
// Serveur HTTP de l'interface
// --------------------------------------------------------------------------

fn handle(state: Shared, llama_bin: PathBuf, mut request: tiny_http::Request) {
    let url = request.url().to_string();
    let path = url.split('?').next().unwrap_or("/").to_string();

    if path == "/_simia/models" {
        let body = {
            let guard = match state.lock() {
                Ok(guard) => guard,
                Err(_) => {
                    let _ = request.respond(Response::empty(StatusCode(500)));
                    return;
                }
            };
            let selected = guard.selected_model.clone();
            let entries = guard
                .models
                .iter()
                .map(|model| {
                    format!(
                        "{{\"id\":{},\"name\":{},\"category\":{},\"size\":{},\"bytes\":{},\"local\":{},\"recommended\":{},\"vision\":{},\"hosted\":{},\"mirror\":{}}}",
                        js_escape(&model.id),
                        js_escape(&model.name),
                        js_escape(&model.category),
                        js_escape(&model.size),
                        model.bytes,
                        model.local,
                        model.recommended,
                        model.mmproj.is_some(),
                        model.hosted,
                        model.mirror.is_some()
                    )
                })
                .collect::<Vec<_>>()
                .join(",");
            let total: u64 = guard.models.iter().map(|model| model.bytes).sum();
            let local_total: u64 = guard
                .models
                .iter()
                .filter(|model| model.local)
                .map(|model| model.bytes)
                .sum();
            format!(
                "{{\"selected\":{},\"ctxSize\":{},\"totalBytes\":{},\"localBytes\":{},\"models\":[{}]}}",
                js_escape(&selected),
                guard.ctx_size,
                total,
                local_total,
                entries
            )
        };
        respond_json(request, 200, body);
        return;
    }

    if path == "/_simia/version" {
        let body = match state.lock() {
            Ok(guard) => {
                let local_bytes: u64 = guard.models.iter().filter(|model| model.local).map(|model| model.bytes).sum();
                let total_bytes: u64 = guard.models.iter().map(|model| model.bytes).sum();
                let remote = guard.remote.clone().unwrap_or_default();
                format!(
                    "{{\"catalog\":{},\"base\":{},\"models\":{},\"local\":{},\"localBytes\":{},\"totalBytes\":{},\"server\":{},\"remote\":{{\"reachable\":{},\"version\":{},\"published\":{},\"notes\":{}}}}}",
                    guard.catalog_version,
                    js_escape(&guard.catalog_base),
                    guard.models.len(),
                    guard.models.iter().filter(|model| model.local).count(),
                    local_bytes,
                    total_bytes,
                    guard.models.iter().filter(|model| model.hosted).count(),
                    remote.reachable,
                    js_escape(&remote.version),
                    js_escape(&remote.published),
                    js_escape(&remote.notes)
                )
            }
            Err(_) => "{\"catalog\":0}".to_string(),
        };
        respond_json(request, 200, body);
        return;
    }

    if path == "/_simia/progress" {
        let body = match state.lock() {
            Ok(guard) => match guard.progress.as_ref() {
                Some(progress) => format!(
                    "{{\"active\":true,\"id\":{},\"downloaded\":{},\"total\":{},\"stage\":{},\"error\":{}}}",
                    js_escape(&progress.id),
                    progress.downloaded,
                    progress.total,
                    js_escape(&progress.stage),
                    progress
                        .error
                        .as_ref()
                        .map(|value| js_escape(value))
                        .unwrap_or_else(|| "null".to_string())
                ),
                None => "{\"active\":false}".to_string(),
            },
            Err(_) => "{\"active\":false}".to_string(),
        };
        respond_json(request, 200, body);
        return;
    }

    if path == "/_simia/select" {
        let mut body = Vec::new();
        let _ = request.as_reader().read_to_end(&mut body);
        let text = String::from_utf8_lossy(&body).to_string();
        let Some(model_id) = json_string(&text, "id") else {
            respond_json(request, 400, "{\"error\":\"id manquant\"}".to_string());
            return;
        };
        let owned = model_id.clone();
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            switch_model(&state, &llama_bin, &owned)
        }));
        match result {
            Ok(Ok(())) => respond_json(
                request,
                200,
                format!("{{\"ok\":true,\"selected\":{}}}", js_escape(&model_id)),
            ),
            Ok(Err(error)) => respond_json(
                request,
                500,
                format!("{{\"error\":{}}}", js_escape(&error)),
            ),
            Err(_) => respond_json(
                request,
                500,
                "{\"error\":\"basculement interrompu\"}".to_string(),
            ),
        }
        return;
    }

    if path == "/_simia/image/packs" {
        respond_json(request, 200, image_packs_json(&state));
        return;
    }

    if path == "/_simia/image/select" {
        let mut body = Vec::new();
        let _ = request.as_reader().read_to_end(&mut body);
        let text = String::from_utf8_lossy(&body).to_string();
        let Some(id) = json_string(&text, "id") else {
            respond_json(request, 400, "{\"error\":\"id manquant\"}".to_string());
            return;
        };
        match select_image_pack(&state, &id) {
            Ok(()) => respond_json(request, 200, image_packs_json(&state)),
            Err(error) => respond_json(request, 400, format!("{{\"error\":{}}}", js_escape(&error))),
        }
        return;
    }

    if path == "/_simia/image/download" {
        let mut body = Vec::new();
        let _ = request.as_reader().read_to_end(&mut body);
        let text = String::from_utf8_lossy(&body).to_string();
        let Some(id) = json_string(&text, "id") else {
            respond_json(request, 400, "{\"error\":\"id manquant\"}".to_string());
            return;
        };
        match download_image_pack(&state, &id) {
            Ok(()) => respond_json(request, 200, image_packs_json(&state)),
            Err(error) => respond_json(request, 500, format!("{{\"error\":{}}}", js_escape(&error))),
        }
        return;
    }

    if path == "/_simia/image/status" {
        respond_json(request, 200, image_status_json(&state));
        return;
    }

    if path == "/_simia/image/prepare" {
        let status = start_image(&state);
        respond_json(request, 200, image_status_json(&state));
        let _ = status;
        return;
    }

    if path == "/_simia/image/release" {
        stop_image(&state);
        if let Ok(mut guard) = state.lock() {
            guard.image.state = "stopped".to_string();
        }
        respond_json(request, 200, image_status_json(&state));
        return;
    }

    if path.starts_with("/sdcpp/") || path.starts_with("/sdapi/") {
        let (port, ready, lora) = match state.lock() {
            Ok(guard) => {
                let lora = guard.image.current().and_then(|pack| {
                    pack.lora_file().map(|file| (file.to_string(), pack.lora_weight))
                });
                (guard.image.port, guard.image.state == "ready", lora)
            }
            Err(_) => (0, false, None),
        };
        if !ready || port == 0 {
            respond_json(
                request,
                503,
                "{\"error\":\"image_engine_not_ready\",\"message\":\"modele d'image non charge\"}"
                    .to_string(),
            );
            return;
        }
        if let Ok(mut guard) = state.lock() {
            guard.image.last_used = Some(Instant::now());
        }
        let generating = url.ends_with("/v1/img_gen") || url.ends_with("/sdapi/v1/txt2img");
        match lora {
            Some((file, weight)) if generating => proxy_with_lora(request, port, &url, &file, weight),
            _ => proxy(request, port, &url),
        }
        return;
    }

    if path == "/_simia/native.js" {
        let body = native_script(&state);
        let mut response = Response::from_string(body).with_status_code(StatusCode(200));
        if let Some(value) = header("Content-Type", "text/javascript; charset=utf-8") {
            response = response.with_header(value);
        }
        if let Some(value) = header("Cache-Control", "no-store") {
            response = response.with_header(value);
        }
        let _ = request.respond(response);
        return;
    }

    if path.starts_with("/v1/") || path == "/health" || path == "/props" {
        // Le GPU n'heberge qu'un moteur a la fois : on rend la main au texte.
        if let Err(error) = ensure_llama(&state) {
            respond_json(
                request,
                503,
                format!("{{\"error\":{}}}", js_escape(&error)),
            );
            return;
        }
        let port = state.lock().map(|guard| guard.llama_port).unwrap_or(0);
        if port == 0 {
            let _ = request.respond(Response::empty(StatusCode(503)));
            return;
        }
        proxy(request, port, &url);
        return;
    }

    serve_static(&state, request, &path);
}

fn respond_json(request: tiny_http::Request, code: u16, body: String) {
    let mut response = Response::from_string(body).with_status_code(StatusCode(code));
    if let Some(value) = header("Content-Type", "application/json; charset=utf-8") {
        response = response.with_header(value);
    }
    if let Some(value) = header("Cache-Control", "no-store") {
        response = response.with_header(value);
    }
    let _ = request.respond(response);
}

fn proxy(mut request: tiny_http::Request, port: u16, target: &str) {
    let method = request.method().as_str().to_string();
    let mut body = Vec::new();
    let _ = request.as_reader().read_to_end(&mut body);
    let empty = body.is_empty();
    forward(request, &method, port, target, if empty { None } else { Some(body.as_slice()) });
}

/// Ajoute le LoRA du pack dans un corps JSON de generation d'image.
///
/// L'API de stable-diffusion.cpp ignore volontairement les balises `<lora:...>`
/// ecrites dans le prompt : le style doit passer par le champ structure `lora`.
fn with_lora(body: &[u8], file: &str, weight: f32) -> Option<Vec<u8>> {
    let text = std::str::from_utf8(body).ok()?;
    let trimmed = text.trim_end();
    if !trimmed.starts_with('{') || !trimmed.ends_with('}') {
        return None;
    }
    if trimmed.contains("\"lora\"") {
        // Le client a deja choisi ses LoRA : on ne s'interpose pas.
        return None;
    }
    let inner = &trimmed[1..trimmed.len() - 1];
    let entry = format!("{{\"path\":{},\"multiplier\":{}}}", js_escape(file), weight);
    let mut out = String::with_capacity(text.len() + entry.len() + 16);
    out.push('{');
    out.push_str(inner);
    if !inner.trim().is_empty() {
        out.push(',');
    }
    out.push_str("\"lora\":[");
    out.push_str(&entry);
    out.push_str("]}");
    Some(out.into_bytes())
}

/// Comme `proxy`, mais force le LoRA du pack courant dans la requete.
fn proxy_with_lora(mut request: tiny_http::Request, port: u16, target: &str, file: &str, weight: f32) {
    let method = request.method().as_str().to_string();
    let mut body = Vec::new();
    let _ = request.as_reader().read_to_end(&mut body);
    let body = with_lora(&body, file, weight).unwrap_or(body);
    let empty = body.is_empty();
    forward(request, &method, port, target, if empty { None } else { Some(body.as_slice()) });
}

fn forward(
    request: tiny_http::Request,
    method: &str,
    port: u16,
    target: &str,
    payload: Option<&[u8]>,
) {
    match http_call(port, method, target, payload, Duration::from_secs(600)) {
        Ok((code, headers, data)) => {
            let mut response = Response::from_data(data).with_status_code(StatusCode(code));
            for (name, value) in headers {
                if name == "content-type" {
                    if let Some(header) = header("Content-Type", &value) {
                        response = response.with_header(header);
                    }
                }
            }
            let _ = request.respond(response);
        }
        Err(err) => {
            let payload = format!("{{\"error\":\"{}\"}}", js_escape(&err.to_string()));
            let _ = request.respond(Response::from_string(payload).with_status_code(StatusCode(502)));
        }
    }
}

fn serve_static(state: &Shared, request: tiny_http::Request, path: &str) {
    let web = match state.lock() {
        Ok(guard) => guard.web.clone(),
        Err(_) => {
            let _ = request.respond(Response::empty(StatusCode(500)));
            return;
        }
    };

    // En mode desktop, le service worker mettrait les assets en cache et servirait
    // une ancienne version apres une mise a jour : on sert un worker inerte.
    if path == "/service-worker.js" {
        let stub = "self.addEventListener('install', () => self.skipWaiting());\n\
                    self.addEventListener('activate', event => event.waitUntil(self.registration.unregister()));\n";
        let mut response = Response::from_string(stub);
        if let Some(value) = header("Content-Type", "text/javascript; charset=utf-8") {
            response = response.with_header(value);
        }
        let _ = request.respond(response);
        return;
    }

    // Le bandeau cookies WordPress n'existe pas hors du site : reponse vide, pas de 404.
    if path.starts_with("/zigmoon-cookies") {
        let _ = request.respond(Response::from_data(Vec::new()));
        return;
    }

    let relative = if path == "/" { "index.html" } else { path.trim_start_matches('/') };
    let file = web.join(relative);
    if !file.starts_with(&web) {
        let _ = request.respond(Response::empty(StatusCode(403)));
        return;
    }

    let bytes = match fs::read(&file) {
        Ok(bytes) => bytes,
        Err(_) => {
            let _ = request.respond(Response::empty(StatusCode(404)));
            return;
        }
    };

    let extension = file
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or("")
        .to_lowercase();
    if extension == "html" {
        let html = String::from_utf8_lossy(&bytes).to_string();
        let injected = inject_native_script(&html);
        let mut response = Response::from_data(injected.into_bytes());
        if let Some(value) = header("Content-Type", "text/html; charset=utf-8") {
            response = response.with_header(value);
        }
        if let Some(value) = header("Cache-Control", "no-store") {
            response = response.with_header(value);
        }
        let _ = request.respond(response);
        return;
    }

    let mut response = Response::from_data(bytes);
    if let Some(value) = header("Content-Type", mime_for(&extension)) {
        response = response.with_header(value);
    }
    if matches!(extension.as_str(), "js" | "css" | "webmanifest") {
        if let Some(value) = header("Cache-Control", "no-store") {
            response = response.with_header(value);
        }
    }
    let _ = request.respond(response);
}

fn inject_native_script(html: &str) -> String {
    let tag = "<script src=\"/_simia/native.js\"></script>";
    match html.find("</head>") {
        Some(index) => {
            let mut out = String::with_capacity(html.len() + tag.len());
            out.push_str(&html[..index]);
            out.push_str(tag);
            out.push_str(&html[index..]);
            out
        }
        None => format!("{tag}{html}"),
    }
}

fn native_script(state: &Shared) -> String {
    let (models, selected, ctx_size, image) = match state.lock() {
        Ok(guard) => {
            let selected = guard.selected_model.clone();
            let image = format!(
                "{{\"available\":{},\"width\":{},\"height\":{},\"steps\":{},\"cfg\":{},\"model\":{},\"packsUrl\":\"/_simia/image/packs\",\"selectPackUrl\":\"/_simia/image/select\",\"downloadPackUrl\":\"/_simia/image/download\",\"statusUrl\":\"/_simia/image/status\",\"prepareUrl\":\"/_simia/image/prepare\",\"generateUrl\":\"/sdcpp/v1/img_gen\",\"jobsUrl\":\"/sdcpp/v1/jobs\"}}",
                guard.image.available(),
                guard.image.current().map(|pack| guard.image.size_override.unwrap_or(pack.px_or(DEFAULT_IMG_WIDTH))).unwrap_or(0),
                guard.image.current().map(|pack| guard.image.size_override.unwrap_or(pack.px_or(DEFAULT_IMG_WIDTH))).unwrap_or(0),
                guard.image.current().map(|pack| guard.image.steps_override.unwrap_or(pack.steps_or(DEFAULT_IMG_STEPS))).unwrap_or(0),
                guard.image.current().map(|pack| pack.cfg).unwrap_or(1.0),
                js_escape(
                    &guard
                        .image
                        .current()
                        .map(|pack| pack.name.clone())
                        .unwrap_or_default()
                )
            );
            let models = guard
                .models
                .iter()
                .map(|model| {
                    format!(
                        "{{\"id\":{},\"name\":{},\"category\":{},\"size\":{},\"bytes\":{},\"local\":{},\"recommended\":{},\"vision\":{},\"hosted\":{},\"mirror\":{}}}",
                        js_escape(&model.id),
                        js_escape(&model.name),
                        js_escape(&model.category),
                        js_escape(&model.size),
                        model.bytes,
                        model.local,
                        model.recommended,
                        model.mmproj.is_some(),
                        model.hosted,
                        model.mirror.is_some()
                    )
                })
                .collect::<Vec<_>>()
                .join(",");
            (models, selected, guard.ctx_size, image)
        }
        Err(_) => (String::new(), String::new(), DEFAULT_CTX_SIZE, "{\"available\":false}".to_string()),
    };

    format!(
        "window.__SIMIA_NATIVE__={{\"app\":\"simia-desktop\",\"version\":{},\"apiBase\":\"/v1\",\"chatUrl\":\"/v1/chat/completions\",\"modelsUrl\":\"/_simia/models\",\"selectUrl\":\"/_simia/select\",\"ctxSize\":{},\"image\":{},\"selected\":{},\"models\":[{}]}};\n\
         (function(){{try{{if(navigator.serviceWorker&&navigator.serviceWorker.getRegistrations){{navigator.serviceWorker.getRegistrations().then(function(list){{list.forEach(function(registration){{registration.unregister().catch(function(){{}})}})}}).catch(function(){{}})}}}}catch(error){{}}}})();\n",
        js_escape(APP_VERSION),
        ctx_size,
        image,
        js_escape(&selected),
        models
    )
}

fn js_escape(value: &str) -> String {
    let mut out = String::with_capacity(value.len() + 2);
    out.push('"');
    for character in value.chars() {
        match character {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => {}
            '\t' => out.push_str("\\t"),
            control if (control as u32) < 0x20 => out.push(' '),
            other => out.push(other),
        }
    }
    out.push('"');
    out
}

/// Recupere la valeur d'une chaine JSON simple : `{"id":"valeur"}`.
fn json_string(json: &str, key: &str) -> Option<String> {
    let needle = format!("\"{key}\"");
    let start = json.find(&needle)? + needle.len();
    let rest = &json[start..];
    let colon = rest.find(':')?;
    let after = &rest[colon + 1..];
    let quote = after.find('"')?;
    let mut out = String::new();
    let mut chars = after[quote + 1..].chars();
    while let Some(character) = chars.next() {
        match character {
            '"' => return Some(out),
            '\\' => match chars.next() {
                Some('n') => out.push('\n'),
                Some('t') => out.push('\t'),
                Some(other) => out.push(other),
                None => return Some(out),
            },
            other => out.push(other),
        }
    }
    Some(out)
}

fn header(name: &'static str, value: &str) -> Option<Header> {
    Header::from_bytes(name.as_bytes(), value.as_bytes()).ok()
}

fn mime_for(extension: &str) -> &'static str {
    match extension {
        "html" => "text/html; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "js" => "text/javascript; charset=utf-8",
        "json" | "webmanifest" => "application/json; charset=utf-8",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "ico" => "image/x-icon",
        "wasm" => "application/wasm",
        "woff2" => "font/woff2",
        "glb" => "model/gltf-binary",
        "xml" => "application/xml",
        "txt" => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    }
}
