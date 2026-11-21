r"""Packs video : MiniMax-H3 et architectures a composants multiples.

Un pack video n'est pas un checkpoint : il lui faut quatre fichiers
(transformer, encodeur de texte, VAE video, VAE audio) et une generation
asynchrone, parce qu'une video prend des minutes.
"""
import sys

PATH = r"C:\Users\zigmo\Desktop\Vibe\SIMIA-desktop\launcher\src\main.rs"


def read(path):
    with open(path, "rb") as handle:
        return handle.read().decode("utf-8-sig").replace("\r\n", "\n")


def write(path, text):
    with open(path, "wb") as handle:
        handle.write(text.replace("\n", "\r\n").encode("utf-8"))


PAIRS = [
    # 1. Champs propres aux packs video.
    (
        r'''    #[serde(default)]
    lora_url: String,
    /// Fichier depose a la main dans `models/image/` : SIMIA l'a reconnu seul,''',
        r'''    #[serde(default)]
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
    /// Fichier depose a la main dans `models/image/` : SIMIA l'a reconnu seul,''',
    ),
    # 2. Helpers du pack : video, dimensions, cadence.
    (
        r'''    fn file_names(&self) -> Vec<String> {
        let mut names = Vec::new();
        for value in [&self.model, &self.diffusion, &self.llm, &self.vae] {''',
        r'''    /// Un pack video ne se charge pas comme un checkpoint : il lui faut un
    /// transformer, un encodeur de texte et deux VAE, et sa generation passe par
    /// une file de taches (`vid_gen`) au lieu d'une requete synchrone.
    fn is_video(&self) -> bool {
        matches!(self.mode.as_str(), "h3" | "ltx" | "video")
    }

    fn file_names(&self) -> Vec<String> {
        let mut names = Vec::new();
        for value in [&self.model, &self.diffusion, &self.llm, &self.vae, &self.audio_vae] {''',
    ),
    (
        r'''    fn px_or(&self, fallback: u32) -> u32 {
        if self.px > 0 { self.px } else { fallback }
    }''',
        r'''    /// Largeur et hauteur. Un pack carre n'a pas de `height` : les deux valent
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
    }''',
    ),
    # 3. Familles : H3, LTX et Z-Image se distinguent enfin.
    (
        r'''enum ImageFamily {
    Sd15,
    Sdxl,
    /// Architecture a blocs de transformation (Flux, Z-Image, LTX-AV) : elle
    /// demande son encodeur de texte et son VAE a cote du checkpoint.
    Dit,
    Unknown,
}''',
        r'''enum ImageFamily {
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
}''',
    ),
    (
        r'''    fn key(self) -> &'static str {
        match self {
            ImageFamily::Sd15 => "sd15",
            ImageFamily::Sdxl => "sdxl",
            ImageFamily::Dit => "dit",
            ImageFamily::Unknown => "",
        }
    }''',
        r'''    fn key(self) -> &'static str {
        match self {
            ImageFamily::Sd15 => "sd15",
            ImageFamily::Sdxl => "sdxl",
            ImageFamily::H3 => "h3",
            ImageFamily::Ltx => "ltx",
            ImageFamily::ZImage => "zimage",
            ImageFamily::Dit => "dit",
            ImageFamily::Unknown => "",
        }
    }''',
    ),
    (
        r'''    fn label(self) -> &'static str {
        match self {
            ImageFamily::Sd15 => "SD 1.5",
            ImageFamily::Sdxl => "SDXL",
            ImageFamily::Dit => "DiT",
            ImageFamily::Unknown => "?",
        }
    }''',
        r'''    fn label(self) -> &'static str {
        match self {
            ImageFamily::Sd15 => "SD 1.5",
            ImageFamily::Sdxl => "SDXL",
            ImageFamily::H3 => "MiniMax-H3",
            ImageFamily::Ltx => "LTX-2",
            ImageFamily::ZImage => "Z-Image",
            ImageFamily::Dit => "DiT",
            ImageFamily::Unknown => "?",
        }
    }''',
    ),
    (
        r'''    fn defaults(self) -> (u32, u32, f32) {
        match self {
            ImageFamily::Sdxl => (1024, 25, 7.0),
            ImageFamily::Sd15 => (512, 20, 7.0),
            // Une architecture DiT complete est presque toujours distillee, et
            // de toute facon on ne peut pas la dessiner sans son VAE.
            ImageFamily::Dit => (1024, 8, 1.0),
            ImageFamily::Unknown => (512, 20, 7.0),
        }
    }''',
        r'''    fn defaults(self) -> (u32, u32, f32) {
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
    }''',
    ),
    # 4. Detection dans l'en-tete : H3 avant les regles generiques.
    (
        r'''    let lora = text.contains("lora_A") || text.contains("lora_B") || text.contains("lora_unet_");
    let family = if text.contains("conditioner.embedders.1") || text.contains("conditioner.embedders.2") {''',
        r'''    let lora = text.contains("lora_A") || text.contains("lora_B") || text.contains("lora_unet_");
    /* MiniMax-H3 porte un `token_refiner`, des projections `qkv_proj` et un
       projecteur audio : trois marques qu'aucune autre famille n'a. Tester
       avant les regles generiques evite de le confondre avec un DiT anonyme. */
    let h3 = text.contains("audio_patch_proj")
        || text.contains("token_refiner")
        || text.contains("qkv_proj");
    let family = if h3 {
        ImageFamily::H3
    } else if text.contains("conditioner.embedders.1") || text.contains("conditioner.embedders.2") {''',
    ),
    (
        r'''    } else if text.contains("joint_blocks")
        || text.contains("double_blocks")
        || text.contains("single_transformer_blocks")
        || text.contains("audio_patch_proj")''',
        r'''    } else if text.contains("transformer_blocks.") {
        // LTX-2 nomme ses blocs `transformer_blocks`.
        ImageFamily::Ltx
    } else if text.contains("joint_blocks")
        || text.contains("double_blocks")
        || text.contains("single_transformer_blocks")''',
    ),
    # 5. spawn : quatre composants pour une video.
    (
        r'''    let mut command = Command::new(bin);
    if pack.mode == "zimage" {''',
        r'''    let mut command = Command::new(bin);
    if pack.is_video() {
        /* MiniMax-H3 : transformer, encodeur de texte et deux VAE. Les poids
           pesent plus lourd que la memoire graphique d'une carte courante :
           `--offload-to-cpu` garde le modele en RAM et fait circuler les blocs,
           et `--rng cpu` evite de tenir le generateur aleatoire sur le GPU. */
        command
            .arg("--diffusion-model")
            .arg(dir.join(&pack.diffusion))
            .arg("--vae")
            .arg(dir.join(&pack.vae))
            .arg("--llm")
            .arg(dir.join(&pack.llm))
            .arg("--offload-to-cpu")
            .arg("--vae-tiling")
            .arg("--rng")
            .arg("cpu");
        if !pack.audio_vae.is_empty() {
            command.arg("--audio-vae").arg(dir.join(&pack.audio_vae));
        }
    } else if pack.mode == "zimage" {''',
    ),
    # 6. start_image : dimensions larges et hautes distinctes.
    (
        r'''        let steps = guard.image.steps_override.unwrap_or(pack.steps_or(DEFAULT_IMG_STEPS));
        let size = guard.image.size_override.unwrap_or(pack.px_or(DEFAULT_IMG_WIDTH));
        (
            guard.image.bin.clone().unwrap(),
            pack,
            guard.image.dir.clone(),
            guard.image.port,
            steps,
            size,
        )''',
        r'''        let steps = guard.image.steps_override.unwrap_or(pack.steps_or(DEFAULT_IMG_STEPS));
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
        )''',
    ),
    (
        r'''    let (bin, pack, dir, port, steps, size) = {''',
        r'''    let (bin, pack, dir, port, steps, width, height) = {''',
    ),
    (
        r'''        let child = match spawn_sd_server(&bin, &pack, &dir, port, steps, size) {''',
        r'''        let child = match spawn_sd_server(&bin, &pack, &dir, port, steps, width, height) {''',
    ),
    (
        r'''    port: u16,
    steps: u32,
    size: u32,
) -> std::io::Result<Child> {''',
        r'''    port: u16,
    steps: u32,
    width: u32,
    height: u32,
) -> std::io::Result<Child> {''',
    ),
    (
        r'''        .arg("--steps")
        .arg(steps.to_string())
        .arg("-W")
        .arg(size.to_string())
        .arg("-H")
        .arg(size.to_string())''',
        r'''        .arg("--steps")
        .arg(steps.to_string())
        .arg("-W")
        .arg(width.to_string())
        .arg("-H")
        .arg(height.to_string())''',
    ),
    # 7. Etat expose a l'interface : video, cadence, duree.
    (
        r'''            let steps = pack.map(|item| guard.image.steps_override.unwrap_or(item.steps_or(DEFAULT_IMG_STEPS))).unwrap_or(0);
            let size = pack.map(|item| guard.image.size_override.unwrap_or(item.px_or(DEFAULT_IMG_WIDTH))).unwrap_or(0);
            format!(
                "{{\"available\":{},\"state\":{},\"message\":{},\"width\":{},\"height\":{},\"steps\":{},\"cfg\":{},\"pack\":{},\"reason\":{}}}",
                available,
                js_escape(&guard.image.state),
                js_escape(&guard.image.message),
                size,
                size,
                steps,''',
        r'''            let steps = pack.map(|item| guard.image.steps_override.unwrap_or(item.steps_or(DEFAULT_IMG_STEPS))).unwrap_or(0);
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
                steps,''',
    ),
    (
        r'''                match missing {
                    Some(reason) => js_escape(&reason),
                    None => "null".to_string(),
                }
            )
        }
        Err(_) => "{\"available\":false,\"state\":\"error\"}".to_string(),''',
        r'''                match missing {
                    Some(reason) => js_escape(&reason),
                    None => "null".to_string(),
                },
                video,
                frames,
                fps
            )
        }
        Err(_) => "{\"available\":false,\"state\":\"error\"}".to_string(),''',
    ),
    # 8. Famille d'un pack video.
    (
        r'''fn pack_family(pack: &ImagePack) -> ImageFamily {
    if pack.mode == "zimage" {
        return ImageFamily::Dit;
    }''',
        r'''fn pack_family(pack: &ImagePack) -> ImageFamily {
    if pack.mode == "h3" {
        return ImageFamily::H3;
    }
    if pack.mode == "ltx" {
        return ImageFamily::Ltx;
    }
    if pack.mode == "zimage" {
        return ImageFamily::ZImage;
    }''',
    ),
    # 9. Le contenu renvoye porte le caractere video du pack.
    (
        r'''\"loraWeight\":{},\"promptPrefix\":{},\"added\":{},\"family\":{}}}",''',
        r'''\"loraWeight\":{},\"promptPrefix\":{},\"added\":{},\"family\":{},\"video\":{},\"height\":{},\"frames\":{},\"fps\":{}}}",''',
    ),
    (
        r'''                        js_escape(pack_family(pack).key())
                    )''',
        r'''                        js_escape(pack_family(pack).key()),
                        pack.is_video(),
                        pack.size_or(0).1,
                        pack.frames_or(DEFAULT_VIDEO_FRAMES),
                        pack.fps_or(DEFAULT_VIDEO_FPS)
                    )''',
    ),
    (
        r'''                        local == false && (!pack.url.is_empty() || !pack.lora_url.is_empty()),''',
        r'''                        local == false
                            && (!pack.url.is_empty()
                                || !pack.lora_url.is_empty()
                                || !pack.diffusion_url.is_empty()
                                || !pack.llm_url.is_empty()
                                || !pack.vae_url.is_empty()
                                || !pack.audio_vae_url.is_empty()),''',
    ),
    # 10. La generation video libere le GPU et recoit le LoRA comme une image.
    (
        r'''        let generating = url.ends_with("/v1/img_gen") || url.ends_with("/sdapi/v1/txt2img");''',
        r'''        let generating = url.ends_with("/v1/img_gen")
            || url.ends_with("/sdapi/v1/txt2img")
            || url.ends_with("/v1/vid_gen");''',
    ),
    # 11. Telechargement : une URL par composant.
    (
        r'''    let checkpoint = if pack.model.is_empty() { None } else { Some(dir.join(&pack.model)) };
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
        }''',
        r'''    /* Un pack video compte quatre fichiers, chacun avec son URL : on construit
       la liste de ce qui manque avant de telecharger, pour tout annoncer d'un
       coup plutot que d'echouer au troisieme. */
    let mut jobs: Vec<(std::path::PathBuf, String)> = Vec::new();
    let mut missing_url: Option<String> = None;
    let mut queue = |name: &str, url: &str| {
        if name.is_empty() {
            return;
        }
        let dest = dir.join(name);
        if dest.is_file() {
            return;
        }
        if url.is_empty() {
            missing_url = Some(name.to_string());
            return;
        }
        jobs.push((dest, url.to_string()));
    };
    queue(&pack.model, &pack.url);
    if pack.is_video() {
        queue(&pack.diffusion, &pack.diffusion_url);
        queue(&pack.llm, &pack.llm_url);
        queue(&pack.vae, &pack.vae_url);
        queue(&pack.audio_vae, &pack.audio_vae_url);
    }
    let lora = pack.lora_file().map(|name| dir.join("loras").join(name));
    let needs_lora = lora.as_ref().map(|path| !path.is_file()).unwrap_or(false);

    if jobs.is_empty() && !needs_lora {
        return select_image_pack(state, id);
    }
    if let Some(name) = missing_url {
        return Err(format!("{name} n'a pas d'URL de telechargement"));
    }

    let total = if jobs.is_empty() { 1 } else { parse_size(&pack.size) };
    set_progress(state, id, 0, total, "image", None);

    let result = (|| -> Result<(), String> {
        for (dest, url) in &jobs {
            if let Some(parent) = dest.parent() {
                let _ = fs::create_dir_all(parent);
            }
            fetch_pack_file(state, id, &pack, dest, url, total)?;
        }''',
    ),
]


def main():
    text = read(PATH)
    for index, (old, new) in enumerate(PAIRS, start=1):
        count = text.count(old)
        if count != 1:
            print(f"ECHEC #{index}: {count} occurrence(s) pour >>>{old[:70]}<<<")
            sys.exit(1)
        text = text.replace(old, new)

    # Constantes de la video
    anchor = "const DEFAULT_IMG_STEPS: u32 = 8;"
    if text.count(anchor) != 1:
        print(f"ECHEC ancre constantes : {text.count(anchor)}")
        sys.exit(1)
    text = text.replace(
        anchor,
        anchor + "\n/// Duree par defaut d'une video : deux secondes a 24 images par seconde.\n"
        "const DEFAULT_VIDEO_FRAMES: u32 = 49;\nconst DEFAULT_VIDEO_FPS: u32 = 24;",
    )

    write(PATH, text)
    print(f"OK {PATH}: {len(PAIRS)} remplacements + constantes")


main()
