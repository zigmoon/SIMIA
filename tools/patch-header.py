r"""Le nom d'un fichier ne dit pas tout : on lit l'en-tete du .safetensors.

Un LoRA depose dans models/image/ etait pris pour un checkpoint : carte creee,
puis echec au chargement, puisque le fichier ne contient pas de modele complet.
L'en-tete d'un .safetensors est du JSON et tient en quelques dizaines de
kilo-octets : il dit quels tenseurs sont la. On y lit trois choses :

- LoRA ou checkpoint (« lora_A »/« lora_B » contre `cond_stage_model` etc.) ;
- la famille d'architecture (SD 1.5, SDXL, DiT/Flux) ;
- donc les reglages de depart, sans les deviner d'apres le nom.

Le nom reste un indice pour ce que l'en-tete ne peut pas dire : une version
distillee (turbo, lightning, LCM) n'a pas de tenseur qui la distingue.
"""
import sys

PATH = r"C:\Users\zigmo\Desktop\Vibe\SIMIA-desktop\launcher\src\main.rs"


def read(path):
    with open(path, "rb") as handle:
        return handle.read().decode("utf-8-sig").replace("\r\n", "\n")


def write(path, text):
    with open(path, "wb") as handle:
        handle.write(text.replace("\n", "\r\n").encode("utf-8"))


HEADER_CODE = r'''
/// Famille d'architecture d'un modele ou d'un LoRA. Elle decide des reglages de
/// depart (resolution, pas) et permet de prevenir qu'un LoRA ne vise pas le
/// modele charge : les tenseurs ne se correspondent pas, le moteur refuse.
#[derive(Clone, Copy, PartialEq, Eq)]
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
    {
        ImageFamily::Dit
    } else {
        ImageFamily::Unknown
    };
    // Une entree par tenseur, plus la cle de metadonnees.
    let tensors = text.matches("\"dtype\"").count().saturating_sub(0);
    Some(TensorHeader {
        tensors,
        lora,
        family,
    })
}
'''

# --- 1. Remplace l'heuristique de nom par en-tete + nom ---------------

GUESS_OLD = r'''/// Reglages de depart d'un checkpoint depose a la main. Le nom du fichier dit
/// presque toujours de quelle famille il s'agit : SDXL dessine en 1024 px, une
/// version distillee (turbo, lightning, LCM) tient en 4 pas et CFG 1, tout le
/// reste est du SD 1.5 en 512 px et 20 pas.
fn guess_image_settings(stem: &str) -> (u32, u32, f32) {
    let lower = stem.to_ascii_lowercase();
    let xl = ["xl", "sdxl", "pony", "illustrious", "noob"]
        .iter()
        .any(|key| lower.contains(key));
    let distilled = [
        "turbo", "lightning", "lcm", "dmd", "hyper", "schnell", "tiny", "distill",
    ]
    .iter()
    .any(|key| lower.contains(key));
    let px = if xl { 1024 } else { 512 };
    let (steps, cfg) = if distilled {
        (4, 1.0)
    } else if xl {
        (25, 7.0)
    } else {
        (20, 7.0)
    };
    (px, steps, cfg)
}'''

GUESS_NEW = r'''/// Reglages de depart d'un checkpoint depose a la main.
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
}'''

# --- 2. Un LoRA n'est pas un checkpoint --------------------------------

ADDED_OLD = r'''    let extension = image_model_extension(path)?;
    let (px, steps, cfg) = guess_image_settings(&stem);
    let kind = if extension == "safetensors" {
        "safetensors".to_string()
    } else {
        extension.to_ascii_uppercase()
    };
    Some(ImagePack {
        id: image_pack_id(&stem),
        name: image_pack_name(&stem),
        mode: "checkpoint".to_string(),
        size: format!("~{}", human_size(bytes)),
        license: String::new(),
        note: format!(
            "Depose a la main dans models/image/ ({kind}). Reglages devines d'apres le nom : {px} px, {steps} pas, CFG {cfg}. Un nom contenant « turbo », « lightning » ou « xl » change ces valeurs.",
        ),'''

ADDED_NEW = r'''    let extension = image_model_extension(path)?;
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
        ),'''

# --- 3. Les LoRA : en-tete, famille, et fichiers a la racine ----------

LORAS_OLD = r'''/// LoRA disponibles dans `models/image/loras/`. Le moteur les applique quand la
/// requete porte `lora: [{path, multiplier}]` : on change de style sans
/// recharger le checkpoint, et un fichier depose la est utilisable tout de suite.
struct ImageLora {
    name: String,
    bytes: u64,
}

fn discover_image_loras(dir: &Path) -> Vec<ImageLora> {
    let mut found: Vec<ImageLora> = Vec::new();
    let Ok(entries) = fs::read_dir(dir.join("loras")) else {
        return found;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let extension = path
            .extension()
            .and_then(|value| value.to_str())
            .map(|value| value.to_ascii_lowercase());
        if !matches!(extension.as_deref(), Some("safetensors") | Some("pt")) {
            continue;
        }
        let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
            continue;
        };
        let bytes = fs::metadata(&path).map(|meta| meta.len()).unwrap_or(0);
        found.push(ImageLora {
            name: name.to_string(),
            bytes,
        });
    }
    found.sort_by(|first, second| first.name.to_lowercase().cmp(&second.name.to_lowercase()));
    found
}'''

LORAS_NEW = r'''/// LoRA disponibles dans `models/image/loras/` et a la racine de
/// `models/image/`. Le moteur les applique quand la requete porte
/// `lora: [{path, multiplier}]` : on change de style sans recharger le
/// checkpoint, et un fichier depose la est utilisable tout de suite.
///
/// La famille visee est lue dans l'en-tete : un LoRA entraine pour une autre
/// architecture que le modele charge ne s'applique pas, autant le dire avant
/// de lancer une generation qui echouera.
struct ImageLora {
    name: String,
    bytes: u64,
    family: ImageFamily,
}

fn collect_loras(entries: impl Iterator<Item = fs::DirEntry>, found: &mut Vec<ImageLora>) {
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
}'''

# --- 4. La famille d'un pack, pour comparer avec celle d'un LoRA ------

PACK_JSON_OLD = r'''                        js_escape(&pack.prompt_prefix),
                        pack.added
                    )'''
PACK_JSON_NEW = r'''                        js_escape(&pack.prompt_prefix),
                        pack.added
                    )'''
FORMAT_OLD = r'''\"loraWeight\":{},\"promptPrefix\":{},\"added\":{}}}",'''
FORMAT_NEW = r'''\"loraWeight\":{},\"promptPrefix\":{},\"added\":{},\"family\":{}}}",'''
ADDED_ARG_OLD = r'''                        js_escape(&pack.prompt_prefix),
                        pack.added
                    )'''
ADDED_ARG_NEW = r'''                        js_escape(&pack.prompt_prefix),
                        pack.added,
                        js_escape(pack_family(pack).key())
                    )'''
LORA_JSON_OLD = r'''                .map(|lora| {
                    format!(
                        "{{\"name\":{},\"bytes\":{}}}",
                        js_escape(&lora.name),
                        lora.bytes
                    )
                })'''
LORA_JSON_NEW = r'''                .map(|lora| {
                    format!(
                        "{{\"name\":{},\"bytes\":{},\"family\":{}}}",
                        js_escape(&lora.name),
                        lora.bytes,
                        js_escape(lora.family.key())
                    )
                })'''

FAMILY_FN = r'''/// Famille d'un pack du catalogue, deduite de sa forme : un pack a trois
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

'''

TESTS_OLD_1 = r'''    #[test]
    fn devine_les_reglages_d_apres_le_nom() {
        assert_eq!(guess_image_settings("dreamshaper_8"), (512, 20, 7.0));
        assert_eq!(guess_image_settings("pony-diffusion-v6-xl"), (1024, 25, 7.0));
        assert_eq!(guess_image_settings("sdxl-turbo"), (1024, 4, 1.0));
        assert_eq!(guess_image_settings("anything-v5-lcm"), (512, 4, 1.0));
    }'''

TESTS_NEW_1 = r'''    /// Ecrit un .safetensors minimal : longueur, puis en-tete JSON.
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
    }'''

TESTS_OLD_2 = r'''    #[test]
    fn les_lora_du_dossier_sont_listes() {
        let dir = scratch("loras");
        touch(&dir, "loras/simia-gravure.safetensors", 32);
        touch(&dir, "loras/photo.pt", 16);
        touch(&dir, "loras/readme.txt", 4);
        let names: Vec<String> = discover_image_loras(&dir).into_iter().map(|lora| lora.name).collect();
        assert_eq!(names, vec!["photo.pt", "simia-gravure.safetensors"]);
        let _ = fs::remove_dir_all(&dir);
    }'''

TESTS_NEW_2 = r'''    #[test]
    fn les_lora_du_dossier_sont_listes() {
        let dir = scratch("loras");
        touch(&dir, "loras/simia-gravure.safetensors", 32);
        touch(&dir, "loras/photo.pt", 16);
        touch(&dir, "loras/readme.txt", 4);
        let names: Vec<String> = discover_image_loras(&dir).into_iter().map(|lora| lora.name).collect();
        assert_eq!(names, vec!["photo.pt", "simia-gravure.safetensors"]);
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
        let _ = fs::remove_dir_all(&dir);
    }'''

PAIRS = [
    # Les types et la lecture d'en-tete, avant l'extension connue.
    (
        r'''/// Extensions que le moteur d'images sait ouvrir.''',
        HEADER_CODE.strip("\n") + "\n\n" + r'''/// Extensions que le moteur d'images sait ouvrir.''',
    ),
    (GUESS_OLD, GUESS_NEW),
    (ADDED_OLD, ADDED_NEW),
    (LORAS_OLD, LORAS_NEW),
    (FORMAT_OLD, FORMAT_NEW),
    (ADDED_ARG_OLD, ADDED_ARG_NEW),
    (LORA_JSON_OLD, LORA_JSON_NEW),
    # pack_family juste avant image_packs_json.
    (
        r'''fn image_packs_json(state: &Shared) -> String {''',
        FAMILY_FN + r'''fn image_packs_json(state: &Shared) -> String {''',
    ),
    (TESTS_OLD_1, TESTS_NEW_1),
    (TESTS_OLD_2, TESTS_NEW_2),
]


def main():
    text = read(PATH)
    for index, (old, new) in enumerate(PAIRS, start=1):
        count = text.count(old)
        if count != 1:
            print(f"ECHEC #{index}: {count} occurrence(s) pour >>>{old[:70]}<<<")
            sys.exit(1)
        text = text.replace(old, new)
    write(PATH, text)
    print(f"OK {PATH}: {len(PAIRS)} remplacements")


main()
