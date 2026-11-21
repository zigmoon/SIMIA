//! SIMIA Desktop launcher.
//!
//! Sert l'interface SIMIA (dossier web) sur un port local stable, supervise un
//! processus `llama-server` (llama.cpp) et permet de changer de modele a chaud.
//!
//! Aucune dependance C/C++ : compile aussi bien avec la toolchain GNU que MSVC.

use std::env;
use std::fs;
use std::io::{IsTerminal, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant};

use serde::Deserialize;
use tiny_http::{Header, Response, Server, StatusCode};

const APP_VERSION: &str = env!("CARGO_PKG_VERSION");
/// Contexte par defaut : 8192 tokens (~0,5 Go de cache KV en f16), soit le double
/// de l'ancienne valeur, ce qui laisse la place a un gros fichier de code.
const DEFAULT_CTX_SIZE: u32 = 8192;
const MIN_CTX_SIZE: u32 = 2048;
/* Plafond de generation par defaut de llama-server. L'interface demande son
   propre budget par requete (jusqu'a 3072 jetons pour un fichier de code),
   et ce plafond ne doit pas le contredire : 1024 coupait une page HTML au
   bout d'une vingtaine de lignes. */
const MAX_OUTPUT: u32 = 4096;
/// Port fixe pour conserver les conversations (localStorage est lie a l'origine).
const DEFAULT_UI_PORT: u16 = 8170;
/// Le generateur d'images libere le GPU apres cette duree d'inactivite.
const IMAGE_IDLE: Duration = Duration::from_secs(300);
const DEFAULT_IMG_WIDTH: u32 = 1024;
const DEFAULT_IMG_STEPS: u32 = 8;
const HEURISTIC_WALK_UP: usize = 6;
const HEALTH_TIMEOUT: Duration = Duration::from_secs(240);

/// Modeles charges en priorite quand plusieurs sont deja sur le disque, du plus
/// souhaite au moins.
const PREFERRED_LOCAL: [&str; 4] = ["qwen3.5-2b", "qwen3-1.7b", "qwen2.5-1.5b", "llama-3.2-1b"];

/// Modele telecharge au tout premier lancement, quand le disque est vide.
/// Un Qwen generaliste, pas un modele de code : le tri par categorie tombait
/// sinon sur « Code », et la premiere impression de SIMIA etait un assistant
/// qui code. Taille volontairement modeste (~508 Mo) pour ne pas imposer plus
/// d'un gigaoctet de telechargement avant la premiere fenetre.
const PREFERRED_BOOTSTRAP: [&str; 4] = ["qwen3.5-0.8b", "qwen3-0.6b", "qwen2.5-1.5b", "llama-3.2-1b"];


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
    /// "EU" pour un modele edite en Europe (Mistral AI, par exemple).
    origin: String,
    /// Editeur, repris du catalogue.
    vendor: String,
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
    /// Ce pack est deja present dans l'archive : la generation d'images marche
    /// des le premier lancement, sans telechargement. L'interface le signale,
    /// sinon rien ne distingue un modele fourni d'un modele a recuperer.
    #[serde(default)]
    bundled: bool,
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
    /// Fichier depose a la main dans `models/image/` : SIMIA l'a reconnu seul,
    /// sans entree de catalogue. L'interface le signale, sinon un fichier ajoute
    /// se confondrait avec un modele fourni.
    #[serde(default)]
    added: bool,
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

/// Famille d'architecture d'un modele ou d'un LoRA. Elle decide des reglages de
/// depart (resolution, pas) et permet de prevenir qu'un LoRA ne vise pas le
/// modele charge : les tenseurs ne se correspondent pas, le moteur refuse.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum ImageFamily {
    Sd15,
    Sdxl,
    /// Architecture a blocs de transformation (Flux, Z-Image, LTX-AV) : elle
    /// demande son encodeur de texte et son VAE a cote du checkpoint.
    Dit,
    Unknown,
}

impl ImageFamily {
    fn key(self) -> &'static str {
        match self {
            ImageFamily::Sd15 => "sd15",
            ImageFamily::Sdxl => "sdxl",
            ImageFamily::Dit => "dit",
            ImageFamily::Unknown => "",
        }
    }

    /// Etiquette lisible, montree telle quelle quand deux familles ne
    /// concordent pas.
    fn label(self) -> &'static str {
        match self {
            ImageFamily::Sd15 => "SD 1.5",
            ImageFamily::Sdxl => "SDXL",
            ImageFamily::Dit => "DiT",
            ImageFamily::Unknown => "?",
        }
    }

    /// Reglages de depart : resolution, pas, CFG.
    fn defaults(self) -> (u32, u32, f32) {
        match self {
            ImageFamily::Sdxl => (1024, 25, 7.0),
            ImageFamily::Sd15 => (512, 20, 7.0),
            // Une architecture DiT complete est presque toujours distillee, et
            // de toute facon on ne peut pas la dessiner sans son VAE.
            ImageFamily::Dit => (1024, 8, 1.0),
            ImageFamily::Unknown => (512, 20, 7.0),
        }
    }
}

/// Ce que l'en-tete d'un `.safetensors` apprend sur le fichier.
struct TensorHeader {
    tensors: usize,
    lora: bool,
    family: ImageFamily,
}

/// Lit l'en-tete d'un `.safetensors` : huit octets de longueur, puis du JSON.
/// Seuls ces octets sont lus, jamais les poids : un fichier de 6 Go se decrit
/// en quelques millisecondes.
fn read_tensor_header(path: &Path) -> Option<TensorHeader> {
    use std::io::Read;
    let mut file = fs::File::open(path).ok()?;
    let mut size = [0u8; 8];
    file.read_exact(&mut size).ok()?;
    let length = u64::from_le_bytes(size);
    // Un en-tete realiste tient sous quelques mega-octets ; au-dela, ce n'est
    // pas un safetensors et on ne gaspille pas la lecture.
    if length == 0 || length > 64 * 1024 * 1024 {
        return None;
    }
    let mut buffer = vec![0u8; length as usize];
    file.read_exact(&mut buffer).ok()?;
    let text = String::from_utf8_lossy(&buffer).to_string();

    let lora = text.contains("lora_A") || text.contains("lora_B") || text.contains("lora_unet_");
    let family = if text.contains("conditioner.embedders.1") || text.contains("conditioner.embedders.2") {
        ImageFamily::Sdxl
    } else if text.contains("cond_stage_model.transformer") || text.contains("cond_stage_model.model") {
        ImageFamily::Sd15
    } else if text.contains("joint_blocks")
        || text.contains("double_blocks")
        || text.contains("single_transformer_blocks")
        || text.contains("audio_patch_proj")
        || text.contains("diffusion_model.blocks.")
    {
        ImageFamily::Dit
    } else {
        ImageFamily::Unknown
    };
    /* Un LoRA DiT ecrit ses cles en `blocks.N...` la ou un LoRA Stable
       Diffusion passe par `lora_unet_` ou `unet.down_blocks`. Sans ce repli, un
       style destine a une architecture video restait sans famille, et le moteur
       refusait de l'appliquer sans qu'on sache pourquoi. */
    /* Un LoRA kohya ne porte pas les noms du modele complet : `lora_te2_`
       signale le second encodeur de texte, donc SDXL ; `lora_te_` seul, SD 1.5.
       C'est le format de la plupart des styles telecharges. */
    let family = if family == ImageFamily::Unknown
        && (text.contains("lora_te2_") || text.contains("text_encoder_2"))
    {
        ImageFamily::Sdxl
    } else if family == ImageFamily::Unknown
        && (text.contains("lora_te_") || text.contains("text_model"))
        && !text.contains("lora_te2_")
    {
        ImageFamily::Sd15
    } else {
        family
    };
    /* Un LoRA kohya peut ne couvrir que le UNet, sans tenseur d'encodeur de
       texte a nommer. SDXL porte alors `label_emb`, que SD 1.5 n'a pas : c'est
       le seul reste pour les distinguer. */
    let family = if family == ImageFamily::Unknown
        && text.contains("down_blocks")
        && !text.contains("label_emb")
    {
        ImageFamily::Sd15
    } else {
        family
    };
    let family = if family == ImageFamily::Unknown
        && text.contains("blocks.")
        && !text.contains("down_blocks")
        && !text.contains("up_blocks")
        && !text.contains("input_blocks")
    {
        ImageFamily::Dit
    } else {
        family
    };
    // Une entree par tenseur, plus la cle de metadonnees.
    let tensors = text.matches("\"dtype\"").count().saturating_sub(0);
    Some(TensorHeader {
        tensors,
        lora,
        family,
    })
}

/// Extensions que le moteur d'images sait ouvrir. `-m` accepte aussi bien un
/// GGUF quantifie qu'un `.safetensors`, un `.ckpt` ou un `.pt` de Stable
/// Diffusion : le format est reconnu a la lecture du fichier.
fn image_model_extension(path: &Path) -> Option<String> {
    let extension = path.extension()?.to_str()?.to_ascii_lowercase();
    if matches!(extension.as_str(), "gguf" | "safetensors" | "ckpt" | "pt") {
        Some(extension)
    } else {
        None
    }
}

/// Reglages de depart d'un checkpoint depose a la main.
///
/// L'en-tete du fichier dit la famille d'architecture, quand il est lisible ;
/// le nom sert de repli, et reste le seul indice pour une version distillee
/// (« turbo », « lightning », « lcm ») : aucun tenseur ne la distingue.
fn guess_image_settings(stem: &str, family: ImageFamily) -> (u32, u32, f32) {
    let lower = stem.to_ascii_lowercase();
    let family = if family == ImageFamily::Unknown {
        let xl = ["xl", "sdxl", "pony", "illustrious", "noob"]
            .iter()
            .any(|key| lower.contains(key));
        if xl { ImageFamily::Sdxl } else { ImageFamily::Sd15 }
    } else {
        family
    };
    let distilled = [
        "turbo", "lightning", "lcm", "dmd", "hyper", "schnell", "tiny", "distill",
    ]
    .iter()
    .any(|key| lower.contains(key));
    let (px, steps, mut cfg) = family.defaults();
    if distilled {
        // Une version distillee tient en 4 pas ; CFG 1, sauf sur SD 1.5 ou
        // certains LCM demandent 1,5.
        return (px, 4, if family == ImageFamily::Sd15 { 1.5 } else { 1.0 });
    }
    if family == ImageFamily::Sd15 {
        cfg = 7.0;
    }
    (px, steps, cfg)
}

/// Nom lisible tire d'un nom de fichier : `dreamshaper_8LCM-iq4_nl` devient
/// « Dreamshaper 8LCM IQ4 NL ». Les quantificateurs restent en capitales.
fn image_pack_name(stem: &str) -> String {
    let cleaned = stem.replace(['_', '-', '.'], " ");
    let words: Vec<String> = cleaned
        .split_whitespace()
        .filter_map(|word| {
            let lower = word.to_ascii_lowercase();
            let shout = is_quant_part(word)
                || matches!(lower.as_str(), "xl" | "sdxl" | "lcm" | "vae")
                || word.chars().any(|character| character.is_ascii_digit());
            if shout {
                Some(word.to_ascii_uppercase())
            } else {
                let mut characters = word.chars();
                characters
                    .next()
                    .map(|first| format!("{}{}", first.to_uppercase(), characters.as_str()))
            }
        })
        .collect();
    if words.is_empty() {
        "Modele d'image".to_string()
    } else {
        words.join(" ")
    }
}

/// Identifiant stable d'un pack ajoute a la main : minuscules, chiffres et
/// tirets. Il sert de cle dans l'interface et dans le fichier de selection.
fn image_pack_id(stem: &str) -> String {
    let mut out = String::with_capacity(stem.len());
    for character in stem.chars() {
        if character.is_ascii_alphanumeric() {
            out.push(character.to_ascii_lowercase());
        } else if !out.ends_with('-') {
            out.push('-');
        }
    }
    let trimmed = out.trim_matches('-').to_string();
    if trimmed.is_empty() {
        "image".to_string()
    } else {
        trimmed
    }
}

/// Un fichier depose dans `models/image/` devient un pack complet : on depose,
/// on rouvre la bibliotheque, il est la. C'est le chargement « a la WordPress »,
/// sans catalogue a modifier ni redemarrage.
fn added_image_pack(path: &Path) -> Option<ImagePack> {
    let file = path.file_name()?.to_str()?.to_string();
    let stem = path.file_stem()?.to_str()?.to_string();
    let bytes = fs::metadata(path).map(|meta| meta.len()).unwrap_or(0);
    // Un fichier vide est certainement un telechargement en cours : le proposer
    // ferait echouer le chargement du moteur.
    if bytes == 0 {
        return None;
    }
    let extension = image_model_extension(path)?;
    let header = if extension == "safetensors" {
        read_tensor_header(path)
    } else {
        None
    };
    /* Un LoRA n'est pas un modele complet : `sd-server -m` echoue a le charger.
       Le proposer comme checkpoint donnait une carte qui ne dessinait rien. Il
       rejoint la liste des styles, ou il a sa place. */
    if header.as_ref().map(|info| info.lora).unwrap_or(false) {
        return None;
    }
    let family = header
        .as_ref()
        .map(|info| info.family)
        .unwrap_or(ImageFamily::Unknown);
    let (px, steps, cfg) = guess_image_settings(&stem, family);
    let kind = if extension == "safetensors" {
        "safetensors".to_string()
    } else {
        extension.to_ascii_uppercase()
    };
    let detected = match (family, header.as_ref().map(|info| info.tensors)) {
        (ImageFamily::Unknown, _) => String::new(),
        (family, Some(tensors)) => format!(", {} tenseurs, famille {}", tensors, family.label()),
        (family, None) => format!(", famille {}", family.label()),
    };
    let caveat = if family == ImageFamily::Dit {
        "\n\nCette famille (DiT) demande son encodeur de texte et son VAE a cote du checkpoint : sans eux, le moteur ne peut pas dessiner. Voyez le pack Z-Image du catalogue pour la disposition attendue."
    } else {
        ""
    };
    Some(ImagePack {
        id: image_pack_id(&stem),
        name: image_pack_name(&stem),
        mode: "checkpoint".to_string(),
        size: format!("~{}", human_size(bytes)),
        license: String::new(),
        note: format!(
            "Depose a la main dans models/image/ ({kind}{detected}). Reglages : {px} px, {steps} pas, CFG {cfg}.{caveat}",
        ),
        bundled: false,
        recommended: false,
        steps,
        cfg,
        px,
        model: file,
        diffusion: String::new(),
        llm: String::new(),
        vae: String::new(),
        url: String::new(),
        lora: String::new(),
        lora_weight: default_lora_weight(),
        prompt_prefix: String::new(),
        lora_url: String::new(),
        added: true,
    })
}

/// Complete la liste des packs avec les fichiers poses a la main. Rejouee a
/// chaque affichage de la bibliotheque : deposer un `.safetensors` ou un
/// `.gguf` dans `models/image/` suffit, sans relancer SIMIA. Un pack ajoute
/// dont le fichier a disparu est retire.
fn discover_image_packs(dir: &Path, packs: &mut Vec<ImagePack>) {
    packs.retain(|pack| !pack.added || dir.join(&pack.model).is_file());

    let declared: Vec<String> = packs
        .iter()
        .flat_map(|pack| pack.file_names())
        .map(|name| name.to_ascii_lowercase())
        .collect();
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    let mut found: Vec<ImagePack> = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() || image_model_extension(&path).is_none() {
            continue;
        }
        let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
            continue;
        };
        let lower = name.to_ascii_lowercase();
        // Un projecteur multimodal accompagne un modele de texte, ce n'est pas
        // un checkpoint d'image. Les fichiers deja cites par un pack non plus.
        if lower.contains("mmproj") || declared.contains(&lower) {
            continue;
        }
        if packs
            .iter()
            .chain(found.iter())
            .any(|pack| pack.model.eq_ignore_ascii_case(name))
        {
            continue;
        }
        if let Some(pack) = added_image_pack(&path) {
            if packs.iter().chain(found.iter()).any(|known| known.id == pack.id) {
                continue;
            }
            found.push(pack);
        }
    }
    found.sort_by(|first, second| first.name.to_lowercase().cmp(&second.name.to_lowercase()));
    packs.extend(found);
}

/// LoRA disponibles dans `models/image/loras/` et a la racine de
/// `models/image/`. Le moteur les applique quand la requete porte
/// `lora: [{path, multiplier}]` : on change de style sans recharger le
/// checkpoint, et un fichier depose la est utilisable tout de suite.
///
/// La famille visee est lue dans l'en-tete : un LoRA entraine pour une autre
/// architecture que le modele charge ne s'applique pas, autant le dire avant
/// de lancer une generation qui echouera.
struct ImageLora {
    name: String,
    /// Chemin relatif a `models/image/`, tel que le moteur l'attend : un style
    /// range dans `loras/` s'ecrit `loras/<fichier>`.
    path: String,
    bytes: u64,
    family: ImageFamily,
}

fn collect_loras(entries: impl Iterator<Item = std::io::Result<fs::DirEntry>>, found: &mut Vec<ImageLora>) {
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let extension = path
            .extension()
            .and_then(|value| value.to_str())
            .map(|value| value.to_ascii_lowercase());
        if !matches!(extension.as_deref(), Some("safetensors") | Some("pt") | Some("ckpt")) {
            continue;
        }
        let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
            continue;
        };
        let header = read_tensor_header(&path);
        /* A la racine, seuls les fichiers qui sont vraiment des LoRA sont
           retenus : un checkpoint complet y est deja une carte. Dans loras/,
           tout est accepte, comme avant, pour ne rien faire disparaitre d'un
           dossier que l'utilisateur a rempli exprès. */
        let in_loras_dir = path
            .parent()
            .and_then(|parent| parent.file_name())
            .and_then(|value| value.to_str())
            .map(|value| value.eq_ignore_ascii_case("loras"))
            .unwrap_or(false);
        if !in_loras_dir && !header.as_ref().map(|info| info.lora).unwrap_or(false) {
            continue;
        }
        if found.iter().any(|lora| lora.name == name) {
            continue;
        }
        let bytes = fs::metadata(&path).map(|meta| meta.len()).unwrap_or(0);
        found.push(ImageLora {
            name: name.to_string(),
            path: if in_loras_dir {
                format!("loras/{name}")
            } else {
                name.to_string()
            },
            bytes,
            family: header
                .map(|info| info.family)
                .unwrap_or(ImageFamily::Unknown),
        });
    }
}

fn discover_image_loras(dir: &Path) -> Vec<ImageLora> {
    let mut found: Vec<ImageLora> = Vec::new();
    if let Ok(entries) = fs::read_dir(dir.join("loras")) {
        collect_loras(entries, &mut found);
    }
    if let Ok(entries) = fs::read_dir(dir) {
        collect_loras(entries, &mut found);
    }
    found.sort_by(|first, second| first.name.to_lowercase().cmp(&second.name.to_lowercase()));
    found
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
            None => Some(
                "aucun modele d'image : deposez un .safetensors ou un .gguf dans models/image/, ou choisissez un pack du catalogue".to_string(),
            ),
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

    /// Relit le dossier avant d'afficher la bibliotheque : un fichier depose
    /// entre-temps apparait, un fichier efface disparait.
    fn refresh(&mut self) {
        discover_image_packs(&self.dir, &mut self.packs);
        let lost = self
            .selected
            .as_deref()
            .map(|id| self.pack(id).is_none())
            .unwrap_or(false);
        if lost {
            self.selected = None;
            self.resolve_selection();
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
    /// Editeur europeen : affiche sur la carte et retenu par le filtre.
    #[serde(default)]
    origin: String,
    #[serde(default)]
    vendor: String,
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

// ---------------------------------------------------------------------------
// Console : banniere, couleurs, progression
// ---------------------------------------------------------------------------
//
// Le lanceur s'ouvre dans une fenetre noire : c'est le premier contact avec
// SIMIA installe. Sans reperes ni couleur, cette fenetre ressemble a un journal
// de debogage. On y pose donc une banniere, des etapes numerotees et une vraie
// barre de progression.
//
// Les couleurs ne s'affichent que dans un terminal : redirigees vers un fichier
// ou un service, les sequences ANSI seraient du bruit. La variable NO_COLOR
// (norme reprise par la plupart des outils) les coupe aussi.
//
// Sous Windows, conhost n'interprete pas ces sequences tant que
// ENABLE_VIRTUAL_TERMINAL_PROCESSING n'est pas arme sur le handle de sortie :
// sans cet appel, la fenetre afficherait « ←[38;2;201;231;68m » en clair.

const RESET: &str = "\x1b[0m";
const BOLD: &str = "\x1b[1m";
const DIM: &str = "\x1b[2m";
/// Le vert de l'interface (#c9e744), puis deux teintes plus sourdes.
const LIME: &str = "\x1b[38;2;201;231;68m";
const GREEN: &str = "\x1b[38;2;143;174;92m";
const GREY: &str = "\x1b[38;2;126;136;128m";
const RED: &str = "\x1b[38;2;214;104;84m";

fn color_setting() -> bool {
    static ENABLED: OnceLock<bool> = OnceLock::new();
    *ENABLED.get_or_init(|| {
        if env::var_os("NO_COLOR").is_some() {
            return false;
        }
        // Convention CLICOLOR_FORCE : permet de garder les couleurs dans un
        // journal redirige, et de les couper dans un terminal (NO_COLOR).
        if env::var_os("CLICOLOR_FORCE").is_some_and(|value| value != "0") {
            return true;
        }
        if !std::io::stdout().is_terminal() {
            return false;
        }
        #[cfg(windows)]
        if !win_console::enable_ansi() {
            return false;
        }
        true
    })
}

fn paint(text: &str, color: &str) -> String {
    if color_setting() {
        format!("{color}{text}{RESET}")
    } else {
        text.to_string()
    }
}

/// `SIMIA` en grandes lettres. Chaque glyphe est decrit par colonne de rendu
/// (six lignes), pour que l'alignement se verifie a la lecture du code et non
/// dans une chaine de 300 caracteres. Uniquement des caracteres ASCII : une
/// fenetre Windows en page de code 437 ou 850 n'afficherait pas autre chose.
const SIMIA_GLYPHS: [[&str; 6]; 5] = [
    [
        "  ____  ",
        " / ___| ",
        " \\___ \\ ",
        "  ___) |",
        " |____/ ",
        "        ",
    ],
    [" ___ ", "|_ _|", " | | ", " | | ", "|___|", "     "],
    [
        " __  __ ",
        "|  \\/  |",
        "| |\\/| |",
        "| |  | |",
        "|_|  |_|",
        "        ",
    ],
    [" ___ ", "|_ _|", " | | ", " | | ", "|___|", "     "],
    [
        "    _    ",
        "   / \\   ",
        "  / _ \\  ",
        " / ___ \\ ",
        "/_/   \\_\\",
        "         ",
    ],
];

fn banner_rows() -> Vec<String> {
    (0..6)
        .map(|line| {
            SIMIA_GLYPHS
                .iter()
                .map(|glyph| glyph[line])
                .collect::<Vec<_>>()
                .join(" ")
        })
        .collect()
}

fn print_banner() {
    println!();
    let shades = [LIME, LIME, GREEN, GREEN, GREEN, GREY];
    for (index, row) in banner_rows().iter().enumerate() {
        println!(" {}", paint(row, shades[index.min(shades.len() - 1)]));
    }
    println!();
    println!(
        "  {}   {}",
        paint("assistant local, prive et hors ligne", GREY),
        paint(&format!("v{APP_VERSION}"), DIM)
    );
    println!("  {}", paint(&"-".repeat(46), DIM));
}

/// Une etape annoncee avant d'agir : le lecteur sait ce qui est en cours et
/// combien il en reste.
fn step(number: u8, total: u8, label: &str) {
    println!(
        "  {} {}",
        paint(&format!("{number}/{total}"), GREY),
        paint(label, BOLD)
    );
}

fn step_ok(label: &str) {
    println!("      {} {}", paint("ok", LIME), paint(label, GREY));
}

fn step_info(label: &str, value: &str) {
    println!("      {} {}", paint(label, GREY), value);
}

/// Efface la ligne courante : la barre de progression est reecrite sur place,
/// et une ligne plus courte laisserait la fin de la precedente.
fn clear_line(width: usize) {
    print!("\r{}\r", " ".repeat(width));
    let _ = std::io::stdout().flush();
}

#[cfg(windows)]
mod win_console {
    use std::ffi::c_void;

    #[link(name = "kernel32")]
    extern "system" {
        fn GetStdHandle(kind: u32) -> *mut c_void;
        fn GetConsoleMode(handle: *mut c_void, mode: *mut u32) -> i32;
        fn SetConsoleMode(handle: *mut c_void, mode: u32) -> i32;
    }

    const STD_OUTPUT_HANDLE: u32 = 0xFFFF_FFF5; // -11 en u32
    const ENABLE_VIRTUAL_TERMINAL_PROCESSING: u32 = 0x0004;

    pub fn enable_ansi() -> bool {
        unsafe {
            let handle = GetStdHandle(STD_OUTPUT_HANDLE);
            if handle.is_null() || handle as isize == -1 {
                return false;
            }
            let mut mode = 0u32;
            if GetConsoleMode(handle, &mut mode) == 0 {
                return false;
            }
            SetConsoleMode(handle, mode | ENABLE_VIRTUAL_TERMINAL_PROCESSING) != 0
        }
    }
}


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

    print_banner();

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
        step(1, 3, &format!("Premier lancement : telechargement de {} ({})", start.name, start.size));
        let bar_width = 26usize;
        if let Err(err) = download_model(&start, &models_dir, |downloaded, total| {
            let pct = if total > 0 { downloaded * 100 / total } else { 0 };
            let filled = (pct as usize * bar_width / 100).min(bar_width);
            let bar = format!(
                "{}{}",
                "#".repeat(filled),
                "-".repeat(bar_width - filled)
            );
            print!(
                "\r      {} [{bar}] {:>3} %  {} / {}",
                paint(">", GREEN),
                pct,
                human_size(downloaded),
                human_size(total)
            );
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

    step_info("interface", &web.display().to_string());
    step_info("moteur", &llama_bin.display().to_string());
    step_info(
        "modeles",
        &format!(
            "{local_count} sur le disque / {} au catalogue ({})",
            models.len(),
            human_size(catalog_bytes)
        ),
    );
    step_info(
        "hebergement",
        &format!("{hosted_count} sur le serveur, {} en CDN", models.len() - hosted_count),
    );
    if !catalog_base.is_empty() {
        step_info("catalogue", &format!("v{catalog_version} ({catalog_base})"));
    }
    step_info(
        "backend",
        &format!("127.0.0.1:{llama_port} · contexte {ctx_size} tokens"),
    );
    println!();

    let (mut child, llama_log) = match spawn_llama(&llama_bin, &start.path, start.mmproj.as_deref(), llama_port, ctx_size) {
        Ok(pair) => pair,
        Err(err) => fail(&format!("Impossible de demarrer llama-server : {err}")),
    };
    let pid_file = write_pid_file(llama_port, child.id());

    step(2, 3, &format!("Chargement de {} dans le GPU", start.name));
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
    let _ = fs::create_dir_all(image_dir.join("loras"));
    let mut image_packs = load_image_packs(&image_dir);
    discover_image_packs(&image_dir, &mut image_packs);
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
        "      {} {}",
        paint("images", GREY),
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

    // Le serveur ecoute AVANT l'ouverture de la fenetre. Dans l'ordre inverse,
    // le navigateur arrivait sur un port encore ferme : page d'erreur, et il
    // fallait recliquer sur l'icone une fois SIMIA pret. C'est exactement ce
    // qui se produisait au premier lancement, quand le modele se telecharge.
    let server = match Server::http(("127.0.0.1", ui_port)) {
        Ok(server) => server,
        Err(err) => {
            shutdown(&state);
            let _ = fs::remove_file(&pid_file);
            fail(&format!("Impossible d'ecouter sur le port {ui_port} : {err}"));
        }
    };

    let url = format!("http://127.0.0.1:{ui_port}/");
    step(3, 3, "Ouverture de l'interface");
    if !no_browser {
        // Ceinture et bretelles : la socket est deja ouverte, mais on attend
        // qu'elle accepte reellement une connexion avant de lancer le
        // navigateur, pour ne jamais lui montrer une page d'erreur.
        wait_for_port(ui_port, Duration::from_secs(5));
        match launch_browser(&url) {
            Some(_) => step_ok(&format!("fenetre applicative ouverte : {url}")),
            None => {
                step_ok("aucun navigateur Chromium trouve");
                step_info("ouvrez SIMIA dans votre navigateur", &url);
            }
        }
    } else {
        step_ok(&format!("interface disponible sur {url}"));
    }
    println!();
    println!(
        "  {}",
        paint(
            "Changez de modele depuis la bibliotheque. Fermez cette fenetre ou Ctrl+C pour quitter.",
            GREY
        )
    );
    println!();

    for request in server.incoming_requests() {
        let state = Arc::clone(&state);
        let llama_bin = llama_bin.clone();
        thread::spawn(move || handle(state, llama_bin, request));
    }

    shutdown(&state);
    let _ = fs::remove_file(&pid_file);
}

/// Attend que le port accepte une connexion TCP, sans jamais echouer : le
/// navigateur sait aussi afficher un rechargement.
fn wait_for_port(port: u16, timeout: Duration) {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if TcpStream::connect_timeout(
            &format!("127.0.0.1:{port}").parse().expect("adresse locale valide"),
            Duration::from_millis(200),
        )
        .is_ok()
        {
            return;
        }
        thread::sleep(Duration::from_millis(60));
    }
}

fn print_help() {
    print_banner();
    println!("  {}", paint("Options", BOLD));
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
    println!();
    eprintln!("  {} {}", paint("erreur", RED), message);
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
            origin: entry.origin.clone(),
            vendor: entry.vendor.clone(),
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
    let mmproj = find_mmproj(path);
    ModelEntry {
        id: stem,
        name,
        // Un GGUF depose a la main avec son projecteur multimodal est un modele
        // d'image : le cataloguer « Generaliste » le cachait du filtre Vision,
        // seul endroit ou l'on comprend qu'il peut lire une capture.
        category: if mmproj.is_some() {
            "Vision".to_string()
        } else {
            "Généraliste".to_string()
        },
        size,
        path: path.to_path_buf(),
        bytes,
        local: true,
        url: None,
        mirror: None,
        hosted: false,
        recommended: false,
        origin: String::new(),
        vendor: String::new(),
        mmproj,
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
    for preferred in PREFERRED_LOCAL {
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
    // Rien sur le disque : on choisit explicitement un Qwen generaliste a
    // telecharger, au lieu de laisser le tri par categorie designer un modele
    // de code.
    for preferred in PREFERRED_BOOTSTRAP {
        if let Some(found) = models
            .iter()
            .find(|model| model.id.to_lowercase().contains(preferred))
        {
            return found.clone();
        }
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

/// Ouvre un dossier dans le gestionnaire de fichiers du systeme.
fn open_in_file_manager(dir: &Path) -> std::io::Result<Child> {
    #[cfg(target_os = "windows")]
    {
        Command::new("explorer").arg(dir).spawn()
    }
    #[cfg(target_os = "macos")]
    {
        Command::new("open").arg(dir).spawn()
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        Command::new("xdg-open").arg(dir).spawn()
    }
}

fn sd_log_path(port: u16) -> std::path::PathBuf {
    std::env::temp_dir().join(format!("simia-sd-{port}.log"))
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
    /* Toujours transmis, meme sans LoRA par defaut : un fichier depose dans
       loras/ doit pouvoir s'appliquer a la generation suivante, sans relancer
       le moteur. Le style choisi part dans le champ `lora` de la requete. */
    /* Un seul dossier, et c'est la racine : le moteur n'en retient qu'un, et
       passer `--lora-model-dir` deux fois faisait perdre le premier — les LoRA
       de `loras/` devenaient introuvables. Depuis la racine, un style range
       dans `loras/` se designe par `loras/<fichier>`, et un style depose a la
       racine par son seul nom. */
    command.arg("--lora-model-dir").arg(dir);
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
        .stdin(Stdio::null());
    // sd-server meurt sans message quand la VRAM manque au moment de dessiner :
    // sans ce journal, l'utilisateur ne voyait qu'un « GPU libre ? » vague.
    match fs::File::create(sd_log_path(port)) {
        Ok(log) => match log.try_clone() {
            Ok(copy) => {
                command.stdout(Stdio::from(log)).stderr(Stdio::from(copy));
            }
            Err(_) => {
                command.stdout(Stdio::null()).stderr(Stdio::null());
            }
        },
        Err(_) => {
            command.stdout(Stdio::null()).stderr(Stdio::null());
        }
    }
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

/// Famille d'un pack du catalogue, deduite de sa forme : un pack a trois
/// fichiers (Z-Image) est un DiT, un pack en 1024 px est du SDXL, le reste du
/// SD 1.5. Un fichier ajoute a la main a deja sa famille, lue dans l'en-tete.
fn pack_family(pack: &ImagePack) -> ImageFamily {
    if pack.mode == "zimage" {
        return ImageFamily::Dit;
    }
    if pack.px >= 768 {
        ImageFamily::Sdxl
    } else if pack.px > 0 {
        ImageFamily::Sd15
    } else {
        ImageFamily::Unknown
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
                        "{{\"id\":{},\"name\":{},\"mode\":{},\"size\":{},\"note\":{},\"license\":{},\"steps\":{},\"cfg\":{},\"px\":{},\"local\":{},\"bytes\":{},\"downloadable\":{},\"recommended\":{},\"bundled\":{},\"lora\":{},\"loraWeight\":{},\"promptPrefix\":{},\"added\":{},\"family\":{}}}",
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
                        pack.bundled,
                        js_escape(&pack.lora),
                        pack.lora_weight,
                        js_escape(&pack.prompt_prefix),
                        pack.added,
                        js_escape(pack_family(pack).key())
                    )
                })
                .collect::<Vec<_>>()
                .join(",");
            let loras = discover_image_loras(&guard.image.dir)
                .iter()
                .map(|lora| {
                    format!(
                        "{{\"name\":{},\"path\":{},\"bytes\":{},\"family\":{}}}",
                        js_escape(&lora.name),
                        js_escape(&lora.path),
                        lora.bytes,
                        js_escape(lora.family.key())
                    )
                })
                .collect::<Vec<_>>()
                .join(",");
            format!(
                "{{\"selected\":{},\"bin\":{},\"packs\":[{}],\"loras\":[{}]}}",
                js_escape(&selected),
                guard.image.bin.is_some(),
                entries,
                loras
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
        origin: String::new(),
        vendor: String::new(),
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

/// Barre défilante pour une attente sans pourcentage : un bloc de six
/// caractères traverse la barre. Fonction pure, pour être vérifiable seule.
fn marquee(slide: usize, width: usize) -> String {
    let wrapped = slide % (width + 8);
    let head = wrapped.saturating_sub(6);
    let tail = wrapped.min(width);
    (0..width)
        .map(|index| if index >= head && index < tail { '#' } else { '-' })
        .collect()
}

/// Attend que le moteur reponde, en s'arretant des que le processus meurt.
/// Un binaire incompatible sort en quelques millisecondes : l'ancienne boucle
/// attendait alors jusqu'a 240 s avant d'accuser le GPU.
///
/// La progression remplace la suite de points : une barre qui defile, un
/// compteur de secondes et le nom du modele. Les points ne disaient ni que le
/// travail avançait ni combien de temps il restait ; ils ressemblaient a une
/// animation d'attente sans fin.
fn wait_healthy(child: &mut Child, port: u16, log_path: &Path) -> Result<(), String> {
    const FRAMES: [&str; 4] = ["|", "/", "-", "\\"];
    const BAR_WIDTH: usize = 26;
    let started = Instant::now();
    let deadline = started + HEALTH_TIMEOUT;
    let mut tick: usize = 0;
    loop {
        if let Ok((200, _, _)) = http_call(port, "GET", "/health", None, Duration::from_secs(2)) {
            clear_line(BAR_WIDTH + 24);
            step_ok(&format!(
                "modele charge en {} s, GPU pret",
                started.elapsed().as_secs()
            ));
            return Ok(());
        }
        if let Ok(Some(status)) = child.try_wait() {
            clear_line(BAR_WIDTH + 24);
            let detail = tail_of(log_path, 2);
            let mut message = format!("le moteur s'est arrete pendant le chargement ({status})");
            if !detail.is_empty() {
                message.push_str(" : ");
                message.push_str(&detail);
            }
            return Err(message);
        }
        if Instant::now() >= deadline {
            clear_line(BAR_WIDTH + 24);
            let detail = tail_of(log_path, 2);
            return Err(if detail.is_empty() {
                "le moteur n'a pas repondu dans le delai imparti".to_string()
            } else {
                format!("le moteur n'a pas repondu dans le delai imparti. {detail}")
            });
        }
        // Bloc de six caracteres qui traverse la barre : mouvement continu,
        // sans laisser croire a un pourcentage que le moteur ne donne pas.
        let bar = marquee(tick, BAR_WIDTH);
        let line = format!(
            "      {} [{}] {:>3} s",
            FRAMES[tick % FRAMES.len()],
            bar,
            started.elapsed().as_secs()
        );
        print!("\r{}", paint(&line, GREEN));
        let _ = std::io::stdout().flush();
        tick += 1;
        thread::sleep(Duration::from_millis(160));
    }
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
        if let Ok(mut child) = command.spawn() {
            /* `open` existe sur tous les Mac : si l'application demandee est
               absente, le processus se termine aussitot avec un code d'erreur.
               Sans cette verification, un Mac sans Chrome n'ouvrait aucune
               fenetre alors que le lanceur annoncait le contraire. Un code 0
               signifie au contraire que le navigateur a delegue l'ouverture a
               une instance deja lancee : c'est un succes. */
            thread::sleep(Duration::from_millis(700));
            match child.try_wait() {
                Ok(Some(status)) if !status.success() => continue,
                _ => return Some(child),
            }
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
                        "{{\"id\":{},\"name\":{},\"category\":{},\"size\":{},\"bytes\":{},\"local\":{},\"recommended\":{},\"vision\":{},\"hosted\":{},\"mirror\":{},\"origin\":{},\"vendor\":{}}}",
                        js_escape(&model.id),
                        js_escape(&model.name),
                        js_escape(&model.category),
                        js_escape(&model.size),
                        model.bytes,
                        model.local,
                        model.recommended,
                        model.mmproj.is_some(),
                        model.hosted,
                        model.mirror.is_some(),
                        js_escape(&model.origin),
                        js_escape(&model.vendor)
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
        if let Ok(mut guard) = state.lock() {
            guard.image.refresh();
        }
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

    /* Le dossier des modeles d'image : on y depose un `.safetensors` ou un
       `.gguf`, un LoRA dans `loras/`, et la bibliotheque les propose. */
    if path == "/_simia/open-image" {
        let dir = match state.lock() {
            Ok(guard) => guard.image.dir.clone(),
            Err(_) => PathBuf::new(),
        };
        if dir.as_os_str().is_empty() {
            respond_json(request, 500, "{\"error\":\"dossier inconnu\"}".to_string());
            return;
        }
        let _ = fs::create_dir_all(dir.join("loras"));
        match open_in_file_manager(&dir) {
            Ok(_) => respond_json(
                request,
                200,
                format!("{{\"path\":{}}}", js_escape(&dir.display().to_string())),
            ),
            Err(error) => respond_json(
                request,
                500,
                format!("{{\"error\":{}}}", js_escape(&error.to_string())),
            ),
        }
        return;
    }

    /* Ouvre le dossier models/ dans le gestionnaire de fichiers du systeme.
       L'utilisateur peut y deposer n'importe quel .gguf : le lanceur le
       decouvre au prochain demarrage, sans passer par le catalogue. */
    if path == "/_simia/open-models" {
        let dir = match state.lock() {
            Ok(guard) => guard.models_dir.clone(),
            Err(_) => PathBuf::new(),
        };
        if dir.as_os_str().is_empty() {
            respond_json(request, 500, "{\"error\":\"dossier inconnu\"}".to_string());
            return;
        }
        let _ = fs::create_dir_all(&dir);
        match open_in_file_manager(&dir) {
            Ok(_) => respond_json(request, 200, format!("{{\"path\":{}}}", js_escape(&dir.display().to_string()))),
            Err(error) => respond_json(request, 500, format!("{{\"error\":{}}}", js_escape(&error.to_string()))),
        }
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
        let (port, ready, lora, exited) = match state.lock() {
            Ok(mut guard) => {
                let lora = guard.image.current().and_then(|pack| {
                    pack.lora_file().map(|file| (file.to_string(), pack.lora_weight))
                });
                // Un sd-server mort laisse l'etat a « ready » : sans ce controle,
                // chaque requete echouait sur une connexion refusee et
                // l'interface concluait a un GPU occupe.
                let exited = match guard.image.child.as_mut() {
                    Some(child) => !matches!(child.try_wait(), Ok(None)),
                    None => guard.image.state == "ready",
                };
                if exited {
                    guard.image.child = None;
                    if guard.image.state == "ready" {
                        guard.image.state = "stopped".to_string();
                        guard.image.message = "le generateur d'images s'est arrete".to_string();
                        guard.image.last_used = None;
                    }
                }
                (
                    guard.image.port,
                    guard.image.state == "ready",
                    lora,
                    exited,
                )
            }
            Err(_) => (0, false, None, true),
        };
        if !ready || port == 0 || exited {
            respond_json(
                request,
                503,
                "{\"error\":\"image_engine_not_ready\",\"message\":\"modele d'image non charge\"}"
                    .to_string(),
            );
            return;
        }
        let generating = url.ends_with("/v1/img_gen") || url.ends_with("/sdapi/v1/txt2img");
        if generating {
            // Le GPU n'heberge qu'un moteur a la fois. Sans cette liberation,
            // sd-server demarrait avec la VRAM deja prise par llama-server et
            // mourait au premier pas de debruitage.
            stop_llama(&state);
        }
        if let Ok(mut guard) = state.lock() {
            guard.image.last_used = Some(Instant::now());
        }
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
    // Les fichiers du catalogue sont ranges dans `loras/` : le chemin doit le dire.
    let entry = format!(
        "{{\"path\":{},\"multiplier\":{}}}",
        js_escape(&format!("loras/{file}")),
        weight
    );
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
            // La cause est presque toujours dans le journal de sd-server :
            // allocation Vulkan refusee, modele invalide, plantage du backend.
            let detail = tail_of(&sd_log_path(port), 3);
            let body = if detail.is_empty() {
                format!("{{\"error\":{}}}", js_escape(&err.to_string()))
            } else {
                format!(
                    "{{\"error\":{},\"detail\":{}}}",
                    js_escape(&err.to_string()),
                    js_escape(&detail)
                )
            };
            let _ = request.respond(Response::from_string(body).with_status_code(StatusCode(502)));
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
                "{{\"available\":{},\"supported\":{},\"width\":{},\"height\":{},\"steps\":{},\"cfg\":{},\"model\":{},\"apiBase\":\"\",\"packsUrl\":\"/_simia/image/packs\",\"selectPackUrl\":\"/_simia/image/select\",\"downloadPackUrl\":\"/_simia/image/download\",\"statusUrl\":\"/_simia/image/status\",\"prepareUrl\":\"/_simia/image/prepare\",\"generateUrl\":\"/sdapi/v1/txt2img\",\"jobsUrl\":\"/sdcpp/v1/jobs\"}}",
                guard.image.available(),
                guard.image.bin.is_some() && guard.image.probe.is_none(),
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
                        "{{\"id\":{},\"name\":{},\"category\":{},\"size\":{},\"bytes\":{},\"local\":{},\"recommended\":{},\"vision\":{},\"hosted\":{},\"mirror\":{},\"origin\":{},\"vendor\":{}}}",
                        js_escape(&model.id),
                        js_escape(&model.name),
                        js_escape(&model.category),
                        js_escape(&model.size),
                        model.bytes,
                        model.local,
                        model.recommended,
                        model.mmproj.is_some(),
                        model.hosted,
                        model.mirror.is_some(),
                        js_escape(&model.origin),
                        js_escape(&model.vendor)
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

#[cfg(test)]
mod console_tests {
    use super::*;

    /// Les six lignes de la banniere doivent avoir la meme largeur : une seule
    /// ligne plus courte ou plus longue decalerait les lettres du mot.
    #[test]
    fn banner_rows_are_aligned() {
        let rows = banner_rows();
        assert_eq!(rows.len(), 6);
        let width = rows[0].chars().count();
        for row in &rows {
            assert_eq!(row.chars().count(), width, "ligne de largeur differente : {row:?}");
        }
        assert!(width > 30, "banniere trop etroite : {width}");
    }

    /// La banniere ne doit contenir que de l'ASCII : une fenetre Windows en
    /// page de code 437 ou 850 afficherait autrement des octets parasites.
    #[test]
    fn banner_is_pure_ascii() {
        for row in banner_rows() {
            assert!(row.is_ascii(), "caractere non ASCII dans la banniere : {row:?}");
        }
    }

    /// La barre garde sa largeur a chaque image, et le bloc avance puis
    /// revient au debut : sinon la ligne effacee laisserait des restes.
    #[test]
    fn marquee_keeps_its_width_and_moves() {
        let width = 26;
        let frames: Vec<String> = (0..width + 8).map(|slide| marquee(slide, width)).collect();
        for frame in &frames {
            assert_eq!(frame.chars().count(), width, "largeur instable : {frame:?}");
        }
        assert_ne!(frames[0], frames[6], "le bloc ne bouge pas");
        assert_eq!(frames[0], marquee(width + 8, width), "le cycle ne se referme pas");
        assert!(frames[6].starts_with("######"), "le bloc n'est pas en tete : {:?}", frames[6]);
    }
}

#[cfg(test)]
mod image_pack_tests {
    use super::*;

    fn scratch(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("simia-image-{label}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("dossier de test");
        dir
    }

    fn touch(dir: &Path, name: &str, bytes: usize) -> PathBuf {
        let path = dir.join(name);
        if let Some(parent) = path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        fs::write(&path, vec![0u8; bytes]).expect("fichier de test");
        path
    }

    /// Ecrit un .safetensors minimal : longueur, puis en-tete JSON.
    fn fake_safetensors(dir: &Path, name: &str, keys: &[&str]) -> PathBuf {
        let mut header = String::from("{");
        for (index, key) in keys.iter().enumerate() {
            if index > 0 {
                header.push(',');
            }
            header.push_str(&format!(
                "\"{key}\":{{\"dtype\":\"F16\",\"shape\":[2],\"data_offsets\":[0,4]}}"
            ));
        }
        header.push('}');
        let path = dir.join(name);
        if let Some(parent) = path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let mut bytes = (header.len() as u64).to_le_bytes().to_vec();
        bytes.extend_from_slice(header.as_bytes());
        bytes.extend_from_slice(&[0u8; 4]);
        fs::write(&path, bytes).expect("safetensors de test");
        path
    }

    #[test]
    fn devine_les_reglages_d_apres_le_nom() {
        assert_eq!(guess_image_settings("dreamshaper_8", ImageFamily::Unknown), (512, 20, 7.0));
        assert_eq!(
            guess_image_settings("pony-diffusion-v6-xl", ImageFamily::Unknown),
            (1024, 25, 7.0)
        );
        assert_eq!(guess_image_settings("sdxl-turbo", ImageFamily::Unknown), (1024, 4, 1.0));
        assert_eq!(
            guess_image_settings("anything-v5-lcm", ImageFamily::Unknown),
            (512, 4, 1.5)
        );
        // L'en-tete prime sur le nom : un fichier nomme « xl » qui contient du
        // SD 1.5 se dessine en 512 px.
        assert_eq!(guess_image_settings("mon-modele-xl", ImageFamily::Sd15), (512, 20, 7.0));
    }

    #[test]
    fn l_en_tete_distingue_un_lora_d_un_checkpoint() {
        let dir = scratch("en-tete");

        let lora = fake_safetensors(
            &dir,
            "mon-style.safetensors",
            &[
                "diffusion_model.blocks.0.attn.qkv_proj.lora_A.weight",
                "diffusion_model.blocks.0.attn.qkv_proj.lora_B.weight",
            ],
        );
        let info = read_tensor_header(&lora).expect("en-tete lisible");
        assert!(info.lora);
        assert_eq!(info.family, ImageFamily::Dit);
        assert_eq!(info.tensors, 2);
        // Un LoRA n'est pas un checkpoint : pas de carte.
        assert!(added_image_pack(&lora).is_none());

        let sdxl = fake_safetensors(
            &dir,
            "mon-modele.safetensors",
            &[
                "conditioner.embedders.1_model_embed.weight",
                "model.diffusion_model.input_blocks.0.weight",
            ],
        );
        let info = read_tensor_header(&sdxl).expect("en-tete lisible");
        assert!(!info.lora);
        assert_eq!(info.family, ImageFamily::Sdxl);
        let pack = added_image_pack(&sdxl).expect("checkpoint reconnu");
        assert_eq!(pack.px, 1024);
        assert!(pack.note.contains("famille SDXL"));

        let sd15 = fake_safetensors(
            &dir,
            "vieux-modele.safetensors",
            &["cond_stage_model.transformer.text_model.embeddings.token_embedding.weight"],
        );
        assert_eq!(
            read_tensor_header(&sd15).map(|info| info.family),
            Some(ImageFamily::Sd15)
        );

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn un_fichier_qui_n_est_pas_un_safetensors_est_ignore_proprement() {
        let dir = scratch("binaire");
        let path = dir.join("tronque.safetensors");
        fs::write(&path, [1u8, 2, 3]).expect("fichier court");
        assert!(read_tensor_header(&path).is_none());
        // Repli sur le nom, sans paniquer.
        let pack = added_image_pack(&path);
        assert!(pack.is_some(), "un fichier court reste propose, faute de mieux");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn identifiant_stable_et_lisible() {
        assert_eq!(image_pack_id("DreamShaper 8 LCM"), "dreamshaper-8-lcm");
        assert_eq!(image_pack_id("__weird__"), "weird");
        assert_eq!(image_pack_name("dreamshaper_8LCM-v2"), "Dreamshaper 8LCM V2");
    }

    #[test]
    fn un_safetensors_depose_devient_un_pack() {
        let dir = scratch("safetensors");
        let path = touch(&dir, "dreamshaperXL_turbo.safetensors", 2048);
        let pack = added_image_pack(&path).expect("pack reconnu");
        assert!(pack.added);
        assert_eq!(pack.mode, "checkpoint");
        assert_eq!(pack.model, "dreamshaperXL_turbo.safetensors");
        assert_eq!(pack.px, 1024);
        assert_eq!(pack.steps, 4);
        assert!(pack.note.contains("safetensors"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn un_fichier_vide_est_ignore() {
        let dir = scratch("vide");
        let path = touch(&dir, "encours.safetensors", 0);
        assert!(added_image_pack(&path).is_none());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn le_dossier_complete_sans_doublon_ni_fichier_etranger() {
        let dir = scratch("dossier");
        let graine = touch(&dir, "graine.safetensors", 16);
        let mut packs = vec![ImagePack {
            id: "catalog".to_string(),
            model: "sd15.gguf".to_string(),
            ..added_image_pack(&graine).expect("graine")
        }];
        packs[0].added = false;
        fs::remove_file(&graine).expect("retrait de la graine");
        touch(&dir, "sd15.gguf", 32);
        touch(&dir, "maison.safetensors", 64);
        touch(&dir, "notes.txt", 8);
        touch(&dir, "mmproj-vision.gguf", 8);
        touch(&dir, "loras/style.safetensors", 8);

        discover_image_packs(&dir, &mut packs);
        discover_image_packs(&dir, &mut packs);

        let ids: Vec<&str> = packs.iter().map(|pack| pack.id.as_str()).collect();
        assert_eq!(ids, vec!["catalog", "maison"]);
        assert!(packs[1].added);

        fs::remove_file(dir.join("maison.safetensors")).expect("suppression");
        discover_image_packs(&dir, &mut packs);
        assert_eq!(packs.len(), 1);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn les_lora_kohya_sont_rattaches_a_leur_famille() {
        let dir = scratch("kohya");
        // SD 1.5 : down_blocks, aucun label_emb, aucun second encodeur.
        let sd15 = fake_safetensors(
            &dir,
            "gravure.safetensors",
            &[
                "lora_unet_down_blocks_0_attentions_0_transformer_blocks_0_attn1_to_k.lora_down.weight",
                "lora_unet_down_blocks_0_attentions_0_transformer_blocks_0_attn1_to_k.lora_up.weight",
            ],
        );
        assert_eq!(
            read_tensor_header(&sd15).map(|info| info.family),
            Some(ImageFamily::Sd15)
        );

        // SDXL : le second encodeur suffit a le dire.
        let sdxl = fake_safetensors(
            &dir,
            "pony-style.safetensors",
            &["lora_te2_text_model_encoder_layers_0_mlp_fc1.lora_down.weight"],
        );
        assert_eq!(
            read_tensor_header(&sdxl).map(|info| info.family),
            Some(ImageFamily::Sdxl)
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn les_lora_du_dossier_sont_listes() {
        let dir = scratch("loras");
        touch(&dir, "loras/simia-gravure.safetensors", 32);
        touch(&dir, "loras/photo.pt", 16);
        touch(&dir, "loras/readme.txt", 4);
        let loras = discover_image_loras(&dir);
        let names: Vec<String> = loras.iter().map(|lora| lora.name.clone()).collect();
        assert_eq!(names, vec!["photo.pt", "simia-gravure.safetensors"]);
        assert_eq!(loras[1].path, "loras/simia-gravure.safetensors");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn un_lora_a_la_racine_rejoint_les_styles_et_pas_les_packs() {
        let dir = scratch("racine");
        fake_safetensors(&dir, "mon-style.safetensors", &["blocks.0.attn.qkv_proj.lora_A.weight"]);
        // Un vrai checkpoint a la racine ne doit pas se retrouver dans les styles.
        fake_safetensors(&dir, "mon-modele.safetensors", &["cond_stage_model.transformer.x"]);

        let mut packs: Vec<ImagePack> = Vec::new();
        discover_image_packs(&dir, &mut packs);
        let ids: Vec<&str> = packs.iter().map(|pack| pack.id.as_str()).collect();
        assert_eq!(ids, vec!["mon-modele"]);

        let loras = discover_image_loras(&dir);
        let names: Vec<&str> = loras.iter().map(|lora| lora.name.as_str()).collect();
        assert_eq!(names, vec!["mon-style.safetensors"]);
        assert_eq!(loras[0].family, ImageFamily::Dit);
        // A la racine, le nom suffit ; dans loras/, le chemin doit le dire.
        assert_eq!(loras[0].path, "mon-style.safetensors");
        drop(packs);
        let _ = fs::remove_dir_all(&dir);
    }
}
