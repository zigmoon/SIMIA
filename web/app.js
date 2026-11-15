const STORAGE_KEY = "simia.backup.v1";
const MODEL_REQUIRED = "__SIMIA_MODEL_REQUIRED__";
/* Renseigne par le lanceur SIMIA Desktop ; absent dans la version web. */
const NATIVE = typeof window !== "undefined" && window.__SIMIA_NATIVE__ ? window.__SIMIA_NATIVE__ : null;
/* Generation d'images : uniquement dans l'application de bureau, le navigateur
 * seul n'a pas de moteur WebGPU compatible avec ces modeles. Le moteur est
 * present des que le lanceur expose son catalogue ; `available` dit si un jeu
 * de fichiers complet est sur le disque. */
const IMAGE = NATIVE && NATIVE.image && NATIVE.image.packsUrl ? NATIVE.image : null;

/* Un jeu de fichiers complet est-il utilisable maintenant ? */
function imageUsable() {
  if (!IMAGE) return false;
  if (state.imagePacks.length) {
    return state.imagePacks.some(pack => pack.id === state.imagePackId && pack.local);
  }
  return Boolean(IMAGE.available);
}
const MODELS = [
  // Léger
  { id: "SmolLM2-135M-Instruct-q0f16-MLC", name: "SmolLM2 135M", category: "Léger", size: "~150 MB", vramMB: 360, requiresF16: true, note: "Le plus compact, adapté aux réponses très courtes et aux essais rapides.", instruction: "Réponds de manière très simple, claire et concise." },
  { id: "SmolLM2-360M-Instruct-q4f16_1-MLC", name: "SmolLM2 360M", category: "Léger", size: "~350 MB", vramMB: 376, requiresF16: true, note: "Ultra-compact pour les réponses courtes et les appareils modestes.", instruction: "Réponds de manière simple, claire et concise." },
  { id: "Qwen2.5-0.5B-Instruct-q4f16_1-MLC", name: "Qwen 2.5 0.5B", category: "Léger", size: "~500 MB", vramMB: 945, note: "Rapide pour les questions simples, les listes et les reformulations brèves.", instruction: "Réponds avec clarté et concision." },
  { id: "TinyLlama-1.1B-Chat-v1.0-q4f16_1-MLC", name: "TinyLlama 1.1B", category: "Léger", size: "~650 MB", vramMB: 697, requiresF16: true, note: "Petit assistant conversationnel pour les tâches quotidiennes simples.", instruction: "Réponds avec bienveillance, clarté et concision." },
  // Généraliste
  { id: "Qwen3-0.6B-q4f16_1-MLC", name: "Qwen 3 0.6B", category: "Généraliste", size: "~500 MB", vramMB: 1403, document: true, note: "Petit mais récent et malin : il réfléchit avant de répondre. Suffisant pour retrouver une information dans un document.", instruction: "Réfléchis brièvement avant de répondre, puis réponds de manière claire et concise." },
  { id: "Llama-3.2-1B-Instruct-q4f16_1-MLC", name: "Llama 3.2 1B", category: "Généraliste", size: "~600 MB", vramMB: 880, note: "Bon point de départ pour créer et reformuler.", instruction: "Réponds avec clarté et concision." },
  { id: "Qwen3.5-0.8B-q4f16_1-MLC", name: "Qwen 3.5 0.8B", category: "Généraliste", size: "~650 MB", vramMB: 1629, document: true, note: "Dernière génération compacte. Réfléchit et suit bien les consignes. Utilisable sur documents.", instruction: "Réfléchis brièvement avant de répondre, puis réponds de manière claire et concise." },
  { id: "Qwen2.5-1.5B-Instruct-q4f16_1-MLC", name: "Qwen 2.5 1.5B", category: "Généraliste", size: "~1 GB", vramMB: 1630, note: "Polyvalent pour suivre des consignes et structurer une réponse.", instruction: "Réponds avec clarté, nuance et structure." },
  { id: "SmolLM2-1.7B-Instruct-q4f16_1-MLC", name: "SmolLM2 1.7B", category: "Généraliste", size: "~1 GB", vramMB: 1774, requiresF16: true, note: "Généraliste polyvalent et léger, bon compromis.", instruction: "Réponds de manière claire et utile." },
  { id: "Qwen3-1.7B-q4f16_1-MLC", name: "Qwen 3 1.7B", category: "Généraliste", size: "~1.2 GB", vramMB: 2037, document: true, note: "Excellent rapport qualité/taille. Polyvalent, pense avant de répondre. Bon sur documents.", instruction: "Réfléchis brièvement avant de répondre, puis réponds de manière claire et structurée." },
  { id: "Qwen3.5-2B-q4f16_1-MLC", name: "Qwen 3.5 2B", category: "Généraliste", size: "~1.4 GB", vramMB: 2245, document: true, recommended: true, note: "Dernière génération, plus de capacité pour des réponses riches et nuancées. Utilisable sur documents.", instruction: "Réfléchis brièvement avant de répondre, puis réponds de manière claire, riche et structurée." },
  { id: "Llama-3.2-3B-Instruct-q4f16_1-MLC", name: "Llama 3.2 3B", category: "Généraliste", size: "~1.9 GB", vramMB: 2264, document: true, note: "Généraliste solide et fluide pour rédiger, raisonner et structurer. Utilisable sur documents.", instruction: "Réponds avec clarté et concision." },
  { id: "Ministral-3-3B-Instruct-2512-BF16-q4f16_1-MLC", name: "Ministral 3 3B", category: "Généraliste", size: "~1.9 GB", vramMB: 2864, document: true, note: "Nouvelle génération compacte de Mistral : multilingue (dont le français), précise pour suivre des consignes et résumer un document.", instruction: "Réponds avec précision, dans la langue de l'utilisateur, et structure tes réponses." },
  // Écriture
  { id: "gemma3-1b-it-q4f16_1-MLC", name: "Gemma 3 1B", category: "Écriture", size: "~700 MB", vramMB: 711, requiresF16: true, note: "Compact et agréable pour les textes, idées et reformulations.", instruction: "Adopte une plume précise et naturelle." },
  { id: "gemma-2-2b-jpn-it-q4f16_1-MLC", name: "Gemma 2 2B JP", category: "Écriture", size: "~1.4 GB", vramMB: 1895, requiresF16: true, note: "Version japonaise de Gemma 2 : naturelle et précise pour écrire, reformuler ou converser en japonais.", instruction: "Réponds dans un japonais naturel, précis et adapté au ton demandé." },
  // Code
  { id: "Qwen2.5-Coder-0.5B-Instruct-q4f16_1-MLC", name: "Qwen 2.5 Coder 0.5B", category: "Code", size: "~500 MB", vramMB: 945, note: "Mini modèle spécialisé pour les snippets, commandes et explications de code courtes.", instruction: "Agis comme un ingénieur logiciel. Donne du code minimal et explique les hypothèses." },
  { id: "Qwen2.5-Coder-1.5B-Instruct-q4f16_1-MLC", name: "Qwen 2.5 Coder 1.5B", category: "Code", size: "~1 GB", vramMB: 1630, note: "Pour les petits scripts, les explications techniques et les revues ciblées.", instruction: "Agis comme un ingénieur logiciel. Donne du code minimal et explique les hypothèses." },
  { id: "Qwen2.5-Coder-3B-Instruct-q4f16_1-MLC", name: "Qwen 2.5 Coder 3B", category: "Code", size: "~1.7 GB", vramMB: 2505, note: "Le bon compromis pour coder : scripts, composants, tests et explications techniques sans saturer la mémoire.", instruction: "Agis comme un ingénieur logiciel. Donne du code minimal, correct et explique les hypothèses." },
  { id: "Qwen2.5-Coder-7B-Instruct-q4f16_1-MLC", name: "Qwen 2.5 Coder 7B", category: "Code", size: "~4.1 GB", vramMB: 5107, note: "Pour les projets de code plus ambitieux : refactorisations, revues complètes et raisonnement technique avancé.", instruction: "Agis comme un ingénieur logiciel senior. Analyse avant d'écrire, produis du code complet et signale les risques." },
  // Maths
  { id: "Qwen2.5-Math-1.5B-Instruct-q4f16_1-MLC", name: "Qwen 2.5 Math 1.5B", category: "Maths", size: "~1 GB", vramMB: 1630, note: "Pour résoudre des problèmes mathématiques étape par étape.", instruction: "Résous les problèmes pas à pas, pose les formules puis vérifie le résultat final." },
  { id: "Ministral-3-3B-Reasoning-2512-q4f16_1-MLC", name: "Ministral 3 3B Reasoning", category: "Maths", size: "~1.9 GB", vramMB: 2864, note: "Version raisonnement de Ministral 3 : maths, logique et problèmes techniques résolus étape par étape.", instruction: "Résous les problèmes étape par étape, vérifie chaque calcul et termine par une réponse claire." },
  { id: "DeepSeek-R1-Distill-Qwen-7B-q4f16_1-MLC", name: "DeepSeek R1 7B", category: "Maths", size: "~4.1 GB", vramMB: 5107, note: "Modèle de raisonnement réputé : démonstrations, maths et problèmes complexes avec un raisonnement détaillé.", instruction: "Raisonne étape par étape, explicite tes vérifications et termine par la réponse finale." },
  // Documents
  { id: "OLMo-2-0425-1B-Instruct-q4f16_1-MLC", name: "OLMo 2 1B", category: "Documents", size: "~1.1 GB", vramMB: 1776, document: true, note: "Modèle 1B totalement ouvert (licence libre) : léger, il lit et cite les passages d'un document sans consommer de mémoire.", instruction: "Tu analyses des documents. Réponds uniquement à partir des extraits fournis et cite-les." },
  { id: "gemma-2-2b-it-q4f16_1-MLC", name: "Gemma 2 2B", category: "Documents", size: "~1.2 GB", vramMB: 1895, requiresF16: true, document: true, recommended: true, note: "Le meilleur choix sous 1,4 Go pour les documents en français : bonne lecture, citations fiables, réponses claires.", instruction: "Tu es un analyste documentaire. Réponds uniquement à partir des extraits fournis, cite leur numéro et leur page, et signale les informations absentes." },
  { id: "Qwen2.5-3B-Instruct-q4f16_1-MLC", name: "Qwen 2.5 3B", category: "Documents", size: "~1.8 GB", vramMB: 2504, document: true, note: "Bon compromis pour lire, résumer et questionner des documents sans saturer la mémoire graphique.", instruction: "Tu analyses des documents. Réponds à partir des extraits fournis, cite-les, et reste factuel." },
  { id: "Phi-4-mini-instruct-q4f16_1-MLC", name: "Phi-4 mini", category: "Documents", size: "~2.1 GB", vramMB: 3437, document: true, recommended: true, note: "Le meilleur choix pour interroger des PDF et des rapports : lecture précise, citations fiables, résumés structurés.", instruction: "Tu es un analyste documentaire. Réponds uniquement à partir des extraits fournis, cite leur numéro et leur page entre crochets, et signale clairement quand l'information demandée n'est pas dans le document." },
  { id: "Phi-3.5-mini-instruct-q4f16_1-MLC", name: "Phi-3.5 mini", category: "Documents", size: "~2.1 GB", vramMB: 3672, document: true, note: "Excellent lecteur de rapports, contrats et documents techniques, avec des synthèses fidèles.", instruction: "Tu es un analyste documentaire. Réponds uniquement à partir des extraits fournis, cite leur numéro et leur page, et signale clairement les informations absentes." },
  { id: "Qwen3.5-4B-q4f16_1-MLC", name: "Qwen 3.5 4B", category: "Documents", size: "~2.3 GB", vramMB: 3868, document: true, note: "Dernière génération Qwen : plus de capacité pour analyser, comparer et résumer de longs documents.", instruction: "Tu es un analyste documentaire rigoureux. Appuie chaque affirmation sur un extrait numéroté, cite la page, et n'invente jamais une information absente du document." },
  { id: "Qwen3-4B-q4f16_1-MLC", name: "Qwen 3 4B", category: "Documents", size: "~2.3 GB", vramMB: 3431, document: true, note: "Plus de capacité : tableaux, calculs, comparaisons et questions complexes sur un long document.", instruction: "Tu es un analyste documentaire rigoureux. Appuie chaque affirmation sur un extrait numéroté, cite la page, et n'invente jamais une information absente du document." },
  { id: "gemma-4-E2B-it-q4f16_1-MLC", name: "Gemma 4 E2B", category: "Documents", size: "~2.7 GB", vramMB: 3387, requiresF16: true, document: true, recommended: true, note: "Le plus récent de Google : raisonnement solide, excellent en français et très à l'aise sur les longs documents.", instruction: "Tu es un analyste documentaire. Réponds uniquement à partir des extraits fournis, cite leur numéro et leur page, et signale les informations absentes." },
  { id: "Qwen2.5-7B-Instruct-q4f16_1-MLC", name: "Qwen 2.5 7B", category: "Documents", size: "~4.2 GB", vramMB: 5106, document: true, note: "Pour les très gros documents et les analyses fines, sur une carte graphique généreuse.", instruction: "Tu analyses des documents volumineux. Structure tes réponses, appuie-toi sur les extraits numérotés et cite les pages." },
  { id: "Qwen3.5-9B-q4f16_1-MLC", name: "Qwen 3.5 9B", category: "Documents", size: "~4.8 GB", vramMB: 6433, document: true, note: "Le haut de gamme de Qwen 3.5 : analyses fines, tableaux complexes et synthèses de très gros documents.", instruction: "Tu analyses des documents volumineux. Structure tes réponses, appuie-toi sur les extraits numérotés et cite les pages." },
  // Vision
  { id: "HuggingFaceTB/SmolVLM-256M-Instruct", name: "SmolVLM 256M", category: "Vision", size: "~500 MB", vramMB: 1000, vision: true, engine: "transformers", note: "Le plus petit modèle multimodal au monde. Analyse les images jointes et décrit leur contenu, entièrement dans le navigateur.", instruction: "Décris précisément le contenu des images et réponds à la question posée." },
  { id: "HuggingFaceTB/SmolVLM-500M-Instruct", name: "SmolVLM 500M", category: "Vision", size: "~1 GB", vramMB: 1300, vision: true, engine: "transformers", note: "Plus précis que le 256M pour décrire, lire et répondre sur les images jointes.", instruction: "Décris précisément le contenu des images et réponds à la question posée." },
  { id: "HuggingFaceTB/SmolVLM2-500M-Video-Instruct", name: "SmolVLM2 500M", category: "Vision", size: "~1 GB", vramMB: 1300, vision: true, engine: "transformers", note: "Nouvelle génération SmolVLM2 : analyse images et courtes vidéos, meilleure précision.", instruction: "Décris précisément le contenu des images et réponds à la question posée." }
];
let DEFAULT_MODEL_ID = "Llama-3.2-1B-Instruct-q4f16_1-MLC";
const MODEL_CONFIG_OVERRIDES = {
  "gemma3-1b-it-q4f16_1-MLC": { sliding_window_size: -1 }
};
const SELF_HOSTED_MODEL_PATH = "./models/Llama-3.2-1B-Instruct-q4f16_1-MLC/";
const SELF_HOSTED_MODEL_LIB = "./models/web-llm-models/Llama-3.2-1B-Instruct-q4f16_1_cs1k-webgpu.wasm";
const SELF_HOSTED_MODEL_STATUS = "./models/hosting-status.json";

const MODEL_EN = {
  "SmolLM2-135M-Instruct-q0f16-MLC": ["Lightweight", "The smallest option, suited to very short replies and quick trials."],
  "SmolLM2-360M-Instruct-q4f16_1-MLC": ["Lightweight", "Ultra-compact for short replies, trials, and modest devices."],
  "Qwen2.5-0.5B-Instruct-q4f16_1-MLC": ["Lightweight", "Fast for simple questions, lists, and short rewrites."],
  "TinyLlama-1.1B-Chat-v1.0-q4f16_1-MLC": ["Lightweight", "A small conversational assistant for simple daily tasks."],
  "Qwen3-0.6B-q4f16_1-MLC": ["General", "Small but recent and clever: it thinks before answering. Great for crisp replies."],
  "Llama-3.2-1B-Instruct-q4f16_1-MLC": ["General", "The lightweight general model to get started."],
  "Qwen3.5-0.8B-q4f16_1-MLC": ["General", "Latest compact generation. Thinks and follows instructions well."],
  "Qwen2.5-1.5B-Instruct-q4f16_1-MLC": ["General", "Versatile for following instructions and structuring answers."],
  "SmolLM2-1.7B-Instruct-q4f16_1-MLC": ["General", "Versatile and lightweight general model, a good compromise."],
  "Qwen3-1.7B-q4f16_1-MLC": ["General", "Excellent quality-to-size ratio. Versatile, thinks before answering."],
  "Qwen3.5-2B-q4f16_1-MLC": ["General", "Latest generation with more capacity for rich, nuanced answers."],
  "Llama-3.2-3B-Instruct-q4f16_1-MLC": ["General", "Solid, fluent general model for writing, reasoning, and structuring."],
  "Ministral-3-3B-Instruct-2512-BF16-q4f16_1-MLC": ["General", "Mistral's new compact generation: multilingual, strong at following instructions, and a good fit for documents."],
  "gemma3-1b-it-q4f16_1-MLC": ["Writing", "Compact and pleasant for text, ideas, and rewrites."],
  "gemma-2-2b-jpn-it-q4f16_1-MLC": ["Writing", "The Japanese-tuned Gemma 2: natural and precise for writing, rewriting, or chatting in Japanese."],
  "Qwen2.5-Coder-0.5B-Instruct-q4f16_1-MLC": ["Code", "A mini specialist for snippets, commands, and short code explanations."],
  "Qwen2.5-Coder-1.5B-Instruct-q4f16_1-MLC": ["Code", "For small scripts, technical explanations, and focused reviews."],
  "Qwen2.5-Coder-3B-Instruct-q4f16_1-MLC": ["Code", "The coding sweet spot: scripts, components, tests, and technical explanations without saturating memory."],
  "Qwen2.5-Coder-7B-Instruct-q4f16_1-MLC": ["Code", "For ambitious code work: refactors, full reviews, and advanced technical reasoning."],
  "Qwen2.5-Math-1.5B-Instruct-q4f16_1-MLC": ["Math", "For solving math problems step by step."],
  "Ministral-3-3B-Reasoning-2512-q4f16_1-MLC": ["Math", "The reasoning edition of Ministral 3: maths, logic, and technical problems solved step by step."],
  "DeepSeek-R1-Distill-Qwen-7B-q4f16_1-MLC": ["Math", "A well-regarded reasoning model: proofs, maths, and complex problems with detailed step-by-step thinking."],
  "OLMo-2-0425-1B-Instruct-q4f16_1-MLC": ["Documents", "A fully open 1B model (free licence): lightweight, it reads and cites passages from a document without using much memory."],
  "gemma-2-2b-it-q4f16_1-MLC": ["Documents", "The best pick under 1.4 GB for documents in French: careful reading, reliable citations, clear answers."],
  "Qwen2.5-3B-Instruct-q4f16_1-MLC": ["Documents", "A good trade-off to read, summarize, and question documents without saturating graphics memory."],
  "Phi-4-mini-instruct-q4f16_1-MLC": ["Documents", "The best pick to question PDFs and reports: careful reading, reliable citations, structured summaries."],
  "Phi-3.5-mini-instruct-q4f16_1-MLC": ["Documents", "Excellent reader of reports, contracts, and technical documents, with faithful summaries."],
  "Qwen3.5-4B-q4f16_1-MLC": ["Documents", "The latest Qwen generation: extra capacity to analyze, compare, and summarize long documents."],
  "Qwen3-4B-q4f16_1-MLC": ["Documents", "More capacity: tables, calculations, comparisons, and complex questions about a long document."],
  "gemma-4-E2B-it-q4f16_1-MLC": ["Documents", "Google's newest model: solid reasoning, excellent French, and very comfortable with long documents."],
  "Qwen2.5-7B-Instruct-q4f16_1-MLC": ["Documents", "For very large documents and fine-grained analysis, on a generous graphics card."],
  "Qwen3.5-9B-q4f16_1-MLC": ["Documents", "The high end of Qwen 3.5: fine-grained analysis, complex tables, and summaries of very large documents."],
  "HuggingFaceTB/SmolVLM-256M-Instruct": ["Vision", "Analyzes attached images and describes their content."],
  "HuggingFaceTB/SmolVLM-500M-Instruct": ["Vision", "More accurate than the 256M for describing, reading, and answering about attached images."],
  "HuggingFaceTB/SmolVLM2-500M-Video-Instruct": ["Vision", "Next-generation SmolVLM2: analyzes images and short videos with better accuracy."]
};

const MODEL_ES = {
  "SmolLM2-135M-Instruct-q0f16-MLC": ["Ligero", "La opción más pequeña, adecuada para respuestas muy cortas y pruebas rápidas."],
  "SmolLM2-360M-Instruct-q4f16_1-MLC": ["Ligero", "Ultracompacto para respuestas cortas, pruebas y dispositivos modestos."],
  "Qwen2.5-0.5B-Instruct-q4f16_1-MLC": ["Ligero", "Rápido para preguntas sencillas, listas y reescrituras breves."],
  "TinyLlama-1.1B-Chat-v1.0-q4f16_1-MLC": ["Ligero", "Un pequeño asistente conversacional para tareas cotidianas sencillas."],
  "Qwen3-0.6B-q4f16_1-MLC": ["General", "Pequeño pero reciente e inteligente: piensa antes de responder. Ideal para respuestas claras."],
  "Llama-3.2-1B-Instruct-q4f16_1-MLC": ["General", "El modelo general ligero para empezar."],
  "Qwen3.5-0.8B-q4f16_1-MLC": ["General", "Última generación compacta. Piensa y sigue bien las instrucciones."],
  "Qwen2.5-1.5B-Instruct-q4f16_1-MLC": ["General", "Versátil para seguir instrucciones y estructurar respuestas."],
  "SmolLM2-1.7B-Instruct-q4f16_1-MLC": ["General", "Modelo general versátil y ligero, un buen equilibrio."],
  "Qwen3-1.7B-q4f16_1-MLC": ["General", "Excelente relación calidad-tamaño. Versátil, piensa antes de responder."],
  "Qwen3.5-2B-q4f16_1-MLC": ["General", "Última generación con más capacidad para respuestas ricas y matizadas."],
  "Llama-3.2-3B-Instruct-q4f16_1-MLC": ["General", "Modelo general sólido y fluido para redactar, razonar y estructurar."],
  "Ministral-3-3B-Instruct-2512-BF16-q4f16_1-MLC": ["General", "La nueva generación compacta de Mistral: multilingüe, buena para seguir instrucciones y adecuada para documentos."],
  "gemma3-1b-it-q4f16_1-MLC": ["Escritura", "Compacto y agradable para textos, ideas y reescrituras."],
  "gemma-2-2b-jpn-it-q4f16_1-MLC": ["Escritura", "La versión japonesa de Gemma 2: natural y precisa para escribir, reescribir o conversar en japonés."],
  "Qwen2.5-Coder-0.5B-Instruct-q4f16_1-MLC": ["Código", "Un mini especialista para fragmentos, comandos y explicaciones de código breves."],
  "Qwen2.5-Coder-1.5B-Instruct-q4f16_1-MLC": ["Código", "Para scripts pequeños, explicaciones técnicas y revisiones concretas."],
  "Qwen2.5-Coder-3B-Instruct-q4f16_1-MLC": ["Código", "El equilibrio ideal para programar: scripts, componentes, pruebas y explicaciones técnicas sin saturar la memoria."],
  "Qwen2.5-Coder-7B-Instruct-q4f16_1-MLC": ["Código", "Para proyectos de código ambiciosos: refactorizaciones, revisiones completas y razonamiento técnico avanzado."],
  "Qwen2.5-Math-1.5B-Instruct-q4f16_1-MLC": ["Matemáticas", "Para resolver problemas matemáticos paso a paso."],
  "Ministral-3-3B-Reasoning-2512-q4f16_1-MLC": ["Matemáticas", "La edición de razonamiento de Ministral 3: matemáticas, lógica y problemas técnicos resueltos paso a paso."],
  "DeepSeek-R1-Distill-Qwen-7B-q4f16_1-MLC": ["Matemáticas", "Un modelo de razonamiento reconocido: demostraciones, matemáticas y problemas complejos con un razonamiento detallado paso a paso."],
  "OLMo-2-0425-1B-Instruct-q4f16_1-MLC": ["Documentos", "Modelo 1B totalmente abierto (licencia libre): ligero, lee y cita pasajes de un documento sin consumir mucha memoria."],
  "gemma-2-2b-it-q4f16_1-MLC": ["Documentos", "La mejor opción por debajo de 1,4 GB para documentos en francés: buena lectura, citas fiables, respuestas claras."],
  "Qwen2.5-3B-Instruct-q4f16_1-MLC": ["Documentos", "Buen equilibrio para leer, resumir y preguntar sobre documentos sin saturar la memoria gráfica."],
  "Phi-4-mini-instruct-q4f16_1-MLC": ["Documentos", "La mejor opción para interrogar PDF e informes: lectura precisa, citas fiables, resúmenes estructurados."],
  "Phi-3.5-mini-instruct-q4f16_1-MLC": ["Documentos", "Excelente lector de informes, contratos y documentos técnicos, con resúmenes fieles."],
  "Qwen3.5-4B-q4f16_1-MLC": ["Documentos", "La última generación de Qwen: más capacidad para analizar, comparar y resumir documentos largos."],
  "Qwen3-4B-q4f16_1-MLC": ["Documentos", "Más capacidad: tablas, cálculos, comparaciones y preguntas complejas sobre un documento largo."],
  "gemma-4-E2B-it-q4f16_1-MLC": ["Documentos", "El modelo más reciente de Google: razonamiento sólido, excelente francés y muy cómodo con documentos largos."],
  "Qwen2.5-7B-Instruct-q4f16_1-MLC": ["Documentos", "Para documentos muy grandes y análisis finos, en una tarjeta gráfica generosa."],
  "Qwen3.5-9B-q4f16_1-MLC": ["Documentos", "La gama alta de Qwen 3.5: análisis detallados, tablas complejas y síntesis de documentos muy grandes."],
  "HuggingFaceTB/SmolVLM-256M-Instruct": ["Visión", "Analiza las imágenes adjuntas y describe su contenido."],
  "HuggingFaceTB/SmolVLM-500M-Instruct": ["Visión", "Más preciso que el 256M para describir, leer y responder sobre las imágenes adjuntas."],
  "HuggingFaceTB/SmolVLM2-500M-Video-Instruct": ["Visión", "Nueva generación SmolVLM2: analiza imágenes y vídeos cortos con mejor precisión."]
};

const MODEL_JA = {
  "SmolLM2-135M-Instruct-q0f16-MLC": ["軽量", "最も小さく、ごく短い回答やお試しに最適です。"],
  "SmolLM2-360M-Instruct-q4f16_1-MLC": ["軽量", "短い回答や非力な端末向けの超コンパクトモデルです。"],
  "Qwen2.5-0.5B-Instruct-q4f16_1-MLC": ["軽量", "簡単な質問、箇条書き、短い言い換えに素早く応えます。"],
  "TinyLlama-1.1B-Chat-v1.0-q4f16_1-MLC": ["軽量", "日常的な簡単な作業に向く小さな対話アシスタントです。"],
  "Qwen3-0.6B-q4f16_1-MLC": ["汎用", "小さいながら新しい賢いモデル。答える前に考えます。文書から情報を探すのに十分です。"],
  "Llama-3.2-1B-Instruct-q4f16_1-MLC": ["汎用", "文章作成や言い換えの入門に最適。文書の検索にも使えます。"],
  "Qwen3.5-0.8B-q4f16_1-MLC": ["汎用", "最新世代のコンパクトモデル。考えて指示によく従います。文書にも使えます。"],
  "Qwen2.5-1.5B-Instruct-q4f16_1-MLC": ["汎用", "指示に従い、回答を組み立てるのが得意。文書への質問にも効果的です。"],
  "SmolLM2-1.7B-Instruct-q4f16_1-MLC": ["汎用", "軽くて汎用的、バランスの良い選択です。"],
  "Qwen3-1.7B-q4f16_1-MLC": ["汎用", "サイズに対する品質が非常に良いモデル。汎用で、答える前に考えます。文書にも強い。"],
  "Qwen3.5-2B-q4f16_1-MLC": ["汎用", "最新世代で、豊かで細やかな回答のための余裕があります。文書にも使えます。"],
  "Llama-3.2-3B-Instruct-q4f16_1-MLC": ["汎用", "文章作成・推論・構成に安定した汎用モデル。文書にも使えます。"],
  "Ministral-3-3B-Instruct-2512-BF16-q4f16_1-MLC": ["汎用", "Mistralの新しいコンパクト世代。多言語対応で指示の遂行に強く、文書にも適しています。"],
  "gemma3-1b-it-q4f16_1-MLC": ["文章", "文章、アイデア、言い換えに心地よいコンパクトモデル。文書にも使えます。"],
  "gemma-2-2b-jpn-it-q4f16_1-MLC": ["文章", "日本語に最適化されたGemma 2。自然で正確な日本語の文章作成・言い換え・会話に適しています。"],
  "Qwen2.5-Coder-0.5B-Instruct-q4f16_1-MLC": ["コード", "短いコード、コマンド、コードの説明に特化した小型モデルです。"],
  "Qwen2.5-Coder-1.5B-Instruct-q4f16_1-MLC": ["コード", "小さなスクリプト、技術的な説明、ピンポイントのレビュー向けです。"],
  "Qwen2.5-Coder-3B-Instruct-q4f16_1-MLC": ["コード", "コーディングの好バランス。スクリプト、コンポーネント、テスト、技術的な説明をメモリを圧迫せずに扱えます。"],
  "Qwen2.5-Coder-7B-Instruct-q4f16_1-MLC": ["コード", "本格的なコード作業向け。リファクタリング、全体レビュー、高度な技術的推論に適しています。"],
  "Qwen2.5-Math-1.5B-Instruct-q4f16_1-MLC": ["数学", "数学の問題を段階的に解きます。"],
  "Ministral-3-3B-Reasoning-2512-q4f16_1-MLC": ["数学", "Ministral 3の推論版。数学、論理、技術的な問題を段階的に解きます。"],
  "DeepSeek-R1-Distill-Qwen-7B-q4f16_1-MLC": ["数学", "定評ある推論モデル。証明、数学、複雑な問題を詳しい思考プロセスで解きます。"],
  "OLMo-2-0425-1B-Instruct-q4f16_1-MLC": ["文書", "完全にオープンな1Bモデル（自由なライセンス）。軽く、文書の箇所を引用して答えます。"],
  "gemma-2-2b-it-q4f16_1-MLC": ["文書", "日本語の文書なら1.4GB以下で最良の選択。読み取りが正確で引用も信頼できます。"],
  "Qwen2.5-3B-Instruct-q4f16_1-MLC": ["文書", "グラフィックメモリを使い切らずに文書を読み、要約し、質問できる良いバランスです。"],
  "Phi-4-mini-instruct-q4f16_1-MLC": ["文書", "PDFや報告書への質問に最適。正確に読み、信頼できる引用と構造化された要約を返します。"],
  "Phi-3.5-mini-instruct-q4f16_1-MLC": ["文書", "報告書、契約書、技術文書の読解に優れ、忠実な要約を作ります。"],
  "Qwen3.5-4B-q4f16_1-MLC": ["文書", "Qwenの最新世代。長い文書の分析・比較・要約のための余裕があります。"],
  "Qwen3-4B-q4f16_1-MLC": ["文書", "より高い能力。表、計算、比較、長い文書への複雑な質問に対応します。"],
  "gemma-4-E2B-it-q4f16_1-MLC": ["文書", "Googleの最新モデル。堅牢な推論、優れたフランス語、長い文書の扱いに強みがあります。"],
  "Qwen2.5-7B-Instruct-q4f16_1-MLC": ["文書", "非常に大きな文書や細かな分析向け。余裕のあるグラフィックカードが必要です。"],
  "Qwen3.5-9B-q4f16_1-MLC": ["文書", "Qwen 3.5のハイエンド。詳細な分析、複雑な表、非常に大きな文書の要約に適しています。"],
  "HuggingFaceTB/SmolVLM-256M-Instruct": ["画像", "世界最小のマルチモーダルモデル。添付画像を解析し、内容をブラウザ内で説明します。"],
  "HuggingFaceTB/SmolVLM-500M-Instruct": ["画像", "256Mより正確に、添付画像の説明・読み取り・回答ができます。"],
  "HuggingFaceTB/SmolVLM2-500M-Video-Instruct": ["画像", "新しいSmolVLM2。画像と短い動画をより高精度に解析します。"]
};

if (NATIVE && Array.isArray(NATIVE.models) && NATIVE.models.length) {
  /* Desktop : le catalogue GGUF du poste remplace la banque web. */
  MODELS.length = 0;
  NATIVE.models.forEach(model => MODELS.push({
    id: model.id,
    name: model.name,
    category: model.category || "Généraliste",
    size: model.size || "",
    vramMB: 0,
    document: true,
    nativeLocal: Boolean(model.local),
    nativeBytes: Number(model.bytes) || 0,
    nativeHosted: Boolean(model.hosted),
    nativeMirror: Boolean(model.mirror),
    nativeVision: Boolean(model.vision),
    recommended: Boolean(model.recommended),
    note: model.local
      ? "Modèle présent sur ce disque et exécuté en natif, sans téléchargement."
      : "Modèle du catalogue : SIMIA le télécharge une seule fois sur ce disque, puis l'exécute en natif.",
    instruction: ""
  }));
  const preferred = MODELS.find(model => model.id === NATIVE.selected);
  DEFAULT_MODEL_ID = (preferred || MODELS[0]).id;
}

const state = {
  language: "fr",
  conversations: [],
  activeConversationId: null,
  engine: null,
  loadedModelId: null,
  loadingEngine: false,
  useWebLLM: false,
  visionPipeline: null,
  visionProcessor: null,
  visionModelId: null,
  loadingVision: false,
  voiceRequested: false,
  recognition: null,
  voiceBase: "",
  voiceFinal: "",
  voiceMessage: "",
  pendingAttachments: [],
  selectedModel: DEFAULT_MODEL_ID,
  code: { files: [], activeId: null, open: false, focus: "code" },
  cachedModelId: null,
  autoLoadModel: false,
  semanticSearch: false,
  semanticVectors: null,
  lastDocumentSources: [],
  documentStatus: "",
  documentJobs: 0,
  gpuFeatures: null,
  webllmAppConfig: null,
  modelFilter: "all",
  modelAdvice: "",
  customModelStatus: "",
  customModel: null,
  customModelActive: false,
  agentMode: false,
  imageMode: false,
  imagePacks: [],
  imagePackId: null,
  profile: "",
  view: "home"
};

const ui = {
  chat: document.querySelector("#chat"),
  welcome: document.querySelector("#welcome"),
  form: document.querySelector("#composer"),
  composer: document.querySelector("#composer"),
  prompt: document.querySelector("#prompt"),
  send: document.querySelector("#send-button"),
  attachmentInput: document.querySelector("#attachment-input"),
  attach: document.querySelector("#attach-button"),
  attachmentTray: document.querySelector("#attachment-tray"),
  documentTools: document.querySelector("#document-tools"),
  documentToolsStatus: document.querySelector("#document-tools-status"),
  documentSummary: document.querySelector("#document-summary"),
  documentSemantic: document.querySelector("#document-semantic"),
  documentExport: document.querySelector("#document-export"),
  voice: document.querySelector("#voice-toggle"),
  voiceStatus: document.querySelector("#voice-status"),
  charCount: document.querySelector("#char-count"),
  agentToggle: document.querySelector("#agent-toggle"),
  imageToggle: document.querySelector("#image-toggle"),
  imageEngine: document.querySelector("#image-engine"),
  settingImage: document.querySelector("#setting-image"),
  imagePicker: document.querySelector("#image-picker"),
  infoToggle: document.querySelector("#info-toggle"),
  infoDialog: document.querySelector("#info-dialog"),
  infoContent: document.querySelector("#info-content"),
  topbar: document.querySelector(".topbar"),
  status: document.querySelector("#engine-status"),
  mode: document.querySelector("#mode-label"),
  language: document.querySelector("#language-toggle"),
  languageCurrent: document.querySelector("#language-current"),
  languageMenu: document.querySelector("#language-menu"),
  appMenu: document.querySelector("#app-menu"),
  appMenuToggle: document.querySelector("#app-menu-toggle"),
  appMenuSettings: document.querySelector("#app-menu-settings"),
  appMenuInfo: document.querySelector("#app-menu-info"),
  appMenuExport: document.querySelector("#app-menu-export"),
  appMenuLegal: document.querySelector("#app-menu-legal"),
  appMenuPurge: document.querySelector("#app-menu-purge"),
  settings: document.querySelector("#settings-panel"),
  webllm: document.querySelector("#webllm-toggle"),
  model: document.querySelector("#model-select"),
  modelInfo: document.querySelector("#model-info"),
  downloadInfo: document.querySelector("#download-info"),
  modelPicker: document.querySelector("#model-picker"),
  homeModelButton: document.querySelector("#home-model-button"),
  modelLibrary: document.querySelector("#model-library"),
  modelFilters: document.querySelector("#model-filters"),
  modelCards: document.querySelector("#model-cards"),
  customModelDialog: document.querySelector("#custom-model-dialog"),
  customModelToggle: document.querySelector("#my-model-toggle"),
  customModelSettingsToggle: document.querySelector("#my-model-settings-toggle"),
  customModelName: document.querySelector("#custom-model-name"),
  customModelBase: document.querySelector("#custom-model-base"),
  customModelInstructions: document.querySelector("#custom-model-instructions"),
  customModelImportFile: document.querySelector("#custom-model-import-file"),
  customModelEyebrow: document.querySelector("#custom-model-eyebrow"),
  customModelTitle: document.querySelector("#custom-model-title"),
  customModelIntro: document.querySelector("#custom-model-intro"),
  customModelStepName: document.querySelector("#custom-model-step-name"),
  customModelNameHint: document.querySelector("#custom-model-name-hint"),
  customModelStepBase: document.querySelector("#custom-model-step-base"),
  customModelBaseHint: document.querySelector("#custom-model-base-hint"),
  customModelStepInstructions: document.querySelector("#custom-model-step-instructions"),
  customModelInstructionsHint: document.querySelector("#custom-model-instructions-hint"),
  customModelExamples: document.querySelector("#custom-model-examples"),
  customModelPreviewLabel: document.querySelector("#custom-model-preview-label"),
  customModelPreview: document.querySelector("#custom-model-preview"),
  customModelStatus: document.querySelector("#custom-model-status"),
  customModelSave: document.querySelector("#custom-model-save"),
  customModelDisable: document.querySelector("#custom-model-disable"),
  customModelExport: document.querySelector("#custom-model-export"),
  customModelImport: document.querySelector("#custom-model-import"),
  autoLoadModel: document.querySelector("#auto-load-model"),
  exportDialog: document.querySelector("#export-dialog"),
  exportToggle: document.querySelector("#export-toggle"),
  purgeToggle: document.querySelector("#purge-toggle"),
  exportSettings: document.querySelector("#export-settings"),
  exportConversations: document.querySelector("#export-conversations"),
  conversationList: document.querySelector("#conversation-list"),
  legal: document.querySelector("#legal-dialog"),
  legalContent: document.querySelector("#legal-content"),
  profileInput: document.querySelector("#profile-input"),
  exportMarkdown: document.querySelector("#export-markdown"),
  importFile: document.querySelector("#import-file"),
  exportFull: document.querySelector("#export-full"),
  importBackup: document.querySelector("#import-backup"),
  modelRecommend: document.querySelector("#model-recommend"),
  workspace: document.querySelector(".workspace"),
  home: document.querySelector("#home-button"),
  codePane: document.querySelector("#code-pane"),
  codeTabs: document.querySelector("#code-tabs"),
  codeInput: document.querySelector("#code-input"),
  codeHighlight: document.querySelector("#code-highlight"),
  codeGutter: document.querySelector("#code-gutter"),
  codeMeta: document.querySelector("#code-meta"),
  codeLang: document.querySelector("#code-lang"),
  codeSwitch: document.querySelector("#code-mode-switch"),
  codeNew: document.querySelector("#code-new"),
  codeNewWrap: document.querySelector("#code-new-wrap"),
  codeNewMenu: document.querySelector("#code-new-menu"),
  codeClose: document.querySelector("#code-close"),
  codeOutput: document.querySelector("#code-output"),
  codeOutputBody: document.querySelector("#code-output-body"),
  codeOutputState: document.querySelector("#code-output-state"),
  codeOutputStop: document.querySelector("#code-output-stop"),
  codeOutputClear: document.querySelector("#code-output-clear"),
  codeRun: document.querySelector("#code-run")
};

const copy = {
  fr: {
    placeholder: "Écrivez votre message...",
    ready: "Prêt",
    local: "ASSISTANT HORS LIGNE",
    loading: "Chargement du modèle...",
    error: "Modèle indisponible",
    welcomeTitle: "Comment puis-je vous aider ?",
    welcomeCopy: "Votre assistant personnel, sans compte et sans serveur : tout se passe dans ce navigateur.",
    welcomeModel: "Choisir un modèle pour commencer",
    welcomeSetup: "Le modèle se télécharge une fois, puis reste sur cet appareil.",
    autoLoadModel: "Charger automatiquement le modèle au lancement",
    disclaimer: "SIMIA peut faire des erreurs. Vérifiez les informations importantes.",
    activate: "Télécharger le modèle",
    active: "WebLLM actif",
    newChat: "+ Nouvelle conversation", today: "AUJOURD'HUI", settings: "Paramètres", localNote: "Vos données restent dans ce navigateur.", personalAssistant: "ASSISTANT PERSONNEL", send: "Envoyer", clear: "Effacer la conversation", legal: "Mentions légales et confidentialité", voiceStart: "Démarrer la saisie vocale", voiceStop: "Arrêter la saisie vocale", voiceListening: "Écoute en cours. La reconnaissance vocale est fournie par votre navigateur.", voiceUnavailable: "La saisie vocale n'est pas disponible dans ce navigateur.", voiceError: "La reconnaissance vocale a été interrompue.", attach: "Joindre des fichiers", dropFiles: "Déposez les fichiers ici", attachmentProblem: "Ce fichier n'a pas pu être lu.", attachmentAdvice: "Aucune limite de taille : SIMIA lit les gros fichiers par étapes et indexe le contenu en arrière-plan. Vous pouvez écrire pendant l'indexation.", imageNeedsVision: "Les modèles légers ne peuvent pas analyser les images.",
    download: "Télécharger le modèle", export: "Exporter / Importer", purge: "Purger", exportTitle: "Exporter et importer", exportCopy: "Téléchargez vos données, ou rechargez une sauvegarde SIMIA.", exportEyebrow: "SAUVEGARDE", exportSectionSave: "EXPORTER", exportSectionImport: "IMPORTER", exportImportHint: "Rechargez un fichier obtenu avec « Sauvegarde complète », « Exporter les réglages » ou « Exporter les conversations ». Vos données actuelles sont conservées.", exportFull: "Sauvegarde complète", importBackup: "Importer une sauvegarde", exportSettings: "Exporter les réglages", exportConversations: "Exporter les conversations", exportMarkdown: "Exporter en Markdown", localModel: "MODÈLE LOCAL", chooseModel: "Choisir un modèle",
    legalTitle: "Mentions légales et confidentialité", legalEyebrow: "NOTICE LOCAL-FIRST",
    downloadHint: "Le premier téléchargement peut prendre quelques minutes. Le modèle reste en cache sur cet appareil.",
    legalContent: "<h3>Éditeur</h3><p>Le site et l'application SIMIA sont édités par Zigmoon. Pour toute demande : <a href='mailto:contact@zigmoon.com'>contact@zigmoon.com</a>.</p><h3>Hébergement</h3><p>Le site est hébergé par LWS (Ligne Web Services), SAS au capital de 500 000 €, 10 rue de Penthièvre, 75008 Paris, France — RCS Paris B 851 993 683 00024. Les serveurs et les données sont situés en France.</p><h3>Données et confidentialité</h3><p>SIMIA conserve les conversations, préférences et exportations uniquement dans le stockage local de ce navigateur. Aucune donnée n'est transmise à un serveur : les modèles s'exécutent entièrement dans votre navigateur.</p><h3>Cookies et stockage local</h3><p>SIMIA ne dépose aucun cookie publicitaire ou de mesure d'audience. Le choix affiché dans la bannière, les réglages et les conversations sont mémorisés dans le stockage local du navigateur. Vous pouvez rouvrir le panneau Cookies ou effacer ces données depuis les réglages du navigateur.</p><h3>Modèles locaux</h3><p>Lorsque vous choisissez un modèle WebLLM, ses fichiers sont téléchargés depuis des fournisseurs tiers et mis en cache par votre navigateur. Les conditions et licences de chaque modèle restent applicables.</p><h3>Utilisation et limites</h3><p>SIMIA est fourni à titre d'assistant général. Les réponses peuvent être inexactes et ne constituent pas un avis professionnel, juridique, médical ou financier. Vérifiez les informations importantes avant toute décision.</p><h3>Vos contrôles</h3><p>Vous pouvez effacer une conversation, supprimer les données du site depuis les réglages du navigateur et exporter vos données au format JSON. Cette application ne propose pas de compte utilisateur ni de suivi analytique intégré.</p><h3>Propriété intellectuelle</h3><p>La marque SIMIA, ses éléments graphiques, textes et code sont protégés. Toute reproduction ou réutilisation non autorisée est interdite.</p>"
  },
  en: {
    placeholder: "Write your message...",
    ready: "Ready",
    local: "OFFLINE ASSISTANT",
    loading: "Loading model...",
    error: "Model unavailable",
    welcomeTitle: "How can I help you?",
    welcomeCopy: "Your personal assistant, with no account and no server: everything happens in this browser.",
    welcomeModel: "Choose a model to get started",
    welcomeSetup: "The model downloads once, then stays on this device.",
    autoLoadModel: "Load the model automatically when SIMIA opens",
    disclaimer: "SIMIA can make mistakes. Verify important information.",
    activate: "Download selected model",
    active: "WebLLM active",
    newChat: "+ New conversation", today: "TODAY", settings: "Settings", localNote: "Your data stays in this browser.", personalAssistant: "PERSONAL ASSISTANT", send: "Send", clear: "Clear conversation", legal: "Legal & privacy", voiceStart: "Start voice input", voiceStop: "Stop voice input", voiceListening: "Listening. Speech recognition is provided by your browser.", voiceUnavailable: "Voice input is not available in this browser.", voiceError: "Speech recognition was interrupted.", attach: "Attach files", dropFiles: "Drop files here", attachmentProblem: "This file could not be read.", attachmentAdvice: "No size limit: SIMIA reads large files in steps and indexes the content in the background. You can keep writing while it indexes.", imageNeedsVision: "Lightweight models cannot analyze images.",
    download: "Download model", export: "Export / Import", purge: "Purge", exportTitle: "Export and import", exportCopy: "Download your data, or load a SIMIA backup.", exportEyebrow: "BACKUP", exportSectionSave: "EXPORT", exportSectionImport: "IMPORT", exportImportHint: "Load a file produced by “Full backup”, “Export settings”, or “Export conversations”. Your current data is kept.", exportFull: "Full backup", importBackup: "Import a backup", exportSettings: "Export settings", exportConversations: "Export conversations", exportMarkdown: "Export to Markdown", localModel: "LOCAL MODEL", chooseModel: "Choose a model",
    legalTitle: "Legal & privacy", legalEyebrow: "LOCAL-FIRST NOTICE",
    downloadHint: "The first download can take a few minutes. The model stays cached on this device.",
    legalContent: "<h3>Publisher</h3><p>The SIMIA website and application are published by Zigmoon. For any request: <a href='mailto:contact@zigmoon.com'>contact@zigmoon.com</a>.</p><h3>Hosting</h3><p>The website is hosted by LWS (Ligne Web Services), SAS with a share capital of €500,000, 10 rue de Penthièvre, 75008 Paris, France — RCS Paris B 851 993 683 00024. Servers and data are located in France.</p><h3>Data and privacy</h3><p>SIMIA keeps conversations, preferences, and exports only in this browser's local storage. No data is sent to any server: the models run entirely inside your browser.</p><h3>Cookies and local storage</h3><p>SIMIA uses no advertising or analytics cookies. The banner choice, settings, and conversations are stored locally in this browser. You can reopen the Cookies panel or clear this data in your browser settings.</p><h3>Local models</h3><p>When you select a WebLLM model, its files are downloaded from third-party providers and cached by your browser. The terms and licenses of each model still apply.</p><h3>Use and limitations</h3><p>SIMIA is a general assistant. Its responses can be inaccurate and are not professional, legal, medical, or financial advice. Verify important information before making decisions.</p><h3>Your controls</h3><p>You can clear a conversation, remove site data through browser settings, and export your data as JSON. This application has no user account and no built-in analytics tracking.</p><h3>Intellectual property</h3><p>The SIMIA name, visual elements, text, and code are protected. Unauthorized reproduction or reuse is prohibited.</p>"
  },
  es: {
    placeholder: "Escribe tu mensaje...",
    ready: "Listo",
    local: "ASISTENTE SIN CONEXIÓN",
    loading: "Cargando el modelo...",
    error: "Modelo no disponible",
    welcomeTitle: "¿En qué puedo ayudarte?",
    welcomeCopy: "Tu asistente personal, sin cuenta y sin servidor: todo ocurre en este navegador.",
    welcomeModel: "Elige un modelo para empezar",
    welcomeSetup: "El modelo se descarga una vez y se queda en este dispositivo.",
    autoLoadModel: "Cargar automáticamente el modelo al abrir SIMIA",
    disclaimer: "SIMIA puede cometer errores. Verifica la información importante.",
    activate: "Descargar el modelo",
    active: "WebLLM activo",
    newChat: "+ Nueva conversación", today: "HOY", settings: "Ajustes", localNote: "Tus datos se quedan en este navegador.", personalAssistant: "ASISTENTE PERSONAL", send: "Enviar", clear: "Borrar conversación", legal: "Aviso legal y privacidad", voiceStart: "Iniciar entrada por voz", voiceStop: "Detener entrada por voz", voiceListening: "Escuchando. El reconocimiento de voz lo proporciona tu navegador.", voiceUnavailable: "La entrada por voz no está disponible en este navegador.", voiceError: "El reconocimiento de voz se ha interrumpido.", attach: "Adjuntar archivos", dropFiles: "Suelta los archivos aquí", attachmentProblem: "No se ha podido leer este archivo.", attachmentAdvice: "Sin límite de tamaño: SIMIA lee los archivos grandes por etapas e indexa el contenido en segundo plano. Puedes seguir escribiendo durante la indexación.", imageNeedsVision: "Los modelos ligeros no pueden analizar imágenes.",
    download: "Descargar modelo", export: "Exportar / Importar", purge: "Purgar", exportTitle: "Exportar e importar", exportCopy: "Descarga tus datos o carga una copia de SIMIA.", exportEyebrow: "COPIA DE SEGURIDAD", exportSectionSave: "EXPORTAR", exportSectionImport: "IMPORTAR", exportImportHint: "Carga un archivo creado con «Copia completa», «Exportar ajustes» o «Exportar conversaciones». Tus datos actuales se conservan.", exportFull: "Copia completa", importBackup: "Importar una copia", exportSettings: "Exportar ajustes", exportConversations: "Exportar conversaciones", exportMarkdown: "Exportar a Markdown", localModel: "MODELO LOCAL", chooseModel: "Elegir un modelo",
    legalTitle: "Aviso legal y privacidad", legalEyebrow: "AVISO LOCAL-FIRST",
    downloadHint: "La primera descarga puede tardar unos minutos. El modelo queda almacenado en este dispositivo.",
    legalContent: "<h3>Editor</h3><p>El sitio y la aplicación SIMIA son publicados por Zigmoon. Para cualquier consulta: <a href='mailto:contact@zigmoon.com'>contact@zigmoon.com</a>.</p><h3>Alojamiento</h3><p>El sitio está alojado por LWS (Ligne Web Services), SAS con un capital social de 500 000 €, 10 rue de Penthièvre, 75008 París, Francia — RCS Paris B 851 993 683 00024. Los servidores y los datos están situados en Francia.</p><h3>Datos y privacidad</h3><p>SIMIA guarda conversaciones, preferencias y exportaciones solo en el almacenamiento local de este navegador. No se envía ningún dato a un servidor: los modelos se ejecutan íntegramente en tu navegador.</p><h3>Cookies y almacenamiento local</h3><p>SIMIA no utiliza cookies publicitarias ni de analítica. La elección de la barra, los ajustes y las conversaciones se guardan localmente en este navegador. Puedes volver a abrir el panel Cookies o borrar estos datos desde los ajustes del navegador.</p><h3>Modelos locales</h3><p>Al elegir un modelo WebLLM, sus archivos se descargan de proveedores externos y se guardan en caché en el navegador. Se aplican las condiciones y licencias de cada modelo.</p><h3>Uso y limitaciones</h3><p>SIMIA es un asistente general. Sus respuestas pueden ser inexactas y no constituyen asesoramiento profesional, jurídico, médico ni financiero. Verifica la información importante antes de decidir.</p><h3>Tus controles</h3><p>Puedes borrar una conversación, eliminar los datos del sitio desde los ajustes del navegador y exportar tus datos como JSON. Esta aplicación no ofrece cuenta de usuario ni analítica integrada.</p><h3>Propiedad intelectual</h3><p>El nombre SIMIA, sus elementos visuales, textos y código están protegidos. Queda prohibida toda reproducción o reutilización no autorizada.</p>"
  }
};

/* ------------------------------------------------------------------
   Japonais : ajouté par-dessus le français sans toucher aux appels
   existants. JA_PHRASES est indexé sur le texte français exact,
   JA_PATTERNS traite les phrases contenant des variables.
   Toute chaîne oubliée est signalée dans la console en japonais.
------------------------------------------------------------------ */
const JA_MISSING = new Set();

const JA_PHRASES = {
  "ACTIF": "稼働中",
  "Menu": "メニュー",
  "Stockage plein": "保存領域が満杯です",
  "Les trois points clés de SIMIA": "SIMIAの3つのポイント",
  "(Un modèle est requis pour répondre.)": "（回答にはモデルが必要です。）",
  "Agent web": "ウェブ検索",
  "Agent actif": "ウェブ検索：オン",
  "Analyse du document…": "文書を解析中…",
  "Analysez les fichiers joints.": "添付ファイルを解析してください。",
  "Analyse…": "解析中…",
  "Appareil à mémoire limitée : privilégiez un modèle léger (≈500 Mo à 1 Go) pour rester fluide.": "メモリの少ない端末です。動作を軽く保つため、軽量モデル（約500MB〜1GB）をおすすめします。",
  "Aucune conversation à exporter.": "書き出す会話がありません。",
  "Aucune synthèse disponible.": "利用できる要約がありません。",
  "COMMENT ÇA MARCHE": "使い方",
  "Ce PDF est protégé par un mot de passe : retirez la protection puis joignez-le de nouveau.": "このPDFはパスワードで保護されています。保護を解除してから、もう一度添付してください。",
  "Ce document n'a pas pu être lu. S'il s'agit d'un ancien format .doc, .xls ou .ppt, enregistrez-le en .docx, .xlsx ou .pptx puis joignez-le de nouveau.": "この文書を読み取れませんでした。古い形式の .doc、.xls、.ppt の場合は、.docx、.xlsx、.pptx で保存し直してから添付してください。",
  "Ce document semble être un scan : le texte n'est pas extractible. Joignez une version texte (OCR) pour pouvoir l'interroger.": "この文書はスキャンのようです。テキストを取り出せません。質問するには、テキスト化（OCR）したファイルを添付してください。",
  "Ce fichier n'est pas une sauvegarde SIMIA lisible. Choisissez un fichier obtenu avec « Sauvegarde complète », « Exporter les réglages » ou « Exporter les conversations ».": "このファイルは読み取り可能なSIMIAのバックアップではありません。「完全バックアップ」「設定を書き出す」「会話を書き出す」で作成したファイルを選んでください。",
  "Ce modèle analyse les images que vous joignez (décrire, lire un texte, répondre sur une photo). Il ne génère pas d'images. Joignez une image pour que je puisse l'analyser, ou choisissez un modèle de conversation pour discuter.": "このモデルは添付した画像を解析します（内容の説明、文字の読み取り、写真についての回答）。画像を生成することはできません。解析したい画像を添付するか、会話用のモデルを選んでください。",
  "Ce modèle est chargé et répondra dans cette conversation.": "このモデルは読み込み済みで、この会話で回答します。",
  "Ce modèle local est trop exigeant pour la mémoire graphique disponible sur ce mobile, ou WebGPU n'est pas pris en charge. Le Wi-Fi ne suffit pas : essayez Chrome récent avec WebGPU, SmolLM2 360M ou Llama 1B, ou utilisez SIMIA sur ordinateur.": "このローカルモデルは、このモバイルのグラフィックメモリには重すぎるか、WebGPUが対応していません。Wi-Fiでは解決しません。WebGPU対応の新しいChrome、SmolLM2 360M、Llama 1B を試すか、パソコンでSIMIAをご利用ください。",
  "Ce modèle n'analyse que les images. Pour interroger un PDF, un Word, un Excel ou un RTF, choisissez un modèle dans l'onglet « Documents & PDF » de la bibliothèque, puis téléchargez-le : SIMIA lira le document et citera les pages.": "このモデルは画像のみを解析します。PDF、Word、Excel、RTF を扱うには、ライブラリの「文書・PDF」タブでモデルを選んでダウンロードしてください。SIMIAが文書を読み、ページを引用します。",
  "Ce navigateur ne prend pas en charge la fonction WebGPU requise par ce modèle. Llama 3.2 1B est maintenant sélectionné.": "このブラウザは、このモデルに必要なWebGPU機能に対応していません。Llama 3.2 1B を選択しました。",
  "Changer de langue": "言語を切り替える",
  "Chargement du moteur de recherche sémantique…": "意味検索エンジンを読み込み中…",
  "Choisissez un modèle dans l'onglet « Documents & PDF » puis téléchargez-le pour lancer le résumé.": "要約を始めるには、「文書・PDF」タブでモデルを選んでダウンロードしてください。",
  "Comment ça marche": "使い方",
  "Continue et complète ta réponse précédente sans te répéter.": "前の回答を繰り返さずに、続きを完成させてください。",
  "Continuer": "続ける",
  "Conversation active exportée en Markdown.": "現在の会話をMarkdownで書き出しました。",
  "Conversation importée": "読み込んだ会話",
  "Copier": "コピー",
  "Copié": "コピーしました",
  "DOCUMENTS": "文書",
  "Diapositive": "スライド",
  "Document prêt : ": "文書の準備完了：",
  "Donne un exemple concret": "具体的な例を挙げて",
  "Développe ce point": "この点を詳しく",
  "Espace de stockage insuffisant.": "保存領域が不足しています。",
  "Extraction du document en cours…": "文書を抽出中…",
  "Fermer": "閉じる",
  "Fermer les paramètres": "設定を閉じる",
  "Feuille": "シート",
  "Fichier non conservé (onglet fermé pendant l'analyse). Joignez-le de nouveau pour l'interroger.": "ファイルは保存されませんでした（解析中にタブが閉じられました）。質問するには、もう一度添付してください。",
  "Filtrer les modèles": "モデルを絞り込む",
  "Fusionne ces notes en un texte unique, sans répétition et sans perte d'information.": "これらのメモを、重複も情報の欠落もなく、一つの文章にまとめてください。",
  "Indexation du fichier…": "ファイルを索引化中…",
  "Indexation…": "索引化中…",
  "Information": "情報",
  "Je n'ai pas pu générer une réponse locale. Vérifiez WebGPU et la mémoire disponible.": "ローカルで回答を生成できませんでした。WebGPUと空きメモリを確認してください。",
  "Je n'ai pas pu générer une réponse.": "回答を生成できませんでした。",
  "Joignez d'abord un document PDF, Word ou Excel.": "まずPDF、Word、Excel のいずれかの文書を添付してください。",
  "Joignez d'abord un document à résumer.": "まず要約する文書を添付してください。",
  "L'agent a collecté des sources, mais aucun modèle de synthèse n'est chargé. Téléchargez un modèle pour obtenir une synthèse.": "エージェントは情報源を集めましたが、要約用のモデルが読み込まれていません。要約を得るにはモデルをダウンロードしてください。",
  "L'agent n'a pas abouti. Vérifiez la connexion et réessayez.": "エージェントは完了できませんでした。接続を確認して再試行してください。",
  "L'agent n'a trouvé aucune source publique. Essayez une formulation plus précise.": "公開された情報源が見つかりませんでした。より具体的な表現でお試しください。",
  "L'agent web n'est pas disponible (vérifiez que le fichier agent-api.php est bien déployé sur le serveur, puis rechargez).": "ウェブエージェントを利用できません（agent-api.php がサーバーに配置されているか確認し、再読み込みしてください）。",
  "L'agent web nécessite un serveur avec PHP. En local (fichier ouvert directement ou serveur statique), il ne peut pas fonctionner. Déployez SIMIA sur votre hébergement pour utiliser l'agent.": "ウェブエージェントにはPHP対応のサーバーが必要です。ローカル（ファイルを直接開く、または静的サーバー）では動作しません。ご利用にはSIMIAをサーバーに配置してください。",
  "L'import a échoué : le fichier est peut-être incomplet.": "読み込みに失敗しました。ファイルが不完全な可能性があります。",
  "La cause exacte est indiquée dans la console du navigateur.": "詳しい原因はブラウザのコンソールに表示されています。",
  "La purge n'a pas pu se terminer. Réessayez après avoir fermé les autres onglets SIMIA.": "完全削除を終えられませんでした。他のSIMIAタブを閉じてから再試行してください。",
  "Le chargement a échoué. Vérifiez WebGPU, l'espace libre et la mémoire graphique, puis essayez le modèle Llama 1B.": "読み込みに失敗しました。WebGPU、空き容量、グラフィックメモリを確認し、Llama 1B をお試しください。",
  "Le fichier PDF semble endommagé ou illisible.": "PDFファイルが破損しているか、読み取れないようです。",
  "Le lecteur PDF n'a pas pu être chargé. Vérifiez la connexion pour le premier chargement, puis réessayez.": "PDFリーダーを読み込めませんでした。初回は接続が必要です。確認して再試行してください。",
  "Le navigateur a bloqué l'accès au fichier du modèle.": "ブラウザがモデルファイルへのアクセスをブロックしました。",
  "Le résumé a échoué. Vérifiez que le modèle est bien chargé puis réessayez.": "要約に失敗しました。モデルが読み込まれているか確認して、再試行してください。",
  "Le téléchargement a été interrompu. Vérifiez votre connexion.": "ダウンロードが中断されました。接続を確認してください。",
  "Lecture de la présentation…": "プレゼンテーションを読み込み中…",
  "Lecture du classeur Excel…": "Excelブックを読み込み中…",
  "Lecture du document OpenDocument…": "OpenDocument文書を読み込み中…",
  "Lecture du document Word…": "Word文書を読み込み中…",
  "Lecture du fichier…": "ファイルを読み込み中…",
  "Lecture du livre EPUB…": "EPUB書籍を読み込み中…",
  "Libération du modèle actif...": "使用中のモデルを解放中…",
  "M'aider à choisir": "選び方を相談",
  "Modifier": "編集",
  "Modèle prêt. Il reste en cache dans ce navigateur pour les prochaines visites.": "モデルの準備ができました。次回のためにこのブラウザにキャッシュされます。",
  "Modèle sélectionné. Les modèles déjà téléchargés restent disponibles dans le cache. Cliquez sur Télécharger le modèle pour l'activer.": "モデルを選択しました。ダウンロード済みのモデルはキャッシュに残ります。有効にするには「モデルをダウンロード」をクリックしてください。",
  "Modèle vision prêt. Il reste en cache pour les prochaines visites.": "画像モデルの準備ができました。次回以降もキャッシュされます。",
  "Modèle vision sélectionné. Cliquez sur Télécharger le modèle pour analyser des images dans le navigateur.": "画像モデルを選択しました。「モデルをダウンロード」をクリックすると、ブラウザで画像を解析できます。",
  "Mon modèle": "マイモデル",
  "Mémoire graphique insuffisante.": "グラフィックメモリが不足しています。",
  "Notes par partie": "部分ごとのメモ",
  "Nouvelle conversation": "新しい会話",
  "Ouverture du PDF…": "PDFを開いています…",
  "Passages utilisés dans vos documents": "文書から使用した箇所",
  "Prénom, langue, ton préféré, contexte...": "名前、言語、好みの文体、背景…",
  "Purge en cours": "完全削除中",
  "Purge en cours...": "完全削除中…",
  "RECOMMANDÉ": "おすすめ",
  "Rapport de l'agent": "エージェントの報告",
  "Recherche par mots-clés et phrases, entièrement locale.": "キーワードとフレーズによる検索（すべて端末内）。",
  "Recherche sémantique": "意味検索",
  "Recherche sémantique active": "意味検索：オン",
  "Recherche sémantique indisponible sur cet appareil. La recherche par mots-clés reste active.": "この端末では意味検索を利用できません。キーワード検索は引き続き使えます。",
  "Recherche sémantique prête : SIMIA retrouve les passages par le sens, pas seulement par les mots.": "意味検索の準備ができました。SIMIAは単語だけでなく意味から箇所を探します。",
  "Recherche web en cours...": "ウェブを検索中…",
  "Recherchez : posez une question à l'agent...": "検索：エージェントに質問してください…",
  "Retour à l'accueil": "ホームに戻る",
  "Réglages exportés : langue, modèle, profil et modèle personnalisé.": "設定を書き出しました：言語、モデル、プロフィール、マイモデル。",
  "Régénérer": "再生成",
  "Résume en 3 points": "3点で要約して",
  "Résumer les documents": "文書を要約",
  "SIMIA - Assistant local": "SIMIA - ローカルアシスタント",
  "SIMIA a été entièrement purgé : modèles, caches, conversations et réglages ont été supprimés.": "SIMIAを完全に削除しました。モデル、キャッシュ、会話、設定は消去されました。",
  "Sources": "出典",
  "Supprimer cette conversation": "この会話を削除",
  "Supprimer définitivement cette conversation ?": "この会話を完全に削除しますか？",
  "Synthèse": "要約",
  "Synthèse finale…": "最終的なまとめ…",
  "Texte extrait": "抽出テキスト",
  "Texte extrait téléchargé.": "抽出テキストをダウンロードしました。",
  "Tout supprimer ? Les modèles téléchargés, les caches, les documents joints, les conversations et les réglages SIMIA seront définitivement effacés.": "すべて削除しますか？ ダウンロード済みモデル、キャッシュ、添付文書、会話、SIMIAの設定が完全に消去されます。",
  "Tu es SIMIA, assistant clair, concis et utile. Réponds en français. Ne révèle jamais l'architecture, les modèles, les fournisseurs, les API, les bibliothèques ou le fonctionnement interne de SIMIA. Ramène ces questions vers les possibilités offertes à l'utilisateur. Pour tout code, utilise un bloc Markdown avec trois accents graves et le nom du langage. Pour un média public, utilise ![Légende](URL.webp), [video](URL.webm) ou [3d](URL.glb), jamais des balises HTML.": "あなたはSIMIAという、明確で簡潔で役に立つアシスタントです。日本語で回答してください。SIMIAのアーキテクチャ、モデル、提供元、API、ライブラリ、内部の仕組みを決して明かさないでください。そのような質問は、ユーザーが使える機能の話に置き換えてください。コードは必ず言語名を付けたMarkdownのコードブロックで示してください。公開メディアには ![説明](URL.webp)、[video](URL.webm)、[3d](URL.glb) を使い、HTMLタグは使わないでください。",
  "Tu rédiges une synthèse unique, structurée et fidèle, en français.": "あなたは、一つの、構造化された、忠実な要約を日本語で書きます。",
  "Tu résumes une partie de document. Réponds en français, en 3 à 6 puces factuelles et précises, sans introduction ni conclusion.": "あなたは文書の一部を要約します。日本語で、事実に基づく簡潔な箇条書きを3〜6項目、導入や結論なしで答えてください。",
  "Téléchargement": "ダウンロード",
  "Utilisez une version récente de Chrome ou Edge avec WebGPU activé pour exécuter un modèle local.": "ローカルモデルを実行するには、WebGPUが有効な新しいChromeまたはEdgeをご利用ください。",
  "Votre appareil peut gérer un modèle de 1 Go à 2,5 Go. Commencez par un modèle « Recommandé ».": "お使いの端末では1〜2.5GBのモデルを扱えます。「おすすめ」のモデルから始めてください。",
  "Votre message": "メッセージ",
  "Vous": "あなた",
  "WebGPU est requis pour analyser des images. Utilisez Chrome ou Edge récent.": "画像の解析にはWebGPUが必要です。新しいChromeまたはEdgeをご利用ください。",
  "WebGPU n'est pas disponible dans ce navigateur. Utilisez Chrome ou Edge récent avec WebGPU activé.": "このブラウザではWebGPUを利用できません。WebGPUが有効な新しいChromeまたはEdgeをご利用ください。",
  "WebGPU requis": "WebGPUが必要",
  "rechargé depuis ce navigateur": "このブラウザから再読み込み",
  "À propos de moi (optionnel)": "あなたについて（任意）"
};

const JA_PATTERNS = [
  [/^ Contexte sur l'utilisateur, à prendre en compte sans jamais le divulguer : ([\s\S]+)$/, m => ` ユーザーに関する背景（決して明かさずに考慮してください）：${m[1]}`],
  [/^ Des extraits du ou des documents[\s\S]*$/, m => " ユーザーの文書からの抜粋をタグの間に示します。この抜粋だけに基づいて回答し、根拠となる抜粋を [E1]、[E2] のように引用してページを示してください。抜粋に情報がないときは推測せず、はっきりと伝えて質問の言い換えを提案してください。"],
  [/^(\d+) chapitres$/, m => `${m[1]}章`],
  [/^(\d+) passages? indexés?$/, m => `${m[1]}個の箇所を索引化`],
  [/^(\d+) mots$/, m => `${m[1]}語`],
  [/^(\d+) pages?$/, m => `${m[1]}ページ`],
  [/^page (\d+)$/, m => `${m[1]}ページ`],
  [/^passage (\d+)$/, m => `箇所 ${m[1]}`],
  [/^Pages (\d+) à (\d+)$/, m => `${m[1]}〜${m[2]}ページ`],
  [/^(.+) est chargé, mais cette conversation utilise (.+)\.$/, m => `${m[1]}は読み込み済みですが、この会話は${m[2]}を使用しています。`],
  [/^(.+) actif$/, m => `${m[1]} 稼働中`],
  [/^Activer (.+)$/, m => `${m[1]}を有効にする`],
  [/^Modèle actif : (.+)$/, m => `使用中のモデル：${m[1]}`],
  [/^CONVERSATION · (.+) \(base (.+)\) ACTIF$/, m => `会話 · ${m[1]}（ベース：${m[2]}）稼働中`],
  [/^CONVERSATION · (.+) ACTIF$/, m => `会話 · ${m[1]} 稼働中`],
  [/^MODÈLE CHARGÉ · (.+)$/, m => `読み込み済みモデル · ${m[1]}`],
  [/^MODÈLE PERSO · base (.+)$/, m => `マイモデル · ベース：${m[1]}`],
  [/^MODÈLE PERSO · (.+)$/, m => `マイモデル · ${m[1]}`],
  [/^« (.+) » : vos consignes permanentes[\s\S]*$/, m => `「${m[1]}」：あなたの永続的な指示がベースモデルに追加されます。「マイモデル」ボタンで編集できます。`],
  [/^(\d+) documents? prêts? · (\d+) passages? indexés?$/, m => `${m[1]}件の文書 · ${m[2]}個の箇所を索引化`],
  [/^(\d+) document\(s\) rechargé\(s\) depuis ce navigateur[\s\S]*$/, m => `${m[1]}件の文書をこのブラウザから再読み込みしました。ファイルを添付し直さずに質問できます。`],
  [/^(.+) : ([\s\S]+)$/, m => `${m[1]}：${m[2]}`],
  [/^Analyse partie (\d+)\/(\d+)…$/, m => `部分 ${m[1]}/${m[2]} を解析中…`],
  [/^« (.+) » — partie (\d+)\/(\d+) \((\d+)\/(\d+)\)$/, m => `「${m[1]}」— 部分 ${m[2]}/${m[3]}（${m[4]}/${m[5]}）`],
  [/^Indexation du livre — page (\d+)\/(\d+) \((\d+) %\)$/, m => `書籍を索引化中 — ${m[1]}/${m[2]} ページ（${m[3]}%）`],
  [/^Indexation en cours : ([\s\S]+)$/, m => `索引化中：${m[1]}`],
  [/^Indexation sémantique (\d+)%…$/, m => `意味索引化 ${m[1]}%…`],
  [/^Préparation du moteur de recherche sémantique (\d+)%…$/, m => `意味検索エンジンを準備中 ${m[1]}%…`],
  [/^Téléchargement de (.+)\.\.\.$/, m => `${m[1]}をダウンロード中…`],
  [/^Lecture de ([\s\S]+)\.\.\.$/, m => `${m[1]}を読み込み中…`],
  [/^Le chargement de (.+) a échoué\.$/, m => `${m[1]}の読み込みに失敗しました。`],
  [/^Le téléchargement de (.+) a échoué\.[\s\S]*$/, m => `${m[1]}のダウンロードに失敗しました。不完全なキャッシュは削除されました。再試行できます。`],
  [/^Résume ([\s\S]+)$/, m => `${m[1]}を要約`],
  [/^Résumé terminé — (\d+) parties analysées sur (\d+)\.$/, m => `要約が完了しました — ${m[1]}/${m[2]} の部分を解析。`],
  [/^\(Résumé établi à partir de (\d+) parties sur (\d+)[\s\S]*\)$/, m => `（${m[1]}/${m[2]} の部分から作成した要約です。未解析の箇所には、ここにない情報が含まれている可能性があります。詳しくは章を指定して要約を依頼してください。）`],
  [/^Conversations exportées : (\d+)\.[\s\S]*$/, m => `会話を書き出しました：${m[1]}件。メッセージとファイル情報を含みます。文書の本文は完全バックアップに含まれます。`],
  [/^Sauvegarde complète : (\d+) conversation\(s\) et (\d+) document\(s\)[\s\S]*$/, m => `完全バックアップ：会話${m[1]}件と文書${m[2]}件（索引化できる本文つき）。このファイルからすべて復元できます。`],
  [/^Import terminé : (\d+) conversation\(s\), (\d+) message\(s\), (\d+) document\(s\)[\s\S]*$/, m => `読み込み完了：会話${m[1]}件、メッセージ${m[2]}件、文書${m[3]}件を再索引化しました。`],
  [/^Importer cette sauvegarde \?[\s\S]*$/, m => "このバックアップを読み込みますか？\n\n会話と文書が追加されます。現在のデータは保持されます。"],
  [/^Objectif : ([\s\S]+)$/, m => `目的：${m[1]}`],
  [/^Choisissez selon votre usage[\s\S]*$/, m => "用途に合わせて選んでください。選んだモデルはそのあとでダウンロードできます。"],
  [/^Un modèle personnel[\s\S]*$/, m => "マイモデルとは、既存のベースモデルに名前と永続的な指示を加えたものです。AIの重みをダウンロードしたり学習させたりはしません。SIMIAはこのモデルを使う会話の冒頭に、あなたの指示を追加するだけです。"],
  [/^SIMIA exécute des modèles d'IA[\s\S]*$/, m => "SIMIAはWebGPUを使って、お使いのブラウザで直接AIモデルを動かします。モデルを選んで一度ダウンロードすれば、あとはローカルで回答します。サーバーには何も送信されません。"],
  [/^Joignez un PDF, un Word[\s\S]*$/, m => "PDF、Word、Excel、PowerPoint、RTF、OpenDocument、EPUB、テキストを添付できます。<strong>サイズ制限はありません</strong>。数百ページの書籍でも大丈夫です。SIMIAはブラウザ内でテキストを取り出し、箇所ごとに分けてバックグラウンドで索引化します。索引化の間も入力できます。<br><br><strong>大きな書籍に最も効果的な方法：</strong><br>1. 具体的に質問する（例：「第4章で著者は信頼について何と言っていますか」）。索引が該当箇所を探し、ページを引用します。<br>2. 全体像には「文書を要約」を使います。PDFに目次があれば章ごとに要約し、最後にまとめます。<br>3. さらに詳しくは章を一つずつ指定してください。回答がぐっと詳しくなります。<br><br>スキャンしたPDF（画像）は、先にテキスト化（OCR）が必要です。"]
];

function localizedText(french, english, spanish, japanese) {
  if (state.language === "fr") return french;
  if (state.language === "es") return spanish;
  if (state.language !== "ja") return english;
  if (japanese) return japanese;
  const direct = JA_PHRASES[french];
  if (direct) return direct;
  for (const [pattern, build] of JA_PATTERNS) {
    const found = french.match(pattern);
    if (found) return build(found);
  }
  if (!JA_MISSING.has(french)) {
    JA_MISSING.add(french);
    console.warn("Traduction japonaise manquante :", french.slice(0, 90));
  }
  return english;
}

/* copy.ja reprend les mêmes clés que copy.fr : aucune chaîne ne peut manquer. */
copy.ja = {
  placeholder: "メッセージを入力…",
  ready: "準備完了",
  local: "オフラインアシスタント",
  loading: "モデルを読み込み中…",
  error: "モデルを利用できません",
  welcomeTitle: "どのようにお手伝いしましょうか？",
  welcomeCopy: "アカウントもサーバーも不要。すべてはこのブラウザの中で動きます。",
  welcomeModel: "モデルを選んで始める",
  welcomeSetup: "モデルは一度だけダウンロードされ、この端末に残ります。",
  autoLoadModel: "SIMIAを開いたときにモデルを自動で読み込む",
  disclaimer: "SIMIAは誤ることがあります。重要な情報は確認してください。",
  activate: "モデルをダウンロード",
  active: "WebLLM 稼働中",
  newChat: "＋ 新しい会話",
  today: "今日",
  settings: "設定",
  localNote: "データはこのブラウザに残ります。",
  personalAssistant: "パーソナルアシスタント",
  send: "送信",
  clear: "会話を消去",
  legal: "法的情報とプライバシー",
  voiceStart: "音声入力を開始",
  voiceStop: "音声入力を停止",
  voiceListening: "聞き取り中です。音声認識はブラウザが提供します。",
  voiceUnavailable: "このブラウザでは音声入力を使えません。",
  voiceError: "音声認識が中断されました。",
  attach: "ファイルを添付",
  dropFiles: "ここにファイルをドロップ",
  attachmentProblem: "このファイルを読み取れませんでした。",
  attachmentAdvice: "サイズ制限はありません。SIMIAは大きなファイルを分割して読み込み、内容をバックグラウンドで索引化します。索引化作業中も入力できます。",
  imageNeedsVision: "軽量モデルは画像を解析できません。",
  download: "モデルをダウンロード",
  export: "書き出し / 読み込み",
  purge: "完全削除",
  exportTitle: "書き出しと読み込み",
  exportCopy: "データをダウンロードするか、SIMIAのバックアップを読み込みます。",
  exportEyebrow: "バックアップ",
  exportSectionSave: "書き出し",
  exportSectionImport: "読み込み",
  exportImportHint: "「完全バックアップ」「設定を書き出す」「会話を書き出す」で作成したファイルを読み込みます。現在のデータは保持されます。",
  exportFull: "完全バックアップ",
  importBackup: "バックアップを読み込む",
  exportSettings: "設定を書き出す",
  exportConversations: "会話を書き出す",
  exportMarkdown: "Markdownで書き出す",
  localModel: "ローカルモデル",
  chooseModel: "モデルを選ぶ",
  legalTitle: "法的情報とプライバシー",
  legalEyebrow: "ローカル優先の方針",
  downloadHint: "最初のダウンロードには数分かかることがあります。モデルはこの端末にキャッシュされます。",
  legalContent: "<h3>発行者</h3><p>SIMIAのサイトとアプリケーションは Zigmoon が発行しています。お問い合わせ：<a href='mailto:contact@zigmoon.com'>contact@zigmoon.com</a>。</p><h3>ホスティング</h3><p>本サイトは LWS（Ligne Web Services、SAS、資本金 500,000 ユーロ、10 rue de Penthièvre, 75008 Paris, France、RCS Paris B 851 993 683 00024）がホストしています。サーバーとデータはフランス国内にあります。</p><h3>データとプライバシー</h3><p>SIMIAは会話、設定、書き出しデータをこのブラウザのローカルストレージにのみ保存します。サーバーには何も送信されません。モデルはすべてブラウザ内で動作します。</p><h3>Cookieとローカルストレージ</h3><p>SIMIAは広告Cookieも解析Cookieも使用しません。バナーでの選択、設定、会話はブラウザのローカルストレージに保存されます。Cookieパネルを再度開くか、ブラウザの設定からこのデータを削除できます。</p><h3>ローカルモデル</h3><p>WebLLMモデルを選ぶと、そのファイルは第三者からダウンロードされ、ブラウザにキャッシュされます。各モデルの利用条件とライセンスが適用されます。</p><h3>利用と限界</h3><p>SIMIAは汎用的なアシスタントです。回答は不正確な場合があり、専門的・法的・医学的・金融的な助言ではありません。重要な判断の前には情報を確認してください。</p><h3>お客様の管理</h3><p>会話の削除、ブラウザ設定からのサイトデータの消去、JSON形式でのデータ書き出しができます。このアプリケーションにはユーザーアカウントも解析トラッキングもありません。</p><h3>知的財産</h3><p>SIMIAの名称、図版、文章、コードは保護されています。無断での複製や再利用は禁止されています。</p>"
};

function isValidCustomModel(profile) {
  const base = MODELS.find(model => model.id === profile?.baseModelId);
  return Boolean(profile && typeof profile.name === "string" && profile.name.trim() && typeof profile.instructions === "string" && base && base.engine !== "transformers");
}

function normalizedCustomModel(profile) {
  if (!isValidCustomModel(profile)) return null;
  return {
    name: String(profile.name).trim().slice(0, 48),
    instructions: String(profile.instructions).slice(0, 4000),
    baseModelId: profile.baseModelId
  };
}

function modelDetails(model) {
  const fallback = [model.category, model.note];
  if (state.language === "ja") return MODEL_JA[model.id] || fallback;
  if (state.language === "es") return MODEL_ES[model.id] || fallback;
  return state.language === "fr" ? fallback : MODEL_EN[model.id] || fallback;
}

function modelLibraryText() {
  return state.language === "fr"
    ? { eyebrow: "BIBLIOTHÈQUE DE MODÈLES", title: "Choisissez un modèle", intro: "Choisissez selon votre usage. Vous pourrez télécharger le modèle sélectionné juste après.", split: "La conversation et la génération d’images sont deux moteurs séparés : un modèle de texte et un modèle d’image peuvent être actifs en même temps.", webLimit: "La version web se limite aux modèles de moins de 1,9 Go, ce que votre navigateur peut héberger. La version desktop donne accès à toute la banque, y compris les modèles lourds, le code et la génération d’images.", close: "Fermer", all: "Tous", general: "Général", documents: "Documents & PDF", writing: "Écriture & création", code: "Code", reasoning: "Raisonnement & maths", vision: "Vision", choose: "Choisir ce modèle", selected: "Sélectionné", requiredTitle: "Choisissez un modèle pour commencer", requiredCopy: "SIMIA a besoin d’un modèle actif pour répondre. Sélectionnez un modèle adapté à votre besoin, puis téléchargez-le.", open: "Choisir un modèle", stored: "téléchargé", empty: "Aucun modèle compatible avec cet appareil dans cette catégorie. Essayez un autre onglet." }
    : state.language === "ja"
      ? { eyebrow: "モデルライブラリ", title: "モデルを選ぶ", intro: "用途に合わせて選んでください。選んだモデルはそのあとでダウンロードできます。", split: "会話と画像生成は別々のエンジンです。テキストモデルと画像モデルは同時に有効にできます。", webLimit: "ウェブ版はブラウザが扱える1.9GB未満のモデルのみです。デスクトップ版では大型モデル、コード、画像生成を含むすべてのモデルが使えます。", close: "閉じる", all: "すべて", general: "汎用", documents: "文書・PDF", writing: "文章・創作", code: "コード", reasoning: "推論・数学", vision: "画像", choose: "このモデルを選ぶ", selected: "選択中", requiredTitle: "始めるにはモデルを選んでください", requiredCopy: "SIMIAが回答するにはモデルが必要です。用途に合ったモデルを選び、ダウンロードしてください。", open: "モデルを選ぶ", stored: "ダウンロード済み", empty: "このカテゴリに、この端末で使えるモデルがありません。別のタブをお試しください。" }
      : state.language === "es"
      ? { eyebrow: "BIBLIOTECA DE MODELOS", title: "Elige un modelo", intro: "Elige según tu uso. Podrás descargar el modelo seleccionado justo después.", split: "El chat y la generación de imágenes son dos motores separados: un modelo de texto y un modelo de imagen pueden estar activos a la vez.", webLimit: "La versión web se limita a modelos de menos de 1,9 GB, que el navegador puede alojar. La versión de escritorio da acceso a toda la biblioteca, incluidos los modelos pesados, el código y la generación de imágenes.", close: "Cerrar", all: "Todos", general: "General", documents: "Documentos y PDF", writing: "Escritura y creación", code: "Código", reasoning: "Razonamiento y matemáticas", vision: "Visión", choose: "Elegir este modelo", selected: "Seleccionado", requiredTitle: "Elige un modelo para comenzar", requiredCopy: "SIMIA necesita un modelo activo para responder. Elige uno adaptado a tu necesidad y descárgalo.", open: "Elegir un modelo", stored: "descargado", empty: "Ningún modelo compatible con este dispositivo en esta categoría. Prueba otra pestaña." }
      : { eyebrow: "MODEL LIBRARY", title: "Choose a model", intro: "Choose by task. You can download the selected model right after.", split: "Chat and image generation are two separate engines: one text model and one image model can be active at the same time.", webLimit: "The web version only lists models under 1.9 GB, which your browser can host. The desktop version unlocks the whole library, including heavy models, code and image generation.", close: "Close", all: "All", general: "General", documents: "Documents & PDF", writing: "Writing & creative", code: "Code", reasoning: "Reasoning & math", vision: "Vision", choose: "Choose this model", selected: "Selected", requiredTitle: "Choose a model to get started", requiredCopy: "SIMIA needs an active model to reply. Select one for your task, then download it.", open: "Choose a model", stored: "downloaded", empty: "No model compatible with this device in this category. Try another tab." };
}

function modelFilterFor(model) {
  if (model.category === "Documents") return "documents";
  if (["Léger", "Généraliste", "Connaissances universelles"].includes(model.category)) return "general";
  if (["Écriture", "Créatif / design"].includes(model.category)) return "writing";
  if (model.category === "Code") return "code";
  if (model.category === "Vision") return "vision";
  return "reasoning";
}

function modelMatchesFilter(model) {
  if (state.modelFilter === "all") return true;
  if (state.modelFilter === "documents") return Boolean(model.document) || modelFilterFor(model) === "documents";
  return modelFilterFor(model) === state.modelFilter;
}

function modelSupportsDocuments(model = MODELS.find(candidate => candidate.id === state.selectedModel)) {
  return Boolean(model?.document);
}

function modelRequiredMarkup() {
  const text = modelLibraryText();
  return `<div class="model-required"><strong>${text.requiredTitle}</strong><p>${text.requiredCopy}</p><button class="open-model-library" type="button">${text.open}</button></div>`;
}

function escapeHtml(value) {
  return value.replace(/[&<>'"]/g, character => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "'":"&#039;", '"':"&quot;" })[character]);
}

function safeLinkUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

/* --------------------------------------------------------------------------
 * Rendu Markdown de la conversation.
 * Rendu maison : aucune dependance externe, tout contenu est echappe.
 * ------------------------------------------------------------------------ */

const ICON_COPY = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="9" y="9" width="11" height="11" rx="2.4"></rect><path d="M5.5 15.2V6.1A2.1 2.1 0 0 1 7.6 4h9.1"></path></svg>';
const ICON_CHECK = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4.5 12.5l4.8 4.8L19.5 7"></path></svg>';
const ICON_REGENERATE = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M20 11.5a8 8 0 1 0-2.6 5.9"></path><path d="M20 4.5v7h-7"></path></svg>';
const ICON_CONTINUE = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 12h15"></path><path d="M13.5 6.5L20 12l-6.5 5.5"></path></svg>';
const ICON_CODE = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M8.5 8.5L4.5 12l4 3.5"></path><path d="M15.5 8.5l4 3.5-4 3.5"></path><path d="M13.5 5.5l-3 13"></path></svg>';

const HIGHLIGHT_FAMILIES = {
  clike: {
    comment: String.raw`\/\/[^\n]*|\/\*[\s\S]*?\*\/`,
    string: String.raw`"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|\x60(?:[^\x60\\]|\\.)*\x60`,
    keywords: "abstract as async await break case catch class const continue declare default delete do else enum export extends false final finally for from function get if implements import in instanceof interface let new null package private protected public readonly return set static super switch this throw true try type typeof undefined var void while yield"
  },
  json: {
    string: String.raw`"(?:[^"\\\n]|\\.)*"`,
    keywords: "true false null"
  },
  python: {
    comment: String.raw`#[^\n]*`,
    string: String.raw`"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'`,
    keywords: "and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return True try while with yield self"
  },
  shell: {
    comment: String.raw`(?:^|[\s;])#[^\n]*`,
    string: String.raw`"(?:[^"\\\n]|\\.)*"|'[^'\n]*'`,
    keywords: "if then else elif fi for while until do done case esac function in return local export echo cd set source exit sudo printf read"
  },
  sql: {
    comment: String.raw`--[^\n]*|\/\*[\s\S]*?\*\/`,
    string: String.raw`'(?:[^'\\\n]|\\.)*'`,
    keywords: "select from where insert into values update set delete create table alter drop index join left right inner outer on group by order having limit offset union all distinct as and or not null is case when then else end primary key foreign references"
  },
  html: {
    comment: String.raw`<!--[\s\S]*?-->`,
    string: String.raw`"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'`,
    tag: String.raw`<\/?[a-zA-Z][\w:-]*`,
    keywords: ""
  }
};

const LANGUAGE_FAMILY = {
  js: "clike", javascript: "clike", mjs: "clike", cjs: "clike", node: "clike", ts: "clike", typescript: "clike",
  jsx: "clike", tsx: "clike", java: "clike", c: "clike", h: "clike", cpp: "clike", "c++": "clike", cc: "clike",
  cs: "clike", csharp: "clike", go: "clike", rust: "clike", rs: "clike", swift: "clike", kotlin: "clike",
  kt: "clike", dart: "clike", php: "clike", scala: "clike", json: "json", jsonc: "clike", python: "python",
  py: "python", bash: "shell", sh: "shell", shell: "shell", zsh: "shell", console: "shell", powershell: "shell",
  ps1: "shell", sql: "sql", html: "html", xml: "html", svg: "html", vue: "html"
};

const HIGHLIGHT_NEVER = "(?!)";
const HIGHLIGHT_CACHE = new Map();
const HIGHLIGHT_TYPES = ["comment", "tag", "string", "number", "keyword"];

function highlightPattern(family) {
  if (HIGHLIGHT_CACHE.has(family)) return HIGHLIGHT_CACHE.get(family);
  const config = HIGHLIGHT_FAMILIES[family];
  if (!config) return null;
  const keywords = config.keywords ? config.keywords.trim().split(/\s+/).join("|") : "";
  const parts = [
    `(${config.comment || HIGHLIGHT_NEVER})`,
    `(${config.tag || HIGHLIGHT_NEVER})`,
    `(${config.string || HIGHLIGHT_NEVER})`,
    String.raw`(\b\d+(?:\.\d+)?\b)`,
    keywords ? `(\\b(?:${keywords})\\b)` : `(${HIGHLIGHT_NEVER})`
  ];
  const compiled = { regex: new RegExp(parts.join("|"), "gi") };
  HIGHLIGHT_CACHE.set(family, compiled);
  return compiled;
}

function highlightCode(code, language) {
  const family = LANGUAGE_FAMILY[String(language || "").toLowerCase()];
  const compiled = family ? highlightPattern(family) : null;
  if (!compiled) return escapeHtml(code);
  const regex = compiled.regex;
  regex.lastIndex = 0;
  let output = "";
  let lastIndex = 0;
  let match;
  while ((match = regex.exec(code))) {
    if (match[0] === "") { regex.lastIndex += 1; continue; }
    if (match.index > lastIndex) output += escapeHtml(code.slice(lastIndex, match.index));
    let type = "keyword";
    for (let index = 1; index <= HIGHLIGHT_TYPES.length; index += 1) {
      if (match[index] !== undefined) { type = HIGHLIGHT_TYPES[index - 1]; break; }
    }
    output += `<span class="tok-${type}">${escapeHtml(match[0])}</span>`;
    lastIndex = regex.lastIndex;
  }
  return output + escapeHtml(code.slice(lastIndex));
}

function safeMediaUrl(value) {
  try {
    const url = new URL(value, location.href);
    return url.protocol === "https:" || url.origin === location.origin ? url.href : null;
  } catch {
    return null;
  }
}

function mediaExtension(url) {
  return new URL(url).pathname.split(".").pop()?.toLowerCase() || "";
}

/* Decoupe le contenu en segments texte / blocs de code (accepte un bloc non ferme). */
function splitFences(source) {
  const segments = [];
  let text = [];
  let code = [];
  let language = "";
  let inCode = false;
  const flushText = () => {
    if (!text.length) return;
    const value = text.join("\n");
    if (value.trim()) segments.push({ type: "text", value });
    text = [];
  };
  for (const line of String(source).split(/\r?\n/)) {
    const fence = line.match(/^[ \t]*(?:```|~~~)[ \t]*([a-zA-Z0-9+#._-]*)[ \t]*$/);
    if (!inCode && fence) { flushText(); inCode = true; language = fence[1] || ""; code = []; continue; }
    if (inCode && fence) { segments.push({ type: "code", language, value: code.join("\n") }); inCode = false; code = []; continue; }
    if (inCode) code.push(line); else text.push(line);
  }
  if (inCode) segments.push({ type: "code", language, value: code.join("\n") });
  flushText();
  return segments;
}

/* Un seul passage : le code inline est consomme en premier, puis les emphases
 * sont re-analysees recursivement, ce qui permet `**` autour d'un `code` **`. */
function renderInline(source) {
  const text = String(source ?? "");
  const pattern = /`([^`\n]+)`|!\[([^\]]*)\]\(([^()\s]+)\)|\[([^\]\n]+)\]\((https?:\/\/[^\s()]+)\)|(https?:\/\/[^\s<]+)|\*\*([^\n]+?)\*\*|__([^_\n]+)__|~~([^~\n]+)~~|\*([^*\n]+?)\*/g;
  let output = "";
  let lastIndex = 0;
  let match;
  while ((match = pattern.exec(text))) {
    output += escapeHtml(text.slice(lastIndex, match.index));
    if (match[1] !== undefined) {
      output += `<code class="inline-code">${escapeHtml(match[1])}</code>`;
    } else if (match[2] !== undefined) {
      const url = safeLinkUrl(match[3]);
      output += url
        ? `<a class="message-link" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(match[2] || url)}</a>`
        : escapeHtml(match[0]);
    } else if (match[4] !== undefined) {
      const url = safeLinkUrl(match[5]);
      output += url
        ? `<a class="message-link" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(match[4])}</a>`
        : escapeHtml(match[0]);
    } else if (match[6] !== undefined) {
      let urlText = match[6];
      const punctuation = urlText.match(/[.,!?;:]+$/) || [""];
      urlText = urlText.slice(0, urlText.length - punctuation[0].length);
      const url = safeLinkUrl(urlText);
      output += url
        ? `<a class="message-link" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(urlText)}</a>${escapeHtml(punctuation[0])}`
        : escapeHtml(match[0]);
    } else if (match[7] !== undefined || match[8] !== undefined) {
      output += `<strong>${renderInline(match[7] ?? match[8])}</strong>`;
    } else if (match[9] !== undefined) {
      output += `<del>${renderInline(match[9])}</del>`;
    } else {
      output += `<em>${renderInline(match[10])}</em>`;
    }
    lastIndex = pattern.lastIndex;
  }
  return output + escapeHtml(text.slice(lastIndex));
}

function renderCodeBlock(language, code) {
  const label = String(language || "").toLowerCase() || "code";
  const copyLabel = localizedText("Copier le code", "Copy code", "Copiar el código", "コードをコピー");
  const openLabel = localizedText("Ouvrir dans l'atelier", "Open in code workspace", "Abrir en el taller", "コード作業台で開く");
  return `<div class="code-block"><div class="code-block-head"><span class="code-language">${escapeHtml(label)}</span><div class="code-actions"><button type="button" class="code-copy" data-action="open-code" title="${escapeHtml(openLabel)}" aria-label="${escapeHtml(openLabel)}">${ICON_CODE}<span>${escapeHtml(localizedText("Atelier", "Workspace", "Taller", "作業台"))}</span></button><button type="button" class="code-copy" data-action="copy-code" title="${escapeHtml(copyLabel)}" aria-label="${escapeHtml(copyLabel)}">${ICON_COPY}<span>${escapeHtml(localizedText("Copier", "Copy", "Copiar", "コピー"))}</span></button></div></div><pre><code>${highlightCode(code.replace(/\n+$/, ""), label)}</code></pre></div>`;
}

function renderMediaBlock(line) {
  const match = line.match(/^[ \t]*(?:!\[([^\]]*)\]\(([^()\s]+)\)|\[(video|3d)\]\(([^()\s]+)\))[ \t]*$/i);
  if (!match) return null;
  const imageExtensions = new Set(["avif", "gif", "jpeg", "jpg", "png", "webp"]);
  const videoExtensions = new Set(["mp4", "webm"]);
  const type = match[3]?.toLowerCase() || "image";
  const label = match[1] || (type === "3d" ? "3D" : type === "video" ? "Video" : "Image");
  const url = safeMediaUrl(match[2] || match[4]);
  const extension = url ? mediaExtension(url) : "";
  let media = "";
  if (type === "image" && url && imageExtensions.has(extension)) {
    media = `<img src="${escapeHtml(url)}" alt="${escapeHtml(label)}" loading="lazy">`;
  } else if (type === "video" && url && videoExtensions.has(extension)) {
    media = `<video controls preload="metadata" playsinline><source src="${escapeHtml(url)}" type="video/${extension}"></video>`;
  } else if (type === "3d" && url && extension === "glb") {
    media = `<model-viewer src="${escapeHtml(url)}" alt="${escapeHtml(label)}" camera-controls auto-rotate shadow-intensity="1"></model-viewer>`;
  }
  if (!media) return null;
  return `<figure class="message-media message-media-${type}">${media}<figcaption>${escapeHtml(label)}</figcaption></figure>`;
}

function renderTable(lines, start) {
  const splitRow = line => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map(cell => cell.trim());
  const header = splitRow(lines[start]);
  const aligns = splitRow(lines[start + 1]).map(cell => {
    const left = cell.startsWith(":");
    const right = cell.endsWith(":");
    if (left && right) return ' style="text-align:center"';
    if (right) return ' style="text-align:right"';
    return "";
  });
  const rows = [];
  let index = start + 2;
  while (index < lines.length && /^[ \t]*\|.*\|[ \t]*$/.test(lines[index])) {
    rows.push(splitRow(lines[index]));
    index += 1;
  }
  const head = header.map((cell, position) => `<th${aligns[position] || ""}>${renderInline(cell)}</th>`).join("");
  const body = rows
    .map(row => `<tr>${row.map((cell, position) => `<td${aligns[position] || ""}>${renderInline(cell)}</td>`).join("")}</tr>`)
    .join("");
  return { html: `<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`, next: index };
}

function renderList(lines, start) {
  const itemPattern = /^([ \t]*)([-*+•]|\d+[.)])[ \t]+(.*)$/;
  const ordered = /^\s*\d+[.)]\s/.test(lines[start]);
  const stack = [{ indent: 0, nodes: [] }];
  let index = start;
  while (index < lines.length) {
    const match = lines[index].match(itemPattern);
    if (!match) break;
    const indent = match[1].replace(/\t/g, "  ").length;
    let content = match[3];
    let look = index + 1;
    while (look < lines.length && /^[ \t]{2,}\S/.test(lines[look]) && !itemPattern.test(lines[look])) {
      content += ` ${lines[look].trim()}`;
      look += 1;
    }
    while (stack.length > 1 && indent < stack[stack.length - 1].indent) stack.pop();
    if (indent > stack[stack.length - 1].indent) {
      const parent = stack[stack.length - 1].nodes[stack[stack.length - 1].nodes.length - 1];
      if (parent) {
        parent.children = parent.children || [];
        stack.push({ indent, nodes: parent.children });
      }
    }
    stack[stack.length - 1].nodes.push({ content, children: null });
    index = look;
  }
  const renderNodes = nodes =>
    nodes
      .map(node => {
        const task = node.content.match(/^\[( |x|X)\][ \t]+(.*)$/);
        const inner = task
          ? `<span class="task-box${task[1].toLowerCase() === "x" ? " checked" : ""}" aria-hidden="true"></span>${renderInline(task[2])}`
          : renderInline(node.content);
        const nested = node.children ? `<${ordered ? "ol" : "ul"}>${renderNodes(node.children)}</${ordered ? "ol" : "ul"}>` : "";
        return `<li${task ? ' class="task-item"' : ""}>${inner}${nested}</li>`;
      })
      .join("");
  return { html: `<${ordered ? "ol" : "ul"}>${renderNodes(stack[0].nodes)}</${ordered ? "ol" : "ul"}>`, next: index };
}

function renderBlocks(source) {
  const lines = String(source).split(/\r?\n/);
  const html = [];
  let index = 0;
  const isBlockStart = line =>
    !line.trim() ||
    /^[ \t]{0,3}#{1,6}[ \t]+\S/.test(line) ||
    /^[ \t]*(-{3,}|\*{3,}|_{3,})[ \t]*$/.test(line) ||
    /^[ \t]{0,3}>/.test(line) ||
    /^[ \t]*([-*+•]|\d+[.)])[ \t]+/.test(line) ||
    /^[ \t]*\|.*\|[ \t]*$/.test(line) ||
    /^[ \t]*(?:!\[[^\]]*\]\([^()\s]+\)|\[(?:video|3d)\]\([^()\s]+\))[ \t]*$/i.test(line);

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) { index += 1; continue; }

    if (/^[ \t]*(-{3,}|\*{3,}|_{3,})[ \t]*$/.test(line)) { html.push("<hr>"); index += 1; continue; }

    const media = renderMediaBlock(line);
    if (media) { html.push(media); index += 1; continue; }

    const heading = line.match(/^[ \t]{0,3}(#{1,6})[ \t]+(.*)$/);
    if (heading) {
      const level = Math.min(6, heading[1].length + 1);
      html.push(`<h${level}>${renderInline(heading[2].replace(/[ \t]+#+[ \t]*$/, "").trim())}</h${level}>`);
      index += 1;
      continue;
    }

    if (line.includes("|") && /^[ \t]*\|?[ \t]*:?-{2,}/.test(lines[index + 1] || "")) {
      const table = renderTable(lines, index);
      html.push(table.html);
      index = table.next;
      continue;
    }

    if (/^[ \t]{0,3}>/.test(line)) {
      const quoted = [];
      while (index < lines.length && /^[ \t]{0,3}>/.test(lines[index])) {
        quoted.push(lines[index].replace(/^[ \t]{0,3}>[ \t]?/, ""));
        index += 1;
      }
      html.push(`<blockquote>${renderBlocks(quoted.join("\n"))}</blockquote>`);
      continue;
    }

    if (/^[ \t]*([-*+•]|\d+[.)])[ \t]+/.test(line)) {
      const list = renderList(lines, index);
      html.push(list.html);
      index = list.next;
      continue;
    }

    const paragraph = [];
    while (index < lines.length && !isBlockStart(lines[index])) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    if (!paragraph.length) { index += 1; continue; }
    html.push(`<p>${paragraph.map(renderInline).join("<br>")}</p>`);
  }
  return html.join("");
}

function formatMessageContent(content) {
  if (content.startsWith(AGENT_RESULT_PREFIX)) {
    try {
      return formatAgentResult(JSON.parse(content.slice(AGENT_RESULT_PREFIX.length)));
    } catch (error) {
      console.warn("Agent result markup could not be restored", error);
    }
  }
  return splitFences(content)
    .map(segment => (segment.type === "code" ? renderCodeBlock(segment.language, segment.value) : renderBlocks(segment.value)))
    .join("");
}

/* --------------------------------------------------------------------------
 * Atelier code : editeur a gauche, conversation a droite.
 * Les fichiers vivent dans IndexedDB (localStorage est trop petit).
 * ------------------------------------------------------------------------ */

const CODE_DB_NAME = "simia.workspace";
const CODE_STORE = "files";
/* Budget du prompt, partage par la conversation et l'atelier.
 * - CODE_CTX_TOKENS : fenetre reelle du modele (le lanceur l'annonce) ;
 * - CHARS_PER_TOKEN : ratio volontairement pessimiste, le code repetitif et le
 *   francais descendent a ~2,3 caracteres par token, contre ~4 en anglais ;
 * - PROMPT_TOKEN_BUDGET : ce qui reste une fois la reponse et une marge
 *   retirees ; au-dela, llama-server et WebLLM renvoient une erreur. */
const CODE_CTX_TOKENS = NATIVE && Number(NATIVE.ctxSize) > 0 ? Number(NATIVE.ctxSize) : 4096;
const CHAT_REPLY_TOKENS = 640;
const CHARS_PER_TOKEN = 2.6;
const PROMPT_TOKEN_BUDGET = Math.max(1200, Math.floor(CODE_CTX_TOKENS * 0.92) - CHAT_REPLY_TOKENS);
/* Il reste a loger la consigne systeme et l'historique recent. */
const CODE_PROMPT_LIMIT = Math.max(4000, Math.floor((PROMPT_TOKEN_BUDGET - 700) * CHARS_PER_TOKEN));
const CODE_RUN_TIMEOUT = NATIVE ? 15000 : 12000;

const CODE_LANGUAGES = {
  py: "python", js: "javascript", mjs: "javascript", cjs: "javascript", jsx: "jsx",
  ts: "typescript", tsx: "tsx", rs: "rust", go: "go", java: "java", kt: "kotlin",
  c: "c", h: "c", cpp: "cpp", cc: "cpp", hpp: "cpp", cs: "csharp", rb: "ruby",
  php: "php", swift: "swift", dart: "dart", html: "html", htm: "html", css: "css",
  scss: "scss", json: "json", sql: "sql", sh: "bash", bash: "bash", zsh: "bash",
  ps1: "powershell", yml: "yaml", yaml: "yaml", md: "markdown", txt: "text"
};

const CODE_EXTENSIONS = {
  python: "py", javascript: "js", jsx: "jsx", typescript: "ts", tsx: "tsx", rust: "rs",
  go: "go", java: "java", kotlin: "kt", c: "c", cpp: "cpp", csharp: "cs", ruby: "rb",
  php: "php", swift: "swift", dart: "dart", html: "html", css: "css", scss: "scss",
  json: "json", sql: "sql", bash: "sh", powershell: "ps1", yaml: "yml",
  markdown: "md", text: "txt"
};

let codeDbPromise = null;
let codeSaveTimer = 0;

function codeDatabase() {
  if (!("indexedDB" in window)) return Promise.resolve(null);
  if (codeDbPromise) return codeDbPromise;
  codeDbPromise = new Promise(resolve => {
    let request;
    try { request = indexedDB.open(CODE_DB_NAME, 1); } catch { resolve(null); return; }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(CODE_STORE)) db.createObjectStore(CODE_STORE, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
  return codeDbPromise;
}

async function codeFilesLoad() {
  const db = await codeDatabase();
  if (!db) return [];
  return new Promise(resolve => {
    try {
      const request = db.transaction(CODE_STORE, "readonly").objectStore(CODE_STORE).getAll();
      request.onsuccess = () => resolve(Array.isArray(request.result) ? request.result : []);
      request.onerror = () => resolve([]);
    } catch { resolve([]); }
  });
}

async function codeFileSave(file) {
  const db = await codeDatabase();
  if (!db || !file) return;
  try { db.transaction(CODE_STORE, "readwrite").objectStore(CODE_STORE).put(file); } catch { /* stockage indisponible */ }
}

async function codeFileDelete(id) {
  const db = await codeDatabase();
  if (!db) return;
  try { db.transaction(CODE_STORE, "readwrite").objectStore(CODE_STORE).delete(id); } catch { /* stockage indisponible */ }
}

function activeCodeFile() {
  return state.code.files.find(file => file.id === state.code.activeId) || null;
}

function codeLanguageFor(name, fallback = "text") {
  const extension = String(name || "").split(".").pop()?.toLowerCase() || "";
  return CODE_LANGUAGES[extension] || fallback;
}

/* Accepte aussi bien « js » (extension) que « javascript » (nom de langage). */
function normalizeCodeLanguage(value) {
  const raw = String(value || "").toLowerCase();
  if (CODE_EXTENSIONS[raw]) return raw;
  const mapped = CODE_LANGUAGES[raw];
  if (mapped && CODE_EXTENSIONS[mapped]) return mapped;
  return "text";
}

function suggestCodeName(language) {
  const extension = CODE_EXTENSIONS[String(language || "").toLowerCase()] || "txt";
  const taken = new Set(state.code.files.map(file => file.name));
  let name = `snippet.${extension}`;
  let index = 1;
  while (taken.has(name)) {
    index += 1;
    name = `snippet-${index}.${extension}`;
  }
  return name;
}

function setCodeNewMenu(open) {
  if (!ui.codeNewMenu || !ui.codeNew) return;
  ui.codeNewMenu.hidden = !open;
  ui.codeNew.setAttribute("aria-expanded", String(Boolean(open)));
}

/* Types proposes dans le selecteur du bas : changer l'extension change le
 * langage, la coloration et l'execution possible. */
const CODE_LANG_CHOICES = [
  "javascript", "typescript", "python", "html", "css", "scss", "json", "markdown",
  "sql", "bash", "powershell", "yaml", "rust", "go", "java", "kotlin", "swift",
  "dart", "c", "cpp", "csharp", "ruby", "php", "text"
];

function fillCodeLangSelect() {
  if (!ui.codeLang || ui.codeLang.options.length) return;
  ui.codeLang.replaceChildren(...CODE_LANG_CHOICES.map(language => {
    const option = document.createElement("option");
    option.value = language;
    option.textContent = language;
    return option;
  }));
}

function renameCodeExtension(name, language) {
  const extension = CODE_EXTENSIONS[language] || "txt";
  const base = String(name || "snippet").replace(/\.[^.]+$/, "") || "snippet";
  return `${base}.${extension}`;
}

function applyCodeLanguage(language) {
  const file = activeCodeFile();
  if (!file) return;
  const next = normalizeCodeLanguage(language);
  if (next === file.language) return;
  file.language = next;
  file.name = renameCodeExtension(file.name, next);
  file.updatedAt = Date.now();
  codeFileSave(file);
  renderCodeTabs();
  renderCodeEditor();
}

function createCodeFile(seed = null) {
  const language = normalizeCodeLanguage(seed?.language);
  const file = {
    id: globalThis.crypto?.randomUUID?.() || `f${Date.now()}${Math.random().toString(16).slice(2)}`,
    name: seed?.name || suggestCodeName(language),
    language,
    content: seed?.code || "",
    updatedAt: Date.now()
  };
  state.code.files.push(file);
  state.code.activeId = file.id;
  codeFileSave(file);
  renderCodeTabs();
  renderCodeEditor();
  return file;
}

function closeCodeFile(id) {
  const index = state.code.files.findIndex(file => file.id === id);
  if (index < 0) return;
  const [removed] = state.code.files.splice(index, 1);
  codeFileDelete(removed.id);
  if (state.code.activeId === id) {
    state.code.activeId = state.code.files[Math.max(0, index - 1)]?.id || null;
  }
  renderCodeTabs();
  renderCodeEditor();
}

function renderCodeTabs() {
  if (!ui.codeTabs) return;
  const closeLabel = localizedText("Fermer le fichier", "Close file", "Cerrar archivo", "ファイルを閉じる");
  ui.codeTabs.innerHTML = state.code.files.length
    ? state.code.files.map(file => {
        const active = file.id === state.code.activeId;
        return `<button type="button" class="code-tab${active ? " active" : ""}" role="tab" aria-selected="${active}" data-code-tab="${escapeHtml(file.id)}"><span class="code-tab-name">${escapeHtml(file.name)}</span><span class="code-tab-close" role="button" tabindex="-1" data-code-close="${escapeHtml(file.id)}" title="${escapeHtml(closeLabel)}" aria-label="${escapeHtml(closeLabel)}">✕</span></button>`;
      }).join("")
    : `<span class="code-tab-empty">${escapeHtml(localizedText("Aucun fichier ouvert", "No file open", "Ningún archivo abierto", "ファイルなし"))}</span>`;
}

function updateCodeMeta() {
  if (!ui.codeMeta) return;
  const file = activeCodeFile();
  if (!file) { ui.codeMeta.textContent = ""; return; }
  const lines = ui.codeInput.value.split("\n").length;
  const chars = ui.codeInput.value.length;
  ui.codeMeta.textContent = localizedText(
    `${lines} ligne(s) · ${chars} caractère(s) · ${file.language}`,
    `${lines} line(s) · ${chars} character(s) · ${file.language}`,
    `${lines} línea(s) · ${chars} carácter(es) · ${file.language}`,
    `${lines} 行 · ${chars} 文字 · ${file.language}`
  );
}

function updateCodeHighlight() {
  if (!ui.codeHighlight || !ui.codeInput) return;
  const file = activeCodeFile();
  ui.codeHighlight.innerHTML = `${highlightCode(ui.codeInput.value, file?.language)}\n`;
  const lines = ui.codeInput.value.split("\n").length;
  let gutter = "";
  for (let index = 1; index <= lines; index += 1) gutter += `${index}\n`;
  if (ui.codeGutter) ui.codeGutter.textContent = gutter;
  ui.codeHighlight.scrollTop = ui.codeInput.scrollTop;
  ui.codeHighlight.scrollLeft = ui.codeInput.scrollLeft;
  if (ui.codeGutter) ui.codeGutter.scrollTop = ui.codeInput.scrollTop;
}

/* --------------------------------------------------------------------------
 * Execution du code : Worker isole (aucun acces au DOM), JavaScript natif et
 * Python via Pyodide charge a la demande. Le worker est termine au dela du delai.
 * ------------------------------------------------------------------------ */

const CODE_RUNNABLE = ["javascript", "python"];

/* Le moteur vit dans code-runner.js : un worker charge depuis un fichier a sa
 * propre politique de securite, alors que le document interdit 'unsafe-eval'.
 * Un worker Blob heriterait de la CSP de la page et refuserait le code colle. */
const CODE_RUNNER_URL = "code-runner.js";

let codeWorker = null;
let activeCodeRun = null;

function codeRuntimeLabel(state) {
  return state === "error"
    ? localizedText("Erreur", "Error", "Error", "エラー")
    : state === "done"
      ? localizedText("Terminé", "Finished", "Finalizado", "完了")
      : localizedText("En cours", "Running", "En curso", "実行中");
}

function renderCodeOutput(run) {
  if (!ui.codeOutputBody) return;
  const pyodideMissing = localizedText(
    "Python n'a pas pu être chargé : une connexion est nécessaire au premier lancement (environ 12 Mo). Le JavaScript, lui, fonctionne hors ligne.",
    "Python could not be loaded: a connection is needed the first time (about 12 MB). JavaScript works offline.",
    "No se pudo cargar Python: se necesita conexión la primera vez (unos 12 MB). JavaScript funciona sin conexión.",
    "Pythonを読み込めませんでした。初回のみ接続が必要です（約12MB）。JavaScriptはオフラインでも動作します。"
  );
  ui.codeOutputBody.innerHTML = run.lines
    .map(line => {
      const className = line.kind === "error" ? "out-error" : line.kind === "return" ? "out-return" : line.kind === "muted" ? "out-muted" : "";
      const text = line.text === "PYODIDE_LOAD_FAILED" ? pyodideMissing : line.text;
      return `<span class="${className}">${escapeHtml(text)}</span>`;
    })
    .join("\n");
  ui.codeOutputBody.scrollTop = ui.codeOutputBody.scrollHeight;
}

function stopCodeRun(run, reason) {
  if (!run) return;
  if (run.timer) clearTimeout(run.timer);
  run.timer = 0;
  try { codeWorker?.terminate(); } catch { /* deja termine */ }
  codeWorker = null;
  if (reason) run.lines.push({ kind: "error", text: reason });
  renderCodeOutput(run);
  finishCodeRun(run, false);
}

function finishCodeRun(run, ok) {
  if (run.timer) clearTimeout(run.timer);
  if (activeCodeRun === run) activeCodeRun = null;
  if (ui.codeOutputState) {
    ui.codeOutputState.className = `code-output-state ${ok ? "" : "is-error"}`.trim();
    ui.codeOutputState.textContent = codeRuntimeLabel(ok ? "done" : "error");
  }
  refreshCodeActions();
}

function resetCodeOutput() {
  if (activeCodeRun) {
    if (activeCodeRun.timer) clearTimeout(activeCodeRun.timer);
    try { codeWorker?.terminate(); } catch { /* deja termine */ }
    codeWorker = null;
    activeCodeRun = null;
  }
  if (!ui.codeOutput) return;
  ui.codeOutput.hidden = true;
  if (ui.codeOutputBody) ui.codeOutputBody.innerHTML = "";
  if (ui.codeOutputState) {
    ui.codeOutputState.className = "code-output-state";
    ui.codeOutputState.textContent = "";
  }
}

function ensureCodeWorker() {
  if (codeWorker) return codeWorker;
  codeWorker = new Worker(CODE_RUNNER_URL);
  codeWorker.addEventListener("message", event => {
    const run = activeCodeRun;
    if (!run) return;
    const data = event.data || {};
    if (data.stage === "loading-python") {
      if (ui.codeOutputState) ui.codeOutputState.textContent = localizedText("Chargement de Python…", "Loading Python…", "Cargando Python…", "Pythonを読み込み中…");
      return;
    }
    run.lines = Array.isArray(data.lines) ? data.lines : [];
    renderCodeOutput(run);
    if (!run.lines.length) {
      run.lines.push({ kind: "muted", text: localizedText("(aucune sortie)", "(no output)", "(sin salida)", "（出力なし）") });
      renderCodeOutput(run);
    }
    finishCodeRun(run, Boolean(data.ok));
  });
  codeWorker.addEventListener("error", event => {
    const run = activeCodeRun;
    if (!run) return;
    run.lines.push({ kind: "error", text: event.message || "Worker error" });
    renderCodeOutput(run);
    finishCodeRun(run, false);
  });
  return codeWorker;
}

function refreshCodeActions() {
  const file = activeCodeFile();
  const busy = Boolean(activeCodeRun);
  if (ui.codeOutputStop) ui.codeOutputStop.hidden = !busy;
  document.querySelectorAll("[data-code-action]").forEach(button => {
    if (!file) { button.disabled = true; return; }
    if (button.dataset.codeAction === "run") {
      button.disabled = busy || !CODE_RUNNABLE.includes(file.language);
    } else {
      button.disabled = busy;
    }
  });
}

async function executeActiveFile() {
  const file = activeCodeFile();
  if (!file || activeCodeRun) return;
  if (!CODE_RUNNABLE.includes(file.language)) {
    toast(
      localizedText(
        "Exécution disponible pour JavaScript et Python.",
        "Execution is available for JavaScript and Python.",
        "La ejecución está disponible para JavaScript y Python.",
        "実行できるのは JavaScript と Python です。"
      ),
      "error"
    );
    return;
  }
  const code = file.content;
  if (!code.trim()) {
    toast(localizedText("Le fichier est vide.", "The file is empty.", "El archivo está vacío.", "ファイルが空です。"), "error");
    return;
  }

  const worker = ensureCodeWorker();
  const run = { lines: [], timer: 0 };
  activeCodeRun = run;
  if (ui.codeOutput) ui.codeOutput.hidden = false;
  if (ui.codeOutputState) {
    ui.codeOutputState.className = "code-output-state is-running";
    ui.codeOutputState.textContent = file.language === "python"
      ? localizedText("Chargement de Python…", "Loading Python…", "Cargando Python…", "Pythonを読み込み中…")
      : localizedText("En cours", "Running", "En curso", "実行中");
  }
  renderCodeOutput(run);
  refreshCodeActions();

  const budget = CODE_RUN_TIMEOUT + (file.language === "python" ? 90000 : 0);
  run.timer = setTimeout(() => {
    if (activeCodeRun !== run) return;
    stopCodeRun(
      run,
      localizedText(
        `Délai dépassé (${Math.round(budget / 1000)} s) : le code a été interrompu.`,
        `Timed out (${Math.round(budget / 1000)} s): the code was stopped.`,
        `Se agotó el tiempo (${Math.round(budget / 1000)} s): el código se detuvo.`,
        `タイムアウト（${Math.round(budget / 1000)} 秒）：実行を停止しました。`
      )
    );
  }, budget);

  worker.postMessage({ code, language: file.language });
}

function renderCodeEditor() {
  if (!ui.codeInput) return;
  fillCodeLangSelect();
  const file = activeCodeFile();
  if (!file) {
    ui.codeInput.value = "";
    ui.codeInput.disabled = true;
    ui.codeInput.placeholder = localizedText("Créez un fichier avec +", "Create a file with +", "Crea un archivo con +", "＋でファイルを作成");
    ui.codeHighlight.innerHTML = "";
    if (ui.codeGutter) ui.codeGutter.textContent = "";
    if (ui.codeMeta) ui.codeMeta.textContent = "";
    if (ui.codeLang) ui.codeLang.disabled = true;
    refreshCodeActions();
    return;
  }
  ui.codeInput.disabled = false;
  ui.codeInput.placeholder = "";
  if (ui.codeLang) {
    ui.codeLang.disabled = false;
    ui.codeLang.value = file.language;
  }
  if (document.activeElement !== ui.codeInput || ui.codeInput.value !== file.content) ui.codeInput.value = file.content;
  updateCodeHighlight();
  updateCodeMeta();
  refreshCodeActions();
}

function onCodeInput() {
  const file = activeCodeFile();
  if (!file) return;
  file.content = ui.codeInput.value;
  file.language = codeLanguageFor(file.name, file.language);
  file.updatedAt = Date.now();
  updateCodeHighlight();
  updateCodeMeta();
  clearTimeout(codeSaveTimer);
  codeSaveTimer = setTimeout(() => codeFileSave(file), 450);
}

function onCodeKeydown(event) {
  if (event.key === "Tab") {
    event.preventDefault();
    const start = ui.codeInput.selectionStart;
    const end = ui.codeInput.selectionEnd;
    ui.codeInput.setRangeText("  ", start, end, "end");
    onCodeInput();
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
    event.preventDefault();
    const file = activeCodeFile();
    if (!file) return;
    file.content = ui.codeInput.value;
    codeFileSave(file);
    toast(localizedText("Fichier enregistré.", "File saved.", "Archivo guardado.", "ファイルを保存しました。"));
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
    event.preventDefault();
    runCodeAction("explain");
  }
}

/* Libelles statiques de l'atelier : retraduits quand la langue change. */
function renderCodeWorkspaceText() {
  if (!ui.codePane) return;
  const actions = {
    run: localizedText("▶ Exécuter", "▶ Run", "▶ Ejecutar", "▶ 実行"),
    explain: localizedText("Expliquer", "Explain", "Explicar", "説明"),
    fix: localizedText("Corriger", "Fix", "Corregir", "修正"),
    improve: localizedText("Optimiser", "Optimize", "Optimizar", "最適化"),
    tests: localizedText("Tests", "Tests", "Pruebas", "テスト")
  };
  document.querySelectorAll("[data-code-action]").forEach(button => {
    const label = actions[button.dataset.codeAction];
    if (label) button.textContent = label;
  });
  const outputTitle = document.querySelector("#code-output-title");
  if (outputTitle) outputTitle.textContent = localizedText("Sortie", "Output", "Salida", "出力");
  if (ui.codeOutputClear) {
    const label = localizedText("Effacer", "Clear", "Borrar", "消去");
    ui.codeOutputClear.textContent = label;
    ui.codeOutputClear.setAttribute("aria-label", label);
  }
  if (ui.codeOutputStop) {
    const label = localizedText("Arrêter", "Stop", "Detener", "停止");
    ui.codeOutputStop.textContent = label;
    ui.codeOutputStop.setAttribute("aria-label", label);
  }
  if (ui.codeNewMenu) {
    ui.codeNewMenu.setAttribute("aria-label", localizedText("Type de fichier", "File type", "Tipo de archivo", "ファイルの種類"));
    const textItem = ui.codeNewMenu.querySelector('[data-code-new="text"]');
    if (textItem) textItem.textContent = localizedText("Texte", "Text", "Texto", "テキスト");
  }
  const newLabel = localizedText("Nouveau fichier", "New file", "Nuevo archivo", "新しいファイル");
  if (ui.codeLang) ui.codeLang.setAttribute("aria-label", localizedText("Type de fichier", "File type", "Tipo de archivo", "ファイルの種類"));
  const closeLabel = localizedText("Fermer l'atelier", "Close workspace", "Cerrar el taller", "作業台を閉じる");
  if (ui.codeNew) {
    ui.codeNew.setAttribute("aria-label", newLabel);
    ui.codeNew.setAttribute("title", newLabel);
  }
  if (ui.codeClose) {
    ui.codeClose.setAttribute("aria-label", closeLabel);
    ui.codeClose.setAttribute("title", closeLabel);
  }
  ui.codeInput?.setAttribute("aria-label", localizedText("Éditeur de code", "Code editor", "Editor de código", "コードエディター"));
  ui.codePane.setAttribute("aria-label", localizedText("Atelier code", "Code workspace", "Taller de código", "コード作業台"));
  const switchLabel = localizedText("Atelier et conversation", "Workspace and chat", "Taller y conversación", "作業台とチャット");
  ui.codeSwitch?.setAttribute("aria-label", switchLabel);
  document.querySelector("#code-tabs")?.setAttribute("aria-label", localizedText("Fichiers de l'atelier", "Workspace files", "Archivos del taller", "作業台のファイル"));
  document.querySelectorAll(".code-mode-switch [data-code-focus]").forEach(button => {
    button.textContent = button.dataset.codeFocus === "chat"
      ? localizedText("Chat", "Chat", "Chat", "チャット")
      : localizedText("Code", "Code", "Código", "コード");
  });
  renderCodeTabs();
  updateCodeMeta();
}

function setCodeFocus(focus) {
  state.code.focus = focus === "chat" ? "chat" : "code";
  if (ui.workspace) ui.workspace.dataset.codePane = state.code.focus;
  if (ui.codeSwitch) {
    ui.codeSwitch.querySelectorAll("[data-code-focus]").forEach(button => {
      button.setAttribute("aria-selected", String(button.dataset.codeFocus === state.code.focus));
    });
  }
  if (state.code.focus === "chat") ui.prompt.focus();
  else ui.codeInput?.focus();
}

function enterCodeMode(focus) {
  if (!ui.codePane) return;
  state.code.open = true;
  if (ui.workspace) ui.workspace.dataset.mode = "code";
  if (ui.codeSwitch) ui.codeSwitch.hidden = false;
  renderCodeTabs();
  renderCodeEditor();
  setCodeFocus(focus || state.code.focus || "code");
  saveState();
}

function exitCodeMode() {
  state.code.open = false;
  if (ui.workspace) {
    delete ui.workspace.dataset.mode;
    delete ui.workspace.dataset.codePane;
  }
  if (ui.codeSwitch) ui.codeSwitch.hidden = true;
  saveState();
  ui.prompt.focus();
}

function openCodeWorkspace(seed) {
  if (!ui.codePane || !seed?.code) return;
  const language = normalizeCodeLanguage(seed.language);
  const twin = state.code.files.find(file => file.content === seed.code && file.language === language);
  if (twin) {
    state.code.activeId = twin.id;
    renderCodeTabs();
    renderCodeEditor();
  } else {
    createCodeFile({ language, code: seed.code });
  }
  enterCodeMode("code");
}

function codeActionIntro(action, name) {
  switch (action) {
    case "fix":
      return localizedText(
        `Corrige les bugs de ce code (${name}). Montre la version corrigée complète, puis la liste des changements.`,
        `Fix the bugs in this code (${name}). Show the complete fixed version, then the list of changes.`,
        `Corrige los errores de este código (${name}). Muestra la versión corregida completa y luego los cambios.`,
        `このコード（${name}）のバグを修正してください。修正版の全体と変更点を示してください。`
      );
    case "improve":
      return localizedText(
        `Optimise ce code (${name}) : lisibilité, performance, robustesse. Garde exactement le même comportement.`,
        `Optimize this code (${name}): readability, performance, robustness. Keep exactly the same behavior.`,
        `Optimiza este código (${name}): legibilidad, rendimiento, robustez. Mantén exactamente el mismo comportamiento.`,
        `このコード（${name}）を最適化してください。可読性・性能・堅牢性を高め、動作は変えないでください。`
      );
    case "tests":
      return localizedText(
        `Écris des tests pour ce code (${name}), avec un cas nominal et les cas limites.`,
        `Write tests for this code (${name}), with a nominal case and the edge cases.`,
        `Escribe pruebas para este código (${name}), con un caso nominal y los casos límite.`,
        `このコード（${name}）のテストを書いてください。通常ケースと境界ケースを含めてください。`
      );
    default:
      return localizedText(
        `Explique ce code du fichier ${name} : son rôle général, puis chaque partie importante.`,
        `Explain this code from ${name}: its overall purpose, then each important part.`,
        `Explica este código del archivo ${name}: su función general y luego cada parte importante.`,
        `ファイル ${name} のこのコードを説明してください。全体の役割と、重要な部分を順に。`
      );
  }
}

function codeActionPrompt(action) {
  const file = activeCodeFile();
  if (!file) return "";
  const code = file.content.replace(/\s+$/, "");
  if (!code) return "";
  const trimmed = code.length > CODE_PROMPT_LIMIT
    ? `${code.slice(0, CODE_PROMPT_LIMIT)}\n// … code tronqué (${code.length} caractères au total)`
    : code;
  const fence = "```";
  return `${codeActionIntro(action, file.name)}\n\n${fence}${file.language || ""}\n${trimmed}\n${fence}`;
}

function runCodeAction(action) {
  if (action === "run") {
    executeActiveFile();
    return;
  }
  const prompt = codeActionPrompt(action);
  if (!prompt) {
    toast(localizedText("Le fichier est vide.", "The file is empty.", "El archivo está vacío.", "ファイルが空です。"), "error");
    return;
  }
  if (window.matchMedia("(max-width: 900px)").matches) setCodeFocus("chat");
  submitPrompt(prompt);
}

async function initCodeWorkspace() {
  if (!ui.codePane) return;
  state.code.files = await codeFilesLoad();
  if (!state.code.files.some(file => file.id === state.code.activeId)) {
    state.code.activeId = state.code.files[0]?.id || null;
  }
  renderCodeTabs();
  renderCodeEditor();
  if (state.code.open) enterCodeMode(state.code.focus);
}

/* --------------------------------------------------------------------------
 * Generation d'images (application de bureau uniquement).
 * Le lanceur demarre sd-server a la demande, libere llama-server le temps du
 * calcul, puis rend le GPU au texte. Les images vivent dans IndexedDB : un PNG
 * de 1024 px peserait trop lourd dans localStorage.
 * ------------------------------------------------------------------------ */

const IMAGE_DB_NAME = "simia.images";
const IMAGE_STORE = "images";
const IMAGE_POLL_MS = 900;

let imageDbPromise = null;
let imageBusy = null;
let imageJobId = null;
let imageCancelPending = false;
const imageUrls = new Map();

function imageDatabase() {
  if (!("indexedDB" in window)) return Promise.resolve(null);
  if (imageDbPromise) return imageDbPromise;
  imageDbPromise = new Promise(resolve => {
    let request;
    try { request = indexedDB.open(IMAGE_DB_NAME, 1); } catch { resolve(null); return; }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(IMAGE_STORE)) db.createObjectStore(IMAGE_STORE, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
  return imageDbPromise;
}

async function imageRecordSave(record) {
  const db = await imageDatabase();
  if (!db) return;
  try { db.transaction(IMAGE_STORE, "readwrite").objectStore(IMAGE_STORE).put(record); } catch { /* stockage indisponible */ }
}

async function imageRecordLoad(id) {
  const db = await imageDatabase();
  if (!db) return null;
  return new Promise(resolve => {
    try {
      const request = db.transaction(IMAGE_STORE, "readonly").objectStore(IMAGE_STORE).get(id);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
}

async function imageRecordClear() {
  const db = await imageDatabase();
  if (!db) return;
  try { db.transaction(IMAGE_STORE, "readwrite").objectStore(IMAGE_STORE).clear(); } catch { /* stockage indisponible */ }
}

function base64ToBlob(base64, type = "image/png") {
  const text = String(base64 || "").includes(",") ? String(base64).split(",").pop() : String(base64 || "");
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type });
}

async function imageObjectUrl(id) {
  if (!id) return null;
  if (imageUrls.has(id)) return imageUrls.get(id);
  const record = await imageRecordLoad(id);
  if (!record?.blob) return null;
  const url = URL.createObjectURL(record.blob);
  imageUrls.set(id, url);
  return url;
}

/* Les <img> sont remplies apres coup : le rendu du message reste synchrone. */
async function hydrateImages(root) {
  const frames = root.querySelectorAll("[data-image-id]");
  for (const frame of frames) {
    const id = frame.dataset.imageId;
    const image = frame.querySelector("img");
    if (!image || image.dataset.hydrated === id) continue;
    const url = await imageObjectUrl(id);
    if (!url) { frame.dataset.missing = "true"; continue; }
    image.src = url;
    image.dataset.hydrated = id;
    frame.removeAttribute("data-loading");
  }
}

function imageMetaLine(image) {
  const stepsLabel = localizedText("pas", "steps", "pasos", "ステップ");
  const parts = [];
  if (image.model) parts.push(image.model);
  parts.push(`${image.width}×${image.height}`, `${image.steps} ${stepsLabel}`);
  return parts.join(" · ");
}

function imageFigureMarkup(image) {
  const download = localizedText("Télécharger", "Download", "Descargar", "ダウンロード");
  const regenerate = localizedText("Régénérer", "Regenerate", "Regenerar", "再生成");
  const remove = localizedText("Supprimer l'image", "Delete image", "Eliminar la imagen", "画像を削除");
  return `<figure class="message-image" data-image-id="${escapeHtml(image.id)}" data-loading="true">
      <div class="image-frame"><img alt="${escapeHtml(image.prompt.slice(0, 120))}"></div>
      <figcaption><span class="image-prompt">${escapeHtml(image.prompt)}</span><span class="image-meta">${escapeHtml(imageMetaLine(image))}</span></figcaption>
      <div class="image-actions">
        <button type="button" data-image-action="download">${escapeHtml(download)}</button>
        <button type="button" data-image-action="regenerate">${escapeHtml(regenerate)}</button>
        <button type="button" data-image-action="delete" aria-label="${escapeHtml(remove)}">✕</button>
      </div>
    </figure>`;
}

function imageProgressMarkup(title) {
  return `<div class="image-progress" role="status" aria-live="polite">
      <div class="image-progress-head"><span class="image-progress-label">${escapeHtml(title)}</span><button type="button" data-image-action="cancel">${escapeHtml(localizedText("Arrêter", "Stop", "Detener", "停止"))}</button></div>
      <div class="image-progress-bar"><i></i></div>
    </div>`;
}

async function imageStatus() {
  if (!IMAGE) return { state: "stopped" };
  try {
    return await fetch(IMAGE.statusUrl, { cache: "no-store" }).then(response => response.json());
  } catch {
    return { state: "error", message: "" };
  }
}

/* Jeux de modeles d'image proposes par le lanceur. Sans eux, l'onglet Image
 * n'aurait aucune carte : c'est ce qui manquait dans la bibliotheque. */
async function loadImagePacks() {
  if (!IMAGE || !IMAGE.packsUrl) return [];
  try {
    const payload = await fetch(IMAGE.packsUrl, { cache: "no-store" }).then(response => response.json());
    state.imagePacks = Array.isArray(payload.packs) ? payload.packs : [];
    state.imagePackId = payload.selected || state.imagePacks[0]?.id || null;
    renderImageEngineUi();
    return state.imagePacks;
  } catch {
    state.imagePacks = [];
    renderImageEngineUi();
    return [];
  }
}

async function selectImagePack(id) {
  if (!IMAGE || !id) return false;
  try {
    const response = await fetch(IMAGE.selectPackUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id })
    });
    if (!response.ok) throw new Error(String(response.status));
    const payload = await response.json();
    state.imagePacks = Array.isArray(payload.packs) ? payload.packs : state.imagePacks;
    state.imagePackId = payload.selected || id;
    const chosen = state.imagePacks.find(pack => pack.id === state.imagePackId);
    if (chosen) IMAGE.model = chosen.name;
    IMAGE.available = Boolean(chosen?.local);
    IMAGE.width = chosen?.px || IMAGE.width;
    IMAGE.height = chosen?.px || IMAGE.height;
    IMAGE.steps = chosen?.steps || IMAGE.steps;
    if (chosen?.cfg) IMAGE.cfg = chosen.cfg;
    if (ui.imageToggle) ui.imageToggle.hidden = !imageUsable();
    renderImageEngineUi();
    renderModelLibrary();
    toast(localizedText("Jeu d'images sélectionné.", "Image model selected.", "Modelo de imagen seleccionado.", "画像モデルを選択しました。"));
    return true;
  } catch {
    toast(localizedText("Impossible de changer de jeu d'images.", "Could not switch the image model.", "No se pudo cambiar el modelo de imagen.", "画像モデルを切り替えられませんでした。"), "error");
    return false;
  }
}

async function downloadImagePack(id) {
  if (!IMAGE || !id) return;
  const pack = state.imagePacks.find(item => item.id === id);
  toast(localizedText(`Téléchargement de ${pack?.name || id}…`, `Downloading ${pack?.name || id}…`, `Descargando ${pack?.name || id}…`, `${pack?.name || id} をダウンロード中…`));
  renderModelLibrary();
  try {
    const response = await fetch(IMAGE.downloadPackUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id })
    });
    if (!response.ok) throw new Error(String(response.status));
    const payload = await response.json();
    state.imagePacks = Array.isArray(payload.packs) ? payload.packs : state.imagePacks;
    state.imagePackId = payload.selected || id;
    const chosen = state.imagePacks.find(pack => pack.id === state.imagePackId);
    if (chosen) {
      IMAGE.available = Boolean(chosen.local);
      IMAGE.model = chosen.name;
      IMAGE.width = chosen.px || IMAGE.width;
      IMAGE.height = chosen.px || IMAGE.height;
      IMAGE.steps = chosen.steps || IMAGE.steps;
      if (chosen.cfg) IMAGE.cfg = chosen.cfg;
    }
    if (ui.imageToggle) ui.imageToggle.hidden = !imageUsable();
    renderImageEngineUi();
    toast(localizedText("Modèle d'image prêt.", "Image model ready.", "Modelo de imagen listo.", "画像モデルの準備ができました。"));
  } catch {
    toast(localizedText("Le téléchargement a échoué.", "The download failed.", "La descarga falló.", "ダウンロードに失敗しました。"), "error");
  }
  renderModelLibrary();
}

function imageStageLabel(status) {
  if (status.state === "loading") {
    return localizedText("Préparation du moteur d'image…", "Preparing the image engine…", "Preparando el motor de imágenes…", "画像エンジンを準備中…");
  }
  const stage = status.stage || "";
  const labels = {
    conditioning: localizedText("Lecture du prompt…", "Reading the prompt…", "Leyendo el prompt…", "プロンプトを解析中…"),
    sampling: localizedText("Dessin en cours…", "Drawing…", "Dibujando…", "描画中…"),
    vae_decode: localizedText("Révélation de l'image…", "Revealing the image…", "Revelando la imagen…", "画像を生成中…"),
    encoding: localizedText("Encodage PNG…", "Encoding PNG…", "Codificando PNG…", "PNGを書き出し中…")
  };
  return labels[stage] || localizedText("Génération…", "Generating…", "Generando…", "生成中…");
}

async function imageEngineReady(onStage) {
  const prepared = await fetch(IMAGE.prepareUrl, { method: "POST" }).then(response => response.json()).catch(() => null);
  if (prepared?.state === "ready") return true;
  if (prepared && prepared.available === false) throw new Error(prepared.reason || "indisponible");
  const deadline = Date.now() + 10 * 60 * 1000;
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 1200));
    const status = await imageStatus();
    if (status.state === "ready") return true;
    if (status.state === "error") throw new Error(status.message || "error");
    onStage?.(imageStageLabel(status));
  }
  throw new Error("timeout");
}

async function imageGenerate(prompt, bubble) {
  const label = bubble.querySelector(".image-progress-label");
  const bar = bubble.querySelector(".image-progress-bar i");
  const setStage = (text, ratio = 0) => {
    if (imageCancelPending) return;
    if (label && text) label.textContent = text;
    if (bar) bar.style.width = `${Math.round(Math.max(0, Math.min(1, ratio)) * 100)}%`;
  };
  await imageEngineReady(setStage);
  setStage(imageStageLabel({ stage: "conditioning" }), 0.05);

  const pack = state.imagePacks.find(item => item.id === state.imagePackId);
  const px = pack?.px || IMAGE.width;
  const steps = pack?.steps || IMAGE.steps;
  const cfg = pack?.cfg ?? IMAGE.cfg ?? 1.0;
  const styledPrompt = pack?.promptPrefix ? `${pack.promptPrefix}, ${prompt}` : prompt;
  const response = await fetch(IMAGE.generateUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: styledPrompt,
      negative_prompt: "",
      width: px,
      height: px,
      seed: -1,
      batch_count: 1,
      sample_params: {
        sample_steps: steps,
        guidance: { txt_cfg: cfg }
      },
      preview: "none",
      output_format: "png"
    })
  });
  if (!response.ok) throw new Error(`image ${response.status}`);
  const job = await response.json();
  imageJobId = job.id;

  let final = null;
  while (!final) {
    await new Promise(resolve => setTimeout(resolve, IMAGE_POLL_MS));
    const poll = await fetch(`${IMAGE.jobsUrl}/${job.id}`, { cache: "no-store" }).then(item => item.json());
    if (poll.status === "completed") { final = poll; break; }
    if (poll.status === "failed") throw new Error(poll.error?.message || "generation_failed");
    if (poll.status === "cancelled") throw new Error("cancelled");
    const progress = poll.progress || {};
    const total = Number(progress.total) || 0;
    const done = Number(progress.completed) || 0;
    setStage(imageStageLabel(progress), total ? done / total : 0.15);
  }
  imageJobId = null;

  const encoded = final.result?.images?.[0]?.b64_json;
  if (!encoded) throw new Error("image vide");
  const blob = base64ToBlob(encoded);
  const id = globalThis.crypto?.randomUUID?.() || `img${Date.now()}`;
  const record = {
    id,
    prompt,
    blob,
    width: px,
    height: px,
    steps,
    cfg,
    pack: pack?.id || null,
    packName: pack?.name || "",
    createdAt: new Date().toISOString()
  };
  await imageRecordSave(record);
  imageUrls.set(id, URL.createObjectURL(blob));
  return { id, prompt, width: px, height: px, steps, model: pack?.name || "" };
}

async function requestImage(prompt) {
  if (!imageUsable() || imageBusy) return;
  const clean = String(prompt || "").trim();
  if (!clean) return;
  imageCancelPending = false;
  if (state.view === "home" && activeConversation()?.messages.length) newConversation();
  showConversation();
  renderMessage("user", clean);
  addMessage("user", clean);
  ui.prompt.value = "";
  autoResize();
  saveDraft();
  ui.send.disabled = true;

  const bubble = renderMessage("assistant", "", false, [], null, { image: null, tools: false, last: false });
  const content = bubble.querySelector(".message-content");
  content.querySelector(".message-text")?.remove();
  content.insertAdjacentHTML("beforeend", imageProgressMarkup(localizedText("Préparation du moteur d'image…", "Preparing the image engine…", "Preparando el motor de imágenes…", "画像エンジンを準備中…")));
  scrollChatToLatest();
  imageBusy = { bubble, prompt: clean };

  try {
    const image = await imageGenerate(clean, bubble);
    const figure = content.querySelector(".message-image, .image-progress");
    if (figure) {
      figure.outerHTML = imageFigureMarkup(image);
      hydrateImages(content);
    }
    addMessage("assistant", "");
    const stored = activeConversation()?.messages[activeConversation().messages.length - 1];
    if (stored) {
      stored.image = image;
      saveState();
    }
  } catch (error) {
    const cancelled = String(error?.message || "").includes("cancel");
    const text = cancelled
      ? localizedText("Génération annulée.", "Generation cancelled.", "Generación cancelada.", "生成を中止しました。")
      : localizedText(
          "L'image n'a pas pu être générée. Vérifiez que le GPU est libre, puis réessayez.",
          "The image could not be generated. Check that the GPU is free, then try again.",
          "No se pudo generar la imagen. Comprueba que la GPU esté libre e inténtalo de nuevo.",
          "画像を生成できませんでした。GPUが空いているか確認して、もう一度お試しください。"
        );
    content.querySelector(".image-progress")?.remove();
    content.insertAdjacentHTML("beforeend", `<div class="message-text"><p>${escapeHtml(text)}</p></div>`);
  } finally {
    imageBusy = null;
    imageJobId = null;
    imageCancelPending = false;
    ui.send.disabled = false;
    ui.prompt.focus();
    autoResize();
  }
}

function setImageMode(active) {
  if (!imageUsable()) return;
  state.imageMode = Boolean(active);
  if (ui.imageToggle) {
    ui.imageToggle.setAttribute("aria-pressed", String(state.imageMode));
    ui.imageToggle.classList.toggle("is-active", state.imageMode);
  }
  if (ui.agentToggle) ui.agentToggle.classList.toggle("is-disabled", state.imageMode);
  ui.composer?.setAttribute("data-image-mode", state.imageMode ? "true" : "false");
  ui.prompt.placeholder = state.imageMode
    ? localizedText("Décrivez l'image à générer…", "Describe the image to generate…", "Describe la imagen a generar…", "生成する画像を説明してください…")
    : copy[state.language].placeholder;
  renderImageEngineUi();
  ui.prompt.focus();
}

/* Le moteur d'image est distinct du modele de texte : sans affichage dedie on
   ne sait jamais ce qui va dessiner. Il apparait dans la barre du haut et dans
   les parametres, en libelle court pour ne pas concurrencer le modele de texte. */
function activeImagePack() {
  return state.imagePacks.find(pack => pack.id === state.imagePackId) || null;
}

/* Nom court : "SD 1.5 · Gravure SIMIA" devient "Gravure SIMIA". Le nom complet
   reste dans l'infobulle et dans les parametres. */
function shortImageName(pack) {
  if (!pack) return "";
  const parts = String(pack.name || "").split("·");
  const tail = (parts.length > 1 ? parts[parts.length - 1] : parts[0]).trim();
  return tail.replace(/^Stable Diffusion\b/i, "SD");
}

function renderImageEngineUi() {
  const pack = activeImagePack();
  const ready = Boolean(pack && pack.local);
  const stepsLabel = localizedText("pas", "steps", "pasos", "ステップ");
  const meta = pack ? `${pack.px} px · ${pack.steps} ${stepsLabel}` : "";

  if (ui.imageEngine) {
    ui.imageEngine.hidden = !ready;
    if (ready) {
      ui.imageEngine.innerHTML = `<svg class="engine-chip-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="3" y="4" width="18" height="16" rx="3"></rect><circle cx="8.5" cy="9.5" r="1.6"></circle><path d="M3.5 17.5 9 12l4 4 3-2.5 4.5 4"></path></svg><b>${escapeHtml(shortImageName(pack))}</b>`;
      ui.imageEngine.title = localizedText(
        `Moteur d'images : ${pack.name} (${meta}). Cliquez pour changer.`,
        `Image engine: ${pack.name} (${meta}). Click to change.`,
        `Motor de imágenes: ${pack.name} (${meta}). Haz clic para cambiar.`,
        `画像エンジン: ${pack.name}（${meta}）。クリックで変更。`
      );
      ui.imageEngine.setAttribute("aria-label", ui.imageEngine.title);
    }
  }

  if (ui.settingImage) {
    ui.settingImage.hidden = !ready;
    if (ready) {
      document.querySelector("#setting-image-label").textContent = localizedText("MOTEUR D'IMAGE", "IMAGE ENGINE", "MOTOR DE IMAGEN", "画像エンジン");
      document.querySelector("#image-picker-name").textContent = pack.name;
      document.querySelector("#image-picker-meta").textContent = meta;
      document.querySelector("#image-info").textContent = pack.note || "";
      ui.imagePicker.title = localizedText("Changer de moteur d'image", "Change the image engine", "Cambiar el motor de imagen", "画像エンジンを変更");
    }
  }
}

/* Notification non bloquante : remplace window.alert. */
function toast(message, kind = "info") {
  if (!message) return;
  let stack = document.querySelector(".toast-stack");
  if (!stack) {
    stack = document.createElement("div");
    stack.className = "toast-stack";
    stack.setAttribute("role", "status");
    stack.setAttribute("aria-live", "polite");
    document.body.append(stack);
  }
  const node = document.createElement("p");
  node.className = kind === "error" ? "toast toast-error" : "toast";
  node.textContent = message;
  stack.append(node);
  setTimeout(() => {
    node.classList.add("toast-leaving");
    setTimeout(() => node.remove(), 220);
  }, kind === "error" ? 7000 : 4200);
}

function setStatus(label, kind = "ready") {
  ui.status.innerHTML = `<i></i> ${escapeHtml(label)}`;
  ui.status.querySelector("i").style.background = kind === "error" ? "#c56b5d" : kind === "loading" ? "#e3b55f" : "#77b289";
  ui.status.dataset.state = kind;
  if (kind !== "loading") ui.topbar.style.setProperty("--model-load-progress", "0%");
}

function customModelLabel() {
  if (!state.customModelActive || !state.customModel) return "";
  return state.customModel.name;
}

function renderModeLabel() {
  const conversationModel = MODELS.find(model => model.id === activeConversation()?.modelId);
  const profile = state.customModelActive ? state.customModel : null;
  if (conversationModel && state.useWebLLM && state.loadedModelId === conversationModel.id) {
    ui.mode.textContent = profile
      ? localizedText(`CONVERSATION · ${profile.name} (base ${conversationModel.name}) ACTIF`, `CONVERSATION · ${profile.name} (base ${conversationModel.name}) ACTIVE`, `CONVERSACIÓN · ${profile.name} (base ${conversationModel.name}) ACTIVO`)
      : localizedText(`CONVERSATION · ${conversationModel.name} ACTIF`, `CONVERSATION · ${conversationModel.name} ACTIVE`, `CONVERSACIÓN · ${conversationModel.name} ACTIVO`);
    return;
  }
  const loadedModel = MODELS.find(model => model.id === state.loadedModelId);
  if (conversationModel) {
    // Le modele choisi pour cette conversation n'est pas encore charge : le
    // bandeau doit le dire, sinon on croit que l'ancien modele est toujours actif.
    ui.mode.textContent = profile
      ? localizedText(`CONVERSATION · ${profile.name} (base ${conversationModel.name})`, `CONVERSATION · ${profile.name} (base ${conversationModel.name})`, `CONVERSACIÓN · ${profile.name} (base ${conversationModel.name})`)
      : localizedText(`CONVERSATION · ${conversationModel.name}`, `CONVERSATION · ${conversationModel.name}`, `CONVERSACIÓN · ${conversationModel.name}`);
    return;
  }
  if (loadedModel) {
    ui.mode.textContent = localizedText(`MODÈLE CHARGÉ · ${loadedModel.name}`, `MODEL LOADED · ${loadedModel.name}`, `MODELO CARGADO · ${loadedModel.name}`);
    return;
  }
  if (profile) {
    ui.mode.textContent = localizedText(`MODÈLE PERSO · ${profile.name}`, `PERSONAL MODEL · ${profile.name}`, `MODELO PERSONAL · ${profile.name}`);
    return;
  }
  ui.mode.textContent = copy[state.language].local;
}

function updateModelActivityUi() {
  const conversation = activeConversation();
  const conversationModel = MODELS.find(model => model.id === conversation?.modelId);
  const loadedModel = MODELS.find(model => model.id === state.loadedModelId);
  const activeForConversation = Boolean(conversationModel && state.useWebLLM && state.loadedModelId === conversationModel.id);
  if (activeForConversation) {
    ui.homeModelButton.textContent = localizedText(`Modèle actif : ${conversationModel.name}`, `Active model: ${conversationModel.name}`, `Modelo activo: ${conversationModel.name}`);
    document.querySelector("#welcome-setup").textContent = localizedText("Ce modèle est chargé et répondra dans cette conversation.", "This model is loaded and will answer in this conversation.", "Este modelo está cargado y responderá en esta conversación.");
    return;
  }
  if (loadedModel && conversationModel) {
    ui.homeModelButton.textContent = localizedText(`Activer ${conversationModel.name}`, `Activate ${conversationModel.name}`, `Activar ${conversationModel.name}`);
    document.querySelector("#welcome-setup").textContent = localizedText(`${loadedModel.name} est chargé, mais cette conversation utilise ${conversationModel.name}.`, `${loadedModel.name} is loaded, but this conversation uses ${conversationModel.name}.`, `${loadedModel.name} está cargado, pero esta conversación usa ${conversationModel.name}.`);
    return;
  }
  if (conversationModel) {
    /* Version web : le modele est choisi mais pas encore charge. Le bouton doit
       nommer ce modele, et non rester sur l'invitation generique. */
    const ready = state.cachedModelId === conversationModel.id;
    ui.homeModelButton.textContent = ready
      ? localizedText(`Activer ${conversationModel.name}`, `Activate ${conversationModel.name}`, `Activar ${conversationModel.name}`)
      : localizedText(`Télécharger ${conversationModel.name}`, `Download ${conversationModel.name}`, `Descargar ${conversationModel.name}`);
    document.querySelector("#welcome-setup").textContent = ready
      ? localizedText(`${conversationModel.name} est déjà téléchargé sur cet appareil : cliquez pour l'activer.`, `${conversationModel.name} is already downloaded on this device: click to activate it.`, `${conversationModel.name} ya está descargado en este dispositivo: haz clic para activarlo.`)
      : localizedText(`${conversationModel.name} n'est pas encore téléchargé : il l'est une seule fois (${conversationModel.size}), puis reste sur cet appareil.`, `${conversationModel.name} is not downloaded yet: it downloads once (${conversationModel.size}), then stays on this device.`, `${conversationModel.name} aún no está descargado: se descarga una sola vez (${conversationModel.size}) y luego queda en este dispositivo.`);
    return;
  }
  ui.homeModelButton.textContent = copy[state.language].welcomeModel;
  document.querySelector("#welcome-setup").textContent = copy[state.language].welcomeSetup;
}

function speechRecognitionConstructor() {
  return window.SpeechRecognition || window.webkitSpeechRecognition;
}

function voiceLanguage() {
  return state.language === "fr" ? "fr-FR" : state.language === "es" ? "es-ES" : state.language === "ja" ? "ja-JP" : "en-US";
}

function updateVoiceUi(message) {
  const text = copy[state.language];
  const listening = state.voiceRequested;
  if (message !== undefined) state.voiceMessage = message;
  ui.voice.classList.toggle("is-listening", listening);
  ui.voice.setAttribute("aria-label", listening ? text.voiceStop : text.voiceStart);
  ui.voice.setAttribute("title", listening ? text.voiceStop : text.voiceStart);
  ui.voiceStatus.textContent = state.voiceMessage || (listening ? text.voiceListening : "");
}

function updateTranscript(interim = "") {
  const parts = [state.voiceBase, state.voiceFinal, interim].filter(Boolean);
  ui.prompt.value = parts.join(" ");
  autoResize();
}

function setupVoiceRecognition() {
  const Recognition = speechRecognitionConstructor();
  if (!Recognition) {
    ui.voice.disabled = true;
    ui.voiceStatus.textContent = copy[state.language].voiceUnavailable;
    return;
  }
  const recognition = new Recognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;
  recognition.onstart = () => updateVoiceUi();
  recognition.onresult = event => {
    let interim = "";
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const transcript = event.results[index][0].transcript.trim();
      if (event.results[index].isFinal) state.voiceFinal = [state.voiceFinal, transcript].filter(Boolean).join(" ");
      else interim = [interim, transcript].filter(Boolean).join(" ");
    }
    updateTranscript(interim);
  };
  recognition.onerror = event => {
    if (event.error === "no-speech") return;
    state.voiceRequested = false;
    updateVoiceUi(event.error === "not-allowed" || event.error === "service-not-allowed" ? copy[state.language].voiceUnavailable : copy[state.language].voiceError);
  };
  recognition.onend = () => {
    if (!state.voiceRequested) {
      updateVoiceUi();
      return;
    }
    window.setTimeout(() => {
      if (state.voiceRequested) recognition.start();
    }, 250);
  };
  state.recognition = recognition;
}

function toggleVoiceInput() {
  if (!state.recognition) setupVoiceRecognition();
  if (!state.recognition) return;
  if (state.voiceRequested) {
    state.voiceRequested = false;
    state.recognition.stop();
    return;
  }
  state.voiceRequested = true;
  state.voiceMessage = "";
  state.voiceBase = ui.prompt.value.trim();
  state.voiceFinal = "";
  state.recognition.lang = voiceLanguage();
  try {
    state.recognition.start();
  } catch (error) {
    console.warn("Voice recognition could not start", error);
    state.voiceRequested = false;
    updateVoiceUi(copy[state.language].voiceError);
  }
}

const TEXT_EXTENSIONS = new Set(["css", "csv", "html", "js", "json", "jsx", "md", "markdown", "mjs", "py", "text", "ts", "tsx", "txt", "xml", "yaml", "yml"]);
/* Aucune limite de taille n'est imposée : un livre entier est accepté.
   Les gros fichiers sont lus par étapes et indexés en arrière-plan. */
const TEXT_INLINE_LIMIT = 20000;
const DOCUMENT_ADVICE_COUNT = 12;
const DOCUMENT_ADVICE_BYTES = 64 * 1024 * 1024;

function attachmentExtension(file) {
  return file.name.split(".").pop()?.toLowerCase() || "";
}

function attachmentKind(file) {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  if (file.type === "model/gltf-binary" || attachmentExtension(file) === "glb") return "3d";
  return "document";
}

function isTextAttachment(file) {
  return file.type.startsWith("text/") || file.type === "application/json" || TEXT_EXTENSIONS.has(attachmentExtension(file));
}

function formatFileSize(bytes) {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/* ------------------------------------------------------------------
   Documents : lecture, indexation et recherche locales
   Aucun fichier ne quitte le navigateur. Le texte est extrait, découpé
   en passages, puis seuls les passages utiles sont envoyés au modèle.
------------------------------------------------------------------ */

const DOCUMENT_EXTENSIONS = new Set(["docx", "docm", "dotx", "epub", "log", "odg", "odp", "ods", "odt", "pdf", "pptm", "pptx", "rtf", "tex", "tsv", "xlsm", "xlsx", "xltx"]);
const UNSUPPORTED_DOCUMENT_EXTENSIONS = new Set(["doc", "dot", "key", "numbers", "pages", "ppt", "wps", "xls"]);
const PDF_INDEX_BATCH_PAGES = 10;
const DOCUMENT_CHUNK_CHARS = 1000;
const DOCUMENT_CHUNK_OVERLAP = 180;
const DOCUMENT_EXCERPT_BUDGET = 5200;
const PDFJS_VERSION = "3.11.174";
const PDFJS_LIB_URL = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.min.js`;
const PDFJS_WORKER_URL = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.worker.min.js`;
const EMBEDDING_MODEL_ID = "Xenova/multilingual-e5-small";
const SEARCH_STOPWORDS = new Set(("a ai and are as at au aux avec avez avoir bien but ca ce ces cette chacun chez comme comment dans de des du dedans dehors depuis devrait doit donc dos droite du elle elles en encore est et eta etes etre eu fait faites fois font hors ici il ils je juste la le les leur leurs lui ma maintenant mais mes mine moins mon mot meme ni nommés notre nous ou où par parce pas peut peu plupart pour pourquoi quand que quel quelle quelles quels qui sa sans ses seulement si sien son sont sous soyez sujet sur ta tandis tellement tels tes ton tous tout trop tres tu un une valeur voie voient vont votre vous vu ca etaient etaient stateux un the of to in is it for on with that this be by an or from was were we you your our their they he she are not no do does did how why when where what which who whom whose will would can could should shall may might must the a and el la los las de del un una unos unas que como para por con sin sobre entre cuando donde porque es son esta este esto estos estas al se su sus lo le les me te nos os ni y o pero mas si ya muy tan no hay todo todos toda todas ser estar tiene tienen puede pueden hacer hace hacia hasta desde cada otro otra otros otras mismo misma aquel aquella esos esas eso esa ese esos quien quienes cual cuales cuanto cuanta cuantos cuantas").split(" "));

function documentExtensionLabel(extension) {
  const labels = { pdf: "PDF", docx: "Word", docm: "Word", dotx: "Word", xlsx: "Excel", xlsm: "Excel", xltx: "Excel", pptx: "PowerPoint", pptm: "PowerPoint", odt: "OpenDocument", ods: "OpenDocument", odp: "OpenDocument", odg: "OpenDocument", rtf: "RTF", epub: "EPUB", tex: "LaTeX", log: "Journal", tsv: "TSV" };
  return labels[extension] || extension.toUpperCase();
}

function isDocumentAttachment(file) {
  const extension = attachmentExtension(file);
  return DOCUMENT_EXTENSIONS.has(extension) || UNSUPPORTED_DOCUMENT_EXTENSIONS.has(extension);
}

function documentUnavailableMessage() {
  return localizedText(
    "Ce document n'a pas pu être lu. S'il s'agit d'un ancien format .doc, .xls ou .ppt, enregistrez-le en .docx, .xlsx ou .pptx puis joignez-le de nouveau.",
    "This document could not be read. If it is a legacy .doc, .xls, or .ppt file, save it as .docx, .xlsx, or .pptx and attach it again.",
    "No se ha podido leer este documento. Si es un formato antiguo .doc, .xls o .ppt, guárdalo como .docx, .xlsx o .pptx y adjúntalo de nuevo."
  );
}

function decodeEntities(value) {
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity) => {
    if (entity[0] === "#") {
      const code = entity[1] === "x" || entity[1] === "X" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : match;
    }
    const named = { amp: "&", apos: "'", gt: ">", lt: "<", nbsp: " ", quot: "\"" };
    return named[entity] ?? match;
  });
}

function tidyText(value) {
  return value
    .replace(/\u0000/g, "")
    .replace(/[ \u00a0]+/g, " ")
    .replace(/ *\t */g, "\t")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function readPlainTextFile(file, limit = Infinity) {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(buffer).replace(/\r\n?/g, "\n").slice(0, limit);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(buffer).replace(/\r\n?/g, "\n").slice(0, limit);
  let text = new TextDecoder("utf-8").decode(buffer);
  const damaged = (text.match(/\uFFFD/g) || []).length;
  if (damaged > text.length / 500) {
    try { text = new TextDecoder("windows-1252").decode(buffer); } catch { /* on garde la version UTF-8 */ }
  }
  return text.replace(/\r\n?/g, "\n").replace(/\u0000/g, "").slice(0, limit);
}

function htmlToPlainText(html) {
  return tidyText(decodeEntities(html
    .replace(/<(script|style|noscript|head|svg|template)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article|blockquote|pre|td)>/gi, "\n")
    .replace(/<[^>]*>/g, " ")));
}

/* --- Fichiers ZIP (docx, xlsx, pptx, odt, epub) --- */

async function inflateRawBytes(bytes) {
  if (typeof DecompressionStream !== "function") throw new Error("deflate-raw");
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function unzipEntries(arrayBuffer, match) {
  const bytes = new Uint8Array(arrayBuffer);
  const view = new DataView(arrayBuffer);
  const decoder = new TextDecoder("utf-8");
  let endRecord = -1;
  const lowest = Math.max(0, bytes.length - 66000);
  for (let index = bytes.length - 22; index >= lowest; index -= 1) {
    if (view.getUint32(index, true) === 0x06054b50) { endRecord = index; break; }
  }
  if (endRecord < 0) throw new Error("zip");
  let total = view.getUint16(endRecord + 10, true);
  let directoryOffset = view.getUint32(endRecord + 16, true);
  if (total === 0xffff || directoryOffset === 0xffffffff) {
    for (let index = endRecord - 20; index >= Math.max(0, endRecord - 4096); index -= 1) {
      if (view.getUint32(index, true) !== 0x07064b50) continue;
      const zip64 = Number(view.getBigUint64(index + 8, true));
      if (view.getUint32(zip64, true) !== 0x06064b50) break;
      total = Number(view.getBigUint64(zip64 + 32, true));
      directoryOffset = Number(view.getBigUint64(zip64 + 48, true));
      break;
    }
  }
  const entries = [];
  let cursor = directoryOffset;
  for (let index = 0; index < total; index += 1) {
    if (cursor + 46 > bytes.length || view.getUint32(cursor, true) !== 0x02014b50) break;
    const method = view.getUint16(cursor + 10, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
    cursor += 46 + nameLength + extraLength + commentLength;
    if (!match(name)) continue;
    if (localOffset + 30 > bytes.length || view.getUint32(localOffset, true) !== 0x04034b50) continue;
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    if (method !== 0 && method !== 8) continue;
    const raw = compressedSize
      ? bytes.subarray(dataStart, dataStart + compressedSize)
      : bytes.subarray(dataStart, Math.min(bytes.length, dataStart + 8 * 1024 * 1024));
    try {
      const content = method === 0 ? raw : await inflateRawBytes(raw);
      entries.push({ name, content: decoder.decode(content) });
    } catch (error) {
      console.warn(`Entrée ZIP illisible : ${name}`, error);
    }
  }
  if (!entries.length) throw new Error("zip-empty");
  return entries;
}

/* --- Extracteurs par format --- */

function docxToText(xml) {
  const structured = xml
    .replace(/<w:tab\b[^>]*\/?>/g, "\t")
    .replace(/<w:br\b[^>]*\/?>/g, "\n")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<\/w:tr>/g, "\n")
    .replace(/<\/w:tc>/g, "\t");
  return tidyText(decodeEntities(structured.replace(/<[^>]+>/g, "")));
}

function odfToText(xml) {
  const structured = xml
    .replace(/<text:tab\b[^>]*\/?>/g, "\t")
    .replace(/<text:line-break\b[^>]*\/?>/g, "\n")
    .replace(/<\/text:(p|h)>/g, "\n")
    .replace(/<\/table:table-row>/g, "\n")
    .replace(/<\/table:table-cell>/g, "\t");
  return tidyText(decodeEntities(structured.replace(/<[^>]+>/g, "")));
}

function pptxSlideToText(xml) {
  const structured = xml.replace(/<\/a:p>/g, "\n").replace(/<a:br\b[^>]*\/?>/g, "\n");
  return tidyText(decodeEntities(structured.replace(/<[^>]+>/g, " ")));
}

function xlsxSheetToText(xml, sharedStrings) {
  const rows = [];
  const rowPattern = /<row\b[^>]*\/>|<row\b[^>]*>([\s\S]*?)<\/row>/g;
  let rowMatch;
  while ((rowMatch = rowPattern.exec(xml))) {
    const cells = [];
    const body = rowMatch[1] || "";
    const cellPattern = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cellMatch;
    while ((cellMatch = cellPattern.exec(body))) {
      const attributes = cellMatch[1] || "";
      const type = /\st="([^"]*)"/.exec(attributes)?.[1] || "";
      const inner = cellMatch[2] || "";
      const value = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1] ?? "";
      const inline = [...inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(match => match[1]).join(" ");
      let text = inline || value;
      if (type === "s" && value !== "") text = sharedStrings[Number(value)] ?? "";
      cells.push(decodeEntities(text).replace(/[\r\n\t]+/g, " ").trim());
    }
    if (cells.some(cell => cell !== "")) rows.push(cells.join("\t"));
  }
  return rows.join("\n");
}

function rtfToText(rtf) {
  let text = rtf.replace(/\\'([0-9a-fA-F]{2})/g, (match, hex) => {
    try { return new TextDecoder("windows-1252").decode(new Uint8Array([parseInt(hex, 16)])); } catch { return ""; }
  });
  text = text.replace(/\\u(-?\d+)\s?/g, (match, code) => {
    const value = Number(code);
    return String.fromCharCode(value < 0 ? value + 65536 : value);
  });
  text = text.replace(/\{\\\*?(?:fonttbl|colortbl|datastore|generator|info|latentstyles|listtable|listoverridetable|object|pict|rsidtbl|stylesheet|themedata)[\s\S]*?\}/g, " ");
  text = text.replace(/\\par\b/g, "\n").replace(/\\line\b/g, "\n").replace(/\\sect\b/g, "\n")
    .replace(/\\tab\b/g, "\t").replace(/\\cell\b/g, "\t").replace(/\\row\b/g, "\n")
    .replace(/\\~|\\-/g, " ").replace(/\\[a-zA-Z]+-?\d* ?/g, "").replace(/[{}]/g, "");
  return tidyText(text);
}

let pdfLoader = null;
function loadPdfLibrary() {
  if (pdfLoader) return pdfLoader;
  pdfLoader = new Promise((resolve, reject) => {
    const ready = () => {
      const library = window.pdfjsLib;
      if (!library) { pdfLoader = null; reject(new Error("pdf-lib")); return; }
      try {
        const workerSource = `importScripts(${JSON.stringify(PDFJS_WORKER_URL)});`;
        library.GlobalWorkerOptions.workerPort = new Worker(URL.createObjectURL(new Blob([workerSource], { type: "text/javascript" })));
      } catch (error) {
        console.warn("Worker PDF indisponible, lecture sur le fil principal", error);
        library.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
      }
      resolve(library);
    };
    const failed = () => { pdfLoader = null; reject(new Error("pdf-lib")); };
    const existing = document.querySelector("script[data-simia-pdfjs]");
    if (existing) {
      if (window.pdfjsLib) { ready(); return; }
      existing.addEventListener("load", ready);
      existing.addEventListener("error", failed);
      return;
    }
    const script = document.createElement("script");
    script.src = PDFJS_LIB_URL;
    script.async = true;
    script.dataset.simiaPdfjs = "1";
    script.addEventListener("load", ready);
    script.addEventListener("error", failed);
    document.head.append(script);
  });
  return pdfLoader;
}

async function extractOfficeSections(file, extension, report) {
  const buffer = await file.arrayBuffer();
  if (extension === "docx" || extension === "docm" || extension === "dotx") {
    report?.(localizedText("Lecture du document Word…", "Reading the Word document…", "Leyendo el documento de Word…"));
    const entries = await unzipEntries(buffer, name => /^word\/(document|footnotes|endnotes)\.xml$/.test(name));
    const main = entries.find(entry => entry.name === "word/document.xml") || entries[0];
    const extras = entries.filter(entry => entry !== main).map(entry => docxToText(entry.content));
    const text = [docxToText(main.content), ...extras].filter(Boolean).join("\n\n");
    return { sections: [{ page: null, text }], pages: null };
  }
  if (extension === "xlsx" || extension === "xlsm" || extension === "xltx") {
    report?.(localizedText("Lecture du classeur Excel…", "Reading the Excel workbook…", "Leyendo el libro de Excel…"));
    const entries = await unzipEntries(buffer, name => name === "xl/sharedStrings.xml" || /^xl\/worksheets\/sheet\d+\.xml$/.test(name) || name === "xl/workbook.xml");
    const sharedStrings = [];
    const shared = entries.find(entry => entry.name === "xl/sharedStrings.xml");
    if (shared) {
      for (const item of shared.content.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
        sharedStrings.push(tidyText(decodeEntities([...item[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(match => match[1]).join(" "))));
      }
    }
    const names = [...(entries.find(entry => entry.name === "xl/workbook.xml")?.content.matchAll(/<sheet[^>]*name="([^"]+)"/g) || [])].map(match => decodeEntities(match[1]));
    const sheets = entries.filter(entry => /^xl\/worksheets\/sheet\d+\.xml$/.test(entry.name)).sort((first, second) => first.name.localeCompare(second.name, undefined, { numeric: true }));
    const sections = sheets.map((sheet, position) => {
      const text = xlsxSheetToText(sheet.content, sharedStrings);
      const title = names[position] || `${localizedText("Feuille", "Sheet", "Hoja")} ${position + 1}`;
      return { page: null, text: text ? `${title}\n${text}` : "" };
    }).filter(section => section.text);
    if (!sections.length) throw new Error(documentUnavailableMessage());
    return { sections, pages: sheets.length };
  }
  if (extension === "pptx" || extension === "pptm") {
    report?.(localizedText("Lecture de la présentation…", "Reading the presentation…", "Leyendo la presentación…"));
    const entries = await unzipEntries(buffer, name => /^ppt\/slides\/slide\d+\.xml$/.test(name));
    const slides = entries.sort((first, second) => first.name.localeCompare(second.name, undefined, { numeric: true }));
    const sections = slides.map((slide, position) => ({ page: position + 1, text: `${localizedText("Diapositive", "Slide", "Diapositiva")} ${position + 1}\n${pptxSlideToText(slide.content)}` })).filter(section => section.text.trim());
    if (!sections.length) throw new Error(documentUnavailableMessage());
    return { sections, pages: slides.length };
  }
  if (["odt", "ods", "odp", "odg"].includes(extension)) {
    report?.(localizedText("Lecture du document OpenDocument…", "Reading the OpenDocument file…", "Leyendo el documento OpenDocument…"));
    const entries = await unzipEntries(buffer, name => name === "content.xml");
    const text = odfToText(entries[0].content);
    return { sections: [{ page: null, text }], pages: null };
  }
  if (extension === "epub") {
    report?.(localizedText("Lecture du livre EPUB…", "Reading the EPUB book…", "Leyendo el libro EPUB…"));
    const entries = await unzipEntries(buffer, name => /\.x?html?$/i.test(name) && !/nav\.x?html?$/i.test(name));
    const sections = entries
      .sort((first, second) => first.name.localeCompare(second.name, undefined, { numeric: true }))
      .map((entry, position) => ({ page: position + 1, text: htmlToPlainText(entry.content) }))
      .filter(section => section.text);
    if (!sections.length) throw new Error(documentUnavailableMessage());
    return { sections, pages: sections.length };
  }
  throw new Error(documentUnavailableMessage());
}

async function extractDocumentSections(file, extension, report) {
  if (UNSUPPORTED_DOCUMENT_EXTENSIONS.has(extension)) throw new Error(documentUnavailableMessage());
  if (extension === "pdf") throw new Error(documentUnavailableMessage());
  if (DOCUMENT_EXTENSIONS.has(extension) && !["rtf", "tex", "log", "tsv"].includes(extension)) {
    return extractOfficeSections(file, extension, report);
  }
  report?.(localizedText("Lecture du fichier…", "Reading the file…", "Leyendo el archivo…"));
  const raw = await readPlainTextFile(file);
  if (extension === "rtf" && /^\s*\{\\rtf/.test(raw)) return { sections: [{ page: null, text: rtfToText(raw) }], pages: null };
  if (["html", "htm", "xhtml"].includes(extension)) return { sections: [{ page: null, text: htmlToPlainText(raw) }], pages: null };
  return { sections: [{ page: null, text: raw }], pages: null };
}

/* --- Découpage, index et recherche dans les passages --- */

function normalizeForSearch(value) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function tokenizeForSearch(value) {
  return (normalizeForSearch(value).match(/[a-z0-9]{2,}/g) || []).filter(token => !SEARCH_STOPWORDS.has(token));
}

function chunkSectionText(text, page) {
  const chunks = [];
  const clean = text.replace(/[ \t]+/g, " ").trim();
  let start = 0;
  while (start < clean.length) {
    let end = Math.min(clean.length, start + DOCUMENT_CHUNK_CHARS);
    if (end < clean.length) {
      const boundary = Math.max(
        clean.lastIndexOf("\n", end),
        clean.lastIndexOf(". ", end),
        clean.lastIndexOf("? ", end),
        clean.lastIndexOf("! ", end)
      );
      if (boundary > start + DOCUMENT_CHUNK_CHARS * 0.55) end = boundary + 1;
    }
    const piece = clean.slice(start, end).trim();
    if (piece) chunks.push({ page: page ?? null, text: piece });
    if (end >= clean.length) break;
    start = Math.max(end - DOCUMENT_CHUNK_OVERLAP, start + 1);
  }
  return chunks;
}

function createDocumentIndex() {
  return { chunks: [], documents: [], documentFrequency: new Map(), averageLength: 1, terms: 0, vectors: null };
}

function appendDocumentChunks(index, chunks) {
  if (!chunks.length) return 0;
  chunks.forEach(chunk => {
    const position = index.documents.length;
    chunk.order = position + 1;
    const tokens = tokenizeForSearch(chunk.text);
    const frequencies = new Map();
    tokens.forEach(token => frequencies.set(token, (frequencies.get(token) || 0) + 1));
    index.documents.push({ frequencies, length: tokens.length || 1, normalized: normalizeForSearch(chunk.text) });
    index.chunks.push(chunk);
    frequencies.forEach((_, term) => index.documentFrequency.set(term, (index.documentFrequency.get(term) || 0) + 1));
    index.terms += tokens.length;
    if (index.vectors) index.vectors.push(null);
  });
  index.averageLength = index.terms / Math.max(1, index.documents.length) || 1;
  return chunks.length;
}

function buildDocumentIndexFromSections(attachment, sections) {
  const index = createDocumentIndex();
  attachment.docIndex = index;
  sections.forEach(section => appendDocumentChunks(index, chunkSectionText(section.text, section.page)));
  updateDocumentCounters(attachment);
  return index;
}

function buildDocumentIndex(attachment) {
  return buildDocumentIndexFromSections(attachment, attachment.docSections || []);
}

function updateDocumentCounters(attachment) {
  if (!attachment.document) return;
  attachment.document.chunks = attachment.docIndex ? attachment.docIndex.chunks.length : 0;
  attachment.document.characters = (attachment.text || "").length;
}

function countWords(text) {
  return (text.match(/\S+/g) || []).length;
}

function finalizeDocumentAttachment(attachment, sections, pages) {
  const paginated = sections.some(section => section.page);
  attachment.text = sections.map(section => (section.page ? `[Page ${section.page}]\n${section.text}` : section.text)).filter(Boolean).join("\n\n");
  attachment.document = {
    ...(attachment.document || {}),
    format: attachment.document?.format || documentExtensionLabel(attachmentExtension({ name: attachment.name })),
    extension: attachmentExtension({ name: attachment.name }),
    pages: paginated ? pages ?? sections.length : null,
    indexedPages: sections.length,
    words: countWords(attachment.text),
    characters: attachment.text.length,
    chunks: 0,
    status: "ready",
    progress: "",
    outline: attachment.document?.outline || [],
    notes: attachment.document?.notes || [],
    restored: false
  };
  if (attachment.document.pages && attachment.text.replace(/\[Page \d+\]/g, "").trim().length < 200) {
    attachment.document.notes.push(localizedText("Ce document semble être un scan : le texte n'est pas extractible. Joignez une version texte (OCR) pour pouvoir l'interroger.", "This document looks like a scan: no text could be extracted. Attach a text (OCR) version to question it.", "Este documento parece un escaneo: no se ha podido extraer texto. Adjunta una versión con texto (OCR) para poder consultarlo."));
  }
  buildDocumentIndexFromSections(attachment, sections);
  updateDocumentCounters(attachment);
  return attachment;
}

function indexAttachmentDocument(attachment, sections, pages) {
  attachment.docSections = sections;
  return finalizeDocumentAttachment(attachment, sections, pages);
}

/* --- Table des matières et indexation progressive des livres PDF --- */

async function readPdfOutline(pdf) {
  let outline = [];
  try { outline = (await pdf.getOutline()) || []; } catch { return []; }
  const chapters = [];
  const walk = async items => {
    for (const item of items) {
      if (chapters.length >= 400) return;
      let page = null;
      try {
        const destination = typeof item.dest === "string" ? await pdf.getDestination(item.dest) : item.dest;
        if (Array.isArray(destination) && destination[0]) page = (await pdf.getPageIndex(destination[0])) + 1;
      } catch { page = null; }
      const title = String(item.title || "").replace(/\s+/g, " ").trim().slice(0, 140);
      if (title && page) chapters.push({ title, page });
      if (item.items?.length) await walk(item.items);
    }
  };
  await walk(outline);
  return chapters.filter((chapter, index, list) => list.findIndex(item => item.page === chapter.page) === index).sort((first, second) => first.page - second.page);
}

function pdfLibraryMessage() {
  return localizedText(
    "Le lecteur PDF n'a pas pu être chargé. Vérifiez la connexion pour le premier chargement, puis réessayez.",
    "The PDF reader could not be loaded. Check your connection for the first load, then try again.",
    "No se ha podido cargar el lector de PDF. Comprueba la conexión en la primera carga e inténtalo de nuevo."
  );
}

async function indexPdfAttachment(attachment, file) {
  const report = message => {
    attachment.document.progress = message;
    updateDocumentProgress(attachment);
  };
  const library = await loadPdfLibrary().catch(() => { throw new Error(pdfLibraryMessage()); });
  const data = new Uint8Array(await file.arrayBuffer());
  let pdf = null;
  try {
    pdf = await library.getDocument({ data, isEvalSupported: false, disableFontFace: true }).promise;
  } catch (error) {
    if (String(error?.name || "") === "PasswordException") {
      throw new Error(localizedText("Ce PDF est protégé par un mot de passe : retirez la protection puis joignez-le de nouveau.", "This PDF is password protected: remove the protection and attach it again.", "Este PDF está protegido con contraseña: quita la protección y adjúntalo de nuevo."));
    }
    throw new Error(localizedText("Le fichier PDF semble endommagé ou illisible.", "The PDF file appears damaged or unreadable.", "El archivo PDF parece dañado o ilegible."));
  }
  try {
    attachment.document.pages = pdf.numPages;
    attachment.document.outline = await readPdfOutline(pdf);
    const parts = [];
    for (let number = 1; number <= pdf.numPages; number += 1) {
      const page = await pdf.getPage(number);
      const content = await page.getTextContent();
      let text = "";
      for (const item of content.items) {
        if (typeof item.str !== "string") continue;
        text += item.str + (item.hasEOL ? "\n" : " ");
      }
      const clean = tidyText(text);
      parts.push(`[Page ${number}]\n${clean}`);
      if (clean) {
        attachment.document.words += countWords(clean);
        appendDocumentChunks(attachment.docIndex, chunkSectionText(clean, number));
      }
      page.cleanup();
      attachment.document.indexedPages = number;
      if (number % PDF_INDEX_BATCH_PAGES === 0 || number === pdf.numPages) {
        attachment.text = parts.join("\n\n");
        updateDocumentCounters(attachment);
        report(localizedText(
          `Indexation du livre — page ${number}/${pdf.numPages} (${Math.round((number / pdf.numPages) * 100)} %)`,
          `Indexing the book — page ${number}/${pdf.numPages} (${Math.round((number / pdf.numPages) * 100)}%)`,
          `Indexando el libro — página ${number}/${pdf.numPages} (${Math.round((number / pdf.numPages) * 100)}%)`
        ));
        await new Promise(resolve => window.setTimeout(resolve, 0));
      }
    }
    return attachment;
  } finally {
    try { await pdf.destroy(); } catch { /* libération optionnelle */ }
  }
}

function updateDocumentProgress(attachment) {
  renderDocumentTools();
  refreshAttachmentCards(attachment);
}

function documentReadyMessage(attachment) {
  const document_ = attachment.document || {};
  return localizedText("Document prêt : ", "Document ready: ", "Documento listo: ") + [
    document_.pages ? localizedText(`${document_.pages} pages`, `${document_.pages} pages`, `${document_.pages} páginas`) : "",
    localizedText(`${document_.chunks} passages indexés`, `${document_.chunks} indexed passages`, `${document_.chunks} pasajes indexados`)
  ].filter(Boolean).join(" · ");
}

function startDocumentIndexing(attachment, file) {
  state.documentJobs += 1;
  indexPdfAttachment(attachment, file)
    .then(() => {
      attachment.document.status = "ready";
      attachment.document.progress = "";
      updateDocumentCounters(attachment);
      state.documentStatus = documentReadyMessage(attachment);
    })
    .catch(error => {
      console.warn("Indexation PDF interrompue", error);
      attachment.document.status = attachment.docIndex?.chunks.length ? "ready" : "error";
      attachment.document.progress = error?.message || documentUnavailableMessage();
      attachment.document.notes = [...(attachment.document.notes || []), attachment.document.progress];
      state.documentStatus = localizedText(`${attachment.name} : ${attachment.document.progress}`, `${attachment.name}: ${attachment.document.progress}`, `${attachment.name}: ${attachment.document.progress}`);
    })
    .finally(() => {
      state.documentJobs = Math.max(0, state.documentJobs - 1);
      if (attachment.document.status === "ready") storeDocumentRecord(attachment, isDocumentPending(attachment));
      updateDocumentProgress(attachment);
    });
}

function isDocumentPending(attachment) {
  return state.pendingAttachments.includes(attachment);
}

/* --- Conservation des documents (IndexedDB, sans limite de taille) --- */

async function documentDb() {
  if ("__documentDbPromise" in state) return state.__documentDbPromise;
  if (!window.indexedDB) { state.__documentDbPromise = Promise.resolve(null); return state.__documentDbPromise; }
  state.__documentDbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open("simia-documents", 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains("documents")) database.createObjectStore("documents", { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }).catch(error => {
    console.warn("Conservation des documents indisponible", error);
    state.__documentDbPromise = null;
    return null;
  });
  return state.__documentDbPromise;
}

async function runDocumentStore(mode, action) {
  const database = await documentDb();
  if (!database) return null;
  return new Promise((resolve, reject) => {
    let request = null;
    try {
      const transaction = database.transaction("documents", mode);
      request = action(transaction.objectStore("documents"));
      transaction.oncomplete = () => resolve(request?.result ?? true);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    } catch (error) {
      reject(error);
    }
  });
}

function documentRecord(attachment, pending = false) {
  return {
    id: attachment.id,
    name: attachment.name,
    type: attachment.type || "",
    size: attachment.size || 0,
    format: attachment.document?.format || "",
    extension: attachment.document?.extension || "",
    pages: attachment.document?.pages ?? null,
    words: attachment.document?.words || 0,
    characters: attachment.document?.characters || 0,
    outline: attachment.document?.outline || [],
    notes: attachment.document?.notes || [],
    text: attachment.text || "",
    pending: Boolean(pending),
    savedAt: new Date().toISOString()
  };
}

async function storeDocumentRecord(attachment, pending = false) {
  if (!attachment.document || !attachment.text) return;
  try {
    await runDocumentStore("readwrite", store => store.put(documentRecord(attachment, pending)));
  } catch (error) {
    console.warn("Document non conservé", error);
  }
}

async function removeDocumentRecords(ids) {
  if (!ids?.length) return;
  try { await runDocumentStore("readwrite", store => ids.forEach(id => store.delete(id))); }
  catch (error) { console.warn("Suppression du document impossible", error); }
}

async function clearDocumentRecords() {
  try { await runDocumentStore("readwrite", store => store.clear()); }
  catch (error) { console.warn("Purge des documents impossible", error); }
}

async function loadStoredDocuments() {
  let records = null;
  try { records = await runDocumentStore("readonly", store => store.getAll()); }
  catch (error) { console.warn("Lecture des documents impossible", error); }
  if (!Array.isArray(records) || !records.length) return 0;
  const byId = new Map(records.map(record => [record.id, record]));
  const used = new Set(state.pendingAttachments.map(attachment => attachment.id));
  let restored = 0;
  state.conversations.forEach(conversation => conversation.messages.forEach(message => (message.attachments || []).forEach(attachment => {
    if (!attachment.document) return;
    used.add(attachment.id);
    const record = byId.get(attachment.id);
    if (!record || attachment.docIndex || !record.text) return;
    attachment.text = record.text;
    attachment.document = {
      ...(attachment.document || {}),
      format: record.format || attachment.document?.format || "Document",
      extension: record.extension || "",
      pages: record.pages ?? null,
      words: record.words || 0,
      outline: record.outline || [],
      notes: record.notes || [],
      status: "ready",
      progress: "",
      restored: true
    };
    restored += 1;
  })));
  /* Documents préparés mais jamais envoyés : on les remet dans la zone de saisie. */
  records.forEach(record => {
    if (used.has(record.id) || !record.pending || !record.text) return;
    const attachment = {
      id: record.id,
      name: record.name,
      type: record.type || "",
      size: record.size || 0,
      kind: "document",
      text: record.text,
      document: {
        format: record.format || "Document",
        extension: record.extension || "",
        pages: record.pages ?? null,
        words: record.words || 0,
        outline: record.outline || [],
        notes: record.notes || [],
        status: "ready",
        progress: "",
        restored: true
      }
    };
    attachment.docSections = documentSectionsFromStoredText(record.text);
    buildDocumentIndex(attachment);
    state.pendingAttachments.push(attachment);
    used.add(record.id);
    restored += 1;
  });
  const orphans = records.filter(record => !used.has(record.id)).map(record => record.id);
  if (orphans.length) removeDocumentRecords(orphans);
  return restored;
}

function refreshAttachmentCards(attachment) {
  document.querySelectorAll(`[data-attachment-id="${attachment.id}"]`).forEach(card => {
    const pending = Boolean(card.closest("#attachment-tray"));
    card.outerHTML = attachmentCard(attachment, pending);
  });
}

function cosineSimilarity(first, second) {
  let score = 0;
  for (let index = 0; index < first.length; index += 1) score += first[index] * second[index];
  return score;
}

function searchDocumentIndex(index, query, limit = 5, queryVector = null) {
  if (!index?.documents?.length) return [];
  const queryTokens = [...new Set(tokenizeForSearch(query))];
  const normalizedQuery = normalizeForSearch(query).replace(/\s+/g, " ").replace(/^(peux tu|can you|puedes) /, "").trim();
  const k1 = 1.2;
  const b = 0.72;
  const scored = index.documents.map((document_, position) => {
    let lexical = 0;
    queryTokens.forEach(term => {
      const frequency = document_.frequencies.get(term) || 0;
      if (!frequency) return;
      const df = index.documentFrequency.get(term) || 0;
      const idf = Math.log(1 + (index.documents.length - df + 0.5) / (df + 0.5));
      lexical += idf * ((frequency * (k1 + 1)) / (frequency + k1 * (1 - b + b * (document_.length / index.averageLength))));
    });
    if (normalizedQuery.length > 4 && document_.normalized.includes(normalizedQuery)) lexical += 5;
    if (queryTokens.length) lexical += queryTokens.filter(token => document_.frequencies.has(token)).length * 0.4;
    return { position, lexical, score: lexical };
  });
  const best = Math.max(...scored.map(entry => entry.lexical)) || 0;
  scored.forEach(entry => { entry.lexicalNormalized = best > 0 ? entry.lexical / best : 0; });
  const usable = scored.filter(entry => entry.lexical > 0.35);
  const candidates = (usable.length ? usable : scored.slice(0, limit));
  if (index.vectors && queryVector) {
    candidates.forEach(entry => {
      const vector = index.vectors[entry.position];
      const similarity = vector ? Math.max(0, cosineSimilarity(queryVector, vector)) : 0;
      entry.score = entry.lexicalNormalized * 0.55 + similarity * 0.45;
    });
  } else {
    candidates.forEach(entry => { entry.score = entry.lexicalNormalized; });
  }
  return candidates
    .sort((first, second) => second.score - first.score)
    .slice(0, limit)
    .map(entry => ({ ...index.chunks[entry.position], score: entry.score }));
}

function conversationDocumentAttachments(conversation) {
  const found = new Map();
  conversation?.messages.forEach(message => {
    (message.attachments || []).forEach(attachment => {
      if (attachment.docIndex && !found.has(attachment.name)) found.set(attachment.name, attachment);
    });
  });
  return [...found.values()];
}

function pendingDocumentAttachments() {
  return state.pendingAttachments.filter(attachment => attachment.docIndex || attachment.document);
}

function collectDocumentExcerpts(query, queryVector = null) {
  const attachments = [...pendingDocumentAttachments(), ...conversationDocumentAttachments(activeConversation())]
    .filter((attachment, index, list) => attachment.docIndex && list.findIndex(item => item.id === attachment.id) === index);
  if (!attachments.length) return null;
  const selected = [];
  let budget = DOCUMENT_EXCERPT_BUDGET;
  const perDocument = Math.max(2, Math.round(6 / attachments.length));
  attachments.forEach(attachment => {
    searchDocumentIndex(attachment.docIndex, query, perDocument, queryVector).forEach(hit => {
      if (budget - hit.text.length < 0) return;
      budget -= hit.text.length;
      selected.push({ attachment, hit });
    });
  });
  if (!selected.length) return null;
  const lines = selected.map((entry, position) => {
    const label = `E${position + 1}`;
    const where = entry.hit.page ? localizedText(`page ${entry.hit.page}`, `page ${entry.hit.page}`, `página ${entry.hit.page}`) : localizedText(`passage ${entry.hit.order}`, `passage ${entry.hit.order}`, `pasaje ${entry.hit.order}`);
    entry.label = label;
    return `[${label} · ${entry.attachment.name} · ${where}]\n${entry.hit.text}`;
  });
  return { text: lines.join("\n\n"), sources: selected };
}

function documentSourcesMarkup(sources) {
  if (!sources?.length) return "";
  const title = localizedText("Passages utilisés dans vos documents", "Passages used from your documents", "Pasajes utilizados de tus documentos");
  const items = sources.map(source => {
    const where = source.hit.page ? localizedText(`page ${source.hit.page}`, `page ${source.hit.page}`, `página ${source.hit.page}`) : localizedText(`passage ${source.hit.order}`, `passage ${source.hit.order}`, `pasaje ${source.hit.order}`);
    const preview = source.hit.text.replace(/\s+/g, " ").slice(0, 150);
    return `<li><strong>[${source.label}]</strong> ${escapeHtml(source.attachment.name)} — ${escapeHtml(where)} : ${escapeHtml(preview)}…</li>`;
  }).join("");
  return `<div class="document-sources"><strong>${escapeHtml(title)}</strong><ul>${items}</ul></div>`;
}

function newDocumentState(attachment, progress) {
  return {
    format: documentExtensionLabel(attachmentExtension({ name: attachment.name })) || "DOC",
    extension: attachmentExtension({ name: attachment.name }),
    pages: null,
    indexedPages: 0,
    words: 0,
    characters: 0,
    chunks: 0,
    outline: [],
    notes: [],
    restored: false,
    status: "indexing",
    progress
  };
}

async function prepareAttachment(file) {
  const kind = attachmentKind(file);
  const extension = attachmentExtension(file);
  const attachment = { id: crypto.randomUUID(), name: file.name, type: file.type, size: file.size, kind };
  if (kind === "image" || kind === "video" || kind === "3d") attachment.previewUrl = URL.createObjectURL(file);
  if (kind === "image") attachment.dataUrl = await fileDataUrl(file);
  if (kind !== "document") return attachment;

  if (isDocumentAttachment(file) && extension === "pdf") {
    attachment.document = newDocumentState(attachment, localizedText("Ouverture du PDF…", "Opening the PDF…", "Abriendo el PDF…"));
    attachment.docIndex = createDocumentIndex();
    return attachment;
  }
  if (isDocumentAttachment(file)) {
    attachment.document = newDocumentState(attachment, localizedText("Analyse du document…", "Analyzing the document…", "Analizando el documento…"));
    const { sections, pages } = await extractDocumentSections(file, extension, message => {
      attachment.document.progress = message;
      updateDocumentProgress(attachment);
    });
    if (!sections.some(section => section.text.trim())) throw new Error(documentUnavailableMessage());
    attachment.document.status = "ready";
    return indexAttachmentDocument(attachment, sections, pages);
  }
  if (isTextAttachment(file)) {
    const text = await readPlainTextFile(file);
    if (text.length <= TEXT_INLINE_LIMIT) {
      attachment.text = text;
      attachment.truncated = false;
      return attachment;
    }
    attachment.document = newDocumentState(attachment, localizedText("Indexation du fichier…", "Indexing the file…", "Indexando el archivo…"));
    attachment.document.status = "ready";
    return finalizeDocumentAttachment(attachment, [{ page: null, text }], null);
  }
  return attachment;
}

function attachmentCard(attachment, pending = false) {
  const preview = attachment.kind === "image" && attachment.previewUrl ? `<img src="${escapeHtml(attachment.previewUrl)}" alt="">` : attachment.kind === "video" ? "VID" : attachment.kind === "3d" ? "3D" : attachment.document ? escapeHtml(attachment.document.format || "DOC") : "DOC";
  const remove = pending ? `<button type="button" data-remove-attachment="${attachment.id}" aria-label="Remove ${escapeHtml(attachment.name)}">x</button>` : "";
  if (attachment.document) {
    const document_ = attachment.document;
    const passages = attachment.docIndex ? attachment.docIndex.chunks.length : 0;
    const status = document_.status === "indexing" ? "" : document_.status === "error" ? " failed" : " ready";
    const information = document_.status === "indexing"
      ? document_.progress || localizedText("Indexation…", "Indexing…", "Indexando…")
      : document_.status === "error"
        ? document_.progress || documentUnavailableMessage()
        : (document_.notes?.[0] || [
          document_.pages ? localizedText(`${document_.pages} page${document_.pages > 1 ? "s" : ""}`, `${document_.pages} page${document_.pages > 1 ? "s" : ""}`, `${document_.pages} página${document_.pages > 1 ? "s" : ""}`) : "",
          document_.words ? localizedText(`${document_.words.toLocaleString("fr-FR")} mots`, `${document_.words.toLocaleString("en-US")} words`, `${document_.words.toLocaleString("es-ES")} palabras`) : "",
          passages ? localizedText(`${passages} passage${passages > 1 ? "s" : ""} indexé${passages > 1 ? "s" : ""}`, `${passages} indexed passage${passages > 1 ? "s" : ""}`, `${passages} pasaje${passages > 1 ? "s" : ""} indexado${passages > 1 ? "s" : ""}`) : "",
          document_.outline?.length > 1 ? localizedText(`${document_.outline.length} chapitres`, `${document_.outline.length} chapters`, `${document_.outline.length} capítulos`) : "",
          document_.restored ? localizedText("rechargé depuis ce navigateur", "reloaded from this browser", "recargado desde este navegador") : ""
        ].filter(Boolean).join(" · "));
    return `<div class="attachment-card attachment-${attachment.kind} attachment-document${status}" data-attachment-id="${attachment.id}"><span class="attachment-preview">${preview}</span><span class="attachment-name"><span class="attachment-label">${escapeHtml(attachment.name)}</span><small class="attachment-detail">${escapeHtml(information)}</small></span><small>${formatFileSize(attachment.size)}</small>${remove}</div>`;
  }
  return `<div class="attachment-card attachment-${attachment.kind}" data-attachment-id="${attachment.id}"><span class="attachment-preview">${preview}</span><span class="attachment-name">${escapeHtml(attachment.name)}</span><small>${formatFileSize(attachment.size)}</small>${remove}</div>`;
}

function renderPendingAttachments() {
  ui.attachmentTray.hidden = state.pendingAttachments.length === 0;
  ui.attachmentTray.innerHTML = state.pendingAttachments.map(attachment => attachmentCard(attachment, true)).join("");
}

async function addAttachments(files) {
  const selected = [...files].filter(Boolean);
  if (!selected.length) return;
  const heavy = selected.length > DOCUMENT_ADVICE_COUNT || selected.some(file => file.size > DOCUMENT_ADVICE_BYTES);
  const errors = [];
  for (const file of selected) {
    const placeholder = { id: `pending-${crypto.randomUUID()}`, name: file.name, type: file.type, size: file.size, kind: attachmentKind(file), document: { ...newDocumentState({ name: file.name }, localizedText("Analyse…", "Analyzing…", "Analizando…")) } };
    state.pendingAttachments.push(placeholder);
    renderPendingAttachments();
    try {
      const attachment = await prepareAttachment(file);
      const position = state.pendingAttachments.indexOf(placeholder);
      state.pendingAttachments.splice(position >= 0 ? position : state.pendingAttachments.length - 1, 1, attachment);
      if (attachment.document?.status === "indexing") startDocumentIndexing(attachment, file);
      else if (attachment.document) storeDocumentRecord(attachment, true);
    } catch (error) {
      state.pendingAttachments = state.pendingAttachments.filter(item => item !== placeholder);
      errors.push(`${file.name} : ${error?.message || copy[state.language].attachmentProblem}`);
      console.warn("Pièce jointe ignorée", error);
    }
    renderPendingAttachments();
    renderDocumentTools();
  }
  if (errors.length) {
    ui.attachmentTray.textContent = errors.join(" · ");
    ui.attachmentTray.hidden = false;
  } else if (heavy) {
    ui.attachmentTray.textContent = copy[state.language].attachmentAdvice;
    ui.attachmentTray.hidden = false;
  }
}

function clearPendingAttachments() {
  state.pendingAttachments.forEach(attachment => {
    if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
  });
  state.pendingAttachments = [];
  ui.attachmentInput.value = "";
  renderPendingAttachments();
  renderDocumentTools();
}

function releaseAttachmentPreviews(messages) {
  messages.forEach(message => message.attachments?.forEach(attachment => {
    if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
  }));
}

function attachmentContext(attachments, brief = false) {
  if (!attachments.length) return "";
  const entries = attachments.map(attachment => {
    if (attachment.document) {
      const stats = [attachment.document.format, attachment.document.pages ? localizedText(`${attachment.document.pages} pages`, `${attachment.document.pages} pages`, `${attachment.document.pages} páginas`) : ""].filter(Boolean).join(", ");
      if (brief) return `Document: ${attachment.name} (${stats}) — son contenu est retrouvé par recherche de passages.`;
      return `Document joint : ${attachment.name} (${stats}). Son contenu est analysé par recherche de passages et fourni sous forme d'extraits numérotés à la fin de ce message.`;
    }
    if (attachment.text) {
      const text = brief ? attachment.text.slice(0, 4000) : attachment.text;
      return `File: ${attachment.name}\n${text}${attachment.truncated && !brief ? "\n[Text truncated]" : ""}`;
    }
    if (attachment.kind === "image") return `Image attached: ${attachment.name}${activeModelIsVision() ? ". Analyze the visible content." : `. ${copy[state.language].imageNeedsVision}`}`;
    return `File attached: ${attachment.name} (${attachment.kind}).`;
  });
  return `\n\n[Local attachments]\n${entries.join("\n\n")}`;
}

/* --- Panneau Documents : actions et recherche sémantique --- */

function activeDocumentAttachments() {
  return [...pendingDocumentAttachments(), ...conversationDocumentAttachments(activeConversation())]
    .filter((attachment, index, list) => list.findIndex(item => item.id === attachment.id) === index);
}

function renderDocumentTools() {
  if (!ui.documentTools) return;
  const documents = activeDocumentAttachments();
  ui.documentTools.hidden = documents.length === 0;
  if (!documents.length) return;
  const indexed = documents.filter(attachment => attachment.docIndex);
  const passages = indexed.reduce((sum, attachment) => sum + attachment.docIndex.chunks.length, 0);
  const indexing = documents.filter(attachment => attachment.document?.status === "indexing");
  const running = indexing.length
    ? localizedText(`Indexation en cours : ${indexing.map(attachment => attachment.document.progress || attachment.name).join(" · ")}`, `Indexing in progress: ${indexing.map(attachment => attachment.document.progress || attachment.name).join(" · ")}`, `Indexación en curso: ${indexing.map(attachment => attachment.document.progress || attachment.name).join(" · ")}`)
    : "";
  const summary = indexed.length
    ? localizedText(`${indexed.length} document${indexed.length > 1 ? "s" : ""} prêt${indexed.length > 1 ? "s" : ""} · ${passages} passage${passages > 1 ? "s" : ""} indexé${passages > 1 ? "s" : ""}`, `${indexed.length} document${indexed.length > 1 ? "s" : ""} ready · ${passages} indexed passage${passages > 1 ? "s" : ""}`, `${indexed.length} documento${indexed.length > 1 ? "s" : ""} listo${indexed.length > 1 ? "s" : ""} · ${passages} pasaje${passages > 1 ? "s" : ""} indexado${passages > 1 ? "s" : ""}`)
    : localizedText("Extraction du document en cours…", "Extracting the document…", "Extrayendo el documento…");
  const semantic = state.semanticSearch ? localizedText("Recherche sémantique active", "Semantic search on", "Búsqueda semántica activa") : localizedText("Recherche sémantique", "Semantic search", "Búsqueda semántica");
  ui.documentToolsStatus.textContent = [running, state.documentStatus || summary].filter(Boolean).join(" — ");
  ui.documentSemantic.textContent = semantic;
  ui.documentSemantic.setAttribute("aria-pressed", String(state.semanticSearch));
  ui.documentSummary.disabled = !indexed.length || Boolean(indexing.length);
  ui.documentExport.disabled = !indexed.length;
}

async function loadEmbedder(report) {
  if (state.embedder) return state.embedder;
  if (!state.embedderPromise) {
    state.embedderPromise = (async () => {
      const transformers = await importTransformers();
      return transformers.pipeline("feature-extraction", EMBEDDING_MODEL_ID, {
        dtype: "q8",
        progress_callback: item => {
          if (item?.status === "progress" && item.progress != null) {
            report?.(localizedText(`Préparation du moteur de recherche sémantique ${Math.round(item.progress)}%…`, `Preparing the semantic search engine ${Math.round(item.progress)}%…`, `Preparando el buscador semántico ${Math.round(item.progress)}%…`));
          }
        }
      });
    })().catch(error => { state.embedderPromise = null; throw error; });
  }
  state.embedder = await state.embedderPromise;
  return state.embedder;
}

async function embedTexts(extractor, texts, prefix, report) {
  const vectors = [];
  const batchSize = 8;
  for (let index = 0; index < texts.length; index += batchSize) {
    const batch = texts.slice(index, index + batchSize).map(text => `${prefix}${text.slice(0, 1100)}`);
    const output = await extractor(batch, { pooling: "mean", normalize: true });
    vectors.push(...output.tolist());
    report?.(localizedText(`Indexation sémantique ${Math.min(100, Math.round(((index + batch.length) / texts.length) * 100))}%…`, `Semantic indexing ${Math.min(100, Math.round(((index + batch.length) / texts.length) * 100))}%…`, `Indexación semántica ${Math.min(100, Math.round(((index + batch.length) / texts.length) * 100))}%…`));
  }
  return vectors;
}

async function indexSemanticVectors(attachment, extractor) {
  const index = attachment.docIndex;
  if (!index) return;
  const chunks = index.chunks;
  if (!index.vectors) index.vectors = new Array(chunks.length).fill(null);
  const missing = [];
  index.vectors.forEach((vector, position) => { if (!vector) missing.push(position); });
  if (!missing.length) return;
  const vectors = await embedTexts(extractor, missing.map(position => chunks[position].text), "passage: ", message => {
    state.documentStatus = `${attachment.name} — ${message}`;
    renderDocumentTools();
  });
  missing.forEach((position, offset) => { index.vectors[position] = vectors[offset] || null; });
}

async function setSemanticSearch(enabled) {
  if (!enabled) {
    state.semanticSearch = false;
    state.documentStatus = localizedText("Recherche par mots-clés et phrases, entièrement locale.", "Keyword and phrase search, fully local.", "Búsqueda por palabras y frases, totalmente local.");
    renderDocumentTools();
    saveState();
    return;
  }
  const documents = activeDocumentAttachments().filter(attachment => attachment.docIndex);
  if (!documents.length) {
    state.documentStatus = localizedText("Joignez d'abord un document PDF, Word ou Excel.", "Attach a PDF, Word, or Excel document first.", "Adjunta primero un documento PDF, Word o Excel.");
    renderDocumentTools();
    return;
  }
  state.semanticSearch = true;
  state.documentStatus = localizedText("Chargement du moteur de recherche sémantique…", "Loading the semantic search engine…", "Cargando el buscador semántico…");
  renderDocumentTools();
  try {
    const extractor = await loadEmbedder(message => { state.documentStatus = message; renderDocumentTools(); });
    for (const attachment of documents) await indexSemanticVectors(attachment, extractor);
    state.documentStatus = localizedText("Recherche sémantique prête : SIMIA retrouve les passages par le sens, pas seulement par les mots.", "Semantic search ready: SIMIA finds passages by meaning, not only by keywords.", "Búsqueda semántica lista: SIMIA localiza los pasajes por significado, no solo por palabras.");
  } catch (error) {
    console.warn("Recherche sémantique indisponible", error);
    state.semanticSearch = false;
    state.semanticVectors = null;
    state.documentStatus = localizedText("Recherche sémantique indisponible sur cet appareil. La recherche par mots-clés reste active.", "Semantic search is unavailable on this device. Keyword search stays active.", "La búsqueda semántica no está disponible en este dispositivo. La búsqueda por palabras sigue activa.");
  }
  renderDocumentTools();
  saveState();
}

function exportDocumentText() {
  const documents = activeDocumentAttachments().filter(attachment => attachment.text);
  if (!documents.length) return;
  const body = documents.map(attachment => `##### ${attachment.name}\n\n${attachment.text}`).join("\n\n");
  downloadTextFile(body, "simia-documents-texte-extrait.txt", "text/plain;charset=utf-8");
  state.documentStatus = localizedText("Texte extrait téléchargé.", "Extracted text downloaded.", "Texto extraído descargado.");
  renderDocumentTools();
}

async function askEngine(system, user, maxTokens = 280) {
  const response = await state.engine.chat.completions.create({
    messages: [{ role: "system", content: system }, { role: "user", content: user }],
    temperature: 0.4,
    max_tokens: maxTokens
  });
  return (response.choices[0].message.content || "").trim();
}

/* --- Résumé hiérarchique : adapté aux livres de plusieurs centaines de pages --- */

const SUMMARY_BATCH_CHARS = 2600;
const SUMMARY_MAX_CALLS = 24;
const SUMMARY_FALLBACK_PAGES = 20;

function documentSummarySections(attachment) {
  const chunks = attachment.docIndex?.chunks || [];
  if (!chunks.length) return [];
  const paginated = chunks.some(chunk => chunk.page != null);
  if (!paginated) return [{ title: attachment.name, chunks }];
  const totalPages = attachment.document?.pages || Math.max(...chunks.map(chunk => chunk.page || 1));
  const outline = (attachment.document?.outline || []).filter(entry => entry.page).sort((first, second) => first.page - second.page);
  const boundaries = outline.length >= 3
    ? outline
    : Array.from({ length: Math.ceil(totalPages / SUMMARY_FALLBACK_PAGES) }, (_, index) => ({
      title: localizedText(`Pages ${index * SUMMARY_FALLBACK_PAGES + 1} à ${Math.min(totalPages, (index + 1) * SUMMARY_FALLBACK_PAGES)}`, `Pages ${index * SUMMARY_FALLBACK_PAGES + 1} to ${Math.min(totalPages, (index + 1) * SUMMARY_FALLBACK_PAGES)}`, `Páginas ${index * SUMMARY_FALLBACK_PAGES + 1} a ${Math.min(totalPages, (index + 1) * SUMMARY_FALLBACK_PAGES)}`),
      page: index * SUMMARY_FALLBACK_PAGES + 1
    }));
  const sections = [];
  boundaries.forEach((entry, index) => {
    const from = entry.page;
    const to = boundaries[index + 1]?.page ?? totalPages + 1;
    const selected = chunks.filter(chunk => chunk.page != null && chunk.page >= from && chunk.page < to);
    if (selected.length) sections.push({ title: entry.title, chunks: selected });
  });
  return sections.length ? sections : [{ title: attachment.name, chunks }];
}

function groupChunksForSummary(chunks) {
  const groups = [];
  let current = [];
  let size = 0;
  chunks.forEach(chunk => {
    if (current.length && size + chunk.text.length > SUMMARY_BATCH_CHARS) {
      groups.push(current);
      current = [];
      size = 0;
    }
    current.push(chunk);
    size += chunk.text.length;
  });
  if (current.length) groups.push(current);
  return groups;
}

function sampleEvenly(items, limit) {
  if (items.length <= limit) return items;
  const step = items.length / limit;
  return Array.from({ length: limit }, (_, index) => items[Math.floor(index * step)]);
}

async function reduceSummaryNotes(system, notes) {
  let current = notes.filter(Boolean);
  while (current.length > 1) {
    const next = [];
    for (let index = 0; index < current.length; index += 6) {
      const batch = current.slice(index, index + 6);
      if (batch.length === 1) { next.push(batch[0]); continue; }
      next.push(await askEngine(system, `${localizedText("Notes par partie", "Notes by part", "Notas por parte")} :\n\n${batch.map((note, position) => `(${position + 1}) ${note}`).join("\n\n")}\n\n${localizedText("Fusionne ces notes en un texte unique, sans répétition et sans perte d'information.", "Merge these notes into a single text, without repetition and without losing information.", "Fusiona estas notas en un texto único, sin repeticiones y sin perder información.")}`, 600));
    }
    if (next.length >= current.length) break;
    current = next;
  }
  return current[0] || "";
}

async function summarizeDocuments() {
  const documents = activeDocumentAttachments().filter(attachment => attachment.docIndex?.chunks.length);
  if (!documents.length) {
    state.documentStatus = localizedText("Joignez d'abord un document à résumer.", "Attach a document to summarize first.", "Adjunta primero un documento que resumir.");
    renderDocumentTools();
    return;
  }
  if (!state.engine || !state.useWebLLM) {
    const message = localizedText("Choisissez un modèle dans l'onglet « Documents & PDF » puis téléchargez-le pour lancer le résumé.", "Pick a model in the \"Documents & PDF\" tab, then download it to start the summary.", "Elige un modelo en la pestaña «Documentos y PDF» y descárgalo para iniciar el resumen.");
    renderMessage("assistant", message);
    addMessage("assistant", message);
    return;
  }
  const label = localizedText(
    `Résume ${documents.map(attachment => attachment.name).join(", ")}`,
    `Summarize ${documents.map(attachment => attachment.name).join(", ")}`,
    `Resume ${documents.map(attachment => attachment.name).join(", ")}`
  );
  if (state.view === "home") showConversation();
  renderMessage("user", label);
  addMessage("user", label);
  const typing = createTyping();
  ui.documentSummary.disabled = true;
  try {
    const plan = [];
    documents.forEach(attachment => documentSummarySections(attachment).forEach(section => plan.push({ attachment, section })));
    const perSection = Math.max(1, Math.floor(SUMMARY_MAX_CALLS / Math.max(1, plan.length)));
    const mapSystem = localizedText(
      "Tu résumes une partie de document. Réponds en français, en 3 à 6 puces factuelles et précises, sans introduction ni conclusion.",
      "You summarize one part of a document. Reply in English with 3 to 6 factual, precise bullets, no introduction or conclusion.",
      "Resumes una parte de un documento. Responde en español con 3 a 6 viñetas factuales y precisas, sin introducción ni conclusión."
    );
    const notes = [];
    let analysed = 0;
    let available = 0;
    for (const [sectionIndex, item] of plan.entries()) {
      const groups = groupChunksForSummary(item.section.chunks);
      available += groups.length;
      const selected = sampleEvenly(groups, perSection);
      for (const [groupIndex, group] of selected.entries()) {
        state.documentStatus = plan.length > 1
          ? localizedText(`« ${item.section.title} » — partie ${groupIndex + 1}/${selected.length} (${sectionIndex + 1}/${plan.length})`, `“${item.section.title}” — part ${groupIndex + 1}/${selected.length} (${sectionIndex + 1}/${plan.length})`, `«${item.section.title}» — parte ${groupIndex + 1}/${selected.length} (${sectionIndex + 1}/${plan.length})`)
          : localizedText(`Analyse partie ${groupIndex + 1}/${selected.length}…`, `Reading part ${groupIndex + 1}/${selected.length}…`, `Analizando la parte ${groupIndex + 1}/${selected.length}…`);
        renderDocumentTools();
        const content = group.map(chunk => `[${chunk.page ? `page ${chunk.page}` : `passage ${chunk.order}`}] ${chunk.text}`).join("\n\n");
        notes.push(await askEngine(mapSystem, content, 240));
        analysed += 1;
      }
    }
    state.documentStatus = localizedText("Synthèse finale…", "Final synthesis…", "Síntesis final…");
    renderDocumentTools();
    const reduceSystem = localizedText(
      "Tu rédiges une synthèse unique, structurée et fidèle, en français.",
      "You write a single, structured, faithful synthesis, in English.",
      "Redactas una síntesis única, estructurada y fiel, en español."
    );
    let summary = await reduceSummaryNotes(reduceSystem, notes);
    if (analysed < available && summary) {
      summary += `\n\n${localizedText(
        `(Résumé établi à partir de ${analysed} parties sur ${available} : les passages non analysés peuvent contenir des éléments absents de cette synthèse. Demandez un résumé d'un chapitre précis pour aller plus loin.)`,
        `(Summary built from ${analysed} parts out of ${available}: unread passages may contain details missing here. Ask for a specific chapter summary to go further.)`,
        `(Resumen elaborado a partir de ${analysed} partes de ${available}: los pasajes no analizados pueden contener detalles ausentes aquí. Pide un resumen de un capítulo concreto para profundizar.)`
      )}`;
    }
    typing.remove();
    renderMessage("assistant", summary);
    addMessage("assistant", summary);
    state.documentStatus = localizedText(`Résumé terminé — ${analysed} parties analysées sur ${available}.`, `Summary complete — ${analysed} parts read out of ${available}.`, `Resumen terminado — ${analysed} partes analizadas de ${available}.`);
  } catch (error) {
    typing.remove();
    const message = localizedText("Le résumé a échoué. Vérifiez que le modèle est bien chargé puis réessayez.", "The summary failed. Check that the model is loaded, then try again.", "El resumen falló. Comprueba que el modelo esté cargado e inténtalo de nuevo.");
    renderMessage("assistant", message);
    addMessage("assistant", message);
    console.error(error);
  } finally {
    ui.documentSummary.disabled = false;
    renderDocumentTools();
  }
}

function isVisionModel() {
  return MODELS.find(model => model.id === state.selectedModel)?.vision;
}

function activeModelIsVision() {
  return Boolean(isVisionModel());
}

function activeConversation() {
  return state.conversations.find(conversation => conversation.id === state.activeConversationId);
}

function newConversation() {
  const conversation = {
    id: crypto.randomUUID(),
    title: localizedText("Nouvelle conversation", "New conversation", "Nueva conversación"),
    modelId: state.selectedModel,
    customModel: state.customModelActive && state.customModel ? { ...state.customModel } : null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    messages: []
  };
  state.conversations.unshift(conversation);
  state.activeConversationId = conversation.id;
  saveState();
  renderConversationList();
  showHome();
}

function storedAttachment(attachment) {
  /* Le texte des documents vit dans IndexedDB (sans limite de taille) :
     le stockage local ne garde que la fiche descriptive. */
  return {
    id: attachment.id,
    name: attachment.name,
    type: attachment.type,
    size: attachment.size,
    kind: attachment.kind,
    text: attachment.document ? undefined : attachment.text,
    truncated: attachment.document ? undefined : attachment.truncated,
    document: attachment.document
      ? { ...attachment.document, status: attachment.document.status === "indexing" ? "ready" : attachment.document.status, progress: "", notes: attachment.document.notes || [], outline: attachment.document.outline || [] }
      : undefined
  };
}

function documentSectionsFromStoredText(text) {
  const sections = [];
  const parts = text.split(/\[Page (\d+)\]\r?\n?/);
  if (parts.length > 1) {
    if (parts[0].trim()) sections.push({ page: null, text: parts[0].trim() });
    for (let index = 1; index < parts.length; index += 2) {
      const pageText = (parts[index + 1] || "").trim();
      if (pageText) sections.push({ page: Number(parts[index]), text: pageText });
    }
  }
  if (!sections.length && text.trim()) sections.push({ page: null, text: text.trim() });
  return sections;
}

function restoreDocumentIndexes(refresh = false) {
  let restored = 0;
  state.conversations.forEach(conversation => {
    conversation.messages.forEach(message => {
      (message.attachments || []).forEach(attachment => {
        if (!attachment.document || attachment.docIndex) return;
        if (!attachment.text) {
          attachment.document.status = "error";
          attachment.document.progress = localizedText("Fichier non conservé (onglet fermé pendant l'analyse). Joignez-le de nouveau pour l'interroger.", "File not saved (tab closed while analysing). Attach it again to question it.", "Archivo no conservado (pestaña cerrada durante el análisis). Adjúntalo de nuevo para consultarlo.");
          return;
        }
        attachment.document.status = "ready";
        attachment.document.progress = "";
        attachment.document.restored = true;
        attachment.document.indexedPages = attachment.document.pages || attachment.document.indexedPages || 0;
        attachment.docSections = documentSectionsFromStoredText(attachment.text);
        buildDocumentIndex(attachment);
        restored += 1;
      });
    });
  });
  if (restored) {
    state.documentStatus = localizedText(`${restored} document(s) rechargé(s) depuis ce navigateur. Interrogez-les directement, sans re-joindre les fichiers.`, `${restored} document(s) reloaded from this browser. Question them directly, without attaching the files again.`, `${restored} documento(s) recargado(s) desde este navegador. Consúltalos directamente, sin volver a adjuntar los archivos.`);
    if (refresh) renderActiveConversation();
  }
  return restored;
}

function saveState() {
  const backup = {
    version: 1,
    savedAt: new Date().toISOString(),
    language: state.language,
    selectedModel: state.selectedModel,
    cachedModelId: state.cachedModelId,
    autoLoadModel: state.autoLoadModel,
    customModel: state.customModel,
    customModelActive: state.customModelActive,
    codeOpen: state.code.open,
    codeFocus: state.code.focus,
    profile: state.profile,
    activeConversationId: state.activeConversationId,
    conversations: state.conversations.map(conversation => ({
      ...conversation,
      messages: conversation.messages.map(message => ({
        ...message,
        attachments: message.attachments?.map(storedAttachment) || []
      }))
    }))
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(backup));
  } catch (error) {
    console.error("Unable to save SIMIA data", error);
    setStatus(localizedText("Stockage plein", "Storage full", "Almacenamiento lleno", "保存領域が満杯です"), "error");
  }
}

function loadState() {
  try {
    const backup = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!backup || !Array.isArray(backup.conversations)) return;
    state.language = ["en", "fr", "es", "ja"].includes(backup.language) ? backup.language : "fr";
    state.selectedModel = MODELS.some(model => model.id === backup.selectedModel) ? backup.selectedModel : DEFAULT_MODEL_ID;
    state.cachedModelId = MODELS.some(model => model.id === backup.cachedModelId) ? backup.cachedModelId : null;
    state.autoLoadModel = Boolean(backup.autoLoadModel);
    state.customModel = normalizedCustomModel(backup.customModel);
    state.customModelActive = Boolean(state.customModel) && Boolean(backup.customModelActive);
    state.profile = typeof backup.profile === "string" ? backup.profile.slice(0, 600) : "";
    state.code.open = Boolean(backup.codeOpen);
    state.code.focus = backup.codeFocus === "chat" ? "chat" : "code";
    state.conversations = backup.conversations.filter(conversation => conversation && typeof conversation.id === "string" && Array.isArray(conversation.messages)).map(conversation => ({
      ...conversation,
      modelId: MODELS.some(model => model.id === conversation.modelId) ? conversation.modelId : state.selectedModel
    }));
    state.activeConversationId = state.conversations.some(conversation => conversation.id === backup.activeConversationId) ? backup.activeConversationId : state.conversations[0]?.id || null;
  } catch (error) {
    console.warn("SIMIA backup ignored", error);
  }
}

function addMessage(role, content, attachments = []) {
  const conversation = activeConversation();
  if (!conversation) return;
  conversation.messages.push({ role, content, attachments, createdAt: new Date().toISOString() });
  conversation.updatedAt = new Date().toISOString();
  if (role === "user" && conversation.messages.length === 1) conversation.title = content.replace(/\s+/g, " ").slice(0, 46) || conversation.title;
  saveState();
  renderConversationList();
}

function renderConversationList() {
  const ordered = [...state.conversations].sort((first, second) => new Date(second.updatedAt) - new Date(first.updatedAt));
  ui.conversationList.replaceChildren(...ordered.map(conversation => {
    const item = document.createElement("div");
    item.className = `history-row${conversation.id === state.activeConversationId ? " active" : ""}`;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "history-delete";
    remove.textContent = "x";
    remove.dataset.deleteConversationId = conversation.id;
    remove.setAttribute("aria-label", localizedText("Supprimer cette conversation", "Delete this conversation", "Eliminar esta conversación"));
    remove.title = remove.getAttribute("aria-label");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "history-item";
    button.textContent = conversation.title;
    button.dataset.conversationId = conversation.id;
    item.append(button, remove);
    return item;
  }));
}

function renderActiveConversation() {
  ui.chat.querySelectorAll(".message").forEach(message => message.remove());
  const conversation = activeConversation();
  renderDocumentTools();
  if (state.view !== "conversation") {
    ui.welcome.hidden = false;
    renderModeLabel();
    updateModelActivityUi();
    return;
  }
  ui.welcome.hidden = Boolean(conversation?.messages.length);
  const messages = conversation?.messages || [];
  const lastAssistantIndex = messages.reduce((last, message, index) => (message.role === "assistant" ? index : last), -1);
  messages.forEach((message, index) => renderMessage(message.role, message.content, false, message.attachments || [], null, { tools: true, last: index === lastAssistantIndex, image: message.image || null }));
  renderModeLabel();
  updateModelActivityUi();
}

function showHome() {
  state.view = "home";
  ui.workspace.dataset.view = "home";
  ui.home.hidden = true;
  renderActiveConversation();
  ui.prompt.focus();
}

function showConversation() {
  state.view = "conversation";
  ui.workspace.dataset.view = "conversation";
  ui.home.hidden = false;
  renderActiveConversation();
  ui.prompt.focus();
}

function scrollChatToLatest() {
  requestAnimationFrame(() => {
    ui.chat.scrollTo({ top: ui.chat.scrollHeight, behavior: "smooth" });
  });
}

const messageRawContent = new WeakMap();

function renderMessage(role, content, scroll = true, attachments = [], sources = null, options = {}) {
  ui.welcome.hidden = true;
  const element = document.createElement("article");
  element.className = `message ${role}`;
  const name = role === "user" ? localizedText("Vous", "You", "Tú", "あなた") : "SIMIA";
  const avatar = role === "user" ? "U" : '<img src="simia-logo-white.svg" alt="">';
  const attachmentMarkup = attachments.length ? `<div class="message-attachments">${attachments.map(attachment => attachmentCard(attachment)).join("")}</div>` : "";
  const sourcesMarkup = role === "assistant" && sources?.length ? documentSourcesMarkup(sources) : "";
  const imageMarkup = options.image ? imageFigureMarkup(options.image) : "";
  const modelGuidance = role === "assistant" && content === MODEL_REQUIRED ? modelRequiredMarkup() : `<div class="message-text">${formatMessageContent(content)}</div>`;
  const showTools = role === "assistant" && content !== MODEL_REQUIRED && (options.tools ?? scroll) && !options.image;
  const allowTurn = options.last ?? true;
  const toolbar = showTools ? messageToolbarMarkup(content, allowTurn) : "";
  element.innerHTML = `<div class="avatar">${avatar}</div><div class="message-content"><p class="message-role">${name}</p>${modelGuidance}${imageMarkup}${attachmentMarkup}${sourcesMarkup}${toolbar}</div>`;
  messageRawContent.set(element, content);
  ui.chat.append(element);
  if (imageMarkup) hydrateImages(element);
  if (scroll) scrollChatToLatest();
  return element;
}

function messageToolbarMarkup(content, allowTurn = true) {
  const labels = {
    copy: localizedText("Copier", "Copy", "Copiar", "コピー"),
    copied: localizedText("Copié", "Copied", "Copiado", "コピー済み"),
    regenerate: localizedText("Régénérer", "Regenerate", "Regenerar", "再生成"),
    continue: localizedText("Continuer", "Continue", "Continuar", "続ける")
  };
  const suggestions = [
    localizedText("Développe ce point", "Expand on this", "Amplía este punto", "この点を詳しく"),
    localizedText("Donne un exemple concret", "Give a concrete example", "Da un ejemplo concreto", "具体例を挙げて"),
    localizedText("Résume en 3 points", "Summarize in 3 points", "Resume en 3 puntos", "3点に要約して")
  ];
  const chips = suggestions.map(suggestion => `<button type="button" class="message-suggestion" data-suggestion="${escapeHtml(suggestion)}">${escapeHtml(suggestion)}</button>`).join("");
  const turnActions = allowTurn
    ? `<button type="button" class="message-action" data-action="regenerate" title="${escapeHtml(labels.regenerate)}">${ICON_REGENERATE}<span>${escapeHtml(labels.regenerate)}</span></button><button type="button" class="message-action" data-action="continue" title="${escapeHtml(labels.continue)}">${ICON_CONTINUE}<span>${escapeHtml(labels.continue)}</span></button>`
    : "";
  return `<div class="message-actions"><button type="button" class="message-action" data-action="copy" data-label-copied="${escapeHtml(labels.copied)}" title="${escapeHtml(labels.copy)}">${ICON_COPY}<span>${escapeHtml(labels.copy)}</span></button>${turnActions}</div>${allowTurn ? `<div class="message-suggestions">${chips}</div>` : ""}`;
}

function lastUserPrompt() {
  const conversation = activeConversation();
  if (!conversation) return "";
  for (let index = conversation.messages.length - 1; index >= 0; index -= 1) {
    if (conversation.messages[index].role === "user") return conversation.messages[index].content;
  }
  return "";
}

function chatNearBottom() {
  return ui.chat.scrollTop + ui.chat.clientHeight >= ui.chat.scrollHeight - 140;
}

/* Affiche la reponse au fil de l'eau, puis la remplace par le rendu final. */
function beginStreamingMessage(typing) {
  const element = document.createElement("article");
  element.className = "message assistant is-streaming";
  element.innerHTML = '<div class="avatar"><img src="simia-logo-white.svg" alt=""></div><div class="message-content"><p class="message-role">SIMIA</p><div class="message-text"></div></div>';
  const textNode = element.querySelector(".message-text");
  typing.replaceWith(element);
  scrollChatToLatest();

  let pending = "";
  let lastPaint = 0;
  let scheduled = 0;
  const paint = () => {
    scheduled = 0;
    lastPaint = performance.now();
    const stick = chatNearBottom();
    textNode.innerHTML = `${formatMessageContent(pending)}<span class="stream-caret" aria-hidden="true"></span>`;
    if (stick) scrollChatToLatest();
  };
  const update = partial => {
    pending = partial;
    if (scheduled) return;
    const wait = Math.max(0, 90 - (performance.now() - lastPaint));
    scheduled = setTimeout(paint, wait);
  };
  const finish = (finalText, sources) => {
    if (scheduled) clearTimeout(scheduled);
    element.remove();
    return renderMessage("assistant", finalText ?? pending, true, [], sources);
  };
  return { element, update, finish };
}

async function runAssistantTurn(prompt) {
  const typing = createTyping();
  ui.send.disabled = true;
  try {
    const visionActive = activeModelIsVision() && state.visionPipeline && state.visionModelId === state.selectedModel;
    const textActive = textModelActive();
    state.lastDocumentSources = [];
    const answering = visionActive || textActive;
    const stream = answering ? beginStreamingMessage(typing) : null;
    const answer = answering ? await respond(prompt, [], delta => stream.update(delta)) : MODEL_REQUIRED;
    if (stream) stream.finish(answer, state.lastDocumentSources);
    else { typing.remove(); renderMessage("assistant", answer); }
    addMessage("assistant", answer);
  } catch (error) {
    typing.remove();
    const message = localizedText("Je n'ai pas pu générer une réponse.", "I could not generate a reply.", "No se pudo generar una respuesta.");
    renderMessage("assistant", message);
    addMessage("assistant", message);
    console.error(error);
  } finally {
    ui.send.disabled = false;
    ui.prompt.focus();
  }
}

async function regenerateLast() {
  const conversation = activeConversation();
  if (!conversation || !conversation.messages.length) return;
  if (conversation.messages[conversation.messages.length - 1].role === "assistant") {
    conversation.messages.pop();
    const assistantNodes = ui.chat.querySelectorAll(".message.assistant");
    assistantNodes[assistantNodes.length - 1]?.remove();
    conversation.updatedAt = new Date().toISOString();
    saveState();
    renderConversationList();
  }
  const prompt = lastUserPrompt();
  if (prompt) await runAssistantTurn(prompt);
}

function continueLast() {
  runAssistantTurn(localizedText("Continue et complète ta réponse précédente sans te répéter.", "Continue and complete your previous answer without repeating yourself.", "Continúa y completa tu respuesta anterior sin repetirte."));
}

function handleMessageAction(button) {
  const action = button.dataset.action;
  if (action === "open-code") {
    const block = button.closest(".code-block");
    if (!block) return;
    const language = block.querySelector(".code-language")?.textContent || "code";
    const code = block.querySelector("code")?.textContent || "";
    openCodeWorkspace({ language, code });
    return;
  }
  if (action === "copy" || action === "copy-code") {
    if (!navigator.clipboard) return;
    let text = "";
    if (action === "copy-code") {
      text = button.closest(".code-block")?.querySelector("code")?.textContent || "";
    } else {
      const message = button.closest(".message");
      text = (message && messageRawContent.get(message)) || button.dataset.copyText || "";
    }
    if (!text) return;
    const originalHtml = button.innerHTML;
    navigator.clipboard.writeText(text).then(() => {
      button.classList.add("is-copied");
      button.innerHTML = `${ICON_CHECK}<span>${escapeHtml(button.dataset.labelCopied || localizedText("Copié", "Copied", "Copiado", "コピー済み"))}</span>`;
      setTimeout(() => {
        button.classList.remove("is-copied");
        button.innerHTML = originalHtml;
      }, 1600);
    }).catch(() => {});
    return;
  }
  if (action === "regenerate") return regenerateLast();
  if (action === "continue") return continueLast();
}

function recommendModel() {
  const memory = navigator.deviceMemory || 0;
  const light = isMobileDevice() || (memory > 0 && memory <= 4);
  state.modelFilter = "general";
  state.modelAdvice = light
    ? localizedText("Appareil à mémoire limitée : privilégiez un modèle léger (≈500 Mo à 1 Go) pour rester fluide.", "Limited-memory device: prefer a light model (~500 MB to 1 GB) to stay smooth.", "Dispositivo con memoria limitada: prioriza un modelo ligero (~500 MB a 1 GB) para mantener la fluidez.")
    : localizedText("Votre appareil peut gérer un modèle de 1 Go à 2,5 Go. Commencez par un modèle « Recommandé ».", "Your device can handle a 1–2.5 GB model. Start with a \"Recommended\" one.", "Tu dispositivo admite un modelo de 1 a 2,5 GB. Empieza por uno \"Recomendado\".");
  renderModelLibrary();
}

function messageToMarkdown(content) {
  if (content === MODEL_REQUIRED) return localizedText("(Un modèle est requis pour répondre.)", "(A model is required to answer.)", "(Se requiere un modelo para responder.)");
  if (content.startsWith(AGENT_RESULT_PREFIX)) {
    try {
      const result = JSON.parse(content.slice(AGENT_RESULT_PREFIX.length));
      const sources = (result.sources || []).map(source => `- [${source.title || source.url}](${source.url})`).join("\n");
      return `**${localizedText("Agent web", "Web agent", "Agente web")} : ${result.query || ""}**\n\n${result.summary || ""}\n\n${sources}`.trim();
    } catch { return content; }
  }
  return content;
}

function downloadTextFile(text, filename, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function exportConversationMarkdown() {
  const conversation = activeConversation();
  if (!conversation || !conversation.messages.length) {
    ui.downloadInfo.textContent = localizedText("Aucune conversation à exporter.", "No conversation to export.", "No hay conversación para exportar.");
    return;
  }
  const lines = [`# ${conversation.title}`, "", `_${new Date(conversation.updatedAt).toLocaleString()}_`, ""];
  conversation.messages.forEach(message => {
    const who = message.role === "user" ? localizedText("Vous", "You", "Tú") : "SIMIA";
    lines.push(`## ${who}`, "", messageToMarkdown(message.content), "");
  });
  const safeTitle = conversation.title.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 40).toLowerCase() || "conversation";
  downloadTextFile(lines.join("\n"), `simia-${safeTitle}.md`, "text/markdown");
  ui.downloadInfo.textContent = localizedText("Conversation active exportée en Markdown.", "Active conversation exported to Markdown.", "Conversación activa exportada en Markdown.");
}

function createTyping() {
  const element = document.createElement("article");
  element.className = "message assistant";
  element.innerHTML = '<div class="avatar"><img src="simia-logo-white.svg" alt=""></div><div class="message-content"><p class="message-role">SIMIA</p><div class="typing"><span></span><span></span><span></span></div></div>';
  ui.chat.append(element);
  scrollChatToLatest();
  return element;
}

function isMobileDevice() {
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}

function modelLoadFailureMessage() {
  if (isMobileDevice()) {
    return localizedText(
      "Ce modèle local est trop exigeant pour la mémoire graphique disponible sur ce mobile, ou WebGPU n'est pas pris en charge. Le Wi-Fi ne suffit pas : essayez Chrome récent avec WebGPU, SmolLM2 360M ou Llama 1B, ou utilisez SIMIA sur ordinateur.",
      "This local model needs more graphics memory than this phone provides, or WebGPU is not supported. Wi-Fi alone cannot fix this: try a recent Chrome with WebGPU, SmolLM2 360M or Llama 1B, or use SIMIA on a computer.",
      "Este modelo local necesita más memoria gráfica de la disponible en este móvil, o WebGPU no es compatible. El Wi-Fi no lo soluciona: prueba Chrome reciente con WebGPU, SmolLM2 360M o Llama 1B, o usa SIMIA en un ordenador."
    );
  }
  return localizedText(
    "Le chargement a échoué. Vérifiez WebGPU, l'espace libre et la mémoire graphique, puis essayez le modèle Llama 1B.",
    "Loading failed. Check WebGPU, free storage, and graphics memory, then try the Llama 1B model.",
    "La carga ha fallado. Comprueba WebGPU, el espacio libre y la memoria gráfica; después prueba el modelo Llama 1B."
  );
}

function modelLoadFailureDetail(error) {
  const message = String(error?.message || error || "").toLowerCase();
  if (/quota|storage|disk|space/.test(message)) return localizedText("Espace de stockage insuffisant.", "Not enough storage space.", "No hay suficiente espacio de almacenamiento.");
  if (/security|csp|blocked|not allowed/.test(message)) return localizedText("Le navigateur a bloqué l'accès au fichier du modèle.", "The browser blocked access to a model file.", "El navegador bloqueó el acceso a un archivo del modelo.");
  if (/memory|buffer|device|gpu|out of memory/.test(message)) return localizedText("Mémoire graphique insuffisante.", "Not enough graphics memory.", "Memoria gráfica insuficiente.");
  if (/fetch|network|networkerror|timeout/.test(message)) return localizedText("Le téléchargement a été interrompu. Vérifiez votre connexion.", "The download was interrupted. Check your connection.", "La descarga se interrumpió. Comprueba tu conexión.");
  return localizedText("La cause exacte est indiquée dans la console du navigateur.", "The exact cause is available in the browser console.", "La causa exacta está disponible en la consola del navegador.");
}

async function getWebllmAppConfig(prebuiltAppConfig) {
  if (state.webllmAppConfig) return state.webllmAppConfig;
  const appConfig = {
    ...prebuiltAppConfig,
    model_list: prebuiltAppConfig.model_list.map(record => {
      const configuredOverrides = MODEL_CONFIG_OVERRIDES[record.model_id] || {};
      const overrides = { ...record.overrides, ...configuredOverrides };
      const contextWindowSize = overrides.context_window_size;
      const slidingWindowSize = overrides.sliding_window_size;
      if (contextWindowSize > 0 && slidingWindowSize > 0) overrides.sliding_window_size = -1;
      return Object.keys(overrides).length ? { ...record, overrides } : record;
    })
  };
  const modelUrl = new URL(SELF_HOSTED_MODEL_PATH, location.href).href;
  try {
    const status = await fetch(new URL(SELF_HOSTED_MODEL_STATUS, location.href), { cache: "no-store" });
    if (!status.ok || !(await status.json()).ready) {
      state.webllmAppConfig = appConfig;
      return state.webllmAppConfig;
    }
    const response = await fetch(`${modelUrl}ndarray-cache.json`, { method: "HEAD" });
    if (response.ok) {
      state.webllmAppConfig = {
        ...appConfig,
        model_list: appConfig.model_list.map(record => record.model_id === DEFAULT_MODEL_ID
          ? { ...record, model: modelUrl, model_lib: new URL(SELF_HOSTED_MODEL_LIB, location.href).href }
          : record)
      };
      return state.webllmAppConfig;
    }
  } catch (error) {
    console.warn("Self-hosted model check failed", error);
  }
  state.webllmAppConfig = appConfig;
  return state.webllmAppConfig;
}

function modelNeedsUnavailableFeature(model, features = state.gpuFeatures) {
  return Boolean(model?.requiresF16 && features && !features.has("shader-f16"));
}

/* Poids d'un modele en Mo, deduits du libelle ("~1.4 GB") ou de la taille reelle. */
function modelSizeMB(model) {
  if (!model) return 0;
  if (model.nativeBytes) return model.nativeBytes / (1024 * 1024);
  const match = String(model.size || "").match(/([\d]+(?:[.,]\d+)?)\s*(GB|MB)/i);
  if (!match) return 0;
  const value = Number(match[1].replace(",", "."));
  return /gb/i.test(match[2]) ? value * 1024 : value;
}

/* Le navigateur ne peut pas heberger les gros modeles : la banque web s'arrete
   sous 1,9 Go. La version desktop n'a pas cette limite. */
const WEB_MAX_MODEL_MB = 1900;
/* Page de presentation des versions de bureau, servie par le site. */
const DESKTOP_PAGE_URL = "https://app.zigmoon.com/SIMIA/desktop/";

function modelIsCompatible(model) {
  if (modelNeedsUnavailableFeature(model)) return false;
  if (!NATIVE && modelSizeMB(model) > WEB_MAX_MODEL_MB) return false;
  return true;
}

async function detectGpuLimit() {
  if (!navigator.gpu) return;
  try {
    const adapter = await navigator.gpu.requestAdapter();
    state.gpuFeatures = new Set(adapter?.features || []);
    populateModelList();
    renderModelLibrary();
  } catch (error) {
    console.warn("Unable to detect WebGPU limits", error);
  }
}

function textModelActive() {
  return NATIVE ? Boolean(state.loadedModelId) : Boolean(state.engine && state.useWebLLM);
}

function activateNativeModel() {
  const model = MODELS.find(candidate => candidate.id === state.selectedModel) || MODELS[0];
  if (!model) return;
  state.selectedModel = model.id;
  state.loadedModelId = model.id;
  state.cachedModelId = model.id;
  state.useWebLLM = true;
  saveState();
  ui.webllm.textContent = NATIVE ? localizedText("Modèle natif actif", "Native model active", "Modelo nativo activo") : copy[state.language].active;
  ui.webllm.disabled = true;
  setStatus(localizedText(`${model.name} actif`, `${model.name} active`, `${model.name} activo`));
  renderModeLabel();
  updateModelActivityUi();
  ui.downloadInfo.textContent = localizedText(
    "Modèle chargé en natif par SIMIA Desktop : aucune donnée envoyée.",
    "Model loaded natively by SIMIA Desktop: no data sent.",
    "Modelo cargado de forma nativa por SIMIA Desktop: sin envío de datos."
  );
}

/* Desktop : demande au lanceur de telecharger puis d'activer le modele. */
async function selectNativeModel(model) {
  const endpoint = new URL(NATIVE.selectUrl || "/_simia/select", location.href).href;
  const progressUrl = new URL("/_simia/progress", location.href).href;
  const needsDownload = !model.nativeLocal;
  setStatus(
    needsDownload
      ? localizedText(`Téléchargement de ${model.name}...`, `Downloading ${model.name}...`, `Descargando ${model.name}...`)
      : localizedText(`Chargement de ${model.name}...`, `Loading ${model.name}...`, `Cargando ${model.name}...`),
    "loading"
  );
  ui.webllm.disabled = true;

  let polling = true;
  const watch = (async () => {
    while (polling) {
      await new Promise(resolve => setTimeout(resolve, 700));
      try {
        const response = await fetch(progressUrl, { cache: "no-store" });
        const progress = await response.json();
        if (!progress.active) continue;
        if (progress.stage === "download" && progress.total > 0) {
          const percent = Math.min(99, Math.round((progress.downloaded / progress.total) * 100));
          setStatus(`${localizedText("Téléchargement", "Download", "Descarga")} ${percent}%`, "loading");
          ui.topbar.style.setProperty("--model-load-progress", `${percent}%`);
          ui.downloadInfo.textContent = localizedText(
            `${model.name} : ${percent}% (${formatBytes(progress.downloaded)} / ${formatBytes(progress.total)})`,
            `${model.name}: ${percent}% (${formatBytes(progress.downloaded)} / ${formatBytes(progress.total)})`,
            `${model.name}: ${percent}% (${formatBytes(progress.downloaded)} / ${formatBytes(progress.total)})`
          );
        } else if (progress.stage === "loading") {
          setStatus(localizedText(`Chargement de ${model.name}...`, `Loading ${model.name}...`, `Cargando ${model.name}...`), "loading");
        }
      } catch { /* le lanceur peut etre occupe */ }
    }
  })();

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: model.id })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    model.nativeLocal = true;
    activateNativeModel();
  } catch (error) {
    console.error(error);
    setStatus(copy[state.language].error, "error");
    ui.downloadInfo.textContent = localizedText(
      `Impossible d'activer ${model.name}. ${modelLoadFailureDetail(error)}`,
      `Could not activate ${model.name}. ${modelLoadFailureDetail(error)}`,
      `No se pudo activar ${model.name}. ${modelLoadFailureDetail(error)}`
    );
    activateNativeModel();
  } finally {
    polling = false;
    ui.topbar.style.setProperty("--model-load-progress", "0%");
    await watch.catch(() => {});
    ui.webllm.disabled = true;
  }
}

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(1)} GB`;
  if (value >= 1024 ** 2) return `${Math.round(value / 1024 ** 2)} MB`;
  return `${Math.round(value / 1024)} KB`;
}

/* Desktop : indique l'origine des modeles et signale une nouvelle version publiee. */
async function renderNativeStatus() {
  if (!NATIVE) return;
  try {
    const response = await fetch(new URL("/_simia/version", location.href).href, { cache: "no-store" });
    const info = await response.json();
    const local = MODELS.filter(model => model.nativeLocal).length;
    const parts = [
      localizedText(
        `${local} modèle(s) sur ce disque · ${info.server} hébergés sur le serveur`,
        `${local} model(s) on this disk · ${info.server} hosted on the server`,
        `${local} modelo(s) en este disco · ${info.server} alojados en el servidor`
      )
    ];
    if (info.remote?.reachable && info.remote.version) {
      const same = String(info.remote.version) === String(info.catalog);
      parts.push(
        same
          ? localizedText(`Catalogue à jour (v${info.catalog}).`, `Catalog up to date (v${info.catalog}).`, `Catálogo al día (v${info.catalog}).`)
          : localizedText(
              `Nouvelle version du catalogue sur le serveur : v${info.remote.version}${info.remote.published ? ` (${info.remote.published})` : ""}.`,
              `New catalog version on the server: v${info.remote.version}${info.remote.published ? ` (${info.remote.published})` : ""}.`,
              `Nueva versión del catálogo en el servidor: v${info.remote.version}${info.remote.published ? ` (${info.remote.published})` : ""}.`
            )
      );
      if (!same) document.querySelector("#native-version-banner")?.remove();
    }
    const target = ui.downloadInfo;
    if (target && !document.querySelector(".is-streaming")) target.textContent = parts.join(" ");
    if (info.remote?.reachable && String(info.remote.version) !== String(info.catalog)) {
      const banner = document.createElement("p");
      banner.id = "native-version-banner";
      banner.className = "native-version-banner";
      banner.textContent = localizedText(
        `Catalogue ${info.catalog} → ${info.remote.version} disponible sur ${info.base}`,
        `Catalog ${info.catalog} → ${info.remote.version} available on ${info.base}`,
        `Catálogo ${info.catalog} → ${info.remote.version} disponible en ${info.base}`
      );
      document.querySelector(".model-library-header")?.after(banner);
    }
  } catch { /* serveur local indisponible : pas bloquant */ }
}

async function loadWebLLM() {
  if (NATIVE) {
    activateNativeModel();
    return;
  }
  const selected = MODELS.find(candidate => candidate.id === state.selectedModel);
  if (selected?.engine === "transformers") {
    await loadVisionModel(selected);
    return;
  }
  if (state.loadingEngine || (state.engine && state.loadedModelId === state.selectedModel)) return;
  if (!navigator.gpu) {
    setStatus(copy[state.language].error, "error");
    ui.webllm.textContent = localizedText("WebGPU requis", "WebGPU required", "Se necesita WebGPU");
    ui.downloadInfo.textContent = localizedText("Utilisez une version récente de Chrome ou Edge avec WebGPU activé pour exécuter un modèle local.", "Use a recent Chrome or Edge version with WebGPU enabled to run a local model.", "Usa una versión reciente de Chrome o Edge con WebGPU activado para ejecutar un modelo local.");
    return;
  }
  const model = MODELS.find(candidate => candidate.id === state.selectedModel);
  let adapter;
  try {
    adapter = await navigator.gpu.requestAdapter();
  } catch (error) {
    console.warn("WebGPU adapter unavailable", error);
  }
  if (!adapter) {
    setStatus(copy[state.language].error, "error");
    ui.downloadInfo.textContent = localizedText("WebGPU n'est pas disponible dans ce navigateur. Utilisez Chrome ou Edge récent avec WebGPU activé.", "WebGPU is not available in this browser. Use a recent Chrome or Edge version with WebGPU enabled.", "WebGPU no está disponible en este navegador. Usa una versión reciente de Chrome o Edge con WebGPU activado.");
    return;
  }
  if (modelNeedsUnavailableFeature(model, adapter.features)) {
    await selectModelById(DEFAULT_MODEL_ID);
    setStatus(copy[state.language].error, "error");
    ui.downloadInfo.textContent = localizedText("Ce navigateur ne prend pas en charge la fonction WebGPU requise par ce modèle. Llama 3.2 1B est maintenant sélectionné.", "This browser does not support the WebGPU feature required by this model. Llama 3.2 1B is now selected.", "Este navegador no admite la función WebGPU requerida por este modelo. Llama 3.2 1B está seleccionado ahora.");
    return;
  }
  state.loadingEngine = true;
  ui.webllm.disabled = true;
  setStatus(copy[state.language].loading, "loading");
  try {
    const { CreateMLCEngine, prebuiltAppConfig } = await import("https://esm.run/@mlc-ai/web-llm");
    state.engine = await CreateMLCEngine(state.selectedModel, {
      appConfig: await getWebllmAppConfig(prebuiltAppConfig),
      initProgressCallback: progress => {
        const percent = Math.round((progress.progress || 0) * 100);
        setStatus(`${copy[state.language].loading} ${percent}%`, "loading");
        ui.topbar.style.setProperty("--model-load-progress", `${percent}%`);
        ui.downloadInfo.textContent = progress.text || `${copy[state.language].loading} ${percent}%`;
      }
    });
    state.useWebLLM = true;
    state.loadedModelId = state.selectedModel;
    state.cachedModelId = state.selectedModel;
    saveState();
    ui.webllm.textContent = copy[state.language].active;
    setStatus(localizedText(`${model.name} actif`, `${model.name} active`, `${model.name} activo`));
    renderModeLabel();
    updateModelActivityUi();
    ui.downloadInfo.textContent = localizedText("Modèle prêt. Il reste en cache dans ce navigateur pour les prochaines visites.", "Model ready. It stays cached in this browser for future visits.", "Modelo listo. Queda guardado en la caché de este navegador para las próximas aperturas.");
    ui.settings.hidden = true;
  } catch (error) {
    console.error(error);
    await clearModelResources(model?.id);
    const recoveryMessage = localizedText(
      `Le téléchargement de ${model?.name || "ce modèle"} a échoué. Le cache incomplet a été supprimé. ${modelLoadFailureDetail(error)} Vous pouvez réessayer.`,
      `Downloading ${model?.name || "this model"} failed. The incomplete cache was removed. ${modelLoadFailureDetail(error)} You can try again.`,
      `La descarga de ${model?.name || "este modelo"} falló. Se eliminó la caché incompleta. ${modelLoadFailureDetail(error)} Puedes intentarlo de nuevo.`
    );
    setStatus(copy[state.language].error, "error");
    ui.downloadInfo.textContent = recoveryMessage;
    toast(recoveryMessage);
    ui.webllm.disabled = false;
  } finally {
    state.loadingEngine = false;
  }
}

async function loadVisionModel(model) {
  if (state.loadingVision) return;
  if (state.visionPipeline && state.visionModelId === model.id) {
    state.useWebLLM = true;
    state.loadedModelId = model.id;
    state.cachedModelId = model.id;
    saveState();
    ui.webllm.textContent = copy[state.language].active;
    setStatus(localizedText(`${model.name} actif`, `${model.name} active`, `${model.name} activo`));
    renderModeLabel();
    updateModelActivityUi();
    return;
  }
  if (!navigator.gpu) {
    setStatus(copy[state.language].error, "error");
    ui.downloadInfo.textContent = localizedText("WebGPU est requis pour analyser des images. Utilisez Chrome ou Edge récent.", "WebGPU is required to analyze images. Use a recent Chrome or Edge.", "WebGPU es necesario para analizar imágenes. Usa una versión reciente de Chrome o Edge.");
    return;
  }
  state.loadingVision = true;
  state.loadingEngine = true;
  ui.webllm.disabled = true;
  setStatus(copy[state.language].loading, "loading");
  try {
    const transformers = await importTransformers();
    const progress = item => {
      const file = item?.file || item?.name || "";
      if (item?.status === "progress" || item?.progress != null) {
        const pct = item.progress ? Math.round(item.progress) : 0;
        setStatus(`${copy[state.language].loading} ${pct}%`, "loading");
        ui.topbar.style.setProperty("--model-load-progress", `${pct}%`);
      }
      if (file) ui.downloadInfo.textContent = file;
    };
    ui.downloadInfo.textContent = localizedText(`Téléchargement de ${model.name}...`, `Downloading ${model.name}...`, `Descargando ${model.name}...`);
    const [processor, pipeline] = await Promise.all([
      transformers.AutoProcessor.from_pretrained(model.id, { progress_callback: progress }),
      transformers.AutoModelForVision2Seq.from_pretrained(model.id, { dtype: "q4", device: "webgpu", progress_callback: progress })
    ]);
    state.visionProcessor = processor;
    state.visionPipeline = pipeline;
    state.visionModelId = model.id;
    state.useWebLLM = true;
    state.loadedModelId = model.id;
    state.cachedModelId = model.id;
    saveState();
    ui.webllm.textContent = copy[state.language].active;
    setStatus(localizedText(`${model.name} actif`, `${model.name} active`, `${model.name} activo`));
    renderModeLabel();
    updateModelActivityUi();
    ui.downloadInfo.textContent = localizedText("Modèle vision prêt. Il reste en cache pour les prochaines visites.", "Vision model ready. It stays cached for future visits.", "Modelo de visión listo. Queda en caché para futuras visitas.");
    ui.settings.hidden = true;
  } catch (error) {
    console.error(error);
    state.visionPipeline = null;
    state.visionProcessor = null;
    state.visionModelId = null;
    setStatus(copy[state.language].error, "error");
    ui.downloadInfo.textContent = `${localizedText(`Le chargement de ${model.name} a échoué.`, `Loading ${model.name} failed.`, `La carga de ${model.name} falló.`)} ${modelLoadFailureDetail(error)}`;
  } finally {
    state.loadingVision = false;
    state.loadingEngine = false;
    ui.webllm.disabled = false;
  }
}

/* Estimation volontairement prudente, alignee sur le budget de l'atelier : elle
 * evite un depassement de contexte, qui fait echouer llama-server comme WebLLM
 * au lieu de repondre. */
function estimateTokens(text) {
  return Math.ceil(String(text ?? "").length / CHARS_PER_TOKEN);
}

function messageTokens(message) {
  return estimateTokens(typeof message.content === "string" ? message.content : JSON.stringify(message.content));
}

/* Le message systeme et la question courante sont intouchables : on retire
 * d'abord les messages les plus anciens, puis on tronque le dernier en son
 * milieu si l'ensemble depasse encore la fenetre du modele. */
function trimMessagesToContext(messages) {
  const budget = PROMPT_TOKEN_BUDGET;
  const kept = messages.map(message => ({ ...message }));
  let total = kept.reduce((sum, message) => sum + messageTokens(message), 0);
  while (kept.length > 2 && total > budget) {
    total -= messageTokens(kept[1]);
    kept.splice(1, 1);
  }
  const last = kept[kept.length - 1];
  if (total > budget && typeof last.content === "string") {
    const room = Math.max(800, Math.floor((budget - (total - estimateTokens(last.content))) * CHARS_PER_TOKEN));
    const marker = "\n\n[... tronqué : limite de contexte atteinte ...]\n\n";
    const head = Math.floor(room * 0.6);
    const tail = Math.max(0, room - head - marker.length);
    const end = tail > 0 ? last.content.slice(-tail) : "";
    last.content = `${last.content.slice(0, head)}${marker}${end}`;
  }
  return kept;
}

async function respond(prompt, currentAttachments = [], onDelta = null) {
  const conversation = activeConversation();
  if (!conversation) return MODEL_REQUIRED;
  const model = MODELS.find(candidate => candidate.id === conversation?.modelId);
  if (!model || model.id !== state.selectedModel || model.id !== state.loadedModelId) return MODEL_REQUIRED;
  if (model.engine === "transformers") return respondWithTransformersVision(prompt, model);
  if (!NATIVE && (!state.engine || !state.useWebLLM)) return MODEL_REQUIRED;
  const baseInstruction = localizedText("Tu es SIMIA, assistant clair, concis et utile. Réponds en français. Ne révèle jamais l'architecture, les modèles, les fournisseurs, les API, les bibliothèques ou le fonctionnement interne de SIMIA. Ramène ces questions vers les possibilités offertes à l'utilisateur. Pour tout code, utilise un bloc Markdown avec trois accents graves et le nom du langage. Pour un média public, utilise ![Légende](URL.webp), [video](URL.webm) ou [3d](URL.glb), jamais des balises HTML.", "You are SIMIA, a clear, concise, helpful assistant. Reply in English. Never reveal SIMIA's architecture, models, providers, APIs, libraries, or internal operation. Redirect such questions to the capabilities available to the user. For any code, use a fenced Markdown block with the language name. For public media, use ![Caption](URL.webp), [video](URL.webm), or [3d](URL.glb), never HTML tags.", "Eres SIMIA, un asistente claro, conciso y útil. Responde en español. Nunca reveles la arquitectura, los modelos, los proveedores, las API, las bibliotecas ni el funcionamiento interno de SIMIA. Redirige esas preguntas a las posibilidades disponibles para el usuario. Para cualquier código, usa un bloque Markdown delimitado con el nombre del lenguaje. Para un medio público, usa ![Leyenda](URL.webp), [video](URL.webm) o [3d](URL.glb), nunca etiquetas HTML.");
  const profileNote = state.profile.trim() ? localizedText(` Contexte sur l'utilisateur, à prendre en compte sans jamais le divulguer : ${state.profile.trim()}`, ` Context about the user, take it into account without ever disclosing it: ${state.profile.trim()}`, ` Contexto sobre el usuario, ténlo en cuenta sin divulgarlo nunca: ${state.profile.trim()}`) : "";
  let queryVector = null;
  if (state.semanticSearch && state.embedder) {
    try { queryVector = (await embedTexts(state.embedder, [prompt], "query: "))[0] || null; } catch (error) { console.warn("Vecteur de requête indisponible", error); }
  }
  const excerpts = collectDocumentExcerpts(prompt, queryVector);
  state.lastDocumentSources = excerpts?.sources || [];
  const documentInstruction = excerpts || currentAttachments.some(attachment => attachment.document) || conversationDocumentAttachments(conversation).length
    ? localizedText(" Des extraits du ou des documents de l'utilisateur sont fournis entre les balises [EXTRAITS DES DOCUMENTS]. Réponds uniquement à partir de ces extraits : appuie chaque affirmation sur un extrait et cite-le sous la forme [E1], [E2] en indiquant la page. Si l'information ne figure pas dans les extraits, dis-le clairement au lieu d'inventer, et propose de reformuler la question.", " Excerpts from the user's document(s) are provided between the [EXTRAITS DES DOCUMENTS] tags. Answer only from those excerpts: support each statement with an excerpt and cite it as [E1], [E2] including the page. If the information is not in the excerpts, say so clearly instead of inventing, and offer to rephrase the question.", " Se proporcionan extractos del documento o documentos del usuario entre las etiquetas [EXTRAITS DES DOCUMENTS]. Responde solo a partir de esos extractos: apoya cada afirmación en un extracto y cítalo como [E1], [E2] indicando la página. Si la información no está en los extractos, dilo claramente en lugar de inventar y propón reformular la pregunta.")
    : "";
  const recentMessages = conversation.messages.slice(-6, -1);
  const messages = [{ role: "system", content: `${baseInstruction} ${model?.instruction || ""} ${conversation?.customModel?.instructions || ""}${documentInstruction}${profileNote}` }, ...recentMessages.map(message => {
    const content = `${message.content}${attachmentContext(message.attachments || [], true)}`;
    const images = isVisionModel() ? (message.attachments || []).filter(attachment => attachment.kind === "image" && attachment.dataUrl) : [];
    if (message.role === "user" && images.length) return { role: "user", content: [{ type: "text", text: content }, ...images.map(image => ({ type: "image_url", image_url: { url: image.dataUrl } }))] };
    return { role: message.role, content };
  }), { role: "user", content: `${prompt}${attachmentContext(currentAttachments)}${excerpts ? `\n\n[EXTRAITS DES DOCUMENTS]\n${excerpts.text}\n[FIN DES EXTRAITS]` : ""}` }];
  const prepared = trimMessagesToContext(messages);
  if (NATIVE) return nativeChat(prepared, onDelta);
  return webllmChat(prepared, onDelta);
}

async function webllmChat(messages, onDelta) {
  if (!onDelta) {
    const response = await state.engine.chat.completions.create({ messages, temperature: 0.7, max_tokens: CHAT_REPLY_TOKENS });
    return response.choices[0].message.content;
  }
  const stream = await state.engine.chat.completions.create({ messages, temperature: 0.7, max_tokens: CHAT_REPLY_TOKENS, stream: true });
  let text = "";
  for await (const chunk of stream) {
    const delta = chunk.choices?.[0]?.delta?.content || "";
    if (!delta) continue;
    text += delta;
    onDelta(text);
  }
  return text;
}

/* Desktop : llama-server expose une API compatible OpenAI sur l'origine locale. */
async function nativeChat(messages, onDelta) {
  const endpoint = new URL(NATIVE.chatUrl || "/v1/chat/completions", location.href).href;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages,
      temperature: 0.7,
      max_tokens: CHAT_REPLY_TOKENS,
      stream: Boolean(onDelta),
      chat_template_kwargs: { enable_thinking: false }
    })
  });
  if (!response.ok) throw new Error(`llama-server ${response.status}`);

  if (!onDelta || !response.body) {
    const payload = await response.json();
    const message = payload.choices?.[0]?.message || {};
    return message.content || message.reasoning_content || "";
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let reasoning = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newline;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).replace(/\r$/, "").trim();
      buffer = buffer.slice(newline + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      let payload;
      try { payload = JSON.parse(data); } catch { continue; }
      const delta = payload.choices?.[0]?.delta || {};
      if (delta.content) {
        text += delta.content;
        onDelta(text);
      } else if (delta.reasoning_content) {
        reasoning += delta.reasoning_content;
      }
    }
  }
  return text || reasoning;
}

const TRANSFORMERS_CDN = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0";

async function importTransformers() {
  return import(TRANSFORMERS_CDN);
}

async function respondWithTransformersVision(prompt, model) {
  const conversation = activeConversation();
  let images = [];
  for (let index = conversation.messages.length - 1; index >= 0; index -= 1) {
    const message = conversation.messages[index];
    if (message.role === "user") {
      images = (message.attachments || [])
        .filter(attachment => attachment.kind === "image" && attachment.dataUrl)
        .map(attachment => attachment.dataUrl);
      break;
    }
  }
  const instruction = model?.instruction || "Describe the visible content and answer the question.";

  if (!images.length && conversationDocumentAttachments(conversation).length) {
    return localizedText(
      "Ce modèle n'analyse que les images. Pour interroger un PDF, un Word, un Excel ou un RTF, choisissez un modèle dans l'onglet « Documents & PDF » de la bibliothèque, puis téléchargez-le : SIMIA lira le document et citera les pages.",
      "This model only analyzes images. To question a PDF, Word, Excel, or RTF file, pick a model in the \"Documents & PDF\" tab of the library, then download it: SIMIA will read the document and cite the pages.",
      "Este modelo solo analiza imágenes. Para consultar un PDF, Word, Excel o RTF, elige un modelo en la pestaña \"Documentos y PDF\" de la biblioteca y descárgalo: SIMIA leerá el documento y citará las páginas."
    );
  }

  if (!images.length) {
    return localizedText(
      "Ce modèle analyse les images que vous joignez (décrire, lire un texte, répondre sur une photo). Il ne génère pas d'images. Joignez une image pour que je puisse l'analyser, ou choisissez un modèle de conversation pour discuter.",
      "This model analyzes the images you attach (describe, read text, answer about a photo). It does not generate images. Attach an image for me to analyze, or choose a chat model to converse.",
      "Este modelo analiza las imágenes que adjuntas (describir, leer texto, responder sobre una foto). No genera imágenes. Adjunta una imagen para que la analice, o elige un modelo de conversación para conversar."
    );
  }

  if (!state.visionPipeline || state.visionModelId !== model.id) {
    const transformers = await importTransformers();
    const progress = item => {
      const file = item?.file || item?.name || "";
      if (item?.status === "progress" || item?.progress != null) {
        const pct = item.progress ? Math.round(item.progress) : 0;
        setStatus(`${copy[state.language].loading} ${pct}%`, "loading");
      }
      if (file) ui.downloadInfo.textContent = file;
    };
    state.loadingVision = true;
    setStatus(copy[state.language].loading, "loading");
    ui.downloadInfo.textContent = localizedText(`Téléchargement de ${model.name}...`, `Downloading ${model.name}...`, `Descargando ${model.name}...`);
    const [processor, pipeline] = await Promise.all([
      transformers.AutoProcessor.from_pretrained(model.id, { progress_callback: progress }),
      transformers.AutoModelForVision2Seq.from_pretrained(model.id, { dtype: "q4", device: "webgpu", progress_callback: progress })
    ]);
    state.visionProcessor = processor;
    state.visionPipeline = pipeline;
    state.visionModelId = model.id;
    state.loadingVision = false;
    setStatus(localizedText(`${model.name} actif`, `${model.name} active`, `${model.name} activo`));
    ui.downloadInfo.textContent = localizedText("Modèle vision prêt. Il reste en cache pour les prochaines visites.", "Vision model ready. It stays cached for future visits.", "Modelo de visión listo. Queda en caché para futuras visitas.");
  }

  const content = [];
  for (const src of images) content.push({ type: "image", image: src });
  content.push({ type: "text", text: `${instruction}\n\n${prompt}` });

  const messages = [{ role: "user", content }];
  const text = state.visionProcessor.apply_chat_template(messages, { add_generation_prompt: true });
  let inputs;
  if (images.length) {
    const transformers = await importTransformers();
    const rawImages = await Promise.all(images.map(src => transformers.load_image(src)));
    inputs = await state.visionProcessor(text, rawImages);
  } else {
    inputs = await state.visionProcessor(text);
  }
  const generated = await state.visionPipeline.generate({ ...inputs, max_new_tokens: 512, do_sample: false });
  const decoded = state.visionProcessor.batch_decode(generated, { skip_special_tokens: true })[0] || "";
  const markers = ["Assistant:", "assistant\n", "<|im_start|>assistant"];
  let answer = decoded;
  for (const marker of markers) {
    const index = decoded.lastIndexOf(marker);
    if (index !== -1) { answer = decoded.slice(index + marker.length); break; }
  }
  return answer.trim() || decoded.trim();
}

async function submitPrompt(rawPrompt) {
  const prompt = rawPrompt.trim();
  const attachments = [...state.pendingAttachments];
  if ((!prompt && !attachments.length) || state.loadingEngine) return;
  const messageContent = prompt || localizedText("Analysez les fichiers joints.", "Analyze the attached files.", "Analiza los archivos adjuntos.");
  if (state.view === "home" && activeConversation()?.messages.length) newConversation();
  showConversation();
  renderMessage("user", messageContent, true, attachments);
  addMessage("user", messageContent, attachments);
  /* Les documents envoyés restent interrogeables après un rechargement. */
  attachments.filter(attachment => attachment.document?.status === "ready").forEach(attachment => {
    attachment.document.restored = false;
    storeDocumentRecord(attachment, false);
  });
  clearPendingAttachments();
  ui.prompt.value = "";
  autoResize();
  saveDraft();
  ui.send.disabled = true;

  if (state.agentMode) {
    await runWebAgent(messageContent);
    ui.send.disabled = false;
    if (!state.voiceRequested) ui.voiceStatus.textContent = "";
    ui.prompt.focus();
    return;
  }

  const typing = createTyping();
  try {
    const visionActive = activeModelIsVision() && state.visionPipeline && state.visionModelId === state.selectedModel;
    const textActive = textModelActive();
    state.lastDocumentSources = [];
    const answering = visionActive || textActive;
    const stream = answering ? beginStreamingMessage(typing) : null;
    const answer = answering
      ? await respond(messageContent, attachments, delta => stream.update(delta))
      : MODEL_REQUIRED;
    if (stream) stream.finish(answer, state.lastDocumentSources);
    else { typing.remove(); renderMessage("assistant", answer); }
    addMessage("assistant", answer);
  } catch (error) {
    typing.remove();
    const message = localizedText("Je n'ai pas pu générer une réponse locale. Vérifiez WebGPU et la mémoire disponible.", "I could not generate a local reply. Check WebGPU and available memory.", "No se ha podido generar una respuesta local. Comprueba WebGPU y la memoria disponible.");
    renderMessage("assistant", message);
    addMessage("assistant", message);
    console.error(error);
  } finally {
    ui.send.disabled = false;
    if (!state.voiceRequested) ui.voiceStatus.textContent = "";
    ui.prompt.focus();
  }
}

function setAgentMode(active) {
  state.agentMode = Boolean(active);
  if (!ui.agentToggle) return;
  ui.agentToggle.setAttribute("aria-pressed", String(state.agentMode));
  ui.agentToggle.textContent = localizedText(state.agentMode ? "Agent actif" : "Agent web", state.agentMode ? "Agent on" : "Web agent", state.agentMode ? "Agente activo" : "Agente web");
  if (state.imageMode) return;
  ui.prompt.placeholder = state.agentMode
    ? localizedText("Recherchez : posez une question à l'agent...", "Search: ask the agent a question...", "Busca: haz una pregunta al agente...")
    : copy[state.language].placeholder;
}

function infoDialogText() {
  return state.language === "fr"
    ? {
        title: "Comment fonctionne SIMIA ?",
        modelsTitle: "1. Les modèles",
        models: "SIMIA exécute des modèles d'IA directement dans votre navigateur grâce à WebGPU. Choisissez un modèle, téléchargez-le une fois, puis il répond localement : rien n'est envoyé sur un serveur.",
        categoriesTitle: "2. Les types de modèles",
        categories: "Généraliste, code, maths et écriture pour discuter et créer ; Documents & PDF pour lire et questionner vos fichiers ; Vision (SmolVLM) pour analyser les images que vous joignez.",
        documentsTitle: "3. Vos documents, même les livres",
        documents: "Joignez un PDF, un Word, un Excel, un PowerPoint, un RTF, un OpenDocument, un EPUB ou un texte : <strong>il n'y a aucune limite de taille</strong>, même pour un livre de plusieurs centaines de pages. SIMIA extrait le texte dans votre navigateur, le découpe en passages et indexe tout en arrière-plan : vous pouvez écrire pendant l'indexation.<br><br><strong>Pour un livre volumineux, la méthode la plus efficace :</strong><br>1. Posez des questions précises (« Que dit l'auteur sur la confiance en soi au chapitre 4 ? »). L'index retrouve les bons passages et cite les pages.<br>2. Pour une vue d'ensemble, lancez « Résumer les documents » : SIMIA résume le livre partie par partie — chapitre par chapitre si le PDF contient une table des matières — puis fusionne le tout.<br>3. Pour aller plus loin, demandez un chapitre à la fois : les réponses sont alors beaucoup plus détaillées.<br><br>Un PDF scanné (image) doit d'abord être converti en texte (OCR).",
        agentTitle: "4. L'agent web",
        agent: "Activez « Agent web » pour poser une question : SIMIA recherche des pages publiques, les lit, puis résume la réponse avec ses sources. La recherche passe par un petit service sécurisé, la synthèse reste locale.",
        privacyTitle: "5. Vos données",
        privacy: "Les conversations, réglages et modèles restent dans ce navigateur. Vous pouvez les exporter ou tout purger à tout moment.",
        close: "Fermer"
      }
    : state.language === "ja"
      ? {
        title: "SIMIAの仕組み",
        modelsTitle: "1. モデル",
        models: "SIMIAはWebGPUを使って、AIモデルをお使いのブラウザで直接動かします。モデルを選んで一度ダウンロードすれば、あとは端末内で回答します。サーバーには何も送信されません。",
        categoriesTitle: "2. モデルの種類",
        categories: "会話や作成には汎用・コード・数学・文章。お手持ちのファイルを読んで質問するには文書・PDF。添付した画像を解析するには画像（SmolVLM）。",
        documentsTitle: "3. 文書、そして書籍も",
        documents: "PDF、Word、Excel、PowerPoint、RTF、OpenDocument、EPUB、テキストを添付できます。<strong>サイズ制限はありません</strong>。数百ページの書籍でも大丈夫です。SIMIAはブラウザ内でテキストを取り出し、箇所ごとに分けてバックグラウンドで索引化します。索引化の間も入力できます。<br><br><strong>大きな書籍に最も効果的な方法：</strong><br>1. 具体的に質問する（例：「第4章で著者は信頼について何と言っていますか」）。索引が該当箇所を探し、ページを引用します。<br>2. 全体像には「文書を要約」を使います。PDFに目次があれば章ごとに要約し、最後にまとめます。<br>3. さらに詳しくは章を一つずつ指定してください。回答がぐっと詳しくなります。<br><br>スキャンしたPDF（画像）は、先にテキスト化（OCR）が必要です。",
        agentTitle: "4. ウェブ検索",
        agent: "「ウェブ検索」をオンにして質問すると、SIMIAが公開ページを検索して読み、出典とともに回答をまとめます。検索は小さな安全なサービスを通りますが、要約は端末内で行われます。",
        privacyTitle: "5. あなたのデータ",
        privacy: "会話、設定、モデルはこのブラウザに残ります。いつでも書き出すか、すべて削除できます。",
        close: "閉じる"
      }
      : state.language === "es"
      ? {
        title: "¿Cómo funciona SIMIA?",
        modelsTitle: "1. Los modelos",
        models: "SIMIA ejecuta modelos de IA directamente en tu navegador mediante WebGPU. Elige un modelo, descárgalo una vez y responderá localmente: no se envía nada a un servidor.",
        categoriesTitle: "2. Tipos de modelos",
        categories: "General, código, matemáticas y escritura para conversar y crear; Documentos y PDF para leer y consultar tus archivos; Visión (SmolVLM) para analizar las imágenes que adjuntas.",
        documentsTitle: "3. Tus documentos, incluso libros",
        documents: "Adjunta un PDF, Word, Excel, PowerPoint, RTF, OpenDocument, EPUB o texto: <strong>no hay ningún límite de tamaño</strong>, ni siquiera para un libro de varios cientos de páginas. SIMIA extrae el texto en tu navegador, lo divide en pasajes y lo indexa en segundo plano: puedes seguir escribiendo durante la indexación.<br><br><strong>Para un libro voluminoso, el método más eficaz:</strong><br>1. Haz preguntas precisas («¿Qué dice el autor sobre la confianza en el capítulo 4?»). El índice localiza los pasajes útiles y cita las páginas.<br>2. Para una visión general, usa «Resumir los documentos»: SIMIA resume el libro parte por parte —capítulo a capítulo si el PDF tiene índice— y luego fusiona el todo.<br>3. Para profundizar, pide un capítulo cada vez: las respuestas serán mucho más detalladas.<br><br>Un PDF escaneado (imagen) debe convertirse antes a texto (OCR).",
        agentTitle: "4. El agente web",
        agent: "Activa « Agente web » para hacer una pregunta: SIMIA busca páginas públicas, las lee y resume la respuesta con sus fuentes. La búsqueda usa un pequeño servicio seguro; la síntesis sigue siendo local.",
        privacyTitle: "5. Tus datos",
        privacy: "Las conversaciones, ajustes y modelos se quedan en este navegador. Puedes exportarlos o borrarlo todo cuando quieras.",
        close: "Cerrar"
      }
      : {
        title: "How SIMIA works",
        modelsTitle: "1. Models",
        models: "SIMIA runs AI models directly in your browser via WebGPU. Pick a model, download it once, and it answers locally: nothing is sent to a server.",
        categoriesTitle: "2. Model types",
        categories: "General, code, math, and writing for chatting and creating; Documents & PDF to read and question your files; Vision (SmolVLM) for analyzing the images you attach.",
        documentsTitle: "3. Your documents, even books",
        documents: "Attach a PDF, Word, Excel, PowerPoint, RTF, OpenDocument, EPUB, or text file: <strong>there is no size limit</strong>, even for a book with hundreds of pages. SIMIA extracts the text in your browser, splits it into passages, and indexes everything in the background: you can keep writing while it indexes.<br><br><strong>For a long book, the most effective method:</strong><br>1. Ask precise questions (“What does the author say about trust in chapter 4?”). The index finds the right passages and cites the pages.<br>2. For an overview, use “Summarize the documents”: SIMIA summarizes the book part by part — chapter by chapter when the PDF has a table of contents — then merges everything.<br>3. To go deeper, ask for one chapter at a time: answers are then far more detailed.<br><br>A scanned (image) PDF must be converted to text (OCR) first.",
        agentTitle: "4. Web agent",
        agent: "Turn on “Web agent” to ask a question: SIMIA searches public pages, reads them, then summarizes the answer with sources. Search uses a small secure service; the summary stays local.",
        privacyTitle: "5. Your data",
        privacy: "Conversations, settings, and models stay in this browser. You can export them or purge everything at any time.",
        close: "Close"
      };
}

function renderInfoContent() {
  const text = infoDialogText();
  /* La section 5 (images) n'existe que dans l'application de bureau : la
   * section des donnees decale son numero en consequence. */
  const privacyTitle = IMAGE ? text.privacyTitle.replace(/^(\d+)\./, (_, n) => `${Number(n) + 1}.`) : text.privacyTitle;
  document.querySelector("#info-title").textContent = text.title;
  document.querySelector("#info-eyebrow").textContent = localizedText("COMMENT ÇA MARCHE", "HOW IT WORKS", "CÓMO FUNCIONA");
  document.querySelector("#info-close").setAttribute("aria-label", text.close);
  ui.infoContent.innerHTML =
    `<h3>${text.modelsTitle}</h3><p>${text.models}</p>` +
    `<h3>${text.categoriesTitle}</h3><p>${text.categories}</p>` +
    `<h3>${text.documentsTitle}</h3><p>${text.documents}</p>` +
    `<h3>${text.agentTitle}</h3><p>${text.agent}</p>` +
    (IMAGE
      ? `<h3>${localizedText("5. Les images", "5. Images", "5. Las imágenes", "5. 画像")}</h3><p>${localizedText(
          "Le bouton <strong>Image</strong> génère une illustration à partir d'une description, avec Z-Image-Turbo. Tout se passe sur votre carte graphique : aucune image ne quitte l'ordinateur. Le modèle d'image et le modèle de texte partagent le GPU, donc le texte cède la place le temps du calcul et revient à la question suivante.",
          "The <strong>Image</strong> button generates a picture from a description with Z-Image-Turbo. Everything runs on your graphics card: no image leaves the computer. The image and text models share the GPU, so text steps aside during a generation and returns on your next question.",
          "El botón <strong>Imagen</strong> genera una ilustración a partir de una descripción con Z-Image-Turbo. Todo ocurre en su tarjeta gráfica: ninguna imagen sale del ordenador. Los modelos de imagen y de texto comparten la GPU, así que el texto cede el paso durante el cálculo y vuelve en la siguiente pregunta.",
          "「画像」ボタンは Z-Image-Turbo で説明から絵を生成します。すべて GPU 上で完結し、画像が外部に送られることはありません。画像モデルとテキストモデルは GPU を共有するため、生成中はテキストが待機し、次の質問で復帰します。"
        )}</p>`
      : "") +
    `<h3>${privacyTitle}</h3><p>${text.privacy}</p>`;
}

const AGENT_RESULT_PREFIX = "__SIMIA_AGENT_RESULT__:";

function formatAgentResult(result) {
  const title = localizedText("Rapport de l'agent", "Agent report", "Informe del agente");
  const sourcesTitle = localizedText("Sources", "Sources", "Fuentes");
  const summaryTitle = localizedText("Synthèse", "Summary", "Resumen");
  const sources = (Array.isArray(result.sources) ? result.sources : []).slice(0, 6);
  const sourceCards = sources.map(source => {
    const url = safeLinkUrl(source.url || "");
    if (!url) return "";
    const host = (() => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; } })();
    return `<article class="web-result-card"><a class="web-result-title" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(source.title || host)}</a><p>${escapeHtml(String(source.text || "").replace(/\s+/g, " ").trim().slice(0, 260))}</p><span>${escapeHtml(host)}</span></article>`;
  }).join("");
  const summary = result.summary || localizedText("Aucune synthèse disponible.", "No summary available.", "No hay resumen disponible.");
  return `<section class="web-result"><p class="web-result-eyebrow">${escapeHtml(title)}</p><h3>${escapeHtml(result.query || "")}</h3>${summary ? `<p class="web-result-section-title">${escapeHtml(summaryTitle)}</p><div class="message-text">${formatMessageContent(String(summary))}</div>` : ""}${sourceCards ? `<p class="web-result-section-title">${escapeHtml(sourcesTitle)}</p><div class="web-result-list">${sourceCards}</div>` : ""}</section>`;
}

async function agentSearch(query) {
  const endpoint = new URL("./agent-api.php", location.href);
  endpoint.search = new URLSearchParams({ action: "search", q: query });
  const response = await fetch(endpoint, { cache: "no-store" });
  if (!response.ok) throw new Error(`Agent search failed: ${response.status}`);
  const payload = await response.json();
  return payload.success && Array.isArray(payload.results) ? payload.results : [];
}

async function agentFetch(url) {
  const endpoint = new URL("./agent-api.php", location.href);
  endpoint.search = new URLSearchParams({ action: "fetch", url });
  const response = await fetch(endpoint, { cache: "no-store" });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.success || !payload.text) throw new Error(payload?.error || `Agent fetch failed: ${response.status}`);
  return { title: payload.title || new URL(url).hostname, url: payload.url || url, text: String(payload.text).replace(/\s+/g, " ").trim().slice(0, 4000) };
}

function agentUnavailableMessage() {
  const isLocal = ["localhost", "127.0.0.1", "::1"].includes(location.hostname) || location.protocol === "file:";
  if (isLocal) {
    return localizedText(
      "L'agent web nécessite un serveur avec PHP. En local (fichier ouvert directement ou serveur statique), il ne peut pas fonctionner. Déployez SIMIA sur votre hébergement pour utiliser l'agent.",
      "The web agent requires a PHP-enabled server. It cannot run from a local static server or a file opened directly. Deploy SIMIA to your hosting to use the agent.",
      "El agente web necesita un servidor con PHP. No puede funcionar desde un servidor estático local o un archivo abierto directamente. Despliega SIMIA en tu hosting para usar el agente."
    );
  }
  return localizedText(
    "L'agent web n'est pas disponible (vérifiez que le fichier agent-api.php est bien déployé sur le serveur, puis rechargez).",
    "The web agent is unavailable (make sure agent-api.php is deployed on the server, then reload).",
    "El agente web no está disponible (comprueba que agent-api.php está desplegado en el servidor y recarga)."
  );
}

async function runWebAgent(objective) {
  const typing = createTyping();
  ui.send.disabled = true;
  ui.voiceStatus.textContent = localizedText("Recherche web en cours...", "Searching the web...", "Buscando en la web...");
  try {
    const results = await agentSearch(objective);
    if (!results.length) {
      typing.remove();
      const empty = localizedText("L'agent n'a trouvé aucune source publique. Essayez une formulation plus précise.", "The agent found no public sources. Try a more specific query.", "El agente no encontró fuentes públicas. Prueba una consulta más precisa.");
      renderMessage("assistant", empty);
      addMessage("assistant", empty);
      return;
    }

    // Lit les 3 premières pages avec une URL valide.
    const readable = results.filter(r => safeLinkUrl(r.url)).slice(0, 3);
    const pages = [];
    for (const r of readable) {
      ui.voiceStatus.textContent = localizedText(`Lecture de ${r.title || "une page"}...`, `Reading ${r.title || "a page"}...`, `Leyendo ${r.title || "una página"}...`);
      try {
        pages.push(await agentFetch(r.url));
      } catch (error) {
        console.warn("Agent page read failed", r.url, error);
      }
    }

    const evidence = pages.map((page, index) => `[${index + 1}] ${page.title}\nURL: ${page.url}\n${page.text.slice(0, 2200)}`).join("\n\n");
    const textActive = textModelActive();
    let summary = localizedText("L'agent a collecté des sources, mais aucun modèle de synthèse n'est chargé. Téléchargez un modèle pour obtenir une synthèse.", "The agent collected sources, but no synthesis model is loaded. Download a model to get a summary.", "El agente recopiló fuentes, pero no hay un modelo de síntesis cargado. Descarga un modelo para obtener un resumen.");

    if (textActive && evidence) {
      const synthesisPrompt = localizedText(
        `Objectif : ${objective}\n\nRédige une synthèse factuelle et concise à partir uniquement des pages ci-dessous. Utilise de courts paragraphes ou des puces. Chaque fait important doit citer sa page avec un lien Markdown comme [1](URL). Signale clairement les informations contradictoires ou absentes.\n\n${evidence}`,
        `Objective: ${objective}\n\nWrite a concise factual summary using only the pages below. Use short paragraphs or bullets. Cite each important fact with a Markdown link such as [1](URL). Clearly identify conflicting or missing information.\n\n${evidence}`,
        `Objetivo: ${objective}\n\nRedacta un resumen factual y conciso usando únicamente las páginas siguientes. Usa párrafos cortos o viñetas. Cita cada dato importante con un enlace Markdown como [1](URL). Indica claramente la información contradictoria o ausente.\n\n${evidence}`
      );
      try {
        const generated = await respond(synthesisPrompt);
        if (generated && generated !== MODEL_REQUIRED) summary = generated;
      } catch (error) {
        console.warn("Agent synthesis unavailable", error);
      }
    }

    const result = {
      query: objective,
      summary,
      sources: pages.length ? pages.map(({ title, url }) => ({ title, url })) : results.slice(0, 4)
    };
    typing.remove();
    const answer = `${AGENT_RESULT_PREFIX}${JSON.stringify(result)}`;
    renderMessage("assistant", answer);
    addMessage("assistant", answer);
  } catch (error) {
    typing.remove();
    const isNetworkError = /fetch|network|failed|refused/i.test(String(error?.message || error));
    const message = isNetworkError
      ? agentUnavailableMessage()
      : localizedText("L'agent n'a pas abouti. Vérifiez la connexion et réessayez.", "The agent did not complete. Check your connection and try again.", "El agente no se completó. Comprueba la conexión e inténtalo de nuevo.");
    renderMessage("assistant", message);
    addMessage("assistant", message);
    console.error(error);
  } finally {
    ui.send.disabled = false;
    ui.voiceStatus.textContent = "";
    ui.prompt.focus();
  }
}

function autoResize() {
  ui.prompt.style.height = "auto";
  ui.prompt.style.height = `${Math.min(ui.prompt.scrollHeight, 180)}px`;
  ui.charCount.textContent = `${ui.prompt.value.length} / 4000`;
}

/* Brouillon : le texte en cours d'écriture survit à un rechargement (mise à jour, fermeture). */
const DRAFT_KEY = "simia.draft";
let draftTimer = null;

function saveDraft() {
  try { sessionStorage.setItem(DRAFT_KEY, ui.prompt.value); } catch { /* stockage indisponible */ }
}

function scheduleDraftSave() {
  if (draftTimer) window.clearTimeout(draftTimer);
  draftTimer = window.setTimeout(saveDraft, 400);
}

function restoreDraft() {
  try {
    const draft = sessionStorage.getItem(DRAFT_KEY);
    if (!draft) return;
    sessionStorage.removeItem(DRAFT_KEY);
    ui.prompt.value = draft;
  } catch { /* stockage indisponible */ }
}

function clearChat() {
  const conversation = activeConversation();
  if (!conversation) return;
  releaseAttachmentPreviews(conversation.messages);
  conversation.messages = [];
  conversation.title = localizedText("Nouvelle conversation", "New conversation", "Nueva conversación");
  conversation.updatedAt = new Date().toISOString();
  saveState();
  renderConversationList();
  showHome();
}

function deleteConversation(conversationId) {
  const conversation = state.conversations.find(item => item.id === conversationId);
  if (!conversation) return;
  const confirmed = window.confirm(localizedText("Supprimer définitivement cette conversation ?", "Permanently delete this conversation?", "¿Eliminar esta conversación definitivamente?"));
  if (!confirmed) return;
  const deletedActiveConversation = conversation.id === state.activeConversationId;
  releaseAttachmentPreviews(conversation.messages);
  removeDocumentRecords(conversation.messages.flatMap(message => (message.attachments || []).filter(attachment => attachment.document).map(attachment => attachment.id)));
  state.conversations = state.conversations.filter(item => item.id !== conversation.id);
  if (!state.conversations.length) {
    newConversation();
    return;
  }
  if (deletedActiveConversation) state.activeConversationId = state.conversations[0].id;
  saveState();
  renderConversationList();
  if (deletedActiveConversation) showHome();
}

function openLanguageMenu() {
  if (!ui.languageMenu) return;
  closeAppMenu();
  ui.languageMenu.hidden = false;
  ui.language.setAttribute("aria-expanded", "true");
}

function closeLanguageMenu() {
  if (!ui.languageMenu || ui.languageMenu.hidden) return;
  ui.languageMenu.hidden = true;
  ui.language.setAttribute("aria-expanded", "false");
}

function toggleLanguageMenu() {
  if (ui.languageMenu?.hidden) openLanguageMenu();
  else closeLanguageMenu();
}

/* Menu compact affiché uniquement sur mobile, là où la barre latérale est masquée. */
function openAppMenu() {
  if (!ui.appMenu) return;
  closeLanguageMenu();
  ui.appMenu.hidden = false;
  ui.appMenuToggle.setAttribute("aria-expanded", "true");
}

function closeAppMenu() {
  if (!ui.appMenu || ui.appMenu.hidden) return;
  ui.appMenu.hidden = true;
  ui.appMenuToggle.setAttribute("aria-expanded", "false");
}

function toggleAppMenu() {
  if (ui.appMenu?.hidden) openAppMenu();
  else closeAppMenu();
}

function setLanguage(code) {
  if (!["fr", "en", "es", "ja"].includes(code)) return;
  closeLanguageMenu();
  if (code === state.language) return;
  state.language = code;
  applyLanguage();
  saveState();
}

function applyLanguage() {
  const text = copy[state.language];
  document.documentElement.lang = state.language;
  document.title = localizedText("SIMIA - Assistant local", "SIMIA - Local assistant", "SIMIA - Asistente local");
  if (ui.languageCurrent) ui.languageCurrent.textContent = state.language.toUpperCase();
  closeLanguageMenu();
  if (ui.languageMenu) {
    ui.languageMenu.querySelectorAll("[data-language]").forEach(node => {
      node.setAttribute("aria-checked", node.dataset.language === state.language ? "true" : "false");
    });
  }
  ui.language.setAttribute("aria-label", localizedText("Changer de langue", "Switch language", "Cambiar idioma", "言語を切り替える"));
  if (ui.appMenuToggle) {
    ui.appMenuToggle.setAttribute("aria-label", localizedText("Menu", "Menu", "Menú", "メニュー"));
    ui.appMenuSettings.textContent = text.settings;
    ui.appMenuInfo.textContent = localizedText("Information", "Information", "Información");
    ui.appMenuExport.textContent = text.export;
    ui.appMenuLegal.textContent = text.legal;
    ui.appMenuPurge.textContent = text.purge;
  }
  ui.prompt.placeholder = text.placeholder;
  ui.prompt.setAttribute("aria-label", localizedText("Votre message", "Your message", "Tu mensaje"));
  renderModeLabel();
  document.querySelector("#welcome-title").textContent = text.welcomeTitle;
  document.querySelector("#welcome-copy").textContent = text.welcomeCopy;
  document.querySelector("#home-model-button").textContent = text.welcomeModel;
  document.querySelector("#welcome-setup").textContent = text.welcomeSetup;
  ui.autoLoadModel.checked = state.autoLoadModel;
  document.querySelector("#auto-load-model-label").textContent = text.autoLoadModel;
  document.querySelector("#disclaimer").textContent = text.disclaimer;
  document.querySelector("#new-chat").textContent = text.newChat;
  document.querySelector(".section-label").textContent = text.today;
  document.querySelector("#settings-toggle").textContent = text.settings;
    document.querySelector("#settings-heading").textContent = text.settings.toUpperCase();
  ui.exportToggle.textContent = text.export;
  ui.purgeToggle.textContent = text.purge;
  if (ui.infoToggle) ui.infoToggle.textContent = localizedText("Information", "Information", "Información");
  document.querySelector(".local-note").textContent = text.localNote;
  document.querySelector("[data-i18n='personalAssistant']").textContent = text.personalAssistant;
  document.querySelector("[data-i18n='localModel']").textContent = text.localModel;
  document.querySelector("[data-i18n='chooseModel']").textContent = text.chooseModel;
  ui.webllm.textContent = NATIVE
    ? localizedText("Modèle natif actif", "Native model active", "Modelo nativo activo", "ネイティブモデル有効")
    : state.useWebLLM ? text.active : text.download;
  ui.exportSettings.textContent = text.exportSettings;
  ui.exportConversations.textContent = text.exportConversations;
  document.querySelector("#export-title").textContent = text.exportTitle;
  document.querySelector("#export-copy").textContent = text.exportCopy;
  document.querySelector("#export-eyebrow").textContent = text.exportEyebrow;
  document.querySelector("#export-section-save").textContent = text.exportSectionSave;
  document.querySelector("#export-section-import").textContent = text.exportSectionImport;
  document.querySelector("#export-import-hint").textContent = text.exportImportHint;
  ui.exportFull.textContent = text.exportFull;
  ui.importBackup.textContent = text.importBackup;
  ui.exportMarkdown.textContent = text.exportMarkdown;
  ui.exportToggle.setAttribute("title", text.export);
  ui.exportToggle.setAttribute("aria-label", text.export);
  document.querySelector("#profile-label").textContent = localizedText("À propos de moi (optionnel)", "About me (optional)", "Sobre mí (opcional)");
  ui.profileInput.placeholder = localizedText("Prénom, langue, ton préféré, contexte...", "Name, language, preferred tone, context...", "Nombre, idioma, tono preferido, contexto...");
  ui.profileInput.value = state.profile;
  ui.modelRecommend.textContent = localizedText("M'aider à choisir", "Help me choose", "Ayúdame a elegir");
  document.querySelector("#export-close").setAttribute("aria-label", localizedText("Fermer", "Close", "Cerrar"));
  if (!state.loadingEngine && !state.useWebLLM) ui.downloadInfo.textContent = text.downloadHint;
  document.querySelector("#legal-toggle").textContent = text.legal;
  ui.home.setAttribute("aria-label", localizedText("Retour à l'accueil", "Back to home", "Volver al inicio"));
  ui.home.setAttribute("title", localizedText("Retour à l'accueil", "Back to home", "Volver al inicio"));
  document.querySelector("#send-button").childNodes[0].textContent = `${text.send} `;
  document.querySelector("#clear-chat").setAttribute("aria-label", text.clear);
  document.querySelector("#clear-chat").setAttribute("title", text.clear);
  ui.attach.setAttribute("aria-label", text.attach);
  ui.attach.setAttribute("title", text.attach);
  state.documentStatus = "";
  document.querySelector("#document-tools-title").textContent = localizedText("DOCUMENTS", "DOCUMENTS", "DOCUMENTOS");
  ui.documentSummary.textContent = localizedText("Résumer les documents", "Summarize the documents", "Resumir los documentos");
  ui.documentExport.textContent = localizedText("Texte extrait", "Extracted text", "Texto extraído");
  ui.documentSemantic.textContent = state.semanticSearch
    ? localizedText("Recherche sémantique active", "Semantic search on", "Búsqueda semántica activa", "意味検索：オン")
    : localizedText("Recherche sémantique", "Semantic search", "Búsqueda semántica", "意味検索");
  renderDocumentTools();
  renderPendingAttachments();
  if (!state.voiceRequested) updateVoiceUi(ui.voice.disabled ? text.voiceUnavailable : "");
  if (state.recognition) state.recognition.lang = voiceLanguage();
  document.querySelector("#legal-title").textContent = text.legalTitle;
  document.querySelector("#legal-eyebrow").textContent = text.legalEyebrow;
  ui.legalContent.innerHTML = text.legalContent;
  ui.model.setAttribute("aria-label", text.chooseModel);
  document.querySelector("#custom-model-close").setAttribute("aria-label", localizedText("Fermer", "Close", "Cerrar"));
  ui.customModelToggle.textContent = localizedText("Mon modèle", "My model", "Mi modelo");
  ui.customModelSettingsToggle.textContent = localizedText("Mon modèle", "My model", "Mi modelo");
  ui.modelFilters.setAttribute("aria-label", localizedText("Filtrer les modèles", "Filter models", "Filtrar modelos"));
  document.querySelector("#settings-close").setAttribute("aria-label", localizedText("Fermer les paramètres", "Close settings", "Cerrar los ajustes"));
  document.querySelector("#settings-close").setAttribute("title", localizedText("Fermer les paramètres", "Close settings", "Cerrar los ajustes"));
  document.querySelector("#info-close").setAttribute("aria-label", localizedText("Fermer", "Close", "Cerrar"));
  document.querySelector("#legal-close").setAttribute("aria-label", localizedText("Fermer", "Close", "Cerrar"));
  ui.send.setAttribute("aria-label", text.send);
  ui.send.setAttribute("title", text.send);
  const welcomeSteps = state.language === "fr"
    ? ["L'IA tourne dans votre navigateur", "Aucune donnée n'est envoyée", "Vos conversations restent ici"]
    : state.language === "es"
      ? ["La IA se ejecuta en tu navegador", "No se envía ningún dato", "Tus conversaciones se quedan aquí"]
      : state.language === "ja"
        ? ["AIはブラウザ内で動作", "データは一切送信されない", "会話はここに残る"]
        : ["The AI runs in your browser", "No data is sent anywhere", "Your conversations stay here"];
  document.querySelectorAll(".welcome-steps span").forEach((node, index) => { if (welcomeSteps[index]) node.textContent = welcomeSteps[index]; });
  document.querySelector(".welcome-steps").setAttribute("aria-label", localizedText("Les trois points clés de SIMIA", "SIMIA's three key points", "Los tres puntos clave de SIMIA", "SIMIAの3つのポイント"));
  renderInfoContent();
  setAgentMode(state.agentMode);
  if (ui.imageToggle) {
    ui.imageToggle.hidden = !imageUsable();
    ui.imageToggle.textContent = localizedText("Image", "Image", "Imagen", "画像");
    ui.imageToggle.setAttribute("aria-pressed", String(state.imageMode));
    ui.imageToggle.title = localizedText(
      "Générer une image (application de bureau)",
      "Generate an image (desktop app)",
      "Generar una imagen (aplicación de escritorio)",
      "画像を生成（デスクトップアプリ）"
    );
    if (state.imageMode) setImageMode(true);
  }
  renderImageEngineUi();
  renderCustomModelText();
  renderCustomModelPreview();
  renderCustomModelStatus();
  renderCustomModelSaveLabel();
  /* Les conversations encore vierges reprennent le titre par défaut de la langue choisie. */
  const defaultTitles = ["Nouvelle conversation", "New conversation", "Nueva conversación", "新しい会話"];
  state.conversations.forEach(conversation => {
    if (defaultTitles.includes(conversation.title)) conversation.title = localizedText("Nouvelle conversation", "New conversation", "Nueva conversación");
  });
  renderConversationList();
  populateModelList();
  renderModelLibrary();
  updateModelActivityUi();
  /* Les messages portent des libelles traduits : on les redessine, sauf pendant le streaming. */
  if (!document.querySelector(".is-streaming")) renderActiveConversation();
  renderCodeWorkspaceText();
  setStatus(text.ready);
}

function populateModelList() {
  ui.model.replaceChildren(...MODELS.map(model => {
    const details = modelDetails(model);
    const option = document.createElement("option");
    option.value = model.id;
    option.textContent = `${details[0]} | ${model.name} - ${model.size}`;
    option.disabled = !modelIsCompatible(model);
    return option;
  }));
  ui.model.value = state.selectedModel;
  updateModelInfo();
}

function updateModelInfo() {
  const model = MODELS.find(candidate => candidate.id === state.selectedModel);
  if (!model) return;
  const details = modelDetails(model);
  const downloadLabel = localizedText("Téléchargement", "Download", "Descarga");
  const profile = state.customModelActive ? state.customModel : null;
  ui.modelInfo.textContent = profile
    ? localizedText(`« ${profile.name} » : vos consignes permanentes sont ajoutées à ${model.name} (${model.size}). Retrouvez-les avec le bouton « Mon modèle ».`, `“${profile.name}”: your permanent instructions are added to ${model.name} (${model.size}). Edit them with the “My model” button.`, `«${profile.name}»: tus instrucciones permanentes se añaden a ${model.name} (${model.size}). Edítalas con el botón «Mi modelo».`)
    : `${details[0]}: ${details[1]} ${downloadLabel}: ${model.size}.`;
  ui.modelPicker.querySelector("#model-picker-name").textContent = profile ? profile.name : model.name;
  ui.modelPicker.querySelector("#model-picker-meta").textContent = profile
    ? localizedText(`MODÈLE PERSO · base ${model.name}`, `PERSONAL MODEL · base ${model.name}`, `MODELO PERSONAL · base ${model.name}`)
    : `${details[0]} · ${model.size}`;
}

async function selectModel() {
  await selectModelById(ui.model.value);
}

async function clearModelResources(modelId) {
  try {
    await releaseActiveEngine();
    if (modelId && !MODELS.find(model => model.id === modelId)?.engine) {
      const { deleteModelAllInfoInCache, prebuiltAppConfig } = await import("https://esm.run/@mlc-ai/web-llm");
      await deleteModelAllInfoInCache(modelId, await getWebllmAppConfig(prebuiltAppConfig));
    }
  } catch (error) {
    console.warn("Unable to clear previous model resources", error);
  } finally {
    state.engine = null;
    state.useWebLLM = false;
    state.loadedModelId = null;
  }
}

async function releaseActiveEngine() {
  try {
    await state.engine?.unload?.();
  } catch (error) {
    console.warn("Unable to release the active model", error);
  } finally {
    state.engine = null;
    state.visionPipeline = null;
    state.visionProcessor = null;
    state.visionModelId = null;
    state.useWebLLM = false;
    state.loadedModelId = null;
  }
}

async function selectModelById(modelId, customModel = false) {
  const nextModel = MODELS.find(model => model.id === modelId);
  if (!nextModel || !modelIsCompatible(nextModel)) return;
  if (modelId === state.selectedModel && state.customModelActive === customModel) return;
  ui.webllm.disabled = true;
  ui.downloadInfo.textContent = localizedText("Libération du modèle actif...", "Releasing the active model...", "Liberando el modelo activo...");
  await releaseActiveEngine();
  state.selectedModel = modelId;
  state.customModelActive = customModel;
  const conversation = activeConversation();
  if (conversation?.messages.length) newConversation();
  else if (conversation) conversation.modelId = modelId;
  ui.model.value = modelId;
  ui.webllm.disabled = false;
  ui.webllm.textContent = copy[state.language].activate;
  renderModeLabel();
  if (NATIVE) {
    ui.model.value = modelId;
    ui.webllm.disabled = false;
    renderModeLabel();
    updateModelInfo();
    ui.downloadInfo.textContent = NATIVE && !nextModel.nativeLocal
      ? localizedText(`${nextModel.name} n'est pas encore sur ce disque : SIMIA le téléchargera une seule fois.`, `${nextModel.name} is not on this disk yet: SIMIA will download it once.`, `${nextModel.name} aún no está en este disco: SIMIA lo descargará una sola vez.`)
      : "";
    await selectNativeModel(nextModel);
    renderActiveConversation();
    saveState();
    return;
  }
  if (nextModel.engine === "transformers") {
    ui.downloadInfo.textContent = localizedText("Modèle vision sélectionné. Cliquez sur Télécharger le modèle pour analyser des images dans le navigateur.", "Vision model selected. Click Download model to analyze images in the browser.", "Modelo de visión seleccionado. Haz clic en Descargar modelo para analizar imágenes en el navegador.");
  } else {
    ui.downloadInfo.textContent = localizedText("Modèle sélectionné. Les modèles déjà téléchargés restent disponibles dans le cache. Cliquez sur Télécharger le modèle pour l'activer.", "Model selected. Downloaded models remain available in the cache. Click Download model to activate it.", "Modelo seleccionado. Los modelos descargados siguen disponibles en la caché. Haz clic en Descargar modelo para activarlo.");
  }
  updateModelInfo();
  if (NATIVE) activateNativeModel();
  renderActiveConversation();
  saveState();
}

function renderModelLibrary() {
  const text = modelLibraryText();
  document.querySelector("#model-library-eyebrow").textContent = text.eyebrow;
  document.querySelector("#model-library-title").textContent = text.title;
  const intro = state.modelAdvice || text.intro;
  document.querySelector("#model-library-intro").textContent = NATIVE
    ? `${intro} ${text.split}`
    : `${intro} ${text.webLimit}`;
  document.querySelector("#model-library-close").setAttribute("aria-label", text.close);
  const filters = [["all", text.all], ["general", text.general], ["documents", text.documents], ["writing", text.writing], ["code", text.code], ["reasoning", text.reasoning], ["vision", text.vision]];
  if (IMAGE) filters.push(["image", localizedText("Image", "Image", "Imagen", "画像生成")]);
  ui.modelFilters.replaceChildren(...filters.map(([id, label]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.dataset.modelFilter = id;
    button.className = id === state.modelFilter ? "active" : "";
    button.setAttribute("role", "tab");
    button.setAttribute("aria-selected", String(id === state.modelFilter));
    return button;
  }));
  const visibleModels = MODELS.filter(model => modelIsCompatible(model) && modelMatchesFilter(model)).sort((first, second) => Number(Boolean(second.recommended)) - Number(Boolean(first.recommended)));
  const showImage = Boolean(IMAGE) && (state.modelFilter === "all" || state.modelFilter === "image");
  const recommendedLabel = localizedText("RECOMMANDÉ", "RECOMMENDED", "RECOMENDADO");
  const customCards = [];
  if (state.customModelActive && state.customModel) {
    const custom = customModelText();
    const base = MODELS.find(model => model.id === state.customModel.baseModelId);
    const card = document.createElement("article");
    card.className = "model-card custom selected";
    card.innerHTML = `<div class="model-card-head"><p class="model-category">${escapeHtml(custom.libraryCategory)}</p><span class="model-badge">${escapeHtml(localizedText("ACTIF", "ACTIVE", "ACTIVO"))}</span></div><div><h3>${escapeHtml(state.customModel.name)}</h3><p>${escapeHtml(custom.libraryDescription(base?.name || state.customModel.baseModelId, state.customModel.instructions.length))}</p></div><div class="model-card-footer"><span>${escapeHtml(base?.size || "")}</span><button type="button" data-custom-model="edit">${escapeHtml(localizedText("Modifier", "Edit", "Modificar"))}</button></div>`;
    customCards.push(card);
  }
  const imageCards = !showImage ? [] : state.imagePacks.map(pack => {
    const active = pack.id === state.imagePackId;
    const ready = Boolean(pack.local);
    const size = `${pack.bytes ? `~${(pack.bytes / (1024 * 1024 * 1024)).toFixed(2)} GB` : pack.size} · ${pack.px}px/${pack.steps} ${localizedText("pas", "steps", "pasos", "ステップ")}`;
    const card = document.createElement("article");
    card.className = `model-card image-card${active ? " selected" : ""}${ready ? "" : " remote"}${pack.recommended ? " recommended" : ""}`;
    const badge = !ready
      ? pack.downloadable
        ? `<span class="model-badge model-badge-download">${escapeHtml(localizedText("À TÉLÉCHARGER", "TO DOWNLOAD", "PARA DESCARGAR", "要ダウンロード"))}</span>`
        : `<span class="model-badge model-badge-download">${escapeHtml(localizedText("MANUEL", "MANUAL", "MANUAL", "手動"))}</span>`
      : pack.recommended
        ? `<span class="model-badge">${escapeHtml(localizedText("RECOMMANDÉ", "RECOMMENDED", "RECOMENDADO", "おすすめ"))}</span>`
        : `<span class="model-origin model-origin-local">${escapeHtml(localizedText("SUR LE DISQUE", "ON DISK", "EN EL DISCO", "ローカル"))}</span>`;
    const action = ready
      ? `<button type="button" data-image-pack="${escapeHtml(pack.id)}"${active ? " disabled" : ""}>${escapeHtml(active ? localizedText("Image active", "Image active", "Imagen activa", "画像 有効") : localizedText("Utiliser", "Use", "Usar", "使う"))}</button>`
      : pack.downloadable
        ? `<button type="button" data-image-pack-download="${escapeHtml(pack.id)}">${escapeHtml(localizedText("Télécharger", "Download", "Descargar", "ダウンロード"))}</button>`
        : `<button type="button" disabled>${escapeHtml(localizedText("Fichiers à placer", "Files required", "Faltan archivos", "ファイル未配置"))}</button>`;
    const styleTag = pack.lora
      ? `<span class="model-origin model-origin-style">${escapeHtml(localizedText("STYLE SIMIA", "SIMIA STYLE", "ESTILO SIMIA", "SIMIA スタイル"))}</span>`
      : "";
    card.innerHTML = `<div class="model-card-head"><p class="model-category">${escapeHtml(localizedText("IMAGE", "IMAGE", "IMAGEN", "画像"))}</p>${badge}</div><div><h3>${escapeHtml(pack.name)}</h3><p>${escapeHtml(pack.note || "")}</p></div><div class="model-card-footer"><span>${escapeHtml(size)}${pack.license ? ` · ${escapeHtml(pack.license)}` : ""}${styleTag}</span>${action}</div>`;
    return card;
  });
  const oversized = NATIVE ? [] : MODELS.filter(model => !modelNeedsUnavailableFeature(model) && modelSizeMB(model) > WEB_MAX_MODEL_MB);
  const desktopCard = !oversized.length || state.modelFilter !== "all"
    ? []
    : [(() => {
        const card = document.createElement("article");
        card.className = "model-card desktop-only-card";
        card.innerHTML = `<div class="model-card-head"><p class="model-category">${escapeHtml(localizedText("HORS LIGNE", "OFFLINE", "SIN CONEXIÓN", "オフライン"))}</p><span class="model-badge model-badge-download">${escapeHtml(localizedText("DESKTOP", "DESKTOP", "DESKTOP", "デスクトップ"))}</span></div><div><h3>${escapeHtml(localizedText("Version desktop", "Desktop version", "Versión de escritorio", "デスクトップ版"))}</h3><p>${escapeHtml(localizedText(`${oversized.length} modèles supplémentaires vous attendent sur PC, Mac et Linux : jusqu'à 9,7 Go, sans limite de navigateur, avec la génération d'images.`, `${oversized.length} more models wait on PC, Mac and Linux: up to 9.7 GB, no browser limit, with image generation.`, `${oversized.length} modelos más te esperan en PC, Mac y Linux: hasta 9,7 GB, sin límite del navegador y con generación de imágenes.`, `PC・Mac・Linux 版では ${oversized.length} 個の追加モデル（最大 9.7GB、ブラウザ制限なし、画像生成対応）が使えます。`))}</p></div><div class="model-card-footer"><span>${escapeHtml(localizedText("Sans téléversement", "Nothing uploaded", "Sin subir nada", "アップロードなし"))}</span><a class="model-card-link" href="${DESKTOP_PAGE_URL}" target="_blank" rel="noopener">${escapeHtml(localizedText("Télécharger", "Download", "Descargar", "ダウンロード"))}</a></div>`;
        return card;
      })()];
  ui.modelCards.replaceChildren(...imageCards, ...customCards, ...visibleModels.map(model => {
    const details = modelDetails(model);
    const active = model.id === state.selectedModel && !state.customModelActive;
    const remote = NATIVE && model.nativeLocal === false;
    const origin = NATIVE && remote
      ? model.nativeHosted
        ? `<span class="model-origin model-origin-server">${escapeHtml(localizedText("SERVEUR", "SERVER", "SERVIDOR", "サーバー"))}</span>`
        : `<span class="model-origin model-origin-cdn">${escapeHtml(localizedText("CDN", "CDN", "CDN", "CDN"))}</span>`
      : NATIVE
        ? `<span class="model-origin model-origin-local">${escapeHtml(localizedText("LOCAL", "LOCAL", "LOCAL", "ローカル"))}</span>`
        : "";
    const badge = model.recommended && !remote ? `<span class="model-badge">${escapeHtml(recommendedLabel)}</span>` : remote ? `<span class="model-badge model-badge-download">${escapeHtml(localizedText("À TÉLÉCHARGER", "TO DOWNLOAD", "PARA DESCARGAR", "要ダウンロード"))}</span>` : "";
    const note = state.cachedModelId === model.id ? ` <span class="model-card-note">${escapeHtml(text.stored)}</span>` : "";
    const card = document.createElement("article");
    card.className = `model-card${active ? " selected" : ""}${model.recommended ? " recommended" : ""}${remote ? " remote" : ""}`;
    card.innerHTML = `<div class="model-card-head"><p class="model-category">${escapeHtml(details[0])}</p>${badge}</div><div><h3>${escapeHtml(model.name)}</h3><p>${escapeHtml(details[1])}</p></div><div class="model-card-footer"><span>${escapeHtml(model.size)}${origin}${note}</span><button type="button" data-model-id="${escapeHtml(model.id)}">${escapeHtml(active ? text.selected : remote ? localizedText("Télécharger", "Download", "Descargar", "ダウンロード") : text.choose)}</button></div>`;
    return card;
  }), ...desktopCard);
  if (!customCards.length && !visibleModels.length && !imageCards.length && !desktopCard.length) {
    const empty = document.createElement("p");
    empty.className = "model-cards-empty";
    empty.textContent = text.empty;
    ui.modelCards.append(empty);
  }
}

function openModelLibrary(filter = "all") {
  state.modelFilter = filter;
  state.modelAdvice = "";
  dismissCookieBanner();
  renderModelLibrary();
  ui.modelLibrary.showModal();
}

function customModelText() {
  return state.language === "fr" ? {
    eyebrow: "MON MODÈLE",
    title: "Créer mon modèle",
    intro: "Un modèle personnel, c'est un nom et des consignes permanentes ajoutés à un modèle de base. Aucun poids d'IA n'est téléchargé ni entraîné : SIMIA ajoute simplement vos consignes au début de chaque conversation qui utilise ce modèle.",
    stepName: "ÉTAPE 1 · NOM",
    nameHint: "Le nom qui s'affichera dans SIMIA pour reconnaître ce modèle.",
    namePlaceholder: "Mon assistant juridique",
    stepBase: "ÉTAPE 2 · MODÈLE DE BASE",
    baseHint: "Le moteur qui réfléchit. Choisissez un modèle léger sur un petit appareil, ou un modèle « Documents » si vous interrogez des PDF.",
    stepInstructions: "ÉTAPE 3 · CONSIGNES PERMANENTES",
    instructionsHint: "Ce que SIMIA doit toujours faire dans ce modèle : ton, rôle, règles, format de réponse. Ces consignes s'appliquent à toutes vos conversations avec ce modèle.",
    instructionsPlaceholder: "Ton, rôle, règles, format de réponse...",
    examplesLabel: "Exemples : cliquez pour ajouter, puis modifiez librement.",
    examples: [
      { label: "Réponses courtes", text: "Réponds toujours en français, en phrases courtes, sans introduction ni conclusion." },
      { label: "Rôle de juriste", text: "Tu agis comme un juriste : tu cites les textes applicables et tu signales les risques." },
      { label: "Points d'action", text: "Termine chaque réponse par trois points d'action concrets." },
      { label: "Vulgariser", text: "Explique chaque terme technique avec un exemple simple." },
      { label: "Prudence médicale", text: "Tu ne donnes jamais de conseil médical : tu renvoies vers un professionnel de santé." }
    ],
    previewLabel: "APERÇU",
    previewEmpty: "Aucune consigne pour l'instant : SIMIA se comportera comme avec un modèle standard.",
    previewFilled: instructions => `SIMIA ajoutera ces consignes à ses instructions générales :\n\n« ${instructions} »`,
    save: "Créer et utiliser",
    saveAndDownload: size => `Créer et télécharger (${size})`,
    disable: "Revenir au modèle standard",
    exportLabel: "Exporter",
    importLabel: "Importer",
    downloaded: "déjà téléchargé",
    needName: "Donnez un nom à votre modèle pour continuer.",
    needBase: "Choisissez un modèle de base compatible.",
    needProfile: "Créez d'abord votre modèle.",
    created: (name, base, size) => `« ${name} » est créé sur ${base}. Dernière étape : téléchargez le modèle de base (${size}) avec le bouton « Télécharger le modèle », juste à côté.`,
    createdReady: name => `« ${name} » est actif. Ses consignes s'appliquent aux nouvelles conversations.`,
    disabled: "Modèle standard réactivé : vos consignes ne sont plus appliquées.",
    exported: "Modèle exporté dans un fichier JSON.",
    imported: name => `Modèle « ${name} » importé et activé.`,
    invalid: "Ce fichier de modèle est invalide.",
    libraryCategory: "MON MODÈLE",
    librarySelected: "Actif",
    libraryChoose: "Utiliser",
    libraryDescription: (base, characters) => `Consignes permanentes appliquées à ${base} (${characters} caractères).`
  } : state.language === "ja" ? {
    eyebrow: "マイモデル",
    title: "マイモデルを作る",
    intro: "マイモデルとは、既存のベースモデルに名前と永続的な指示を加えたものです。AIの重みをダウンロードしたり学習させたりはしません。SIMIAは、このモデルを使う会話の冒頭にあなたの指示を追加するだけです。",
    stepName: "ステップ1 · 名前",
    nameHint: "SIMIAでこのモデルを見分けるために表示される名前です。",
    namePlaceholder: "私の法務アシスタント",
    stepBase: "ステップ2 · ベースモデル",
    baseHint: "考えるエンジンです。小さな端末なら軽量モデル、PDFを扱うなら「文書」モデルを選んでください。",
    stepInstructions: "ステップ3 · 永続的な指示",
    instructionsHint: "このモデルでSIMIAが常に守ること：口調、役割、ルール、回答の形式。これらの指示は、このモデルを使うすべての会話に適用されます。",
    instructionsPlaceholder: "口調、役割、ルール、回答の形式…",
    examplesLabel: "例：クリックで追加し、あとは自由に編集できます。",
    examples: [
      { label: "短い回答", text: "常に日本語で、短い文で答え、導入や結論は書かないでください。" },
      { label: "法律の専門家", text: "あなたは法律の専門家として振る舞い、該当する法令を示し、リスクを指摘します。" },
      { label: "行動のポイント", text: "各回答の最後に、具体的な行動を3つ示してください。" },
      { label: "かみ砕いて説明", text: "専門用語は必ず簡単な例を使って説明してください。" },
      { label: "医療の慎重さ", text: "医療上の助言は決してせず、医療従事者への相談を促してください。" }
    ],
    previewLabel: "プレビュー",
    previewEmpty: "まだ指示がありません。SIMIAは標準モデルと同じように動作します。",
    previewFilled: instructions => `SIMIAはこれらの指示を、全体の指示に追加します：\n\n「${instructions}」`,
    save: "作成して使う",
    saveAndDownload: size => `作成してダウンロード（${size}）`,
    disable: "標準モデルに戻す",
    exportLabel: "書き出す",
    importLabel: "読み込む",
    downloaded: "ダウンロード済み",
    needName: "続けるにはモデルに名前を付けてください。",
    needBase: "対応するベースモデルを選んでください。",
    needProfile: "まずモデルを作成してください。",
    created: (name, base, size) => `「${name}」を ${base} で作成しました。最後の手順：すぐ隣の「モデルをダウンロード」ボタンでベースモデル（${size}）をダウンロードしてください。`,
    createdReady: name => `「${name}」が有効になりました。指示は新しい会話に適用されます。`,
    disabled: "標準モデルに戻りました。あなたの指示は適用されません。",
    exported: "モデルをJSONファイルに書き出しました。",
    imported: name => `モデル「${name}」を読み込み、有効にしました。`,
    invalid: "このモデルファイルは無効です。",
    libraryCategory: "マイモデル",
    librarySelected: "使用中",
    libraryChoose: "使う",
    libraryDescription: (base, characters) => `${base} に適用される永続的な指示（${characters}文字）。`
  } : state.language === "es" ? {
    eyebrow: "MI MODELO",
    title: "Crear mi modelo",
    intro: "Un modelo personal es un nombre y unas instrucciones permanentes añadidas a un modelo base. No se descarga ni se entrena ningún peso de IA: SIMIA añade tus instrucciones al principio de cada conversación que usa este modelo.",
    stepName: "PASO 1 · NOMBRE",
    nameHint: "El nombre que se mostrará en SIMIA para reconocer este modelo.",
    namePlaceholder: "Mi asistente jurídico",
    stepBase: "PASO 2 · MODELO BASE",
    baseHint: "El motor que razona. Elige un modelo ligero en un dispositivo pequeño, o un modelo «Documentos» si consultas PDF.",
    stepInstructions: "PASO 3 · INSTRUCCIONES PERMANENTES",
    instructionsHint: "Lo que SIMIA debe hacer siempre con este modelo: tono, papel, reglas, formato. Estas instrucciones se aplican a todas tus conversaciones con este modelo.",
    instructionsPlaceholder: "Tono, papel, reglas, formato de respuesta...",
    examplesLabel: "Ejemplos: haz clic para añadir y edita después.",
    examples: [
      { label: "Respuestas cortas", text: "Responde siempre en español, con frases cortas, sin introducción ni conclusión." },
      { label: "Papel de jurista", text: "Actúas como jurista: citas las normas aplicables y señalas los riesgos." },
      { label: "Puntos de acción", text: "Termina cada respuesta con tres puntos de acción concretos." },
      { label: "Vulgarizar", text: "Explica cada término técnico con un ejemplo sencillo." },
      { label: "Prudencia médica", text: "Nunca das consejo médico: remites a un profesional de la salud." }
    ],
    previewLabel: "VISTA PREVIA",
    previewEmpty: "Sin instrucciones por ahora: SIMIA se comportará como con un modelo estándar.",
    previewFilled: instructions => `SIMIA añadirá estas instrucciones a sus instrucciones generales:\n\n«${instructions}»`,
    save: "Crear y usar",
    saveAndDownload: size => `Crear y descargar (${size})`,
    disable: "Volver al modelo estándar",
    exportLabel: "Exportar",
    importLabel: "Importar",
    downloaded: "ya descargado",
    needName: "Pon un nombre a tu modelo para continuar.",
    needBase: "Elige un modelo base compatible.",
    needProfile: "Crea primero tu modelo.",
    created: (name, base, size) => `«${name}» está creado sobre ${base}. Último paso: descarga el modelo base (${size}) con el botón «Descargar modelo», justo al lado.`,
    createdReady: name => `«${name}» está activo. Sus instrucciones se aplican a las nuevas conversaciones.`,
    disabled: "Modelo estándar reactivado: tus instrucciones ya no se aplican.",
    exported: "Modelo exportado a un archivo JSON.",
    imported: name => `Modelo «${name}» importado y activado.`,
    invalid: "Este archivo de modelo no es válido.",
    libraryCategory: "MI MODELO",
    librarySelected: "Activo",
    libraryChoose: "Usar",
    libraryDescription: (base, characters) => `Instrucciones permanentes aplicadas a ${base} (${characters} caracteres).`
  } : {
    eyebrow: "MY MODEL",
    title: "Create my model",
    intro: "A personal model is a name and permanent instructions added to a base model. No AI weights are downloaded or trained: SIMIA simply adds your instructions at the start of every conversation that uses this model.",
    stepName: "STEP 1 · NAME",
    nameHint: "The name shown in SIMIA to recognise this model.",
    namePlaceholder: "My legal assistant",
    stepBase: "STEP 2 · BASE MODEL",
    baseHint: "The engine that thinks. Pick a light model on a small device, or a “Documents” model if you question PDFs.",
    stepInstructions: "STEP 3 · PERMANENT INSTRUCTIONS",
    instructionsHint: "What SIMIA must always do in this model: tone, role, rules, answer format. These instructions apply to every conversation using this model.",
    instructionsPlaceholder: "Tone, role, rules, answer format...",
    examplesLabel: "Examples: click to add, then edit freely.",
    examples: [
      { label: "Short answers", text: "Always answer in English, in short sentences, with no introduction or conclusion." },
      { label: "Legal role", text: "You act as a lawyer: you cite the applicable rules and flag the risks." },
      { label: "Action points", text: "End every answer with three concrete action points." },
      { label: "Plain language", text: "Explain every technical term with a simple example." },
      { label: "Medical caution", text: "You never give medical advice: you refer to a health professional." }
    ],
    previewLabel: "PREVIEW",
    previewEmpty: "No instructions yet: SIMIA will behave as with a standard model.",
    previewFilled: instructions => `SIMIA will add these instructions to its general ones:\n\n“${instructions}”`,
    save: "Create and use",
    saveAndDownload: size => `Create and download (${size})`,
    disable: "Back to the standard model",
    exportLabel: "Export",
    importLabel: "Import",
    downloaded: "already downloaded",
    needName: "Give your model a name to continue.",
    needBase: "Choose a compatible base model.",
    needProfile: "Create your model first.",
    created: (name, base, size) => `“${name}” is created on ${base}. Last step: download the base model (${size}) with the “Download model” button right next to this window.`,
    createdReady: name => `“${name}” is active. Its instructions apply to new conversations.`,
    disabled: "Standard model restored: your instructions are no longer applied.",
    exported: "Model exported to a JSON file.",
    imported: name => `Model “${name}” imported and activated.`,
    invalid: "This model file is invalid.",
    libraryCategory: "MY MODEL",
    librarySelected: "Active",
    libraryChoose: "Use",
    libraryDescription: (base, characters) => `Permanent instructions applied to ${base} (${characters} characters).`
  };
}

function renderCustomModelText() {
  const text = customModelText();
  ui.customModelEyebrow.textContent = text.eyebrow;
  ui.customModelTitle.textContent = text.title;
  ui.customModelIntro.textContent = text.intro;
  ui.customModelStepName.textContent = text.stepName;
  ui.customModelNameHint.textContent = text.nameHint;
  ui.customModelName.placeholder = text.namePlaceholder;
  ui.customModelStepBase.textContent = text.stepBase;
  ui.customModelBaseHint.textContent = text.baseHint;
  ui.customModelStepInstructions.textContent = text.stepInstructions;
  ui.customModelInstructionsHint.textContent = text.instructionsHint;
  ui.customModelInstructions.placeholder = text.instructionsPlaceholder;
  ui.customModelPreviewLabel.textContent = text.previewLabel;
  ui.customModelDisable.textContent = text.disable;
  ui.customModelExport.textContent = text.exportLabel;
  ui.customModelImport.textContent = text.importLabel;
  ui.customModelExamples.replaceChildren(...text.examples.map(example => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "custom-chip";
    button.textContent = example.label;
    button.dataset.customExample = example.text;
    return button;
  }));
}

function renderCustomModelPreview() {
  const text = customModelText();
  const instructions = ui.customModelInstructions.value.trim();
  ui.customModelPreview.textContent = instructions ? text.previewFilled(instructions) : text.previewEmpty;
}

function renderCustomModelStatus() {
  ui.customModelDisable.disabled = !(state.customModelActive && state.customModel);
  ui.customModelExport.disabled = !isValidCustomModel(state.customModel);
  ui.customModelStatus.textContent = state.customModelStatus || "";
}

function customModelBaseOptions() {
  const text = customModelText();
  return MODELS
    .filter(model => modelIsCompatible(model) && model.engine !== "transformers")
    .map(model => new Option(`${model.name} · ${model.size}${state.cachedModelId === model.id ? ` · ${text.downloaded}` : ""}`, model.id));
}

function renderCustomModelSaveLabel() {
  const text = customModelText();
  const model = MODELS.find(candidate => candidate.id === ui.customModelBase.value);
  ui.customModelSave.textContent = model && state.cachedModelId !== model.id ? text.saveAndDownload(model.size) : text.save;
}

function openCustomModelDialog() {
  dismissCookieBanner();
  renderCustomModelText();
  ui.customModelBase.replaceChildren(...customModelBaseOptions());
  const profile = state.customModel || { name: "", instructions: "", baseModelId: state.selectedModel || DEFAULT_MODEL_ID };
  ui.customModelName.value = profile.name;
  ui.customModelInstructions.value = profile.instructions;
  ui.customModelBase.value = MODELS.some(model => model.id === profile.baseModelId) ? profile.baseModelId : DEFAULT_MODEL_ID;
  state.customModelStatus = "";
  renderCustomModelPreview();
  renderCustomModelStatus();
  renderCustomModelSaveLabel();
  ui.customModelDialog.showModal();
}

async function applyCustomModel(profile) {
  const normalized = normalizedCustomModel(profile);
  if (!normalized) return;
  state.customModel = normalized;
  state.customModelActive = true;
  await selectModelById(normalized.baseModelId, true);
  const conversation = activeConversation();
  if (conversation?.messages.length) newConversation();
  else if (conversation) {
    conversation.modelId = normalized.baseModelId;
    conversation.customModel = { ...normalized };
  }
  saveState();
  renderModeLabel();
  updateModelInfo();
  updateModelActivityUi();
  renderModelLibrary();
}

function disableCustomModel() {
  const text = customModelText();
  state.customModelActive = false;
  const conversation = activeConversation();
  if (conversation) conversation.customModel = null;
  state.customModelStatus = text.disabled;
  saveState();
  renderCustomModelStatus();
  renderModeLabel();
  updateModelInfo();
  updateModelActivityUi();
  renderModelLibrary();
  ui.downloadInfo.textContent = text.disabled;
}

function dismissCookieBanner() {
  try {
    if (window.ZigmoonCookies?.close) window.ZigmoonCookies.close();
  } catch { /* banner optional */ }
}

async function saveCustomModel() {
  const text = customModelText();
  const profile = { name: ui.customModelName.value.trim(), instructions: ui.customModelInstructions.value.trim(), baseModelId: ui.customModelBase.value };
  if (!profile.name) {
    state.customModelStatus = text.needName;
    renderCustomModelStatus();
    ui.customModelName.focus();
    return;
  }
  if (!isValidCustomModel(profile)) {
    state.customModelStatus = text.needBase;
    renderCustomModelStatus();
    return;
  }
  const base = MODELS.find(model => model.id === profile.baseModelId);
  await applyCustomModel(profile);
  const baseReady = state.cachedModelId === profile.baseModelId;
  state.customModelStatus = baseReady ? text.createdReady(profile.name) : text.created(profile.name, base?.name || profile.baseModelId, base?.size || "");
  renderCustomModelStatus();
  ui.customModelDialog.close();
  ui.modelLibrary.close();
  ui.settings.hidden = false;
  ui.downloadInfo.textContent = state.customModelStatus;
  setStatus(state.customModelStatus);
}

function exportCustomModel() {
  const text = customModelText();
  if (!isValidCustomModel(state.customModel)) {
    state.customModelStatus = text.needProfile;
    renderCustomModelStatus();
    return;
  }
  downloadJson({ format: "SIMIA custom model", version: 1, exportedAt: new Date().toISOString(), profile: state.customModel }, "simia-mon-modele.json");
  state.customModelStatus = text.exported;
  renderCustomModelStatus();
}

async function importCustomModel(file) {
  const text = customModelText();
  let imported = null;
  try { imported = JSON.parse(await file.text()); } catch { imported = null; }
  if (imported?.format !== "SIMIA custom model" || imported.version !== 1 || !isValidCustomModel(imported.profile)) {
    toast(text.invalid);
    return;
  }
  await applyCustomModel(imported.profile);
  renderCustomModelText();
  ui.customModelBase.replaceChildren(...customModelBaseOptions());
  ui.customModelName.value = imported.profile.name;
  ui.customModelInstructions.value = imported.profile.instructions;
  ui.customModelBase.value = imported.profile.baseModelId;
  renderCustomModelPreview();
  renderCustomModelSaveLabel();
  state.customModelStatus = text.imported(imported.profile.name);
  renderCustomModelStatus();
}

function downloadJson(data, filename) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

const BACKUP_FORMAT = "SIMIA backup";
const BACKUP_VERSION = 2;

function exportableAttachments(attachments = []) {
  return attachments.filter(attachment => attachment && typeof attachment.name === "string").map(attachment => ({
    id: attachment.id,
    name: attachment.name,
    type: attachment.type || "",
    size: attachment.size || 0,
    kind: attachment.kind || "document",
    truncated: attachment.truncated,
    document: attachment.document ? { ...attachment.document, progress: "", status: "ready", restored: false } : undefined
  }));
}

function exportableConversation(conversation) {
  return {
    id: conversation.id,
    title: conversation.title,
    modelId: conversation.modelId,
    customModel: conversation.customModel || null,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    messages: conversation.messages.map(message => ({
      role: message.role,
      content: message.content,
      createdAt: message.createdAt,
      attachments: exportableAttachments(message.attachments)
    }))
  };
}

function exportableDocuments() {
  const records = new Map();
  const collect = attachment => {
    if (!attachment?.document || !attachment.text || records.has(attachment.id)) return;
    records.set(attachment.id, { ...documentRecord(attachment), pending: false });
  };
  state.conversations.forEach(conversation => conversation.messages.forEach(message => (message.attachments || []).forEach(collect)));
  state.pendingAttachments.forEach(collect);
  return [...records.values()];
}

function preferencesPayload() {
  return {
    language: state.language,
    selectedModel: state.selectedModel,
    cachedModelId: state.cachedModelId,
    autoLoadModel: state.autoLoadModel,
    profile: state.profile,
    customModel: state.customModel
  };
}

function exportFullBackup() {
  const documents = exportableDocuments();
  const backup = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    application: { name: "SIMIA", storage: "navigateur : localStorage + IndexedDB" },
    preferences: preferencesPayload(),
    conversations: state.conversations.map(exportableConversation),
    documents
  };
  downloadJson(backup, `simia-sauvegarde-${new Date().toISOString().slice(0, 10)}.json`);
  ui.downloadInfo.textContent = localizedText(
    `Sauvegarde complète : ${state.conversations.length} conversation(s) et ${documents.length} document(s) avec le texte indexable. Ce fichier permet de tout restaurer.`,
    `Full backup: ${state.conversations.length} conversation(s) and ${documents.length} document(s) with searchable text. This file restores everything.`,
    `Copia completa: ${state.conversations.length} conversación(es) y ${documents.length} documento(s) con el texto indexable. Este archivo permite restaurarlo todo.`
  );
}

function exportSettings() {
  const backup = {
    format: "SIMIA settings",
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    application: { name: "SIMIA", storage: "navigateur : localStorage" },
    preferences: preferencesPayload()
  };
  downloadJson(backup, `simia-reglages-${new Date().toISOString().slice(0, 10)}.json`);
  ui.downloadInfo.textContent = localizedText("Réglages exportés : langue, modèle, profil et modèle personnalisé.", "Settings exported: language, model, profile, and custom model.", "Ajustes exportados: idioma, modelo, perfil y modelo personalizado.");
}

function exportConversations() {
  const backup = {
    format: "SIMIA conversations",
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    application: { name: "SIMIA", storage: "navigateur : localStorage" },
    conversations: state.conversations.map(exportableConversation)
  };
  downloadJson(backup, `simia-conversations-${new Date().toISOString().slice(0, 10)}.json`);
  ui.downloadInfo.textContent = localizedText(
    `Conversations exportées : ${state.conversations.length}. Les messages et les fiches de fichiers sont inclus ; le texte des documents se trouve dans la sauvegarde complète.`,
    `Conversations exported: ${state.conversations.length}. Messages and file cards are included; document text is part of the full backup.`,
    `Conversaciones exportadas: ${state.conversations.length}. Se incluyen mensajes y fichas de archivos; el texto de los documentos está en la copia completa.`
  );
}

function backupKind(payload) {
  const format = String(payload?.format || "").toLowerCase();
  if (format === "simia backup") return "full";
  if (format === "simia settings") return "settings";
  if (format === "simia conversations" || format === "simia conversation text export") return "conversations";
  if (format === "simia custom model") return "customModel";
  if (Array.isArray(payload?.conversations)) return "conversations";
  if (payload?.preferences && typeof payload.preferences === "object") return "settings";
  if (payload?.profile) return "customModel";
  return null;
}

function importedPreferences(preferences) {
  if (!preferences || typeof preferences !== "object") return false;
  if (["en", "fr", "es"].includes(preferences.language)) state.language = preferences.language;
  if (MODELS.some(model => model.id === preferences.selectedModel)) state.selectedModel = preferences.selectedModel;
  if (MODELS.some(model => model.id === preferences.cachedModelId)) state.cachedModelId = preferences.cachedModelId;
  if (typeof preferences.autoLoadModel === "boolean") state.autoLoadModel = preferences.autoLoadModel;
  if (typeof preferences.profile === "string") state.profile = preferences.profile.slice(0, 600);
  if (isValidCustomModel(preferences.customModel)) state.customModel = preferences.customModel;
  return true;
}

function importedConversation(conversation, documents) {
  if (!conversation || typeof conversation.id !== "string" || !Array.isArray(conversation.messages)) return null;
  const messages = conversation.messages
    .filter(message => message && typeof message.content === "string" && (message.role === "user" || message.role === "assistant"))
    .map(message => ({
      role: message.role,
      content: message.content,
      createdAt: message.createdAt || new Date().toISOString(),
      attachments: (Array.isArray(message.attachments) ? message.attachments : [])
        .filter(attachment => attachment && typeof attachment.name === "string")
        .map(attachment => {
          const record = attachment.id ? documents.get(attachment.id) : null;
          return {
            id: typeof attachment.id === "string" ? attachment.id : crypto.randomUUID(),
            name: attachment.name,
            type: attachment.type || "",
            size: attachment.size || 0,
            kind: attachment.kind || "document",
            truncated: attachment.truncated,
            text: record?.text,
            document: attachment.document
              ? { format: attachment.document.format || "Document", extension: attachment.document.extension || "", pages: attachment.document.pages ?? null, words: attachment.document.words || 0, outline: attachment.document.outline || [], notes: attachment.document.notes || [], status: "ready", progress: "", restored: Boolean(record) }
              : undefined
          };
        })
    }));
  return {
    id: conversation.id,
    title: typeof conversation.title === "string" && conversation.title.trim() ? conversation.title.slice(0, 120) : localizedText("Conversation importée", "Imported conversation", "Conversación importada"),
    modelId: MODELS.some(model => model.id === conversation.modelId) ? conversation.modelId : state.selectedModel,
    customModel: isValidCustomModel(conversation.customModel) ? conversation.customModel : null,
    createdAt: conversation.createdAt || new Date().toISOString(),
    updatedAt: conversation.updatedAt || new Date().toISOString(),
    messages
  };
}

async function storeImportedDocuments(records) {
  let stored = 0;
  for (const record of records) {
    try {
      await runDocumentStore("readwrite", store => store.put({ ...record, pending: false }));
      stored += 1;
    } catch (error) {
      console.warn("Document importé non conservé", error);
    }
  }
  return stored;
}

async function applyImportedBackup(payload, kind) {
  const rawDocuments = (Array.isArray(payload.documents) ? payload.documents : [])
    .filter(record => record && typeof record.id === "string" && typeof record.text === "string");
  const documents = new Map(rawDocuments.map(record => [record.id, record]));
  let conversations = 0;
  let messages = 0;
  if (kind !== "settings") {
    (Array.isArray(payload.conversations) ? payload.conversations : []).forEach(entry => {
      const conversation = importedConversation(entry, documents);
      if (!conversation) return;
      const position = state.conversations.findIndex(item => item.id === conversation.id);
      if (position >= 0) state.conversations.splice(position, 1);
      state.conversations.unshift(conversation);
      conversations += 1;
      messages += conversation.messages.length;
    });
  }
  if (kind !== "conversations") importedPreferences(payload.preferences);
  if (rawDocuments.length) await storeImportedDocuments(rawDocuments);
  if (!state.conversations.some(conversation => conversation.id === state.activeConversationId)) state.activeConversationId = state.conversations[0]?.id || null;
  if (!state.conversations.length) newConversation();
  else saveState();
  restoreDocumentIndexes();
  applyLanguage();
  ui.profileInput.value = state.profile;
  ui.exportDialog.close();
  renderConversationList();
  renderActiveConversation();
  renderDocumentTools();
  ui.downloadInfo.textContent = localizedText(
    `Import terminé : ${conversations} conversation(s), ${messages} message(s), ${documents.size} document(s) réindexé(s).`,
    `Import complete: ${conversations} conversation(s), ${messages} message(s), ${documents.size} document(s) re-indexed.`,
    `Importación completa: ${conversations} conversación(es), ${messages} mensaje(s), ${documents.size} documento(s) reindexado(s).`
  );
}

async function importBackup(file) {
  let payload = null;
  try { payload = JSON.parse(await file.text()); } catch { payload = null; }
  const kind = backupKind(payload);
  if (!kind) {
    toast(localizedText("Ce fichier n'est pas une sauvegarde SIMIA lisible. Choisissez un fichier obtenu avec « Sauvegarde complète », « Exporter les réglages » ou « Exporter les conversations ».", "This file is not a readable SIMIA backup. Choose a file produced by “Full backup”, “Export settings”, or “Export conversations”.", "Este archivo no es una copia de SIMIA legible. Elige un archivo creado con «Copia completa», «Exportar ajustes» o «Exportar conversaciones»."));
    return;
  }
  const count = Array.isArray(payload.conversations) ? payload.conversations.length : 0;
  const documentCount = Array.isArray(payload.documents) ? payload.documents.length : 0;
  const confirmed = window.confirm(localizedText(
    `Importer cette sauvegarde ?\n\n${count} conversation(s) et ${documentCount} document(s) seront ajoutés. Vos données actuelles sont conservées.`,
    `Import this backup?\n\n${count} conversation(s) and ${documentCount} document(s) will be added. Your current data is kept.`,
    `¿Importar esta copia?\n\nSe añadirán ${count} conversación(es) y ${documentCount} documento(s). Tus datos actuales se conservan.`
  ));
  if (!confirmed) return;
  try {
    await applyImportedBackup(payload, kind);
  } catch (error) {
    console.error("Import impossible", error);
    toast(localizedText("L'import a échoué : le fichier est peut-être incomplet.", "The import failed: the file may be incomplete.", "La importación ha fallado: el archivo puede estar incompleto."));
  }
}

async function purgeModelCaches() {
  const confirmed = window.confirm(localizedText(
    "Tout supprimer ? Les modèles téléchargés, les caches, les documents joints, les conversations et les réglages SIMIA seront définitivement effacés.",
    "Remove everything? Downloaded models, caches, attached documents, conversations, and SIMIA settings will be permanently deleted.",
    "¿Eliminarlo todo? Los modelos descargados, cachés, documentos adjuntos, conversaciones y ajustes de SIMIA se borrarán definitivamente."
  ));
  if (!confirmed) return;
  ui.purgeToggle.disabled = true;
  ui.purgeToggle.textContent = localizedText("Purge en cours...", "Purging...", "Purgando...");
  setStatus(localizedText("Purge en cours", "Purging", "Purgando"), "loading");
  try {
    try {
      await state.engine?.unload?.();
      const { deleteModelAllInfoInCache, prebuiltAppConfig } = await import("https://esm.run/@mlc-ai/web-llm");
      const appConfig = await getWebllmAppConfig(prebuiltAppConfig);
      const llmIds = MODELS.filter(model => !model.engine).map(model => model.id);
      await Promise.allSettled(llmIds.map(id => deleteModelAllInfoInCache(id, appConfig)));
    } catch (error) {
      console.warn("WebLLM cache cleanup skipped", error);
    }
    await Promise.allSettled((await caches.keys()).map(cacheName => caches.delete(cacheName)));
    await clearDocumentRecords();
    await imageRecordClear();
    localStorage.removeItem(STORAGE_KEY);
    sessionStorage.clear();
    state.engine = null;
    state.visionPipeline = null;
    state.visionProcessor = null;
    state.visionModelId = null;
    state.useWebLLM = false;
    state.webllmAppConfig = null;
    state.conversations = [];
    state.activeConversationId = null;
    toast(localizedText("SIMIA a été entièrement purgé : modèles, caches, conversations et réglages ont été supprimés.", "SIMIA was fully purged: models, caches, conversations, and settings were deleted.", "SIMIA se purgó por completo: se eliminaron modelos, cachés, conversaciones y ajustes."));
    window.location.reload();
  } catch (error) {
    console.error("Cache purge failed", error);
    setStatus(copy[state.language].error, "error");
    ui.purgeToggle.disabled = false;
    ui.purgeToggle.textContent = copy[state.language].purge;
    toast(localizedText("La purge n'a pas pu se terminer. Réessayez après avoir fermé les autres onglets SIMIA.", "The purge could not finish. Try again after closing other SIMIA tabs.", "La purga no pudo terminar. Inténtalo de nuevo después de cerrar las otras pestañas de SIMIA."));
  }
}

ui.form.addEventListener("submit", event => {
  event.preventDefault();
  if (state.imageMode) requestImage(ui.prompt.value);
  else submitPrompt(ui.prompt.value);
});
ui.prompt.addEventListener("input", () => { autoResize(); scheduleDraftSave(); });
ui.prompt.addEventListener("keydown", event => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); ui.form.requestSubmit(); } });
ui.attach.addEventListener("click", () => ui.attachmentInput.click());
ui.attachmentInput.addEventListener("change", event => addAttachments(event.target.files));
ui.documentSummary.addEventListener("click", summarizeDocuments);
ui.documentSemantic.addEventListener("click", () => setSemanticSearch(!state.semanticSearch));
ui.documentExport.addEventListener("click", exportDocumentText);
ui.attachmentTray.addEventListener("click", event => {
  const remove = event.target.closest("button[data-remove-attachment]");
  if (!remove) return;
  const attachment = state.pendingAttachments.find(item => item.id === remove.dataset.removeAttachment);
  if (attachment?.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
  state.pendingAttachments = state.pendingAttachments.filter(item => item.id !== remove.dataset.removeAttachment);
  renderPendingAttachments();
});
ui.form.addEventListener("dragover", event => { event.preventDefault(); ui.form.classList.add("is-dropping"); });
ui.form.addEventListener("dragleave", event => { if (!ui.form.contains(event.relatedTarget)) ui.form.classList.remove("is-dropping"); });
ui.form.addEventListener("drop", event => { event.preventDefault(); ui.form.classList.remove("is-dropping"); addAttachments(event.dataTransfer.files); });
document.querySelector("#home-model-button").addEventListener("click", () => openModelLibrary());
document.querySelector("#new-chat").addEventListener("click", newConversation);
document.querySelector("#clear-chat").addEventListener("click", clearChat);
ui.voice.addEventListener("click", toggleVoiceInput);
ui.agentToggle.addEventListener("click", () => setAgentMode(!state.agentMode));
ui.imageToggle?.addEventListener("click", () => setImageMode(!state.imageMode));
ui.chat.addEventListener("click", async event => {
  const button = event.target.closest("[data-image-action]");
  if (!button) return;
  const action = button.dataset.imageAction;
  if (action === "cancel") {
    button.disabled = true;
    imageCancelPending = true;
    const label = button.closest(".image-progress")?.querySelector(".image-progress-label");
    if (label) label.textContent = localizedText("Arrêt demandé…", "Stopping…", "Deteniendo…", "停止しています…");
    if (imageJobId) {
      try { await fetch(`${IMAGE.jobsUrl}/${imageJobId}/cancel`, { method: "POST" }); } catch { /* deja termine */ }
    }
    return;
  }
  const frame = button.closest(".message-image");
  const id = frame?.dataset.imageId;
  if (!id) return;
  if (action === "download") {
    const url = await imageObjectUrl(id);
    if (!url) return;
    const link = document.createElement("a");
    link.href = url;
    link.download = `simia-${id.slice(0, 8)}.png`;
    link.click();
    return;
  }
  if (action === "regenerate") {
    const record = await imageRecordLoad(id);
    if (record?.prompt) {
      setImageMode(true);
      requestImage(record.prompt);
    }
    return;
  }
  if (action === "delete") {
    const conversation = activeConversation();
    if (conversation) {
      conversation.messages = conversation.messages.filter(item => item.image?.id !== id);
      saveState();
      renderConversationList();
    }
    const cached = imageUrls.get(id);
    if (cached) { URL.revokeObjectURL(cached); imageUrls.delete(id); }
    button.closest(".message")?.remove();
    if (!conversation?.messages.length) ui.welcome.hidden = false;
  }
});
ui.home.addEventListener("click", showHome);
document.querySelector("#settings-toggle").addEventListener("click", () => { ui.settings.hidden = !ui.settings.hidden; });
document.querySelector("#settings-close").addEventListener("click", () => { ui.settings.hidden = true; });
document.addEventListener("keydown", event => { if (event.key === "Escape") ui.settings.hidden = true; });
ui.webllm.addEventListener("click", loadWebLLM);
ui.autoLoadModel.addEventListener("change", () => { state.autoLoadModel = ui.autoLoadModel.checked; saveState(); });
ui.language.addEventListener("click", event => { event.stopPropagation(); toggleLanguageMenu(); });
if (ui.languageMenu) {
  ui.languageMenu.addEventListener("click", event => {
    const choice = event.target.closest("[data-language]");
    if (choice) setLanguage(choice.dataset.language);
  });
  ui.languageMenu.addEventListener("keydown", event => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const items = [...ui.languageMenu.querySelectorAll("[data-language]")];
    const current = items.indexOf(document.activeElement);
    const step = event.key === "ArrowDown" ? 1 : -1;
    const next = (current + step + items.length) % items.length;
    event.preventDefault();
    items[next].focus();
  });
  document.addEventListener("click", event => {
    if (!event.target.closest("#language-menu-wrap")) closeLanguageMenu();
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && !ui.languageMenu.hidden) {
      closeLanguageMenu();
      ui.language.focus();
    }
  });
}
if (ui.appMenuToggle) {
  ui.appMenuToggle.addEventListener("click", event => { event.stopPropagation(); toggleAppMenu(); });
  ui.appMenu.addEventListener("click", event => {
    const choice = event.target.closest("[role='menuitem']");
    if (!choice) return;
    closeAppMenu();
    if (choice === ui.appMenuSettings) ui.settings.hidden = false;
    else if (choice === ui.appMenuInfo) { renderInfoContent(); ui.infoDialog.showModal(); }
    else if (choice === ui.appMenuExport) ui.exportDialog.showModal();
    else if (choice === ui.appMenuLegal) ui.legal.showModal();
    else if (choice === ui.appMenuPurge) purgeModelCaches();
  });
  document.addEventListener("click", event => { if (!event.target.closest("#app-menu-wrap")) closeAppMenu(); });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && !ui.appMenu.hidden) {
      closeAppMenu();
      ui.appMenuToggle.focus();
    }
  });
}
ui.model.addEventListener("change", selectModel);
ui.modelPicker.addEventListener("click", () => openModelLibrary());
/* Le nom du moteur d'image, ou qu'on clique dessus, ouvre directement l'onglet Image. */
ui.imageEngine?.addEventListener("click", () => openModelLibrary("image"));
ui.imagePicker?.addEventListener("click", () => openModelLibrary("image"));
ui.customModelToggle.addEventListener("click", openCustomModelDialog);
ui.customModelSettingsToggle.addEventListener("click", openCustomModelDialog);
document.querySelector("#custom-model-close").addEventListener("click", () => ui.customModelDialog.close());
document.querySelector("#custom-model-save").addEventListener("click", saveCustomModel);
document.querySelector("#custom-model-export").addEventListener("click", exportCustomModel);
document.querySelector("#custom-model-import").addEventListener("click", () => ui.customModelImportFile.click());
ui.customModelDisable.addEventListener("click", disableCustomModel);
ui.customModelInstructions.addEventListener("input", renderCustomModelPreview);
ui.customModelBase.addEventListener("change", renderCustomModelSaveLabel);
ui.customModelName.addEventListener("input", () => {
  if (!state.customModelStatus) return;
  state.customModelStatus = "";
  renderCustomModelStatus();
});
ui.customModelExamples.addEventListener("click", event => {
  const chip = event.target.closest("button[data-custom-example]");
  if (!chip) return;
  const current = ui.customModelInstructions.value.trim();
  ui.customModelInstructions.value = current ? `${current}\n${chip.dataset.customExample}` : chip.dataset.customExample;
  renderCustomModelPreview();
  ui.customModelInstructions.focus();
});
ui.customModelImportFile.addEventListener("change", event => {
  const [file] = event.target.files;
  if (file) importCustomModel(file);
  event.target.value = "";
});
ui.modelLibrary.addEventListener("click", event => {
  const close = event.target.closest("#model-library-close");
  if (close) return ui.modelLibrary.close();
  if (event.target.closest("#model-recommend")) return recommendModel();
  const filter = event.target.closest("button[data-model-filter]");
  if (filter) {
    state.modelFilter = filter.dataset.modelFilter;
    state.modelAdvice = "";
    renderModelLibrary();
    return;
  }
  const customChoice = event.target.closest("button[data-custom-model]");
  if (customChoice) {
    if (customChoice.dataset.customModel === "edit") return openCustomModelDialog();
    applyCustomModel(state.customModel);
    ui.settings.hidden = false;
    ui.modelLibrary.close();
    return;
  }
  const packDownload = event.target.closest("button[data-image-pack-download]");
  if (packDownload) {
    downloadImagePack(packDownload.dataset.imagePackDownload);
    return;
  }
  const packChoice = event.target.closest("button[data-image-pack]");
  if (packChoice) {
    selectImagePack(packChoice.dataset.imagePack);
    return;
  }
  const choice = event.target.closest("button[data-model-id]");
  if (!choice) return;
  selectModelById(choice.dataset.modelId);
  ui.settings.hidden = false;
  ui.modelLibrary.close();
});
ui.chat.addEventListener("click", event => {
  if (event.target.closest(".open-model-library")) openModelLibrary();
  const actionButton = event.target.closest("[data-action]");
  if (actionButton) return handleMessageAction(actionButton);
  const suggestion = event.target.closest(".message-suggestion");
  if (suggestion) {
    ui.prompt.value = suggestion.dataset.suggestion;
    autoResize();
    ui.prompt.focus();
  }
});

/* Atelier code */
ui.codeInput?.addEventListener("input", onCodeInput);
ui.codeInput?.addEventListener("keydown", onCodeKeydown);
ui.codeInput?.addEventListener("scroll", () => {
  ui.codeHighlight.scrollTop = ui.codeInput.scrollTop;
  ui.codeHighlight.scrollLeft = ui.codeInput.scrollLeft;
  if (ui.codeGutter) ui.codeGutter.scrollTop = ui.codeInput.scrollTop;
});
ui.codeTabs?.addEventListener("click", event => {
  const close = event.target.closest("[data-code-close]");
  if (close) {
    event.stopPropagation();
    closeCodeFile(close.dataset.codeClose);
    return;
  }
  const tab = event.target.closest("[data-code-tab]");
  if (tab) {
    state.code.activeId = tab.dataset.codeTab;
    renderCodeTabs();
    renderCodeEditor();
  }
});
ui.codeNew?.addEventListener("click", () => {
  setCodeNewMenu(ui.codeNewMenu?.hidden !== false);
});
ui.codeNewMenu?.addEventListener("click", event => {
  const item = event.target.closest("[data-code-new]");
  if (!item) return;
  setCodeNewMenu(false);
  createCodeFile({ language: item.dataset.codeNew });
  ui.codeInput?.focus();
});
document.addEventListener("click", event => {
  if (ui.codeNewMenu?.hidden !== false) return;
  if (ui.codeNewWrap?.contains(event.target)) return;
  setCodeNewMenu(false);
});
document.addEventListener("keydown", event => {
  if (event.key === "Escape" && ui.codeNewMenu?.hidden === false) setCodeNewMenu(false);
});
ui.codeClose?.addEventListener("click", exitCodeMode);
ui.codeSwitch?.addEventListener("click", event => {
  const button = event.target.closest("[data-code-focus]");
  if (button) setCodeFocus(button.dataset.codeFocus);
});
document.querySelector(".code-actions-bar")?.addEventListener("click", event => {
  const button = event.target.closest("[data-code-action]");
  if (button) runCodeAction(button.dataset.codeAction);
});
ui.codeOutputClear?.addEventListener("click", () => {
  resetCodeOutput();
  refreshCodeActions();
});
ui.codeOutputStop?.addEventListener("click", () => {
  if (!activeCodeRun) return;
  stopCodeRun(
    activeCodeRun,
    localizedText("Exécution arrêtée.", "Execution stopped.", "Ejecución detenida.", "実行を停止しました。")
  );
});
ui.codeLang?.addEventListener("change", () => applyCodeLanguage(ui.codeLang.value));
ui.exportToggle.addEventListener("click", () => ui.exportDialog.showModal());
ui.purgeToggle.addEventListener("click", purgeModelCaches);
document.querySelector("#export-close").addEventListener("click", () => ui.exportDialog.close());
document.querySelector("#export-full").addEventListener("click", exportFullBackup);
ui.exportSettings.addEventListener("click", exportSettings);
ui.exportConversations.addEventListener("click", exportConversations);
ui.exportMarkdown.addEventListener("click", exportConversationMarkdown);
document.querySelector("#import-backup").addEventListener("click", () => ui.importFile.click());
ui.importFile.addEventListener("change", event => {
  const [file] = event.target.files;
  event.target.value = "";
  if (file) importBackup(file);
});
ui.profileInput.addEventListener("input", () => { state.profile = ui.profileInput.value; saveState(); });
document.addEventListener("keydown", event => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") { event.preventDefault(); openModelLibrary(); return; }
  const typing = /^(input|textarea|select)$/i.test(event.target.tagName) || event.target.isContentEditable;
  if (event.key === "/" && !typing) { event.preventDefault(); ui.prompt.focus(); }
});
ui.conversationList.addEventListener("click", event => {
  const remove = event.target.closest("button[data-delete-conversation-id]");
  if (remove) return deleteConversation(remove.dataset.deleteConversationId);
  const button = event.target.closest("button[data-conversation-id]");
  if (!button) return;
  if (button.dataset.conversationId !== state.activeConversationId) {
    state.activeConversationId = button.dataset.conversationId;
    saveState();
    renderConversationList();
  }
  showConversation();
});
document.querySelector("#legal-toggle").addEventListener("click", () => ui.legal.showModal());
document.querySelector("#legal-close").addEventListener("click", () => ui.legal.close());
ui.infoToggle.addEventListener("click", () => { renderInfoContent(); ui.infoDialog.showModal(); });
document.querySelector("#info-close").addEventListener("click", () => ui.infoDialog.close());
document.addEventListener("click", event => {
  const legalLink = event.target.closest('a[href="#legal-dialog"]');
  if (!legalLink) return;
  event.preventDefault();
  ui.legal.showModal();
});
loadState();
restoreDocumentIndexes();
if (!state.activeConversationId) newConversation();
populateModelList();
renderConversationList();
if (NATIVE) activateNativeModel();
if (IMAGE) loadImagePacks();
renderActiveConversation();
applyLanguage();
if (NATIVE) renderNativeStatus();
initCodeWorkspace();
loadStoredDocuments().then(restored => {
  if (!restored) return;
  restoreDocumentIndexes(true);
  renderDocumentTools();
  ui.downloadInfo.textContent = localizedText(`${restored} document(s) rechargé(s) depuis ce navigateur : vous pouvez les interroger sans re-joindre les fichiers.`, `${restored} document(s) reloaded from this browser: you can question them without attaching the files again.`, `${restored} documento(s) recargado(s) desde este navegador: puedes consultarlos sin volver a adjuntar los archivos.`);
});
detectGpuLimit().then(() => {
  if (state.autoLoadModel && state.cachedModelId === state.selectedModel && modelIsCompatible(MODELS.find(model => model.id === state.selectedModel))) loadWebLLM();
});
setupVoiceRecognition();
restoreDraft();
autoResize();
if (!NATIVE && "serviceWorker" in navigator && location.protocol !== "file:") {
  let reloadingForUpdate = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloadingForUpdate) return;
    reloadingForUpdate = true;
    saveDraft();
    window.location.reload();
  });
  navigator.serviceWorker.register("./service-worker.js").catch(error => console.warn("Service worker unavailable", error));
}
