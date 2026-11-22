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
use std::sync::atomic::{AtomicBool, Ordering};
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
/// Duree par defaut d'une video : deux secondes a 24 images par seconde.
const DEFAULT_VIDEO_FRAMES: u32 = 49;
const DEFAULT_VIDEO_FPS: u32 = 24;
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
    /// VAE audio des packs qui produisent une piste son (MiniMax-H3).
    #[serde(default, rename = "audioVae")]
    audio_vae: String,
    /// Hauteur de l'image ou de la video ; egale a `px` quand elle est absente.
    #[serde(default)]
    height: u32,
    /// Nombre d'images de la video et cadence de lecture.
    #[serde(default)]
    frames: u32,
    #[serde(default)]
    fps: u32,
    /// Une URL par composant : un pack video ne se telecharge pas d'un bloc.
    #[serde(default, rename = "diffusionUrl")]
    diffusion_url: String,
    #[serde(default, rename = "llmUrl")]
    llm_url: String,
    #[serde(default, rename = "vaeUrl")]
    vae_url: String,
    #[serde(default, rename = "audioVaeUrl")]
    audio_vae_url: String,
    /* Taille attendue de chaque fichier, en octets. Elle sert a deux choses :
       calculer une progression juste sur un pack de quatre fichiers, et refuser
       un fichier tronque comme s'il etait complet. Un pack sans ces tailles
       continue de fonctionner, avec une progression estimee. */
    #[serde(default, rename = "modelBytes")]
    model_bytes: u64,
    #[serde(default, rename = "diffusionBytes")]
    diffusion_bytes: u64,
    #[serde(default, rename = "llmBytes")]
    llm_bytes: u64,
    #[serde(default, rename = "vaeBytes")]
    vae_bytes: u64,
    #[serde(default, rename = "audioVaeBytes")]
    audio_vae_bytes: u64,
    /* Traductions de la note. Elles vivent dans le catalogue plutot que dans le
       code : un pack ajoute a la main peut fournir les siennes, et l'interface
       n'a qu'un champ a lire. */
    #[serde(default, rename = "noteEn")]
    note_en: String,
    #[serde(default, rename = "noteEs")]
    note_es: String,
    #[serde(default, rename = "noteJa")]
    note_ja: String,
    /// Fichier depose a la main dans `models/image/` : SIMIA l'a reconnu seul,
    /// sans entree de catalogue. L'interface le signale, sinon un fichier ajoute
    /// se confondrait avec un modele fourni.
    #[serde(default)]
    added: bool,
    /// Composants obligatoires qu'un fichier depose seul ne peut pas fournir
    /// (encodeur de texte, VAE, VAE audio). Nommes en clair : ils remontent tels
    /// quels dans « fichiers absents », et la carte ne peut donc pas se dire
    /// prete.
    #[serde(default)]
    needs: Vec<String>,
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
    /// Un pack video ne se charge pas comme un checkpoint : il lui faut un
    /// transformer, un encodeur de texte et deux VAE, et sa generation passe par
    /// une file de taches (`vid_gen`) au lieu d'une requete synchrone.
    fn is_video(&self) -> bool {
        matches!(self.mode.as_str(), "h3" | "ltx" | "video")
    }

    fn file_names(&self) -> Vec<String> {
        let mut names = Vec::new();
        for value in [&self.model, &self.diffusion, &self.llm, &self.vae, &self.audio_vae] {
            if !value.is_empty() {
                names.push(value.clone());
            }
        }
        names
    }

    fn steps_or(&self, fallback: u32) -> u32 {
        if self.steps > 0 { self.steps } else { fallback }
    }

    /// Largeur et hauteur. Un pack carre n'a pas de `height` : les deux valent
    /// `px`, comme avant.
    fn size_or(&self, fallback: u32) -> (u32, u32) {
        let width = if self.px > 0 { self.px } else { fallback };
        let height = if self.height > 0 { self.height } else { width };
        (width, height)
    }

    fn frames_or(&self, fallback: u32) -> u32 {
        if self.frames > 0 { self.frames } else { fallback }
    }

    fn fps_or(&self, fallback: u32) -> u32 {
        if self.fps > 0 { self.fps } else { fallback }
    }

    fn lora_file(&self) -> Option<&str> {
        if self.lora.is_empty() { None } else { Some(self.lora.as_str()) }
    }

    /// Tout ce qu'il faut telecharger pour que ce pack fonctionne : le chemin
    /// relatif au dossier des images, l'adresse, et la taille annoncee (0 quand
    /// le catalogue ne la donne pas). Un pack video en compte quatre, un
    /// checkpoint un seul.
    fn components(&self) -> Vec<(&str, &str, u64)> {
        let mut list: Vec<(&str, &str, u64)> = Vec::new();
        if !self.model.is_empty() && !self.url.is_empty() {
            list.push((self.model.as_str(), self.url.as_str(), self.model_bytes));
        }
        if !self.diffusion.is_empty() && !self.diffusion_url.is_empty() {
            list.push((
                self.diffusion.as_str(),
                self.diffusion_url.as_str(),
                self.diffusion_bytes,
            ));
        }
        if !self.llm.is_empty() && !self.llm_url.is_empty() {
            list.push((self.llm.as_str(), self.llm_url.as_str(), self.llm_bytes));
        }
        if !self.vae.is_empty() && !self.vae_url.is_empty() {
            list.push((self.vae.as_str(), self.vae_url.as_str(), self.vae_bytes));
        }
        if !self.audio_vae.is_empty() && !self.audio_vae_url.is_empty() {
            list.push((
                self.audio_vae.as_str(),
                self.audio_vae_url.as_str(),
                self.audio_vae_bytes,
            ));
        }
        list
    }

    /// Somme des tailles annoncees. Zero des qu'une seule manque : une
    /// progression totale fausse vaut moins qu'une progression estimee.
    fn declared_bytes(&self) -> u64 {
        let components = self.components();
        if components.is_empty() || components.iter().any(|(_, _, bytes)| *bytes == 0) {
            return 0;
        }
        components.iter().map(|(_, _, bytes)| *bytes).sum()
    }
}

/// Famille d'architecture d'un modele ou d'un LoRA. Elle decide des reglages de
/// depart (resolution, pas) et permet de prevenir qu'un LoRA ne vise pas le
/// modele charge : les tenseurs ne se correspondent pas, le moteur refuse.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum ImageFamily {
    Sd15,
    Sdxl,
    /// MiniMax-H3 : transformer video et audio, quatre composants.
    H3,
    /// LTX-2.x : transformer video, encodeur Gemma, deux VAE.
    Ltx,
    /// Z-Image : un DiT et son VAE.
    ZImage,
    /// Architecture a blocs de transformation non identifiee.
    Dit,
    Unknown,
}

impl ImageFamily {
    fn key(self) -> &'static str {
        match self {
            ImageFamily::Sd15 => "sd15",
            ImageFamily::Sdxl => "sdxl",
            ImageFamily::H3 => "h3",
            ImageFamily::Ltx => "ltx",
            ImageFamily::ZImage => "zimage",
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
            ImageFamily::H3 => "MiniMax-H3",
            ImageFamily::Ltx => "LTX-2",
            ImageFamily::ZImage => "Z-Image",
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
            ImageFamily::Dit | ImageFamily::ZImage => (1024, 8, 1.0),
            ImageFamily::Ltx => (768, 25, 4.0),
            ImageFamily::H3 => (640, 8, 1.0),
            ImageFamily::Unknown => (512, 20, 7.0),
        }
    }
}

/// Role d'un fichier dans un pack video. Le moteur ne charge pas les quatre
/// composants par la meme option : un transformateur seul ne dessine rien, et
/// sans VAE il n'y a rien a decoder.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum VideoSlot {
    Transformer,
    TextEncoder,
    Vae,
    AudioVae,
}

impl VideoSlot {
    /// Ce que l'interface annonce quand le fichier manque.
    fn label(self) -> &'static str {
        match self {
            VideoSlot::Transformer => "transformateur video",
            VideoSlot::TextEncoder => "encodeur de texte",
            VideoSlot::Vae => "VAE video",
            VideoSlot::AudioVae => "VAE audio",
        }
    }
}

/// Famille deduite du nom du fichier. Un `.gguf` n'a pas d'en-tete lisible ici,
/// et les noms de Hugging Face sont explicites : « minimax_h3 », « ltx »,
/// « z_image ». Sans cela, un transformateur quantifie passait pour un
/// checkpoint et la carte ne pouvait pas fonctionner.
fn family_from_name(stem: &str) -> Option<ImageFamily> {
    let lower = stem.to_ascii_lowercase();
    if lower.contains("minimax") || lower.contains("h3") {
        return Some(ImageFamily::H3);
    }
    if lower.contains("ltx") {
        return Some(ImageFamily::Ltx);
    }
    if lower.contains("z_image") || lower.contains("z-image") || lower.contains("zimage") {
        return Some(ImageFamily::ZImage);
    }
    None
}

/// Role d'un fichier video, lu dans son nom puis dans sa famille. L'ordre
/// compte : « audio_vae » avant « vae », sinon le VAE audio passait pour le VAE
/// video et le pack se croyait complet avec deux fois le meme composant.
fn video_slot(stem: &str, family: ImageFamily) -> Option<VideoSlot> {
    let lower = stem.to_ascii_lowercase();
    let has = |keys: &[&str]| keys.iter().any(|key| lower.contains(key));
    if has(&["audio_vae", "audio-vae", "audiovae", "vocoder"]) {
        return Some(VideoSlot::AudioVae);
    }
    if has(&["vae"]) {
        return Some(VideoSlot::Vae);
    }
    if has(&[
        "text_encoder",
        "text-encoder",
        "textencoder",
        "umt5",
        "t5_",
        "gemma",
        "llm",
    ]) {
        return Some(VideoSlot::TextEncoder);
    }
    if has(&["transformer", "diffusion", "dit"]) {
        return Some(VideoSlot::Transformer);
    }
    match family {
        ImageFamily::H3 | ImageFamily::Ltx => Some(VideoSlot::Transformer),
        _ => None,
    }
}

/// Reglages d'une video deposee a la main : largeur, hauteur, images, vitesse.
/// MiniMax-H3 travaille en 640x360 et compte par 17 images plus 5 ; LTX en
/// 768x512. Les valeurs par defaut du moteur donneraient un carre de 512 px,
/// qu'aucun de ces modeles ne sait produire.
fn video_frame_defaults(family: ImageFamily) -> (u32, u32, u32, u32) {
    match family {
        ImageFamily::H3 => (640, 360, 22, 24),
        ImageFamily::Ltx => (768, 512, 25, 24),
        _ => (512, 512, 22, 24),
    }
}

/// Un fichier video depose dans `models/image/` ou dans un sous-dossier.
struct AddedVideoFile {
    name: String,
    stem: String,
    bytes: u64,
    slot: VideoSlot,
}

/// Les fichiers d'un modele video forment une seule carte. Deposer le
/// transformateur, son encodeur et les deux VAE creait auparavant quatre cartes
/// inutilisables ; ici ils se rejoignent, et ce qui manque est nomme. Une carte
/// incomplete reste visible : c'est en la voyant qu'on sait quoi telecharger.
fn added_video_pack(family: ImageFamily, files: &[AddedVideoFile]) -> Option<ImagePack> {
    let first = files.first()?;
    let find = |slot: VideoSlot| files.iter().find(|file| file.slot == slot);
    let transformer = find(VideoSlot::Transformer);
    let vae = find(VideoSlot::Vae);
    let audio_vae = find(VideoSlot::AudioVae);
    let encoder = find(VideoSlot::TextEncoder);
    let (px, height, frames, fps) = video_frame_defaults(family);
    let (_, steps, cfg) = family.defaults();
    let stem = transformer
        .map(|file| file.stem.clone())
        .unwrap_or_else(|| first.stem.clone());
    let mode = match family {
        ImageFamily::Ltx => "ltx",
        _ => "h3",
    };
    let mut needs: Vec<String> = Vec::new();
    for (slot, present) in [
        (VideoSlot::Transformer, transformer.is_some()),
        (VideoSlot::Vae, vae.is_some()),
        (VideoSlot::TextEncoder, encoder.is_some()),
    ] {
        if !present {
            needs.push(slot.label().to_string());
        }
    }
    // Le VAE audio n'est exige que par les familles qui produisent du son.
    if family == ImageFamily::H3 && audio_vae.is_none() {
        needs.push(VideoSlot::AudioVae.label().to_string());
    }
    let listed = [&transformer, &vae, &audio_vae, &encoder]
        .iter()
        .filter_map(|file| file.map(|file| file.name.clone()))
        .count();
    let total: u64 = files.iter().map(|file| file.bytes).sum();
    let note = format!(
        "Modele video depose a la main (famille {}, {} fichier(s)). Reglages : {px} px, {frames} images a {fps} i/s, {steps} pas, CFG {cfg}.\n\nUn pack video demande un transformateur, un VAE video, un encodeur de texte et, pour MiniMax-H3, un VAE audio, tous dans models/image/. Ce qui est deja present est inscrit dans la carte ; le catalogue telecharge les quatre d'un coup si vous preferez.",
        family.label(),
        listed,
    );
    let bytes = |file: Option<&AddedVideoFile>| file.map(|file| file.bytes).unwrap_or(0);
    Some(ImagePack {
        id: image_pack_id(&format!("{}-{}", mode, stem)),
        name: image_pack_name(&stem),
        mode: mode.to_string(),
        size: format!("~{}", human_size(total)),
        license: String::new(),
        note,
        bundled: false,
        recommended: false,
        steps,
        cfg,
        px,
        model: String::new(),
        diffusion: transformer.map(|file| file.name.clone()).unwrap_or_default(),
        llm: encoder.map(|file| file.name.clone()).unwrap_or_default(),
        vae: vae.map(|file| file.name.clone()).unwrap_or_default(),
        url: String::new(),
        lora: String::new(),
        lora_weight: default_lora_weight(),
        prompt_prefix: String::new(),
        lora_url: String::new(),
        audio_vae: audio_vae.map(|file| file.name.clone()).unwrap_or_default(),
        height,
        frames,
        fps,
        diffusion_url: String::new(),
        llm_url: String::new(),
        vae_url: String::new(),
        audio_vae_url: String::new(),
        model_bytes: 0,
        diffusion_bytes: bytes(transformer),
        llm_bytes: bytes(encoder),
        vae_bytes: bytes(vae),
        audio_vae_bytes: bytes(audio_vae),
        note_en: String::new(),
        note_es: String::new(),
        note_ja: String::new(),
        added: true,
        needs,
    })
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
    /* MiniMax-H3 porte un `token_refiner`, des projections `qkv_proj` et un
       projecteur audio : trois marques qu'aucune autre famille n'a. Tester
       avant les regles generiques evite de le confondre avec un DiT anonyme. */
    let h3 = text.contains("audio_patch_proj")
        || text.contains("token_refiner")
        || text.contains("qkv_proj");
    let family = if h3 {
        ImageFamily::H3
    } else if text.contains("conditioner.embedders.1") || text.contains("conditioner.embedders.2") {
        ImageFamily::Sdxl
    } else if text.contains("cond_stage_model.transformer") || text.contains("cond_stage_model.model") {
        ImageFamily::Sd15
    } else if text.contains("transformer_blocks.") {
        // LTX-2 nomme ses blocs `transformer_blocks`.
        ImageFamily::Ltx
    } else if text.contains("joint_blocks")
        || text.contains("double_blocks")
        || text.contains("single_transformer_blocks")
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
    /* Un transformateur video n'est pas un checkpoint : il lui faut son
       encodeur, ses VAE, et le moteur passe par la file video. Le declarer
       « checkpoint » produisait une carte qui echouait au chargement. */
    /* Une famille video ne passe jamais par ici : ses fichiers sont regroupes
       par `added_video_pack`, qui remplit chaque composant a sa place. Laisser
       cette branche creer un « checkpoint » avec le transformateur dans `model`
       donnait une carte qui se disait prete et que le moteur refusait. */
    if matches!(family, ImageFamily::H3 | ImageFamily::Ltx) {
        return None;
    }
    let (mode, needs, extra_caveat) = match family {
        ImageFamily::Dit | ImageFamily::ZImage => (
            "checkpoint",
            vec!["VAE".to_string(), "encodeur de texte".to_string()],
            "\n\nCette famille (DiT) demande son encodeur de texte et son VAE a cote du checkpoint : sans eux, le moteur ne peut pas dessiner. Voyez le pack Z-Image du catalogue pour la disposition attendue.",
        ),
        _ => ("checkpoint", Vec::new(), ""),
    };
    let caveat = extra_caveat;
    Some(ImagePack {
        id: image_pack_id(&stem),
        name: image_pack_name(&stem),
        mode: mode.to_string(),
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
        audio_vae: String::new(),
        height: 0,
        frames: 0,
        fps: 0,
        diffusion_url: String::new(),
        llm_url: String::new(),
        vae_url: String::new(),
        audio_vae_url: String::new(),
        // Un fichier depose a la main : sa taille est celle du disque.
        model_bytes: bytes,
        diffusion_bytes: 0,
        llm_bytes: 0,
        vae_bytes: 0,
        audio_vae_bytes: 0,
        note_en: String::new(),
        note_es: String::new(),
        note_ja: String::new(),
        added: true,
        needs,
    })
}

/// Complete la liste des packs avec les fichiers poses a la main. Rejouee a
/// chaque affichage de la bibliotheque : deposer un `.safetensors` ou un
/// `.gguf` dans `models/image/` suffit, sans relancer SIMIA. Un pack ajoute
/// dont le fichier a disparu est retire.
fn discover_image_packs(dir: &Path, packs: &mut Vec<ImagePack>) {
    /* Les cartes deposees a la main sont reconstruites a chaque lecture du
       disque : leurs fichiers peuvent changer (un composant video ajoute, un
       autre efface), et garder l'ancienne version aurait fige le premier
       inventaire, avec une carte qui se dit complete apres la suppression d'un
       VAE. Les packs du catalogue, eux, restent tels quels. */
    packs.retain(|pack| !pack.added);

    let declared: Vec<String> = packs
        .iter()
        .flat_map(|pack| pack.file_names())
        .map(|name| name.to_ascii_lowercase())
        .collect();
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    /* Un modele livre par Hugging Face arrive souvent dans un sous-dossier
       (`minimax-h3/…`) : sans cette descente d'un niveau, deposer le dossier
       entier ne montrait aucune carte. */
    let mut paths: Vec<PathBuf> = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            let is_loras = path
                .file_name()
                .and_then(|value| value.to_str())
                .map(|value| value.eq_ignore_ascii_case("loras"))
                .unwrap_or(false);
            if is_loras {
                continue;
            }
            if let Ok(children) = fs::read_dir(&path) {
                for child in children.flatten() {
                    let child = child.path();
                    if child.is_file() {
                        paths.push(child);
                    }
                }
            }
            continue;
        }
        if path.is_file() {
            paths.push(path);
        }
    }
    paths.sort();

    let mut found: Vec<ImagePack> = Vec::new();
    let mut video: Vec<(ImageFamily, Vec<AddedVideoFile>)> = Vec::new();
    for path in paths {
        if image_model_extension(&path).is_none() {
            continue;
        }
        let Some(relative) = relative_image_name(dir, &path) else {
            continue;
        };
        let Some(stem) = path.file_stem().and_then(|value| value.to_str()) else {
            continue;
        };
        let lower = relative.to_ascii_lowercase();
        // Un projecteur multimodal accompagne un modele de texte, ce n'est pas
        // un checkpoint d'image. Les fichiers deja cites par un pack non plus.
        if lower.contains("mmproj") || declared.contains(&lower) {
            continue;
        }
        if packs.iter().chain(found.iter()).any(|pack| {
            pack.file_names()
                .iter()
                .any(|name| name.eq_ignore_ascii_case(&relative))
        }) {
            continue;
        }
        let header = if path
            .extension()
            .and_then(|value| value.to_str())
            .map(|value| value.eq_ignore_ascii_case("safetensors"))
            .unwrap_or(false)
        {
            read_tensor_header(&path)
        } else {
            None
        };
        // Un LoRA rejoint la liste des styles, pas celle des modeles.
        if header.as_ref().map(|info| info.lora).unwrap_or(false) {
            continue;
        }
        let family = header
            .as_ref()
            .map(|info| info.family)
            .filter(|family| *family != ImageFamily::Unknown)
            .or_else(|| family_from_name(stem))
            .unwrap_or(ImageFamily::Unknown);
        if matches!(family, ImageFamily::H3 | ImageFamily::Ltx) {
            let Some(slot) = video_slot(stem, family) else {
                continue;
            };
            let bytes = fs::metadata(&path).map(|meta| meta.len()).unwrap_or(0);
            if bytes == 0 {
                continue;
            }
            let file = AddedVideoFile {
                name: relative,
                stem: stem.to_string(),
                bytes,
                slot,
            };
            match video.iter_mut().find(|(known, _)| *known == family) {
                Some((_, files)) => files.push(file),
                None => video.push((family, vec![file])),
            }
            continue;
        }
        if let Some(pack) = added_image_pack(&path) {
            if packs.iter().chain(found.iter()).any(|known| known.id == pack.id) {
                continue;
            }
            found.push(pack);
        }
    }
    for (family, files) in video {
        if let Some(pack) = added_video_pack(family, &files) {
            if packs.iter().chain(found.iter()).any(|known| known.id == pack.id) {
                continue;
            }
            found.push(pack);
        }
    }
    found.sort_by(|first, second| first.name.to_lowercase().cmp(&second.name.to_lowercase()));
    packs.extend(found);
}

/// Nom d'un fichier tel que le moteur le designe : relatif a `models/image/`,
/// avec des barres obliques. Un fichier a la racine garde son simple nom.
fn relative_image_name(dir: &Path, path: &Path) -> Option<String> {
    let relative = path.strip_prefix(dir).ok()?;
    let parts: Vec<String> = relative
        .components()
        .filter_map(|part| part.as_os_str().to_str().map(|value| value.to_string()))
        .collect();
    if parts.is_empty() {
        return None;
    }
    Some(parts.join("/"))
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
    /// Un telechargement de 14 Go se lance pour une heure : il doit pouvoir
    /// s'arreter. Le drapeau est lu par la boucle de transfert, et le pid
    /// permet de tuer curl sur-le-champ au lieu d'attendre le prochain tour.
    download_cancel: Arc<AtomicBool>,
    download_pid: Option<u32>,
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
        /* Un fichier tronque par une coupure compte comme absent : sinon un
           pack video de 14 Go s'affichait « pret » avec un transformateur
           incomplet, et le moteur echouait au chargement sans explication. */
        let expected: Vec<(String, u64)> = pack
            .components()
            .iter()
            .map(|(name, _, bytes)| (name.to_string(), *bytes))
            .collect();
        let mut missing: Vec<String> = pack
            .file_names()
            .into_iter()
            .filter(|name| {
                let want = expected
                    .iter()
                    .find(|(candidate, _)| candidate == name)
                    .map(|(_, bytes)| *bytes)
                    .unwrap_or(0);
                !is_complete(&self.path_of(name), want)
            })
            .collect();
        if let Some(lora) = pack.lora_file() {
            if !self.loras_dir().join(lora).is_file() {
                missing.push(format!("loras/{lora}"));
            }
        }
        // Un composant obligatoire qui n'a jamais ete telecharge n'est pas un
        // fichier oublie : on le nomme en clair plutot que de laisser la carte
        // se dire prete.
        missing.extend(pack.needs.iter().cloned());
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
        if reason.contains("introuvable") {
            fail(&reason);
        }
        // Le nom choisi par defaut peut etre absent du disque : le dire ici
        // evite de chercher un probleme de pilote.
        if !start.path.is_file() {
            fail(&format!(
                "{reason}\n\nLe fichier attendu n'existe pas : {}",
                absolute(&start.path).display()
            ));
        }
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
        download_cancel: Arc::new(AtomicBool::new(false)),
        download_pid: None,
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

/// Les moteurs sont lances depuis leur propre dossier (`vendor/<moteur>/`) :
/// un chemin relatif qui leur est transmis se resout donc au mauvais endroit.
/// Tout ce qui part vers un moteur passe d'abord par ici.
fn absolute(path: &Path) -> PathBuf {
    if path.is_absolute() {
        return path.to_path_buf();
    }
    match env::current_dir() {
        Ok(cwd) => cwd.join(path),
        Err(_) => path.to_path_buf(),
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
            return absolute(candidate);
        }
    }
    let fallback = absolute(
        &candidates
            .first()
            .cloned()
            .unwrap_or_else(|| PathBuf::from("models")),
    );
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
        match fetch_to_partial(&url, &partial, &mut on_progress, &|_| {}, &|| false) {
            Ok(()) => {
                fs::rename(&partial, &target)
                    .map_err(|err| format!("fichier non deplacable : {err}"))?;
                on_progress(total, total);
                return Ok(());
            }
            Err(TransferError::Cancelled) => {
                return Err("telechargement interrompu".to_string());
            }
            Err(TransferError::Failed(reason)) => last_error = reason,
        }
    }

    Err(if last_error.is_empty() {
        "toutes les sources ont echoue".to_string()
    } else {
        last_error
    })
}

/// Pourquoi un transfert s'est arrete. La difference compte : annule par
/// l'utilisateur, ce n'est pas une panne, et le fichier partiel doit rester.
enum TransferError {
    Cancelled,
    Failed(String),
}

/// Ecrit `url` dans `partial` en reprenant ou le fichier s'est arrete.
///
/// Un pack video pese 14 Go : un telephone qui sonne, une mise en veille, et
/// le transfert tombe. Sans reprise, tout etait perdu et il fallait repartir
/// de zero. `curl -C -` reprend au dernier octet deja ecrit, et le fichier
/// partiel est conserve en cas d'echec, justement pour cela.
///
/// `on_progress` recoit (octets ecrits, taille attendue). `on_child` recoit le
/// pid pour qu'une annulation puisse tuer curl immediatement.
fn fetch_to_partial<F, G>(
    url: &str,
    partial: &Path,
    on_progress: &mut F,
    on_child: &G,
    cancelled: &dyn Fn() -> bool,
) -> Result<(), TransferError>
where
    F: FnMut(u64, u64),
    G: Fn(Option<u32>),
{
    let known = fs::metadata(partial).map(|meta| meta.len()).unwrap_or(0);
    let mut command = Command::new(if cfg!(windows) { "curl.exe" } else { "curl" });
    command
        .arg("-L")
        .arg("--fail")
        /* Cinq essais plutot que deux : une coupure WiFi de dix secondes sur un
           fichier de 6 Go ne doit pas condamner le telechargement. */
        .arg("--retry")
        .arg("5")
        .arg("--retry-delay")
        .arg("3")
        .arg("--retry-all-errors")
        .arg("--connect-timeout")
        .arg("20")
        /* Un transfert qui ne bouge plus de 2 Ko/s pendant une minute est
           considere comme mort : sans cela curl peut rester bloque des heures. */
        .arg("--speed-limit")
        .arg("2048")
        .arg("--speed-time")
        .arg("60");
    if known > 0 {
        command.arg("-C").arg("-");
    }
    command
        .arg("-o")
        .arg(partial)
        .arg(url)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = command
        .spawn()
        .map_err(|err| TransferError::Failed(format!("curl indisponible : {err}")))?;
    on_child(Some(child.id()));
    let mut last_progress = Instant::now();
    let outcome = loop {
        if cancelled() {
            let _ = child.kill();
            let _ = child.wait();
            break Err(TransferError::Cancelled);
        }
        match child.try_wait() {
            Ok(Some(status)) if status.success() => break Ok(()),
            Ok(Some(status)) => {
                break Err(TransferError::Failed(format!(
                    "le transfert s'est arrete ({status})"
                )))
            }
            Ok(None) => {
                if last_progress.elapsed() >= Duration::from_millis(500) {
                    last_progress = Instant::now();
                    let written = fs::metadata(partial).map(|meta| meta.len()).unwrap_or(0);
                    on_progress(written, 0);
                }
                thread::sleep(Duration::from_millis(200));
            }
            Err(err) => {
                let _ = child.kill();
                break Err(TransferError::Failed(err.to_string()));
            }
        }
    };
    on_child(None);
    outcome
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

/// Ligne de commande du generateur d'images. Isolee pour pouvoir la relire
/// dans un test : c'est la seule verification possible d'un pack video sans
/// telecharger ses quatorze gigaoctets de poids.
fn sd_server_args(
    pack: &ImagePack,
    dir: &Path,
    port: u16,
    steps: u32,
    width: u32,
    height: u32,
) -> Vec<String> {
    let mut args: Vec<String> = Vec::new();
    let path = |name: &str| dir.join(name).display().to_string();
    if pack.is_video() {
        /* MiniMax-H3 : transformer, encodeur de texte et deux VAE. Les poids
           pesent plus lourd que la memoire graphique d'une carte courante :
           `--offload-to-cpu` garde le modele en RAM et fait circuler les blocs,
           et `--rng cpu` evite de tenir le generateur aleatoire sur le GPU. */
        args.push("--diffusion-model".to_string());
        args.push(path(&pack.diffusion));
        args.push("--vae".to_string());
        args.push(path(&pack.vae));
        args.push("--llm".to_string());
        args.push(path(&pack.llm));
        args.push("--offload-to-cpu".to_string());
        args.push("--vae-tiling".to_string());
        args.push("--rng".to_string());
        args.push("cpu".to_string());
        if !pack.audio_vae.is_empty() {
            args.push("--audio-vae".to_string());
            args.push(path(&pack.audio_vae));
        }
    } else if pack.mode == "zimage" {
        args.push("--diffusion-model".to_string());
        args.push(path(&pack.diffusion));
        args.push("--llm".to_string());
        args.push(path(&pack.llm));
        args.push("--vae".to_string());
        args.push(path(&pack.vae));
        // Sans ce drapeau, le DiT et l'encodeur ne tiennent pas ensemble dans 6 Go.
        args.push("--offload-to-cpu".to_string());
        args.push("--vae-tiling".to_string());
    } else {
        args.push("-m".to_string());
        args.push(path(&pack.model));
    }
    /* Un seul dossier, et c'est la racine : le moteur n'en retient qu'un, et
       passer `--lora-model-dir` deux fois faisait perdre le premier — les LoRA
       de `loras/` devenaient introuvables. Depuis la racine, un style range
       dans `loras/` se designe par `loras/<fichier>`, et un style depose a la
       racine par son seul nom. */
    args.push("--lora-model-dir".to_string());
    args.push(dir.display().to_string());
    args.push("--steps".to_string());
    args.push(steps.to_string());
    args.push("-W".to_string());
    args.push(width.to_string());
    args.push("-H".to_string());
    args.push(height.to_string());
    /* Le moteur ecoute 1234 par defaut. Sans ces trois drapeaux, le lanceur
       interrogeait un port ou personne n'ecoutait : la generation d'images
       echouait sans le moindre message. Restaures tels quels. */
    args.push("--listen-ip".to_string());
    args.push("127.0.0.1".to_string());
    args.push("--listen-port".to_string());
    args.push(port.to_string());
    args.push("--log-level".to_string());
    args.push("warn".to_string());
    args
}

fn spawn_sd_server(
    bin: &Path,
    pack: &ImagePack,
    dir: &Path,
    port: u16,
    steps: u32,
    width: u32,
    height: u32,
) -> std::io::Result<Child> {
    let mut command = Command::new(bin);
    for argument in sd_server_args(pack, dir, port, steps, width, height) {
        command.arg(argument);
    }
    command
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
    let (bin, pack, dir, port, steps, width, height) = {
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
        let (width, height) = match guard.image.size_override {
            Some(size) if pack.is_video() => (size, (size * 9 / 16).max(64)),
            Some(size) => (size, size),
            None => pack.size_or(DEFAULT_IMG_WIDTH),
        };
        (
            guard.image.bin.clone().unwrap(),
            pack,
            guard.image.dir.clone(),
            guard.image.port,
            steps,
            width,
            height,
        )
    };

    stop_llama(state);
    if let Ok(mut guard) = state.lock() {
        guard.image.state = "loading".to_string();
        guard.image.message = "chargement du modele d'image".to_string();
    }

    let shared = Arc::clone(state);
    thread::spawn(move || {
        let child = match spawn_sd_server(&bin, &pack, &dir, port, steps, width, height) {
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

/// Tue un processus par son pid. Sans crate systeme : `taskkill` sous Windows,
/// `kill` ailleurs. Les deux existent sur toutes les installations visees.
fn kill_pid(pid: u32) {
    #[cfg(windows)]
    {
        let _ = Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/F", "/T"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn();
    }
    #[cfg(not(windows))]
    {
        let _ = Command::new("kill")
            .args(["-9", &pid.to_string()])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn();
    }
}

/// Decode un nom de fichier envoye en en-tete HTTP. Le client l'encode en
/// pourcent : un en-tete HTTP ne transporte pas d'accent, et un fichier
/// « planche_botanique_été.safetensors » doit garder son nom.
fn percent_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        let byte = bytes[index];
        if byte == b'%' && index + 2 < bytes.len() {
            let pair = [bytes[index + 1], bytes[index + 2]];
            if let Ok(text) = std::str::from_utf8(&pair) {
                if let Ok(code) = u8::from_str_radix(text, 16) {
                    out.push(code);
                    index += 3;
                    continue;
                }
            }
        }
        out.push(byte);
        index += 1;
    }
    String::from_utf8_lossy(&out).to_string()
}

/// Reduit un nom recu a un nom de fichier sur : pas de dossier, pas de `..`,
/// pas de caractere interdit par Windows, et une extension connue.
fn safe_import_name(raw: &str) -> Option<String> {
    let decoded = percent_decode(raw);
    let base = decoded
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or("")
        .trim()
        .to_string();
    if base.is_empty() || base.starts_with('.') {
        return None;
    }
    let cleaned: String = base
        .chars()
        .map(|character| {
            if character.is_control() || matches!(character, '<' | '>' | ':' | '"' | '|' | '?' | '*') {
                '_'
            } else {
                character
            }
        })
        .collect();
    let extension = Path::new(&cleaned)
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())?;
    if !matches!(extension.as_str(), "safetensors" | "gguf" | "ckpt" | "pt") {
        return None;
    }
    Some(cleaned)
}

/// Recoit un fichier depose depuis l'interface et le range au bon endroit.
///
/// Le corps est ecrit au fil de l'eau : un checkpoint de 6 Go ne peut pas
/// transiter par un tampon en memoire. Une fois le transfert fini, l'en-tete du
/// fichier dit s'il s'agit d'un style (LoRA) ou d'un modele complet, et la
/// destination suit : `loras/` pour un style, la racine pour un modele.
fn import_image_request(state: &Shared, request: &mut tiny_http::Request) -> (u16, String) {
    let raw_name = request
        .headers()
        .iter()
        .find(|header| header.field.equiv("x-simia-filename"))
        .map(|header| header.value.as_str().to_string())
        .unwrap_or_default();
    let Some(name) = safe_import_name(&raw_name) else {
        return (400, "{\"error\":\"nom de fichier absent ou extension non reconnue (.safetensors, .gguf, .ckpt, .pt)\"}"
                .to_string(),);
    };
    let dir = match state.lock() {
        Ok(guard) => guard.image.dir.clone(),
        Err(_) => PathBuf::from("models/image"),
    };
    let loras = dir.join("loras");
    let _ = fs::create_dir_all(&loras);

    let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|value| value.as_nanos()).unwrap_or(0);
    let temp = dir.join(format!(".import-{}-{stamp}.part", std::process::id()));
    let reader = request.as_reader();
    let mut file = match fs::File::create(&temp) {
        Ok(file) => file,
        Err(error) => {
            return (500, format!("{{\"error\":{}}}", js_escape(&format!("fichier temporaire : {error}"))),);
        }
    };
    /* Le corps est lu par blocs de 1 Mo : assez gros pour ne pas faire de
       milliers d'appels systeme, assez petit pour que l'annulation et l'etat
       de progression restent vivants pendant le transfert. */
    let mut buffer = vec![0u8; 1024 * 1024];
    let mut written: u64 = 0;
    let result = loop {
        match reader.read(&mut buffer) {
            Ok(0) => break Ok(()),
            Ok(count) => {
                if let Err(error) = file.write_all(&buffer[..count]) {
                    break Err(format!("ecriture : {error}"));
                }
                written += count as u64;
                set_progress(state, "import", written, 0, "import", None);
            }
            Err(error) => break Err(format!("lecture : {error}")),
        }
        if let Ok(guard) = state.lock() {
            if guard.image.download_cancel.load(Ordering::SeqCst) {
                break Err("import annule".to_string());
            }
        }
    };
    let flushed = file.flush().is_ok();
    drop(file);
    if let Err(error) = result {
        let _ = fs::remove_file(&temp);
        if let Ok(mut guard) = state.lock() {
            guard.progress = None;
        }
        return (400, format!("{{\"error\":{}}}", js_escape(&error)));
    }
    if !flushed {
        let _ = fs::remove_file(&temp);
        return (500, "{\"error\":\"le fichier n'a pas pu etre ecrit en entier\"}".to_string(),);
    }

    let header = read_tensor_header(&temp);
    let is_lora = header.as_ref().map(|info| info.lora).unwrap_or(false);
    let family = header
        .as_ref()
        .map(|info| info.family)
        .unwrap_or(ImageFamily::Unknown);
    let destination = if is_lora { loras.join(&name) } else { dir.join(&name) };
    if let Err(error) = fs::rename(&temp, &destination) {
        // Un rename echoue si le fichier existe deja sous Windows : on remplace.
        if fs::copy(&temp, &destination).is_err() {
            let _ = fs::remove_file(&temp);
            return (500, format!("{{\"error\":{}}}", js_escape(&format!("deplacement : {error}"))),);
        }
        let _ = fs::remove_file(&temp);
    }

    let body = match state.lock() {
        Ok(mut guard) => {
            guard.progress = None;
            guard.image.refresh();
            /* L'identifiant du pack que ce fichier vient de creer. L'interface
               l'active aussitot : sans lui, elle devait deviner a partir du nom
               de fichier, et un modele importe laissait le precedent actif. */
            let pack_id = guard
                .image
                .packs
                .iter()
                .find(|pack| {
                    pack.added
                        && (pack.model.eq_ignore_ascii_case(&name)
                            || pack.diffusion.eq_ignore_ascii_case(&name)
                            || pack.llm.eq_ignore_ascii_case(&name)
                            || pack.vae.eq_ignore_ascii_case(&name)
                            || pack.audio_vae.eq_ignore_ascii_case(&name))
                })
                .map(|pack| pack.id.clone())
                .unwrap_or_default();
            format!(
                "{{\"ok\":true,\"name\":{},\"kind\":{},\"family\":{},\"bytes\":{},\"lora\":{},\"packId\":{}}}",
                js_escape(&name),
                js_escape(if is_lora { "lora" } else { "model" }),
                js_escape(family.key()),
                written,
                is_lora,
                js_escape(&pack_id)
            )
        }
        Err(_) => format!("{{\"ok\":true,\"name\":{}}}", js_escape(&name)),
    };
    (200, body)
}

fn image_status_json(state: &Shared) -> String {
    match state.lock() {
        Ok(guard) => {
            let missing = guard.image.missing_reason();
            let available = missing.is_none();
            let pack = guard.image.current();
            let steps = pack.map(|item| guard.image.steps_override.unwrap_or(item.steps_or(DEFAULT_IMG_STEPS))).unwrap_or(0);
            let (width, height) = pack
                .map(|item| match guard.image.size_override {
                    Some(size) if item.is_video() => (size, (size * 9 / 16).max(64)),
                    Some(size) => (size, size),
                    None => item.size_or(DEFAULT_IMG_WIDTH),
                })
                .unwrap_or((0, 0));
            let video = pack.map(|item| item.is_video()).unwrap_or(false);
            let frames = pack.map(|item| item.frames_or(DEFAULT_VIDEO_FRAMES)).unwrap_or(0);
            let fps = pack.map(|item| item.fps_or(DEFAULT_VIDEO_FPS)).unwrap_or(0);
            format!(
                "{{\"available\":{},\"state\":{},\"message\":{},\"width\":{},\"height\":{},\"steps\":{},\"cfg\":{},\"pack\":{},\"reason\":{},\"video\":{},\"frames\":{},\"fps\":{}}}",
                available,
                js_escape(&guard.image.state),
                js_escape(&guard.image.message),
                width,
                height,
                steps,
                pack.map(|item| item.cfg).unwrap_or(1.0),
                match pack {
                    Some(item) => js_escape(&item.id),
                    None => "null".to_string(),
                },
                match missing {
                    Some(reason) => js_escape(&reason),
                    None => "null".to_string(),
                },
                video,
                frames,
                fps
            )
        }
        Err(_) => "{\"available\":false,\"state\":\"error\"}".to_string(),
    }
}

/// Famille d'un pack du catalogue, deduite de sa forme : un pack a trois
/// fichiers (Z-Image) est un DiT, un pack en 1024 px est du SDXL, le reste du
/// SD 1.5. Un fichier ajoute a la main a deja sa famille, lue dans l'en-tete.
fn pack_family(pack: &ImagePack) -> ImageFamily {
    if pack.mode == "h3" {
        return ImageFamily::H3;
    }
    if pack.mode == "ltx" {
        return ImageFamily::Ltx;
    }
    if pack.mode == "zimage" {
        return ImageFamily::ZImage;
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
                    /* Ce qui manque, nomme : pour un pack video depose a la
                       main, la carte doit dire « il faut le VAE video » et non
                       seulement rester grisee. */
                    let missing = guard
                        .image
                        .missing_of(pack)
                        .iter()
                        .map(|item| js_escape(item))
                        .collect::<Vec<_>>()
                        .join(",");
                    format!(
                        "{{\"id\":{},\"name\":{},\"mode\":{},\"size\":{},\"note\":{},\"noteEn\":{},\"noteEs\":{},\"noteJa\":{},\"license\":{},\"steps\":{},\"cfg\":{},\"px\":{},\"local\":{},\"bytes\":{},\"downloadable\":{},\"recommended\":{},\"bundled\":{},\"lora\":{},\"loraWeight\":{},\"promptPrefix\":{},\"added\":{},\"family\":{},\"video\":{},\"height\":{},\"frames\":{},\"fps\":{},\"missing\":[{}]}}",
                        js_escape(&pack.id),
                        js_escape(&pack.name),
                        js_escape(&pack.mode),
                        js_escape(&pack.size),
                        js_escape(&pack.note),
                        js_escape(&pack.note_en),
                        js_escape(&pack.note_es),
                        js_escape(&pack.note_ja),
                        js_escape(&pack.license),
                        pack.steps,
                        pack.cfg,
                        pack.px,
                        local,
                        bytes,
                        local == false
                            && (!pack.url.is_empty()
                                || !pack.lora_url.is_empty()
                                || !pack.diffusion_url.is_empty()
                                || !pack.llm_url.is_empty()
                                || !pack.vae_url.is_empty()
                                || !pack.audio_vae_url.is_empty()),
                        pack.recommended,
                        pack.bundled,
                        js_escape(&pack.lora),
                        pack.lora_weight,
                        js_escape(&pack.prompt_prefix),
                        pack.added,
                        js_escape(pack_family(pack).key()),
                        pack.is_video(),
                        pack.size_or(0).1,
                        pack.frames_or(DEFAULT_VIDEO_FRAMES),
                        pack.fps_or(DEFAULT_VIDEO_FPS),
                        missing
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

/// Telecharge ce qui manque a un pack et le selectionne.
///
/// Un pack video demande quatre fichiers de plusieurs giga-octets : la
/// progression est cumulee sur l'ensemble, chaque fichier reprend ou il s'etait
/// arrete, et l'utilisateur peut arreter net.
fn download_image_pack(state: &Shared, id: &str) -> Result<(), String> {
    let (pack, dir, cancel) = {
        let guard = state.lock().map_err(|_| "etat verrouille".to_string())?;
        let pack = guard
            .image
            .pack(id)
            .cloned()
            .ok_or_else(|| format!("jeu d'images inconnu : {id}"))?;
        (pack, guard.image.dir.clone(), Arc::clone(&guard.image.download_cancel))
    };
    cancel.store(false, Ordering::SeqCst);

    /* On liste tout ce qui manque avant de commencer : un pack video a quatre
       fichiers, autant annoncer le total des le depart plutot que d'echouer au
       troisieme apres une heure. */
    let mut jobs: Vec<(PathBuf, String, u64)> = Vec::new();
    let mut missing_url: Option<String> = None;
    let mut queued = 0u64;
    for (name, url, bytes) in pack.components() {
        let dest = dir.join(name);
        if is_complete(&dest, bytes) {
            queued += bytes;
            continue;
        }
        if url.is_empty() {
            missing_url = Some(name.to_string());
            continue;
        }
        jobs.push((dest, url.to_string(), bytes));
        queued += bytes;
    }
    let lora = pack.lora_file().map(|name| dir.join("loras").join(name));
    let needs_lora = lora.as_ref().map(|path| !path.is_file()).unwrap_or(false);

    if jobs.is_empty() && !needs_lora {
        return select_image_pack(state, id);
    }
    if let Some(name) = missing_url {
        return Err(format!("{name} n'a pas d'URL de telechargement"));
    }

    let declared = pack.declared_bytes();
    let total = if declared > 0 { declared } else { parse_size(&pack.size) };
    let _ = queued;
    set_progress(state, id, 0, total, "image", None);

    /* Espace disque : un pack de 14 Go sur un disque plein echoue au bout de
       deux heures, apres avoir tout telecharge. Autant le dire avant. */
    if let Some(needed) = free_space_shortfall(&dir, declared.saturating_sub(already_present(&pack, &dir))) {
        return Err(needed);
    }

    let mut done: u64 = 0;
    let result = (|| -> Result<(), String> {
        for (dest, url, bytes) in &jobs {
            if let Some(parent) = dest.parent() {
                let _ = fs::create_dir_all(parent);
            }
            fetch_pack_file(state, id, dest, url, &cancel, done, &mut |written, base| {
                set_progress(state, id, base + written, total, "image", None);
            })?;
            done += if *bytes > 0 {
                *bytes
            } else {
                fs::metadata(dest).map(|meta| meta.len()).unwrap_or(0)
            };
        }
        if needs_lora {
            if pack.lora_url.is_empty() {
                return Err("le style de ce jeu n'a pas d'URL de telechargement".to_string());
            }
            let dest = lora.as_deref().unwrap();
            if let Some(parent) = dest.parent() {
                let _ = fs::create_dir_all(parent);
            }
            fetch_pack_file(state, id, dest, &pack.lora_url, &cancel, done, &mut |written, base| {
                set_progress(state, id, base + written, total, "image", None);
            })?;
        }
        Ok(())
    })();
    match result {
        Ok(()) => {
            set_progress(state, id, 1, 1, "image-ready", None);
            if let Ok(mut guard) = state.lock() {
                guard.progress = None;
                guard.image.download_pid = None;
                guard.image.selected = Some(id.to_string());
                save_image_selection(&guard.image.dir, id);
            }
            Ok(())
        }
        Err(error) => {
            if let Ok(mut guard) = state.lock() {
                guard.image.download_pid = None;
            }
            if error == CANCELLED {
                set_progress(state, id, 0, total, "cancelled", None);
                return Err(error);
            }
            set_progress(state, id, 0, total, "error", Some(error.clone()));
            Err(error)
        }
    }
}

const CANCELLED: &str = "telechargement interrompu";

/// Vrai quand le fichier est la et fait exactement la taille annoncee. Un
/// fichier tronque par une coupure passe pour absent : c'est ce qui permet de
/// reprendre au lieu de croire le pack installe.
fn is_complete(path: &Path, expected: u64) -> bool {
    match fs::metadata(path) {
        Ok(meta) => meta.is_file() && (expected == 0 || meta.len() >= expected),
        Err(_) => false,
    }
}

/// Somme des composants deja sur le disque : sert a demander l'espace qui
/// manque vraiment, pas la taille totale du pack.
fn already_present(pack: &ImagePack, dir: &Path) -> u64 {
    pack.components()
        .iter()
        .filter(|(name, _, bytes)| is_complete(&dir.join(name), *bytes))
        .map(|(_, _, bytes)| *bytes)
        .sum()
}

/// Verifie qu'il reste la place pour `needed` octets dans le dossier des
/// modeles. Rend `None` quand tout va bien, ou le message a montrer.
fn free_space_shortfall(dir: &Path, needed: u64) -> Option<String> {
    if needed == 0 {
        return None;
    }
    let free = free_bytes(&dir.to_path_buf())?;
    // Marge de 1 Go : le disque sert aussi de cache pendant le transfert.
    if free > needed + 1_073_741_824 {
        return None;
    }
    Some(format!(
        "espace insuffisant : il faut {} de plus, il reste {} sur le disque",
        human_size(needed),
        human_size(free)
    ))
}

#[cfg(windows)]
fn free_bytes(dir: &Path) -> Option<u64> {
    /* Sans crate systeme, on interroge le disque par une commande : `dir` existe
       deja (le lanceur l'a cree). `wmic` a disparu de Windows 11 recent, on
       passe donc par PowerShell. */
    let output = Command::new("powershell")
        .args([
            "-NoProfile",
            "-Command",
            "$d=(Get-PSDrive -Name (Split-Path -Qualifier '",
        ])
        .arg(dir.display().to_string())
        .args(["').TrimEnd(':')).Free"])
        .output()
        .ok()?;
    String::from_utf8_lossy(&output.stdout).trim().parse().ok()
}

#[cfg(not(windows))]
fn free_bytes(dir: &Path) -> Option<u64> {
    let output = Command::new("df").arg("-Pk").arg(dir).output().ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout).to_string();
    let line = text.lines().nth(1)?;
    let available_kb: u64 = line.split_whitespace().nth(3)?.parse().ok()?;
    Some(available_kb * 1024)
}

/// Telecharge un composant, en reprenant au dernier octet deja ecrit.
fn fetch_pack_file(
    state: &Shared,
    id: &str,
    dest: &Path,
    url: &str,
    cancel: &Arc<AtomicBool>,
    base: u64,
    progress: &mut dyn FnMut(u64, u64),
) -> Result<(), String> {
    let partial = dest.with_extension("part");
    if let Some(parent) = dest.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let state_for_child = Arc::clone(state);
    let look = Arc::clone(cancel);
    let on_child = |pid: Option<u32>| {
        if let Ok(mut guard) = state_for_child.lock() {
            guard.image.download_pid = pid;
        }
    };
    let cancelled = {
        let flag = Arc::clone(cancel);
        move || flag.load(Ordering::SeqCst)
    };
    let mut report = |written: u64, _total: u64| progress(written, base);
    match fetch_to_partial(url, &partial, &mut report, &on_child, &cancelled) {
        Ok(()) => {
            // Une reprise peut laisser un fichier incomplet si la source ne
            // gere pas les plages d'octets : on reverifie, sinon on repart.
            fs::rename(&partial, dest)
                .map_err(|err| format!("fichier non deplacable : {err}"))?;
            let _ = id;
            let _ = look;
            Ok(())
        }
        Err(TransferError::Cancelled) => {
            // Le partiel reste : relancer reprendra ici.
            Err(CANCELLED.to_string())
        }
        Err(TransferError::Failed(reason)) => Err(format!(
            "{reason}. Le fichier partiel est garde : relancer reprendra ou il s'est arrete."
        )),
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

/// Vrai quand le journal du moteur dit que le fichier n'existe pas, plutot
/// que d'annoncer un probleme de GPU ou de memoire.
fn log_mentions_missing_file(path: &Path) -> bool {
    let text = fs::read_to_string(path).unwrap_or_default();
    text.contains("failed to open GGUF file")
        || text.contains("No such file or directory")
        || text.contains("error loading model")
}

fn spawn_llama(bin: &Path, model: &Path, mmproj: Option<&Path>, port: u16, ctx: u32) -> std::io::Result<(Child, PathBuf)> {
    let log_path = env::temp_dir().join(format!("simia-llama-{port}.log"));
    let log = fs::File::create(&log_path)?;
    let log_out = log.try_clone()?;
    let mut command = Command::new(bin);
    command
        .arg("-m")
        .arg(absolute(model));
    if let Some(mmproj) = mmproj {
        command.arg("--mmproj").arg(absolute(mmproj));
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
            /* Le cas le plus courant n'est pas le GPU : c'est un fichier
               absent. Sans cette lecture du journal, on envoyait l'utilisateur
               verifier son pilote Vulkan pour un modele introuvable. */
            if log_mentions_missing_file(log_path) {
                message.push_str(
                    "\nLe fichier du modele est introuvable sur le disque : choisissez un modele deja telecharge ou relancez le telechargement.",
                );
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
            Err(error) => {
                /* Une annulation n'est pas une panne : 400 le dit a
                   l'interface, qui n'affiche alors pas d'erreur. */
                let code = if error == CANCELLED { 400 } else { 500 };
                respond_json(request, code, format!("{{\"error\":{}}}", js_escape(&error)))
            }
        }
        return;
    }

    /* Arreter un telechargement de 14 Go. Le drapeau suffit quand curl tourne
       encore ; le pid permet de le tuer tout de suite, sinon il fallait attendre
       le tour suivant de la boucle. Le fichier partiel est garde. */
    if path == "/_simia/image/cancel" {
        let killed = match state.lock() {
            Ok(mut guard) => {
                guard.image.download_cancel.store(true, Ordering::SeqCst);
                match guard.image.download_pid {
                    Some(pid) => {
                        kill_pid(pid);
                        guard.image.download_pid = None;
                        true
                    }
                    None => false,
                }
            }
            Err(_) => false,
        };
        respond_json(
            request,
            200,
            format!("{{\"cancelled\":true,\"killed\":{killed}}}"),
        );
        return;
    }

    /* Importer un fichier depuis l'interface, sans passer par le gestionnaire
       de fichiers. Le corps de la requete EST le fichier : il est ecrit au fil
       de l'eau, jamais garde en memoire, parce qu'un safetensors peut peser
       plusieurs giga-octets. A la fin, l'en-tete decide de la destination. */
    if path == "/_simia/image/import" {
        let (code, body) = import_image_request(&state, &mut request);
        respond_json(request, code, body);
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
        let generating = url.ends_with("/v1/img_gen")
            || url.ends_with("/sdapi/v1/txt2img")
            || url.ends_with("/v1/vid_gen");
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
                "{{\"available\":{},\"supported\":{},\"width\":{},\"height\":{},\"steps\":{},\"cfg\":{},\"model\":{},\"apiBase\":\"\",\"packsUrl\":\"/_simia/image/packs\",\"selectPackUrl\":\"/_simia/image/select\",\"downloadPackUrl\":\"/_simia/image/download\",\"statusUrl\":\"/_simia/image/status\",\"prepareUrl\":\"/_simia/image/prepare\",\"importUrl\":\"/_simia/image/import\",\"cancelUrl\":\"/_simia/image/cancel\",\"generateUrl\":\"/sdapi/v1/txt2img\",\"jobsUrl\":\"/sdcpp/v1/jobs\"}}",
                guard.image.available(),
                guard.image.bin.is_some() && guard.image.probe.is_none(),
                guard.image.current().map(|pack| match guard.image.size_override {
                    Some(size) if pack.is_video() => size,
                    Some(size) => size,
                    None => pack.size_or(DEFAULT_IMG_WIDTH).0,
                }).unwrap_or(0),
                guard.image.current().map(|pack| match guard.image.size_override {
                    Some(size) if pack.is_video() => (size * 9 / 16).max(64),
                    Some(size) => size,
                    None => pack.size_or(DEFAULT_IMG_WIDTH).1,
                }).unwrap_or(0),
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

    /// Les moteurs tournent depuis `vendor/<moteur>/` : un chemin relatif leur
    /// fait chercher le modele au mauvais endroit, et le journal parle alors
    /// d'un fichier introuvable au lieu d'un vrai probleme de GPU.
    #[test]
    fn un_chemin_relatif_devient_absolu_avant_le_moteur() {
        let relative = Path::new("models/Qwen3.5-2B-Q4_K_M.gguf");
        let resolved = absolute(relative);
        assert!(resolved.is_absolute(), "chemin encore relatif : {resolved:?}");
        assert!(
            resolved.ends_with(relative),
            "le chemin a perdu sa fin : {resolved:?}"
        );
        let already = env::current_dir().expect("dossier courant").join("modele.gguf");
        assert_eq!(absolute(&already), already, "un chemin absolu est reecrit");
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

    /// Un pack nu, pour les tests : chaque cas ne remplit que ce qu'il verifie.
    fn empty_pack(mode: &str) -> ImagePack {
        ImagePack {
            id: String::new(),
            name: String::new(),
            mode: mode.to_string(),
            size: String::new(),
            note: String::new(),
            license: String::new(),
            recommended: false,
            bundled: false,
            steps: 0,
            cfg: 1.0,
            px: 0,
            model: String::new(),
            diffusion: String::new(),
            llm: String::new(),
            vae: String::new(),
            url: String::new(),
            lora: String::new(),
            lora_weight: 0.8,
            prompt_prefix: String::new(),
            lora_url: String::new(),
            audio_vae: String::new(),
            height: 0,
            frames: 0,
            fps: 0,
            diffusion_url: String::new(),
            llm_url: String::new(),
            vae_url: String::new(),
            audio_vae_url: String::new(),
            model_bytes: 0,
            diffusion_bytes: 0,
            llm_bytes: 0,
            vae_bytes: 0,
            audio_vae_bytes: 0,
            note_en: String::new(),
            note_es: String::new(),
            note_ja: String::new(),
            added: false,
            needs: Vec::new(),
        }
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
    fn un_pack_video_recoit_ses_quatre_composants() {
        let mut pack = empty_pack("h3");
        pack.id = "minimax-h3".to_string();
        pack.diffusion = "minimax-h3/transformer.gguf".to_string();
        pack.llm = "minimax-h3/encodeur.safetensors".to_string();
        pack.vae = "minimax-h3/vae-video.safetensors".to_string();
        pack.audio_vae = "minimax-h3/vae-audio.safetensors".to_string();
        let args = sd_server_args(&pack, Path::new("/models/image"), 8901, 8, 640, 360);
        let line = args.join(" ");
        assert!(line.contains("--diffusion-model"), "{line}");
        assert!(line.contains("transformer.gguf"));
        assert!(line.contains("--llm"));
        assert!(line.contains("encodeur.safetensors"));
        let expected_vae = Path::new("/models/image").join("minimax-h3/vae-video.safetensors");
        assert!(line.contains(&format!("--vae {}", expected_vae.display())), "{line}");
        assert!(line.contains("--audio-vae"), "{line}");
        assert!(line.contains("--rng cpu"));
        assert!(line.contains("--offload-to-cpu"));
        // Les dimensions arrivent en clair : une video n'est pas carree.
        assert!(line.contains("-W 640"));
        assert!(line.contains("-H 360"));
        // Un seul dossier de LoRA : deux fois, le moteur perd le premier.
        assert_eq!(args.iter().filter(|arg| *arg == "--lora-model-dir").count(), 1, "{line}");
        // Le port demande par le lanceur, sinon le moteur ecoute 1234 et tout
        // appel de generation tombe dans le vide.
        assert!(line.contains("--listen-port 8901"), "{line}");
        assert!(line.contains("--listen-ip 127.0.0.1"), "{line}");
        assert!(line.contains("--log-level warn"), "{line}");
    }

    #[test]
    fn un_checkpoint_garde_l_appel_historique() {
        let mut pack = empty_pack("checkpoint");
        pack.model = "sd15/modele.gguf".to_string();
        let args = sd_server_args(&pack, Path::new("/m"), 8901, 20, 512, 512);
        assert_eq!(args[0], "-m");
        // Le separateur depend du systeme : on compare un chemin construit.
        assert_eq!(args[1], Path::new("/m").join("sd15/modele.gguf").display().to_string());
        assert!(!args.join(" ").contains("--llm"));
        // Un LoRA de style ne change pas le dossier : il est deja a la racine.
        pack.lora = "gravure.safetensors".to_string();
        let args = sd_server_args(&pack, Path::new("/m"), 8901, 20, 512, 512);
        assert_eq!(args.iter().filter(|arg| *arg == "--lora-model-dir").count(), 1);
    }

    #[test]
    fn le_catalogue_du_depot_decrit_le_pack_video() {
        let path = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("models")
            .join("image")
            .join("catalog.json");
        let Ok(text) = fs::read_to_string(&path) else {
            return;
        };
        let catalog: ImageCatalog = serde_json::from_str(&text).expect("catalogue lisible");
        let pack = catalog
            .packs
            .iter()
            .find(|item| item.id == "minimax-h3")
            .expect("pack video present");
        assert!(pack.is_video());
        // Chaque composant a son fichier et son URL : le telechargement se fait
        // un fichier a la fois, pas d'un bloc.
        assert!(!pack.diffusion.is_empty() && !pack.diffusion_url.is_empty());
        assert!(!pack.llm.is_empty() && !pack.llm_url.is_empty());
        assert!(!pack.vae.is_empty() && !pack.vae_url.is_empty());
        assert!(!pack.audio_vae.is_empty() && !pack.audio_vae_url.is_empty());
        // Les quatre fichiers comptent pour la presence sur le disque.
        assert_eq!(pack.file_names().len(), 4);
        // Une video a une hauteur et une cadence ; un carre n'en a pas besoin.
        assert!(pack.height > 0 && pack.px > pack.height);
        assert!(pack.frames > 0 && pack.fps > 0);
        let (width, height) = pack.size_or(512);
        assert_eq!((width, height), (640, 360));
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
        // `qkv_proj` et `token_refiner` sont les marques de MiniMax-H3.
        assert_eq!(info.family, ImageFamily::H3);
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
    fn un_transformateur_video_seul_devient_une_carte_incomplete() {
        let dir = scratch("video-seul");
        fake_safetensors(
            &dir,
            "minimax_h3_ref2va.safetensors",
            &[
                "audio_patch_proj.weight",
                "token_refiner.blocks.0.weight",
                "qkv_proj.weight",
            ],
        );
        let mut packs = Vec::new();
        discover_image_packs(&dir, &mut packs);
        let pack = packs.first().expect("une carte video");
        // Le moteur passe par la file video : le mode doit le dire.
        assert_eq!(pack.mode, "h3");
        assert!(pack.is_video());
        // Le fichier depose est un transformateur, pas un checkpoint : `-m`
        // aurait echoue. Il va dans `diffusion`, ou le moteur le cherche.
        assert_eq!(pack.diffusion, "minimax_h3_ref2va.safetensors");
        assert!(pack.model.is_empty());
        // Les reglages sont ceux d'une video, pas le carre de 512 px par defaut.
        assert_eq!((pack.px, pack.height, pack.frames, pack.fps), (640, 360, 22, 24));
        // Un transformateur seul ne suffit pas : la carte ne peut pas se dire prete.
        assert!(pack.needs.iter().any(|need| need.contains("VAE video")));
        assert!(pack.needs.iter().any(|need| need.contains("encodeur de texte")));
        assert!(pack.note.contains("Modele video"));
        let engine = ImageEngine {
            bin: Some(dir.join("sd-server")),
            probe: None,
            dir: dir.clone(),
            packs: packs.clone(),
            selected: Some(pack.id.clone()),
            port: 0,
            child: None,
            state: "stopped".to_string(),
            message: String::new(),
            last_used: None,
            size_override: None,
            steps_override: None,
            download_cancel: Arc::new(AtomicBool::new(false)),
            download_pid: None,
        };
        assert!(!engine.local_of(pack));
        let reason = engine.missing_reason().expect("raison");
        assert!(reason.contains("VAE video"), "{reason}");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn les_quatre_fichiers_d_un_modele_video_forment_une_seule_carte() {
        let dir = scratch("video-complet");
        // Le cas reel : les quatre fichiers de MiniMax-H3, tels que Hugging
        // Face les nomme, deposes a la racine de models/image/.
        let transformer = touch(&dir, "minimax_h3_ref2va_pruned-Q2_K_M.gguf", 512);
        touch(&dir, "p-h3-image_text_encoder_int8.safetensors", 256);
        touch(&dir, "minimax_h3_video_vae_int8.safetensors", 128);
        touch(&dir, "minimax_h3_audio_vae_fp32.safetensors", 64);
        let mut packs = Vec::new();
        discover_image_packs(&dir, &mut packs);
        // Une carte, pas quatre : un pack video est un ensemble, pas un fichier.
        assert_eq!(packs.len(), 1, "cartes : {:?}", packs.iter().map(|p| &p.name).collect::<Vec<_>>());
        let pack = &packs[0];
        assert_eq!(pack.diffusion, "minimax_h3_ref2va_pruned-Q2_K_M.gguf");
        assert_eq!(pack.llm, "p-h3-image_text_encoder_int8.safetensors");
        assert_eq!(pack.vae, "minimax_h3_video_vae_int8.safetensors");
        assert_eq!(pack.audio_vae, "minimax_h3_audio_vae_fp32.safetensors");
        assert!(pack.needs.is_empty(), "manquant : {:?}", pack.needs);
        assert!(transformer.is_file());
        let engine = ImageEngine {
            bin: Some(dir.join("sd-server")),
            probe: None,
            dir: dir.clone(),
            packs: packs.clone(),
            selected: Some(pack.id.clone()),
            port: 0,
            child: None,
            state: "stopped".to_string(),
            message: String::new(),
            last_used: None,
            size_override: None,
            steps_override: None,
            download_cancel: Arc::new(AtomicBool::new(false)),
            download_pid: None,
        };
        assert!(engine.local_of(pack), "manquant : {:?}", engine.missing_of(pack));

        // Un fichier efface ne fait pas disparaitre la carte : elle redevient
        // incomplete et nomme ce qui manque, au lieu de s'evanouir sans un mot.
        fs::remove_file(dir.join("minimax_h3_video_vae_int8.safetensors")).expect("suppression");
        discover_image_packs(&dir, &mut packs);
        assert_eq!(packs.len(), 1);
        assert!(packs[0].needs.iter().any(|need| need.contains("VAE video")));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn un_modele_video_dans_un_sous_dossier_est_trouve() {
        let dir = scratch("video-sous-dossier");
        let nested = dir.join("minimax-h3");
        fs::create_dir_all(&nested).expect("dossier");
        fs::write(nested.join("minimax_h3_ref2va.gguf"), vec![0u8; 128]).expect("transformateur");
        fs::write(
            nested.join("minimax_h3_video_vae.safetensors"),
            vec![0u8; 64],
        )
        .expect("vae");
        let mut packs = Vec::new();
        discover_image_packs(&dir, &mut packs);
        let pack = packs.first().expect("carte trouvee dans le sous-dossier");
        // Le moteur recoit un chemin relatif au dossier des images, avec une
        // barre oblique : c'est ainsi qu'il ouvre un fichier range a cote.
        assert_eq!(pack.diffusion, "minimax-h3/minimax_h3_ref2va.gguf");
        assert_eq!(pack.vae, "minimax-h3/minimax_h3_video_vae.safetensors");
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
        assert_eq!(loras[0].family, ImageFamily::H3);
        // A la racine, le nom suffit ; dans loras/, le chemin doit le dire.
        assert_eq!(loras[0].path, "mon-style.safetensors");
        drop(packs);
        let _ = fs::remove_dir_all(&dir);
    }

    /// Un pack de 14 Go se telecharge en plusieurs fois : le fichier partiel
    /// doit etre reconnu comme tel, sinon il passe pour installe et le moteur
    /// echoue au chargement.
    #[test]
    fn un_fichier_tronque_n_est_pas_complet() {
        let dir = scratch("tronque");
        let path = dir.join("poids.gguf");
        fs::write(&path, vec![0u8; 100]).expect("fichier de test");
        assert!(is_complete(&path, 100), "un fichier exact est complet");
        assert!(is_complete(&path, 0), "sans taille annoncee, sa presence suffit");
        assert!(!is_complete(&path, 200), "un fichier trop court est incomplet");
        assert!(!is_complete(&dir.join("absent.gguf"), 10));
        let _ = fs::remove_dir_all(&dir);
    }

    /// La progression d'un pack video doit s'additionner : quatre fichiers, une
    /// seule barre. Et une taille manquante rend le total inconnu plutot que
    /// faux, pour ne pas afficher 100 % a la moitie du transfert.
    #[test]
    fn la_progression_additionne_les_composants_du_pack() {
        let mut pack = empty_pack("h3");
        pack.diffusion = "t.gguf".to_string();
        pack.diffusion_url = "https://exemple/t".to_string();
        pack.diffusion_bytes = 100;
        pack.llm = "e.safetensors".to_string();
        pack.llm_url = "https://exemple/e".to_string();
        pack.llm_bytes = 200;
        pack.vae = "v.safetensors".to_string();
        pack.vae_url = "https://exemple/v".to_string();
        pack.vae_bytes = 300;
        pack.audio_vae = "a.safetensors".to_string();
        pack.audio_vae_url = "https://exemple/a".to_string();
        pack.audio_vae_bytes = 400;
        assert_eq!(pack.components().len(), 4);
        assert_eq!(pack.declared_bytes(), 1000);

        // Une composante sans URL n'est pas telechargeable : elle ne compte pas.
        pack.audio_vae_url.clear();
        assert_eq!(pack.components().len(), 3);
        assert_eq!(pack.declared_bytes(), 600);

        // Une taille inconnue rend le total inconnu.
        pack.vae_bytes = 0;
        assert_eq!(pack.declared_bytes(), 0);
    }

    /// Le nom d'un fichier importe vient du navigateur : il ne doit pas
    /// pouvoir sortir du dossier des modeles, et son accent doit survivre.
    #[test]
    fn un_nom_importe_est_reduit_a_un_fichier_sur() {
        assert_eq!(percent_decode("%C3%A9t%C3%A9"), "été");
        assert_eq!(
            safe_import_name("planche%20botanique.safetensors").as_deref(),
            Some("planche botanique.safetensors")
        );
        // Un chemin relatif remonte : on ne garde que le dernier morceau.
        assert_eq!(
            safe_import_name("..%2F..%2Fsecret.safetensors").as_deref(),
            Some("secret.safetensors")
        );
        // Un chemin Windows absolu aussi.
        assert_eq!(
            safe_import_name("C%3A%5CUsers%5Cm.safetensors").as_deref(),
            Some("m.safetensors")
        );
        // Une extension inconnue est refusee, comme un nom vide.
        assert_eq!(safe_import_name("virus.exe"), None);
        assert_eq!(safe_import_name(""), None);
        assert_eq!(safe_import_name(".cache.safetensors"), None);
        // Un caractere interdit par Windows devient un souligne.
        assert_eq!(
            safe_import_name("mo%3Adele.safetensors").as_deref(),
            Some("mo_dele.safetensors")
        );
    }
}
