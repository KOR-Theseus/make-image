import { Buffer } from "node:buffer";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { exportMeshAsset } from "./src/mesh-exporter.js";
import { buildRunId, slugify } from "./src/naming.js";
import { chromaKeyPngFile } from "./src/png-chroma-key.js";
import { WORKFLOWS } from "./public/workflows.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");
const dataDir = path.join(__dirname, "data");
const outputDir = path.join(__dirname, "generated");
const storePath = path.join(dataDir, "prompt-store.json");
const captionOverlayScript = path.join(__dirname, "src", "caption-overlay.swift");
const captionOverlayBinary = path.join(dataDir, "caption-overlay");
const regionCompositeScript = path.join(__dirname, "src", "region-composite.swift");
const regionCompositeBinary = path.join(dataDir, "region-composite");
const port = Number(process.env.PORT || 5173);
const defaultProjectId = "project_default";

await loadLocalEnv();

const apiKey = await resolveOpenAiApiKey();
const adapterMode = process.env.IMAGE_ADAPTER || (apiKey ? "openai" : "codex-cli");

async function loadLocalEnv() {
  try {
    const envPath = path.join(__dirname, ".env");
    const raw = await fs.readFile(envPath, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!match || process.env[match[1]]) continue;
      process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    // .env is optional for local development.
  }
}

async function resolveOpenAiApiKey() {
  return process.env.OPENAI_API_KEY || "";
}

const defaultStore = {
  prompts: [
    {
      id: "prompt_0001",
      title: "앱 캠페인 - 동물 일상",
      body: "{일상행동} 하는 {동물}, {장소} 배경, 따뜻하고 선명한 앱 캠페인 정사각형 이미지",
      slots: ["일상행동", "동물", "장소"],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  ],
  slotSets: [
    { id: "slot_daily", name: "일상행동", keywords: ["산책", "커피 마시기", "책 읽기", "낮잠", "요가"] },
    { id: "slot_animal", name: "동물", keywords: ["고양이", "강아지", "토끼", "여우", "판다"] },
    { id: "slot_place", name: "장소", keywords: ["공원", "카페", "거실", "해변", "서재"] }
  ],
  projects: [
    {
      id: "project_default",
      name: "기본 프로젝트",
      type: "single-image",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  ],
  characterRefs: [],
  meshExports: [],
  jobs: [],
  settings: {
    imageModel: "gpt-image-1.5",
    codexModel: "gpt-5.5",
    resolution: "1200x1200",
    preset: "앱 캠페인 정사각형",
    background: "사용 안함",
    count: 4,
    concurrency: 3,
    retries: 2,
    combinationMode: "random",
    assetMode: "single-image",
    emoticonPackType: "static-32",
    emoticonIncludeText: true,
    emoticonTextMode: "overlay",
    emoticonTextColor: "#1d4ed8",
    emoticonExpressions: "안녕!, 고마워, 미안해, 좋아!, 싫어!, 최고!, 힘내!, 축하해!, 잘자, 배고파, 바빠요, 기다려, 놀람!, 눈물, 웃겨!, 부끄, 화남!, 삐짐, 좋아요, 부탁해, 오케이, 안돼!, 가자!, 쉬는중, 생각중, 반짝!, 심쿵, 졸려, 대박!, 보고싶어, 사랑해, 빠이!",
    gifFrameStrategy: "separate",
    gifCutPreset: 4,
    gifFrameDelay: 12,
    revealVideoSeconds: 1.2,
    spriteDirections: "S, SW, W, NW, N, NE, E, SE",
    spriteActions: "idle, walk, attack, death",
    spriteFrames: 4,
    characterLock: "same character, same costume, same proportions, same silhouette, same palette",
    sceneChoices: "approach cautiously, ask for help, draw weapon",
    threeDViews: "front, left side, back, right side, 3/4 front, 3/4 back",
    threeDActions: "idle, walk, run, attack, hit react, death",
    threeDFrames: 6,
    threeDTargetFormat: "OBJ",
    threeDStyle: "stylized game character, clean topology-friendly forms, readable silhouette",
    meshAssetKind: "forest-terrain",
    meshTileSize: 24,
    sliceFrameSize: 256
  },
  stats: {
    totalImages: 0,
    totalJobs: 0,
    sessionTokens: 0,
    accumulatedTokens: 0
  }
};

const workflowIds = new Set(WORKFLOWS.map((workflow) => workflow.id));

function validateCurrentStore(store) {
  if (!Array.isArray(store.projects) || !store.projects.length) throw new Error("프로젝트 데이터가 없습니다.");
  if (!Array.isArray(store.jobs)) throw new Error("작업 데이터가 올바르지 않습니다.");
  const projectIds = new Set(store.projects.map((project) => project.id));
  const invalidJob = store.jobs.find((job) => (
    !job.id || !job.projectId || !projectIds.has(job.projectId) || !job.chainId || !workflowIds.has(job.projectType)
  ));
  if (invalidJob) throw new Error(`현재 작업 스키마와 맞지 않는 데이터가 있습니다: ${invalidJob.id || "unknown"}`);
  return store;
}

async function ensureStore() {
  await fs.mkdir(dataDir, { recursive: true });
  await fs.mkdir(outputDir, { recursive: true });
  try {
    await fs.access(storePath);
  } catch {
    await fs.writeFile(storePath, JSON.stringify(defaultStore, null, 2));
  }
}

async function readStore() {
  await ensureStore();
  const raw = await fs.readFile(storePath, "utf8");
  const parsed = JSON.parse(raw);
  validateCurrentStore(parsed);
  const jobs = parsed.jobs.map((job) => ({
    ...job,
    resultImages: (job.resultImages || []).map(normalizeGeneratedImageUrl)
  }));
  return {
    ...defaultStore,
    ...parsed,
    prompts: parsed.prompts || defaultStore.prompts,
    slotSets: parsed.slotSets || defaultStore.slotSets,
    projects: parsed.projects,
    characterRefs: parsed.characterRefs || [],
    meshExports: parsed.meshExports || [],
    jobs,
    settings: { ...defaultStore.settings, ...(parsed.settings || {}), activeProjectId: parsed.settings?.activeProjectId || parsed.projects[0].id },
    stats: { ...defaultStore.stats, ...(parsed.stats || {}) }
  };
}

async function writeStore(store) {
  await ensureStore();
  await fs.writeFile(storePath, JSON.stringify(store, null, 2));
  return store;
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload)
  });
  res.end(payload);
}

function publicUrlForGenerated(absPath) {
  return `/generated/${path.relative(outputDir, absPath).split(path.sep).join("/")}`;
}

function normalizeGeneratedImageUrl(image) {
  if (!image?.path) return image;
  return { ...image, url: publicUrlForGenerated(image.path) };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 30_000_000) {
        req.destroy();
        reject(new Error("Request body too large"));
      }
    });
    req.on("end", () => resolve(body ? JSON.parse(body) : {}));
    req.on("error", reject);
  });
}

function importedImageExtension(mimeType) {
  return {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif"
  }[mimeType] || "";
}

function parseImageDataUrl(dataUrl) {
  const match = String(dataUrl || "").match(/^data:(image\/(?:png|jpeg|webp|gif));base64,(.+)$/);
  if (!match) throw new Error("PNG, JPG, WEBP, GIF 이미지 파일만 사용할 수 있습니다.");
  const mimeType = match[1];
  const ext = importedImageExtension(mimeType);
  const buffer = Buffer.from(match[2], "base64");
  if (!buffer.length) throw new Error("이미지 파일이 비어 있습니다.");
  return { mimeType, ext, buffer };
}

async function importImageJob({ name, dataUrl, settings, store }) {
  const { mimeType, ext, buffer } = parseImageDataUrl(dataUrl);
  const projectId = settings.activeProjectId || store.projects[0]?.id || defaultProjectId;
  const jobId = buildRunId("import", name || "imported-image");
  const project = store.projects.find((item) => item.id === projectId);
  const jobDir = path.join(outputDir, slugify(project?.name, "미분류-프로젝트"), "영역-편집", jobId);
  await fs.mkdir(jobDir, { recursive: true });
  const fileName = `source.${ext}`;
  const absPath = path.join(jobDir, fileName);
  await fs.writeFile(absPath, buffer);
  const image = {
    id: `${jobId}_1`,
    url: publicUrlForGenerated(absPath),
    path: absPath,
    prompt: `가져온 이미지: ${name || fileName}`,
    status: "completed",
    model: "local-import",
    createdAt: new Date().toISOString(),
    adapter: "local-import",
    mimeType
  };
  return {
    id: jobId,
    title: name || "가져온 이미지",
    storageCategory: "영역 편집",
    promptId: null,
    projectId,
    projectType: "region-edit",
    chainId: settings.chainId || jobId,
    parentJobId: settings.parentJobId || null,
    finalPrompts: [image.prompt],
    status: "completed",
    resultImages: [image],
    tokensUsed: 0,
    retries: 0,
    adapter: "local-import",
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString()
  };
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve) => {
    execFile(command, args, { timeout: options.timeout || 5000, maxBuffer: options.maxBuffer || 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({ ok: !error, stdout: stdout.trim(), stderr: stderr.trim() });
    });
  });
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function extractSlots(prompt) {
  return [...new Set([...prompt.matchAll(/\{([^{}]+)\}/g)].map((match) => match[1].trim()))];
}

function pickKeyword(slotSet, index, mode) {
  if (!slotSet || slotSet.keywords.length === 0) return `{${slotSet?.name || "슬롯"}}`;
  if (mode === "sequential") return slotSet.keywords[index % slotSet.keywords.length];
  return slotSet.keywords[Math.floor(Math.random() * slotSet.keywords.length)];
}

function renderPrompt(template, slotSets, index, mode) {
  const byName = new Map(slotSets.map((slot) => [slot.name, slot]));
  return template.replace(/\{([^{}]+)\}/g, (_, name) => pickKeyword(byName.get(name.trim()), index, mode));
}

function parseCsv(value) {
  return String(value || "")
    .split(/[,，\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseEmoticonCue(value) {
  const [caption, motion] = String(value || "").split("|").map((item) => item.trim());
  return {
    caption: caption || motion || "",
    motion: motion || ""
  };
}

function visibleKoreanCaption(value) {
  return String(value || "")
    .replace(/[^\u3131-\u318e\uac00-\ud7a3!?~.,\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function captionForFrame(settings, index) {
  const expressions = parseCsv(settings.emoticonExpressions);
  const expression = expressions[index % Math.max(expressions.length, 1)] || "";
  return visibleKoreanCaption(parseEmoticonCue(expression).caption);
}

function shouldOverlayEmoticonText(settings) {
  return ["kakao-emoticon-static", "kakao-emoticon-gif"].includes(settings.assetMode)
    && settings.emoticonIncludeText !== false
    && (settings.emoticonTextMode || "overlay") === "overlay";
}

function defaultKoreanMotion(caption, index, frameCount = 4) {
  const phase = index % Math.max(1, Number(frameCount || 4));
  const motions = {
    "안녕": ["손을 아래에서 들어 올리기", "손을 오른쪽으로 크게 흔들기", "손을 왼쪽으로 크게 흔들기", "웃으며 손을 천천히 내리기"],
    "고마워": ["두 손을 모으기", "상체를 살짝 숙이기", "밝게 웃으며 고개 들기", "작게 하트 만들기"],
    "미안해": ["두 손을 앞으로 모으기", "고개를 숙이기", "눈썹을 낮추고 미안한 표정", "조심스럽게 고개 들기"],
    "좋아": ["작게 미소 짓기", "엄지 올리기", "몸을 살짝 통통 튀기기", "엄지를 유지하며 웃기"],
    "싫어": ["고개를 살짝 젓기", "두 팔로 엑스 만들기", "뒤로 한 걸음 물러나기", "단호한 표정 유지"],
    "최고": ["주먹을 쥐고 준비", "양손 엄지 척", "반짝이는 자신감 포즈", "활짝 웃으며 마무리"],
    "힘내": ["주먹을 가슴 앞에 모으기", "응원하듯 팔을 올리기", "몸을 앞으로 살짝 기울이기", "씩씩하게 웃기"],
    "축하해": ["손을 모아 준비", "작은 점프", "양손을 위로 올리기", "꽃가루처럼 반짝이는 축하 포즈"],
    "사랑해": ["가슴 앞에 손 모으기", "작은 하트 만들기", "하트를 앞으로 내밀기", "수줍게 웃기"],
    "빠이": ["작게 손 들기", "손을 옆으로 흔들기", "몸을 살짝 돌리기", "웃으며 손 내리기"]
  };
  const normalized = String(caption || "").replace(/[!~.,\s]/g, "");
  const sequence = motions[normalized] || ["준비 자세", "표정을 크게 바꾸기", "몸을 살짝 움직이기", "원래 자세로 돌아오기"];
  return sequence[phase % sequence.length];
}

function gifFrameCount(settings) {
  return Math.max(2, Math.min(8, Number(settings.gifCutPreset || settings.count || 4)));
}

function gifSheetGrid(frameCount) {
  if (frameCount <= 3) return { columns: 3, rows: 1 };
  if (frameCount <= 4) return { columns: 2, rows: 2 };
  return { columns: 4, rows: 2 };
}

function gifMotionsForSheet(settings) {
  const frameCount = gifFrameCount(settings);
  const expressions = parseCsv(settings.emoticonExpressions);
  const expression = expressions[0] || "안녕";
  const cue = parseEmoticonCue(expression);
  const caption = visibleKoreanCaption(cue.caption);
  return Array.from({ length: frameCount }, (_, index) => cue.motion || defaultKoreanMotion(caption, index, frameCount));
}

function buildGenerationPrompt(finalPrompt, settings, index = 0) {
  if (settings.assetMode === "kakao-emoticon-static") {
    const expressions = parseCsv(settings.emoticonExpressions);
    const expression = expressions[index % Math.max(expressions.length, 1)] || `expression ${index + 1}`;
    const cue = parseEmoticonCue(expression);
    const caption = visibleKoreanCaption(cue.caption);
    const motion = cue.motion || defaultKoreanMotion(caption, index, 1);
    const characterLock = settings.characterLock || "same character identity, same face proportions, same color palette, same silhouette, same outfit/accessories";
    const textRule = settings.emoticonIncludeText === false
      ? "No text, no Korean text, no speech bubble, no logo, no watermark, no UI, no border."
      : shouldOverlayEmoticonText(settings)
        ? "No text at all. Do not render Korean text, English text, letters, numbers, speech bubbles, labels, logos, or captions. The app will add the Korean caption later in a fixed style."
      : `Visible text rule: render exactly this Korean caption only: "${caption}". Do not render English, Latin letters, romanized words, prompt words, frame labels, numbers, or any other text.`;
    return [
      "Create one Korean messenger sticker/emoticon image.",
      `Character concept: ${finalPrompt}`,
      `Expression/action for this one sticker, described for the artist only and never rendered as text: ${motion}.`,
      `Character consistency lock: ${characterLock}.`,
      "Use the exact same original character design and same 3D chibi sticker style across the whole pack: soft toon shading, rounded silhouette, big readable expression, centered full body or upper body.",
      textRule,
      "No logo, no watermark, no UI, no border.",
      "Transparent background if available; otherwise flat pure chroma-key green background with no shadows.",
      "Leave comfortable padding around the character. Final intended canvas is 360x360 PNG."
    ].join("\n");
  }

  if (settings.assetMode === "kakao-emoticon-gif") {
    if ((settings.gifFrameStrategy || "separate") === "sheet") {
      const frameCount = gifFrameCount(settings);
      const grid = gifSheetGrid(frameCount);
      const motions = gifMotionsForSheet(settings);
      const characterLock = settings.characterLock || "same white humanoid figure, same head shape, same proportions, same soft 3D material";
      return [
        `Create one animation sequence sheet for a Korean messenger GIF sticker, containing exactly ${frameCount} frames.`,
        `Character concept: ${finalPrompt}`,
        `Grid layout: exactly ${grid.columns} columns by ${grid.rows} rows, equal square cells, clean gutters, no merged cells.`,
        `Frame order: left to right, top to bottom. Motions by frame: ${motions.map((motion, motionIndex) => `${motionIndex + 1}. ${motion}`).join(" / ")}.`,
        `Character consistency lock: ${characterLock}.`,
        "Draw the same original character in every cell. Keep identical face design, body proportions, silhouette, material, palette, lighting, camera angle, and scale.",
        "Only the action pose changes between cells. Make the sequence read as a smooth loop.",
        "No text at all. Do not render Korean text, English text, letters, numbers, frame labels, captions, speech bubbles, logos, watermarks, UI, or borders inside the cells.",
        "Transparent background if available; otherwise flat pure chroma-key green background with no shadows.",
        "Leave comfortable padding inside every cell. The app will crop each cell into separate 360x360 PNG frames."
      ].join("\n");
    }

    const expressions = parseCsv(settings.emoticonExpressions);
    const expression = expressions[index % Math.max(expressions.length, 1)] || `motion frame ${index + 1}`;
    const cue = parseEmoticonCue(expression);
    const caption = visibleKoreanCaption(cue.caption);
    const motion = cue.motion || defaultKoreanMotion(caption, index, settings.gifCutPreset || settings.count || 4);
    const characterLock = settings.characterLock || "same white humanoid figure, same head shape, same proportions, same soft 3D material";
    const textRule = settings.emoticonIncludeText === false
      ? "No text, no Korean text, no speech bubble, no logo, no watermark, no UI, no border."
      : shouldOverlayEmoticonText(settings)
        ? "No text at all. Do not render Korean text, English text, letters, numbers, speech bubbles, labels, logos, or captions. The app will add the Korean caption later in a fixed style."
      : `Visible text rule: render exactly this Korean caption only: "${caption}". Do not render English, Latin letters, romanized words, prompt words, frame labels, numbers, or any other text. The caption color may be blue, black, yellow, or any readable color; do not use white text on a white character.`;
    return [
      "Create one frame for an animated Korean messenger GIF sticker.",
      `Character concept: ${finalPrompt}`,
      `Animation cue for this frame, described for the artist only and never rendered as text: ${motion}.`,
      `Character consistency lock: ${characterLock}.`,
      "Use the exact same original character design in every frame: cute 3D white humanoid figure, soft clay-like material, rounded simplified body, expressive pose, minimal face.",
      "Only the action pose should change between frames. Keep camera, scale, lighting, material, face design, body proportions, and silhouette consistent.",
      "Make the pose read as one frame of a smooth loop.",
      textRule,
      "No logo, no watermark, no UI, no border.",
      "Transparent background if available; otherwise flat pure chroma-key green background with no shadows.",
      "Leave comfortable padding around the character. Final intended canvas is 360x360 PNG frame."
    ].join("\n");
  }

  if (settings.assetMode === "3d-production-sheet") {
    const views = settings.threeDViews || "front, left side, back, right side, 3/4 front, 3/4 back";
    const characterLock = settings.characterLock || "same character, same costume, same proportions, same silhouette, same palette";
    const targetFormat = settings.threeDTargetFormat || "OBJ";
    const style = settings.threeDStyle || "stylized game character, clean topology-friendly forms, readable silhouette";
    return [
      `Create a 3D game asset production reference sheet intended for ${targetFormat} modeling handoff.`,
      `Character/object concept: ${finalPrompt}`,
      `Target 3D style: ${style}.`,
      `Views to show in a strict grid: ${views}.`,
      `Character consistency lock: ${characterLock}.`,
      "Use orthographic camera views, neutral A-pose or T-pose where possible, consistent scale, identical proportions, identical outfit, and identical accessories across all views.",
      "Show clear silhouette, readable shapes, visible front/back/side design information, simple material/color separation, and topology-friendly details.",
      "No perspective exaggeration, no cinematic action pose, no text, no labels, no numbers, no watermark.",
      "Plain transparent or flat neutral background. This is a 2D reference image for later 3D modeling, not an actual mesh export."
    ].join("\n");
  }

  if (settings.assetMode === "3d-animation-sequence") {
    const actions = settings.threeDActions || "idle, walk, run, attack, hit react, death";
    const frames = settings.threeDFrames || "6";
    const characterLock = settings.characterLock || "same character, same costume, same proportions, same silhouette, same palette";
    const targetFormat = settings.threeDTargetFormat || "OBJ";
    const style = settings.threeDStyle || "stylized game character, clean topology-friendly forms, readable silhouette";
    const background = settings.background === "transparent" || settings.background === "투명 배경"
      ? "transparent background if available; otherwise perfectly flat #00ff00 chroma-key background with no shadows"
      : "plain empty background";
    return [
      `Create a rendered 3D animation sequence sheet for ${targetFormat} rigging and animation handoff.`,
      `Character/object concept: ${finalPrompt}`,
      `Target 3D style: ${style}.`,
      `Actions, top to bottom rows: ${actions}.`,
      `Frames per action, left to right columns: ${frames}.`,
      `Character consistency lock: ${characterLock}.`,
      "Use a strict grid layout with equal-size cells, consistent camera distance, consistent lighting, and consistent scale in every cell.",
      "Each row must show a clear animation progression from anticipation through contact/follow-through or rest state.",
      "Keep the same character identity across all cells: identical face, outfit, proportions, palette, accessories, and silhouette.",
      "No text, no labels, no numbers, no UI, no watermark.",
      `Background: ${background}.`,
      "This is a 2D rendered sequence reference for later 3D rig/animation work, not an actual mesh export."
    ].join("\n");
  }

  if (settings.assetMode === "character-scenes") {
    const choices = expandSceneChoices(settings.sceneChoices, Number(settings.count || 1));
    const choice = choices[index % Math.max(choices.length, 1)] || `choice ${index + 1}`;
    const variant = sceneVariant(index);
    const characterLock = settings.characterLock || "same character, same costume, same proportions, same silhouette, same palette";
    return [
      "Create one game/dialogue scene illustration for a simulation or branching-choice game.",
      `Main character and story context: ${finalPrompt}`,
      `Scene choice/state to depict for this image only: ${choice}.`,
      `Make this image visually distinct from other batch images: ${variant}.`,
      `Character consistency lock: ${characterLock}.`,
      "Keep the same character identity if a reference image is attached.",
      "Show a clear readable scene, suitable for a player choice card or visual novel event.",
      "No text, no UI labels, no watermark. Leave space if UI text will be overlaid later."
    ].join("\n");
  }

  if (settings.assetMode !== "sprite-sheet") return finalPrompt;

  const directions = settings.spriteDirections || "S, SW, W, NW, N, NE, E, SE";
  const actions = settings.spriteActions || "idle, walk, attack, death";
  const frames = settings.spriteFrames || "4";
  const characterLock = settings.characterLock || "same character, same costume, same proportions, same silhouette, same palette";
  const background = settings.background === "transparent" || settings.background === "투명 배경"
    ? "transparent background if available; otherwise perfectly flat #00ff00 chroma-key background with no shadows"
    : "plain empty background";

  return [
    "Create a game-ready sprite sheet.",
    `Character concept: ${finalPrompt}`,
    `Character consistency lock: ${characterLock}.`,
    `Directions, left to right inside each action row: ${directions}.`,
    `Actions, top to bottom rows: ${actions}.`,
    `Frames per action-direction sequence: ${frames}.`,
    "Use a strict grid layout with equal-size cells and consistent character scale in every cell.",
    "Keep the same character identity across all cells: identical face, outfit, body proportions, color palette, weapon/accessories, and silhouette.",
    "Show readable animation progression for movement, attack, and death sequences.",
    "No text, no labels, no numbers, no UI, no watermark.",
    `Background: ${background}.`,
    "Pixel-art, 2D game sprite, clean edges, centered in each frame."
  ].join("\n");
}

async function saveRegionReferenceImage({ referenceImage, jobDir }) {
  if (!referenceImage?.dataUrl) return null;
  const { mimeType, ext, buffer } = parseImageDataUrl(referenceImage.dataUrl);
  const safeName = slugify(referenceImage.name || "reference", "reference");
  const filePath = path.join(jobDir, `reference_${Date.now()}_${safeName}.${ext}`);
  await fs.writeFile(filePath, buffer);
  return {
    name: referenceImage.name || "reference image",
    mimeType,
    path: filePath,
    url: publicUrlForGenerated(filePath)
  };
}

function buildRegionEditPrompt({ image, region, requestText, reference, sourceDimensions }) {
  const bounds = `x ${Math.round(region.x)}%, y ${Math.round(region.y)}%, width ${Math.round(region.width)}%, height ${Math.round(region.height)}%`;
  const sizeRule = sourceDimensions
    ? `Output must preserve the source image canvas size and aspect ratio exactly: ${sourceDimensions.width}x${sourceDimensions.height}. Do not square-crop, downscale, stretch, or remake the full image at a lower resolution.`
    : "Output must preserve the source image canvas size and aspect ratio. Do not square-crop, downscale, stretch, or remake the full image at a lower resolution.";
  return [
    "Edit the attached source image using an image model.",
    "The first attached image is the source image.",
    reference ? "The second attached image is a visual reference for the selected region only. Do not paste the whole reference photo into the source image." : "",
    sizeRule,
    "Keep all unselected pixels as visually identical to the source as possible: preserve sharpness, text, edges, UI details, texture, and color outside the selected region.",
    "Preserve the overall composition, camera, style, lighting, and all areas outside the selected region.",
    `Selected region bounds: ${bounds}.`,
    reference
      ? `Replace or restyle the selected region using only the relevant subject/material/detail from the reference image. Do not copy unrelated background, white trays, inner fillers, labels, table surfaces, hands, shadows, or objects unless the user explicitly asks for them. Request: ${requestText || region.orderText || "match the reference image"}.`
      : `Edit request for that region only: ${requestText || region.orderText || "refine the selected area"}.`,
    "If the request mentions a transparent lid, plastic cover, glass, or clear object, preserve transparency and show only that object detail. Avoid adding opaque white fill on the opposite side unless it already exists in the selected source area.",
    "Return a complete edited image, not a mask, crop, annotation, wireframe, UI mockup, or explanation.",
    `Source image note: ${image.prompt || image.id}.`
  ].filter(Boolean).join("\n");
}

async function editRegionImage({ jobId, imageId, regionId, requestText, referenceImage, settings, store }) {
  const job = store.jobs.find((item) => item.id === jobId);
  if (!job) throw new Error("편집할 작업을 찾을 수 없습니다.");
  const image = (job.resultImages || []).find((item) => item.id === imageId);
  if (!image?.path) throw new Error("편집할 원본 이미지를 찾을 수 없습니다.");
  const region = (image.regions || []).find((item) => item.id === regionId);
  if (!region) throw new Error("편집할 영역을 찾을 수 없습니다.");
  if (adapterMode !== "codex-cli") throw new Error("영역 편집은 현재 Codex CLI 이미지 도구에서 실행됩니다.");

  const now = new Date().toISOString();
  region.orderText = requestText || region.orderText || "";
  region.status = "queued";
  region.model = settings.imageModel || defaultStore.settings.imageModel;
  region.updatedAt = now;
  image.editHistory = image.editHistory || [];
  image.editHistory.unshift({
    id: `history_${Date.now()}`,
    action: "이미지 모델 편집 대기",
    regionId,
    note: region.orderText,
    status: region.status,
    model: region.model,
    createdAt: now
  });

  try {
    region.status = "editing";
    const jobDir = path.join(path.dirname(image.path), "region_edits");
    await fs.mkdir(jobDir, { recursive: true });
    const reference = await saveRegionReferenceImage({ referenceImage, jobDir });
    if (reference) region.referenceImage = reference;
    const sourceDimensions = await getImageDimensions(image.path);
    const finalPrompt = buildRegionEditPrompt({ image, region, requestText: region.orderText, reference, sourceDimensions });
    const editedImage = await generateCodexCliImage({
      finalPrompt,
      index: job.resultImages.length,
      settings: {
        ...settings,
        assetMode: "single-image",
        resolution: `${sourceDimensions.width}x${sourceDimensions.height}`,
        _preserveSourceResolution: true,
        referenceImagePaths: [image.path, reference?.path].filter(Boolean)
      },
      jobDir
    });
    const modelOutputPath = editedImage.path;
    const compositePath = path.join(jobDir, `composite_${String(job.resultImages.length + 1).padStart(2, "0")}_${Date.now()}.png`);
    await compositeEditedRegion({
      sourcePath: image.path,
      editPath: modelOutputPath,
      region,
      outputPath: compositePath,
      mode: "percent"
    });
    const resultPath = compositePath;
    editedImage.id = `${job.id}_edit_${Date.now()}`;
    editedImage.url = publicUrlForGenerated(resultPath);
    editedImage.path = resultPath;
    editedImage.prompt = finalPrompt;
    editedImage.parentImageId = image.id;
    editedImage.sourceRegionId = region.id;
    editedImage.modelOutputPath = modelOutputPath;
    editedImage.modelOutputUrl = publicUrlForGenerated(modelOutputPath);
    editedImage.compositeMode = "region-composite";
    editedImage.status = "completed";
    job.resultImages.push(editedImage);
    region.status = "done";
    region.resultImageId = editedImage.id;
    region.updatedAt = new Date().toISOString();
    image.editHistory.unshift({
      id: `history_${Date.now() + 1}`,
      action: "이미지 모델 편집 완료",
      regionId,
      note: region.orderText,
      status: region.status,
      model: region.model,
      referenceImage: region.referenceImage || null,
      resultImageId: editedImage.id,
      createdAt: region.updatedAt
    });
    job.status = "completed";
    job.finishedAt = region.updatedAt;
    return editedImage;
  } catch (error) {
    region.status = "failed";
    region.updatedAt = new Date().toISOString();
    image.editHistory.unshift({
      id: `history_${Date.now() + 2}`,
      action: "이미지 모델 편집 실패",
      regionId,
      note: error.message || "편집 실패",
      status: region.status,
      model: region.model,
      createdAt: region.updatedAt
    });
    throw error;
  }
}

function expandSceneChoices(value, count) {
  const choices = parseCsv(value);
    const defaultChoices = [
    "talking to villagers in a warm marketplace",
    "entering a dark forest path alone",
    "raising shield against an enemy ambush",
    "discovering a glowing ancient ruin",
    "resting beside a campfire at night",
    "finding a wounded traveler on the road",
    "negotiating with a suspicious merchant",
    "standing before a locked castle gate",
    "crossing a rain-soaked bridge",
    "celebrating after a small victory at dawn",
    "searching a quiet library for a map",
    "protecting a child during a town evacuation"
  ];
  const source = choices.length ? choices : defaultChoices;
  return Array.from({ length: Math.max(count, source.length) }, (_, index) => source[index % source.length]);
}

function sceneVariant(index) {
  const variants = [
    "wide establishing shot, warm morning light, village background, hopeful expression",
    "medium shot, cool dusk light, forest background, cautious expression",
    "low-angle action shot, harsh sunlight, enemy foreground silhouette, determined expression",
    "over-the-shoulder shot, mysterious green glow, ancient stone background, surprised expression",
    "cozy campfire lighting, night sky, relaxed seated pose, thoughtful expression",
    "close conversational shot, dusty road background, concerned expression",
    "market stall composition, busy background, skeptical expression",
    "dramatic castle gate composition, cloudy sky, resolute stance",
    "rainy blue lighting, bridge and river background, tense pose",
    "bright sunrise victory pose, open field background, relieved smile",
    "quiet interior library lighting, shelves and map table, focused expression",
    "urgent evacuation scene, smoke in distance, protective stance"
  ];
  return variants[index % variants.length];
}

function normalizeImageSize(size) {
  const value = String(size || "1024x1024").replace("×", "x");
  if (["1024x1024", "1024x1536", "1536x1024"].includes(value)) return value;
  if (value === "1200x1200") return "1024x1024";
  return "1024x1024";
}

async function resizeImageIfRequested(imagePath, settings) {
  const size = String(settings.resolution || "").replace("×", "x");
  const match = size.match(/^(\d+)x\1$/);
  if (!match) return;
  const pixels = Number(match[1]);
  if (!pixels || pixels > 2048) return;
  const result = await runCommand("sips", ["-z", String(pixels), String(pixels), imagePath], { timeout: 10000, maxBuffer: 1024 * 1024 });
  if (!result.ok) throw new Error(`이미지 리사이즈 실패: ${result.stderr || result.stdout}`);
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function ensureCaptionOverlayBinary() {
  const [sourceStat, binaryStat] = await Promise.all([
    fs.stat(captionOverlayScript),
    fs.stat(captionOverlayBinary).catch(() => null)
  ]);
  if (binaryStat && binaryStat.mtimeMs >= sourceStat.mtimeMs) return captionOverlayBinary;
  await fs.mkdir(dataDir, { recursive: true });
  const result = await runCommand("swiftc", [captionOverlayScript, "-o", captionOverlayBinary], { timeout: 30000, maxBuffer: 2 * 1024 * 1024 });
  if (!result.ok) throw new Error(`문구 오버레이 도구 빌드 실패: ${result.stderr || result.stdout}`);
  return captionOverlayBinary;
}

async function ensureRegionCompositeBinary() {
  const [sourceStat, binaryStat] = await Promise.all([
    fs.stat(regionCompositeScript),
    fs.stat(regionCompositeBinary).catch(() => null)
  ]);
  if (binaryStat && binaryStat.mtimeMs >= sourceStat.mtimeMs) return regionCompositeBinary;
  await fs.mkdir(dataDir, { recursive: true });
  const result = await runCommand("swiftc", [regionCompositeScript, "-o", regionCompositeBinary], { timeout: 30000, maxBuffer: 2 * 1024 * 1024 });
  if (!result.ok) throw new Error(`영역 합성 도구 빌드 실패: ${result.stderr || result.stdout}`);
  return regionCompositeBinary;
}

async function compositeEditedRegion({ sourcePath, editPath, region, outputPath, mode = "percent" }) {
  const compositeBinary = await ensureRegionCompositeBinary();
  const result = await runCommand(compositeBinary, [
    sourcePath,
    editPath,
    outputPath,
    String(region.x || 0),
    String(region.y || 0),
    String(region.width || 0),
    String(region.height || 0),
    mode
  ], { timeout: 30000, maxBuffer: 2 * 1024 * 1024 });
  if (!result.ok) throw new Error(`영역 합성 실패: ${result.stderr || result.stdout}`);
}

function normalizeHexColor(value, fallback = "#1d4ed8") {
  const color = String(value || "").trim();
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color : fallback;
}

async function drawKoreanCaption(imagePath, caption, settings) {
  const text = visibleKoreanCaption(caption);
  if (!text) return;
  const fontPath = "/System/Library/Fonts/AppleSDGothicNeo.ttc";
  if (!(await fileExists(fontPath))) return;
  const parsed = path.parse(imagePath);
  const tmpPath = path.join(parsed.dir, `${parsed.name}_caption_${Date.now()}.png`);
  const fontSize = Number(settings.emoticonTextSize || 46);
  const textColor = normalizeHexColor(settings.emoticonTextColor, "#1d4ed8");
  const overlayBinary = await ensureCaptionOverlayBinary();
  const result = await runCommand(overlayBinary, [imagePath, tmpPath, text, textColor, String(fontSize)], { timeout: 10000, maxBuffer: 2 * 1024 * 1024 });
  if (!result.ok) {
    await fs.rm(tmpPath, { force: true }).catch(() => {});
    throw new Error(`문구 오버레이 실패: ${result.stderr || result.stdout}`);
  }
  await fs.rename(tmpPath, imagePath);
}

async function postProcessImage(imagePath, settings, index = 0) {
  if (settings._skipEmoticonPostProcess) return;
  if (!settings._preserveSourceResolution) await resizeImageIfRequested(imagePath, settings);
  if (["kakao-emoticon-static", "kakao-emoticon-gif"].includes(settings.assetMode)) {
    await chromaKeyPngFile(imagePath, { key: [0, 255, 0], tolerance: 86 });
    if (shouldOverlayEmoticonText(settings)) {
      await drawKoreanCaption(imagePath, captionForFrame(settings, index), settings);
    }
  }
}

function extensionForFormat(format) {
  return format === "jpeg" ? "jpg" : format;
}

async function generateOpenAiImage({ finalPrompt, index, settings, jobDir }) {
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY가 없어 실제 OpenAI 이미지 생성에 연결할 수 없습니다.");
  }

  const outputFormat = settings.outputFormat || "png";
  const response = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: settings.imageModel || "gpt-image-1.5",
      prompt: finalPrompt,
      n: 1,
      size: normalizeImageSize(settings.resolution),
      quality: settings.quality || "medium",
      output_format: outputFormat
    })
  });

  const bodyText = await response.text();
  let body;
  try {
    body = JSON.parse(bodyText);
  } catch {
    body = {};
  }

  if (!response.ok) {
    throw new Error(body.error?.message || `OpenAI Image API failed with ${response.status}`);
  }

  const item = body.data?.[0];
  const b64 = item?.b64_json || item?.image_base64;
  if (!b64) {
    throw new Error("OpenAI Image API 응답에 이미지 base64 데이터가 없습니다.");
  }

  const fileName = `image_${String(index + 1).padStart(2, "0")}.${extensionForFormat(outputFormat)}`;
  const absPath = path.join(jobDir, fileName);
  await fs.writeFile(absPath, Buffer.from(b64, "base64"));
  await postProcessImage(absPath, settings, index);

  return {
    id: `image_${Date.now()}_${index + 1}`,
    url: publicUrlForGenerated(absPath),
    path: absPath,
    prompt: finalPrompt,
    status: "completed",
    model: settings.imageModel,
    createdAt: new Date().toISOString(),
    usage: body.usage || null
  };
}

async function generateCodexCliImage({ finalPrompt, index, settings, jobDir }) {
  const fileName = `image_${String(index + 1).padStart(2, "0")}.png`;
  const absPath = path.join(jobDir, fileName);
  const messagePath = path.join(jobDir, `codex_message_${String(index + 1).padStart(2, "0")}.txt`);
  const prompt = [
    "Use the available image generation tool to create one real AI-generated raster image.",
    "Do not create SVG, HTML, canvas, or a placeholder.",
    (settings.referenceImagePaths?.length || settings.referenceImagePath)
      ? "Reference image(s) are attached. Use them according to the prompt while preserving identity, composition, or replacement details as requested."
      : "",
    `Prompt: ${buildGenerationPrompt(finalPrompt, settings, index)}`,
    `Save or copy the generated PNG exactly to this path: ${absPath}`,
    `Target size/preset requested by the app: ${settings.resolution || "1024x1024"}`,
    "After saving it, verify with the file command. If no image generation tool is available, say exactly NO_IMAGE_TOOL_AVAILABLE."
  ].join("\n");

  const logPath = path.join(jobDir, `codex_exec_${String(index + 1).padStart(2, "0")}.log`);
  const command = [
    "codex",
    "exec",
    "--model",
    shellQuote(settings.codexExecModel || process.env.CODEX_EXEC_MODEL || "gpt-5.4"),
    "--skip-git-repo-check",
    "--sandbox",
    "workspace-write",
    "--add-dir",
    shellQuote(outputDir),
    ...[...(settings.referenceImagePaths || []), settings.referenceImagePath].filter(Boolean).flatMap((imagePath) => ["--image", shellQuote(imagePath)]),
    "--output-last-message",
    shellQuote(messagePath),
    shellQuote(prompt),
    ">",
    shellQuote(logPath),
    "2>&1",
    "<",
    "/dev/null"
  ].join(" ");

  const result = await runCommand("/bin/zsh", ["-lc", command], { timeout: 10 * 60 * 1000, maxBuffer: 1024 * 1024 });

  const stat = await fs.stat(absPath).catch(() => null);

  if (!stat || stat.size === 0) {
    const message = await fs.readFile(messagePath, "utf8").catch(() => "");
    const log = await fs.readFile(logPath, "utf8").catch(() => "");
    throw new Error(message.includes("NO_IMAGE_TOOL_AVAILABLE")
      ? "Codex CLI에서 이미지 생성 도구를 사용할 수 없습니다."
      : `Codex CLI 이미지 생성 실패: ${message || log || result.stderr || result.stdout || "이미지 파일이 생성되지 않았습니다."}`);
  }

  await postProcessImage(absPath, settings, index);

  return {
    id: `image_${Date.now()}_${index + 1}`,
    url: publicUrlForGenerated(absPath),
    path: absPath,
    prompt: finalPrompt,
    status: "completed",
    model: settings.imageModel || "codex-cli-image-tool",
    createdAt: new Date().toISOString(),
    adapter: "codex-cli"
  };
}

async function getImageDimensions(imagePath) {
  const result = await runCommand("sips", ["-g", "pixelWidth", "-g", "pixelHeight", imagePath], { timeout: 5000 });
  const width = Number(result.stdout.match(/pixelWidth:\s*(\d+)/)?.[1]);
  const height = Number(result.stdout.match(/pixelHeight:\s*(\d+)/)?.[1]);
  if (!width || !height) throw new Error(`이미지 크기를 읽을 수 없습니다: ${imagePath}`);
  return { width, height };
}

async function sliceSpriteSheet({ imagePath, frameSize = 256, columns, rows, jobId }) {
  const size = Math.max(16, Math.min(1024, Number(frameSize || 256)));
  const dimensions = await getImageDimensions(imagePath);
  const cols = Math.max(1, Math.min(64, Number(columns || Math.floor(dimensions.width / size))));
  const rowCount = Math.max(1, Math.min(64, Number(rows || Math.floor(dimensions.height / size))));
  const baseName = path.basename(imagePath, path.extname(imagePath));
  const outDir = path.join(path.dirname(imagePath), `${baseName}_frames_${size}`);
  await fs.mkdir(outDir, { recursive: true });

  const frames = [];
  for (let row = 0; row < rowCount; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const x = col * size;
      const y = row * size;
      if (x + size > dimensions.width || y + size > dimensions.height) continue;
      const frameName = `row_${String(row + 1).padStart(2, "0")}_col_${String(col + 1).padStart(2, "0")}.png`;
      const framePath = path.join(outDir, frameName);
      const cropX = x === 0 && y > 0 ? 1 : x;
      const result = await runCommand("sips", [
        "-c",
        String(size),
        String(size),
        "--cropOffset",
        String(y),
        String(cropX),
        imagePath,
        "--out",
        framePath
      ], { timeout: 10000, maxBuffer: 1024 * 1024 });
      if (!result.ok) throw new Error(`프레임 분리 실패: ${result.stderr || result.stdout}`);
      const frameDimensions = await getImageDimensions(framePath);
      if (frameDimensions.width !== size || frameDimensions.height !== size) {
        throw new Error(`프레임 크기 검증 실패: ${frameName} is ${frameDimensions.width}x${frameDimensions.height}, expected ${size}x${size}`);
      }
      frames.push({
        row,
        col,
        index: frames.length,
        path: framePath,
        url: publicUrlForGenerated(framePath)
      });
    }
  }

  const manifest = {
    jobId,
    sourcePath: imagePath,
    sourceUrl: publicUrlForGenerated(imagePath),
    frameSize: size,
    columns: cols,
    rows: rowCount,
    sourceWidth: dimensions.width,
    sourceHeight: dimensions.height,
    frames,
    createdAt: new Date().toISOString()
  };
  const manifestPath = path.join(outDir, "manifest.json");
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  return { ...manifest, manifestPath, manifestUrl: publicUrlForGenerated(manifestPath) };
}

async function sliceGifSequenceSheet({ imagePath, settings, jobId }) {
  const frameCount = gifFrameCount(settings);
  const grid = gifSheetGrid(frameCount);
  const dimensions = await getImageDimensions(imagePath);
  const cellWidth = Math.floor(dimensions.width / grid.columns);
  const cellHeight = Math.floor(dimensions.height / grid.rows);
  const cropSize = Math.max(64, Math.min(cellWidth, cellHeight));
  const outDir = path.join(path.dirname(imagePath), "sequence_frames_360");
  await fs.mkdir(outDir, { recursive: true });

  const frames = [];
  for (let index = 0; index < frameCount; index += 1) {
    const row = Math.floor(index / grid.columns);
    const col = index % grid.columns;
    const x = Math.max(0, Math.round(col * cellWidth + (cellWidth - cropSize) / 2));
    const y = Math.max(0, Math.round(row * cellHeight + (cellHeight - cropSize) / 2));
    const framePath = path.join(outDir, `frame_${String(index + 1).padStart(2, "0")}.png`);
    const crop = await runCommand("sips", [
      "-c",
      String(cropSize),
      String(cropSize),
      "--cropOffset",
      String(y),
      String(x),
      imagePath,
      "--out",
      framePath
    ], { timeout: 10000, maxBuffer: 1024 * 1024 });
    if (!crop.ok) throw new Error(`시퀀스 프레임 분리 실패: ${crop.stderr || crop.stdout}`);
    const resize = await runCommand("sips", ["-z", "360", "360", framePath], { timeout: 10000, maxBuffer: 1024 * 1024 });
    if (!resize.ok) throw new Error(`시퀀스 프레임 리사이즈 실패: ${resize.stderr || resize.stdout}`);
    await postProcessImage(framePath, { ...settings, resolution: "360x360", gifFrameStrategy: "separate" }, index);
    frames.push({
      id: `${jobId}_${index + 1}`,
      url: publicUrlForGenerated(framePath),
      path: framePath,
      prompt: settings._sheetPrompt || "",
      status: "completed",
      model: settings.imageModel || "codex-cli-image-tool",
      createdAt: new Date().toISOString(),
      adapter: adapterMode,
      sourceSheetPath: imagePath,
      sourceSheetUrl: publicUrlForGenerated(imagePath),
      sheetCell: { row, col, cropSize }
    });
  }

  const manifest = {
    jobId,
    sourcePath: imagePath,
    sourceUrl: publicUrlForGenerated(imagePath),
    frameSize: 360,
    sourceWidth: dimensions.width,
    sourceHeight: dimensions.height,
    columns: grid.columns,
    rows: grid.rows,
    frames: frames.map(({ id, url, path: framePath, sheetCell }) => ({ id, url, path: framePath, sheetCell })),
    createdAt: new Date().toISOString()
  };
  const manifestPath = path.join(outDir, "manifest.json");
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  return { frames, manifestPath, manifestUrl: publicUrlForGenerated(manifestPath) };
}

async function makeGifFromImages({ job, images, delay = 12 }) {
  if (!images.length) throw new Error("GIF로 묶을 이미지가 없습니다.");
  const gifPath = path.join(path.dirname(images[0].path), `animated_${Date.now()}.gif`);
  const listPath = path.join(path.dirname(images[0].path), `gif_frames_${Date.now()}.txt`);
  const frameDelay = Math.max(4, Math.min(80, Number(delay || 12))) / 100;
  const list = images
    .map((image) => `file '${String(image.path).replaceAll("'", "'\\''")}'\nduration ${frameDelay}`)
    .join("\n");
  await fs.writeFile(listPath, `${list}\nfile '${String(images[images.length - 1].path).replaceAll("'", "'\\''")}'\n`);
  const result = await runCommand("ffmpeg", [
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    listPath,
    "-vf",
    "fps=12,scale=360:360:flags=lanczos,split[s0][s1];[s0]palettegen=reserve_transparent=1[p];[s1][p]paletteuse=alpha_threshold=128",
    "-loop",
    "0",
    gifPath
  ], { timeout: 120000, maxBuffer: 1024 * 1024 * 4 });
  if (!result.ok) throw new Error(`GIF 생성 실패: ${result.stderr || result.stdout}`);
  const stat = await fs.stat(gifPath);
  const gif = {
    id: `gif_${Date.now()}`,
    jobId: job.id,
    path: gifPath,
    url: publicUrlForGenerated(gifPath),
    frameCount: images.length,
    sizeBytes: stat.size,
    createdAt: new Date().toISOString()
  };
  job.gifs = [gif, ...(job.gifs || [])];
  return gif;
}

async function makeRevealVideoFromImages({ job, images, seconds = 1.2 }) {
  if (!images.length) throw new Error("영상으로 묶을 이미지가 없습니다.");
  const dir = path.dirname(images[0].path);
  const videoPath = path.join(dir, `reveal_${Date.now()}.mp4`);
  const listPath = path.join(dir, `video_frames_${Date.now()}.txt`);
  const duration = Math.max(0.4, Math.min(5, Number(seconds || 1.2)));
  const list = images
    .map((image) => `file '${String(image.path).replaceAll("'", "'\\''")}'\nduration ${duration}`)
    .join("\n");
  await fs.writeFile(listPath, `${list}\nfile '${String(images[images.length - 1].path).replaceAll("'", "'\\''")}'\n`);
  const result = await runCommand("ffmpeg", [
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    listPath,
    "-vf",
    "fps=30,scale=360:360:flags=lanczos,format=yuv420p",
    "-movflags",
    "+faststart",
    videoPath
  ], { timeout: 120000, maxBuffer: 1024 * 1024 * 4 });
  if (!result.ok) throw new Error(`영상 생성 실패: ${result.stderr || result.stdout}`);
  const stat = await fs.stat(videoPath);
  const video = {
    id: `video_${Date.now()}`,
    jobId: job.id,
    path: videoPath,
    url: publicUrlForGenerated(videoPath),
    frameCount: images.length,
    sizeBytes: stat.size,
    secondsPerCut: duration,
    createdAt: new Date().toISOString()
  };
  job.videos = [video, ...(job.videos || [])];
  return video;
}

async function generateCharacterReference({ prompt, settings, store }) {
  const now = Date.now();
  const refId = `char_${now}_${slugify(prompt, "character")}`;
  const refDir = path.join(outputDir, "characters", refId);
  await fs.mkdir(refDir, { recursive: true });
  const refPrompt = [
    "single full-body character reference sheet, front-facing neutral pose, centered",
    "clean silhouette, readable outfit, no background props, no text, no labels",
    "plain transparent or flat chroma-key background",
    prompt
  ].join(", ");
  const image = await generateCodexCliImage({
    finalPrompt: refPrompt,
    index: 0,
    settings: { ...settings, assetMode: "single-image", background: "transparent" },
    jobDir: refDir
  });
  const ref = {
    id: refId,
    title: settings.characterName || `캐릭터 ${store.characterRefs.length + 1}`,
    prompt,
    imagePath: image.path,
    imageUrl: publicUrlForGenerated(image.path),
    lock: settings.characterLock || defaultStore.settings.characterLock,
    createdAt: new Date().toISOString()
  };
  store.characterRefs.unshift(ref);
  store.settings.activeCharacterRefId = ref.id;
  store.settings.characterLock = ref.lock;
  return ref;
}

function saveCharacterReferenceFromImage({ jobId, imageId, title, prompt, lock, settings, store }) {
  const job = store.jobs.find((item) => item.id === jobId);
  if (!job) throw new Error("캐릭터로 저장할 작업을 찾을 수 없습니다.");
  const image = (job.resultImages || []).find((item) => item.id === imageId);
  if (!image?.path) throw new Error("저장할 이미지 파일 경로가 없습니다.");
  const ref = {
    id: `char_${Date.now()}_${slugify(title || prompt || image.prompt || "saved-character", "character")}`,
    title: title || `캐릭터 ${store.characterRefs.length + 1}`,
    prompt: prompt || image.prompt || job.finalPrompts?.[0] || "저장한 캐릭터",
    imagePath: image.path,
    imageUrl: publicUrlForGenerated(image.path),
    sourceJobId: job.id,
    sourceImageId: image.id,
    lock: lock || settings.characterLock || defaultStore.settings.characterLock,
    createdAt: new Date().toISOString()
  };
  store.characterRefs.unshift(ref);
  store.settings.activeCharacterRefId = ref.id;
  store.settings.useCharacterRef = true;
  store.settings.characterLock = ref.lock;
  return ref;
}

async function generateImages({ prompt, settings, store }) {
  const maxCount = ["kakao-emoticon-static", "kakao-emoticon-gif"].includes(settings.assetMode) ? 32 : 12;
  const isGifSheet = settings.assetMode === "kakao-emoticon-gif" && (settings.gifFrameStrategy || "separate") === "sheet";
  const count = isGifSheet ? 1 : Math.max(1, Math.min(maxCount, Number(settings.count || 1)));
  const concurrency = Math.max(1, Math.min(12, Number(settings.concurrency || 1)));
  const mode = settings.combinationMode || "random";
  const jobId = buildRunId("job", prompt);
  const finalPrompts = Array.from({ length: count }, (_, index) => renderPrompt(prompt, store.slotSets, index, mode));
  const resultImages = [];
  const projectId = settings.activeProjectId || store.projects[0]?.id || defaultProjectId;
  const project = store.projects.find((item) => item.id === projectId);
  const jobDir = path.join(outputDir, slugify(project?.name, "미분류-프로젝트"), slugify(settings.assetMode || "single-image"), jobId);
  await fs.mkdir(jobDir, { recursive: true });

  if (isGifSheet) {
    const sheetSettings = {
      ...settings,
      count: 1,
      resolution: "1024x1024",
      emoticonIncludeText: false,
      _skipEmoticonPostProcess: true,
      _sheetPrompt: finalPrompts[0]
    };
    const sheetImage = adapterMode === "codex-cli"
      ? await generateCodexCliImage({ finalPrompt: finalPrompts[0], index: 0, settings: sheetSettings, jobDir })
      : await generateOpenAiImage({ finalPrompt: finalPrompts[0], index: 0, settings: sheetSettings, jobDir });
    sheetImage.id = `${jobId}_sheet`;
    const sliced = await sliceGifSequenceSheet({
      imagePath: sheetImage.path,
      settings: { ...settings, _sheetPrompt: finalPrompts[0] },
      jobId
    });
    return {
      id: jobId,
      title: finalPrompts[0],
      storageCategory: settings.assetMode || "single-image",
      promptId: null,
      projectId: settings.activeProjectId || store.projects[0]?.id || defaultProjectId,
      projectType: settings.assetMode || "single-image",
      chainId: settings.chainId || jobId,
      parentJobId: settings.parentJobId || null,
      finalPrompts: Array.from({ length: sliced.frames.length }, () => finalPrompts[0]),
      status: "completed",
      resultImages: sliced.frames,
      sourceSheets: [{ ...sheetImage, slicesManifestPath: sliced.manifestPath, slicesManifestUrl: sliced.manifestUrl }],
      tokensUsed: Number(sheetImage.usage?.total_tokens || 0) || Math.ceil(prompt.length / 4) + 120,
      retries: Number(settings.retries || 0),
      adapter: adapterMode,
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString()
    };
  }

  const workers = Array.from({ length: Math.min(concurrency, finalPrompts.length) }, async (_, workerIndex) => {
    for (let index = workerIndex; index < finalPrompts.length; index += concurrency) {
      const image = adapterMode === "codex-cli"
        ? await generateCodexCliImage({ finalPrompt: finalPrompts[index], index, settings, jobDir })
        : await generateOpenAiImage({ finalPrompt: finalPrompts[index], index, settings, jobDir });
      image.id = `${jobId}_${index + 1}`;
      resultImages[index] = image;
    }
  });
  await Promise.all(workers);

  const usageTotal = resultImages.reduce((sum, image) => sum + Number(image.usage?.total_tokens || 0), 0);
  return {
    id: jobId,
    title: finalPrompts[0],
    storageCategory: settings.assetMode || "single-image",
    promptId: null,
    projectId: settings.activeProjectId || store.projects[0]?.id || defaultProjectId,
    projectType: settings.assetMode || "single-image",
    chainId: settings.chainId || jobId,
    parentJobId: settings.parentJobId || null,
    finalPrompts,
    status: "completed",
    resultImages,
    tokensUsed: usageTotal || Math.ceil(prompt.length / 4) + count * 80,
    retries: Number(settings.retries || 0),
    adapter: adapterMode,
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString()
  };
}

function touchActiveProject(store, settings, job) {
  const projectId = settings.activeProjectId || store.projects[0]?.id || defaultStore.projects[0].id;
  let project = store.projects.find((item) => item.id === projectId);
  if (!project) {
    project = {
      id: projectId,
      name: "새 프로젝트",
      type: settings.assetMode || "single-image",
      createdAt: new Date().toISOString()
    };
    store.projects.unshift(project);
  }
  if (settings.assetMode !== "region-edit" || !project.type) {
    project.type = settings.assetMode || project.type || "single-image";
  }
  project.updatedAt = new Date().toISOString();
  project.jobIds = [job.id, ...(project.jobIds || []).filter((id) => id !== job.id)];
  project.coverImage = job.resultImages?.[0]?.url || project.coverImage || null;
}

async function handleApi(req, res) {
  if (req.method === "GET" && req.url === "/api/state") {
    sendJson(res, 200, await readStore());
    return;
  }

  if (req.method === "GET" && req.url === "/api/preflight") {
    const codex = await runCommand("codex", ["--version"]);
    sendJson(res, 200, {
      codexInstalled: codex.ok,
      codexVersion: codex.ok ? codex.stdout || "codex" : "",
      openaiApiKey: Boolean(apiKey),
      imageAdapter: adapterMode,
      oauthStatus: codex.ok ? "unknown" : "missing",
      note: adapterMode === "codex-cli" && codex.ok
        ? "Codex CLI 이미지 도구에 실제 연결됩니다."
        : adapterMode === "codex-cli"
          ? "Codex CLI 어댑터 모드입니다. codex CLI 실행이 필요합니다."
          : adapterMode === "openai" && apiKey
        ? "OpenAI Image API에 실제 연결됩니다."
        : "실제 OpenAI 어댑터 모드입니다. OPENAI_API_KEY가 필요합니다."
    });
    return;
  }

  if (req.method === "POST" && req.url === "/api/export-3d") {
    const body = await readBody(req);
    const store = await readStore();
    const prompt = String(body.prompt || "").trim() || "forest terrain block kit";
    const settings = { ...store.settings, ...(body.settings || {}) };
    const meshExport = await exportMeshAsset({
      prompt,
      settings,
      outputDir,
      publicUrlForGenerated
    });
    meshExport.projectId = settings.activeProjectId || store.projects[0]?.id || defaultProjectId;
    store.meshExports.unshift(meshExport);
    store.settings = settings;
    sendJson(res, 200, await writeStore(store));
    return;
  }

  if (req.method === "POST" && req.url === "/api/state") {
    const incoming = await readBody(req);
    const nextStore = validateCurrentStore({ ...defaultStore, ...incoming });
    sendJson(res, 200, await writeStore(nextStore));
    return;
  }

  if (req.method === "POST" && req.url === "/api/prompts") {
    const body = await readBody(req);
    const store = await readStore();
    const now = new Date().toISOString();
    const prompt = {
      id: body.id || `prompt_${Date.now()}`,
      title: body.title || "제목 없는 프롬프트",
      body: body.body || "",
      slots: extractSlots(body.body || ""),
      createdAt: body.createdAt || now,
      updatedAt: now
    };
    const index = store.prompts.findIndex((item) => item.id === prompt.id);
    if (index >= 0) store.prompts[index] = prompt;
    else store.prompts.unshift(prompt);
    sendJson(res, 200, await writeStore(store));
    return;
  }

  if (req.method === "POST" && req.url === "/api/import-image") {
    const body = await readBody(req);
    const store = await readStore();
    const settings = { ...store.settings, ...(body.settings || {}) };
    const job = await importImageJob({
      name: body.name || "imported-image",
      dataUrl: body.dataUrl,
      settings,
      store
    });
    store.jobs.unshift(job);
    touchActiveProject(store, { ...settings, assetMode: "region-edit" }, job);
    store.settings = settings;
    store.stats.totalImages += 1;
    store.stats.totalJobs += 1;
    sendJson(res, 200, await writeStore(store));
    return;
  }

  if (req.method === "POST" && req.url === "/api/edit-region") {
    const body = await readBody(req);
    if (!body.jobId || !body.imageId || !body.regionId) {
      sendJson(res, 400, { error: "편집할 작업, 이미지, 영역을 지정해야 합니다." });
      return;
    }
    const store = await readStore();
    const settings = { ...store.settings, ...(body.settings || {}), assetMode: "region-edit" };
    try {
      const editedImage = await editRegionImage({
        jobId: body.jobId,
        imageId: body.imageId,
        regionId: body.regionId,
        requestText: body.requestText,
        referenceImage: body.referenceImage,
        settings,
        store
      });
      store.settings = settings;
      store.stats.totalImages += 1;
      store.stats.accumulatedTokens += Number(editedImage.usage?.total_tokens || 0);
      const nextStore = await writeStore(store);
      sendJson(res, 200, { ...nextStore, editedImageId: editedImage.id });
    } catch (error) {
      store.settings = settings;
      const nextStore = await writeStore(store);
      sendJson(res, 200, { ...nextStore, editError: error.message || "영역 편집 실패" });
    }
    return;
  }


  if (req.method === "POST" && req.url === "/api/character-ref/from-image") {
    const body = await readBody(req);
    const store = await readStore();
    if (!body.jobId || !body.imageId) {
      sendJson(res, 400, { error: "캐릭터로 저장할 작업과 이미지를 지정해야 합니다." });
      return;
    }
    try {
      const settings = { ...store.settings, ...(body.settings || {}) };
      const ref = saveCharacterReferenceFromImage({
        jobId: body.jobId,
        imageId: body.imageId,
        title: String(body.title || "").trim(),
        prompt: String(body.prompt || "").trim(),
        lock: String(body.lock || "").trim(),
        settings,
        store
      });
      await writeStore(store);
      sendJson(res, 200, { ...store, activeCharacterRef: ref });
    } catch (error) {
      sendJson(res, 400, { error: error.message || "캐릭터 저장 실패" });
    }
    return;
  }

  if (req.method === "POST" && req.url === "/api/character-ref") {
    const body = await readBody(req);
    const store = await readStore();
    const prompt = String(body.prompt || "").trim();
    if (!prompt) {
      sendJson(res, 400, { error: "캐릭터 기준 프롬프트를 입력해야 합니다." });
      return;
    }
    if (adapterMode !== "codex-cli") {
      sendJson(res, 400, { error: "캐릭터 기준 생성은 현재 Codex CLI 어댑터에서 지원됩니다." });
      return;
    }
    const ref = await generateCharacterReference({ prompt, settings: { ...store.settings, ...(body.settings || {}) }, store });
    await writeStore(store);
    sendJson(res, 200, { ...store, activeCharacterRef: ref });
    return;
  }

  if (req.method === "POST" && req.url === "/api/slice-sprite") {
    const body = await readBody(req);
    const store = await readStore();
    const job = store.jobs.find((item) => item.id === body.jobId) || store.jobs[0];
    const image = body.imageId
      ? job?.resultImages.find((item) => item.id === body.imageId)
      : job?.resultImages[0];
    if (!job || !image?.path) {
      sendJson(res, 400, { error: "분리할 스프라이트 이미지가 없습니다." });
      return;
    }
    const sliced = await sliceSpriteSheet({
      imagePath: image.path,
      frameSize: body.frameSize || store.settings.sliceFrameSize || 256,
      columns: body.columns,
      rows: body.rows,
      jobId: job.id
    });
    image.slices = sliced;
    store.settings.sliceFrameSize = sliced.frameSize;
    await writeStore(store);
    sendJson(res, 200, { ...store, sliced });
    return;
  }

  if (req.method === "POST" && req.url === "/api/make-gif") {
    const body = await readBody(req);
    const store = await readStore();
    const job = store.jobs.find((item) => item.id === body.jobId) || store.jobs[0];
    if (!job?.resultImages?.length) {
      sendJson(res, 400, { error: "GIF로 묶을 이미지 작업이 없습니다." });
      return;
    }
    const images = job.resultImages
      .filter((image) => image.path?.endsWith(".png"))
      .slice(0, Math.max(2, Math.min(24, Number(body.frameCount || job.resultImages.length))));
    const gif = await makeGifFromImages({
      job,
      images,
      delay: body.delay || store.settings.gifFrameDelay || 12
    });
    await writeStore(store);
    sendJson(res, 200, { ...store, gif });
    return;
  }

  if (req.method === "POST" && req.url === "/api/make-reveal-video") {
    const body = await readBody(req);
    const store = await readStore();
    const job = store.jobs.find((item) => item.id === body.jobId) || store.jobs[0];
    if (!job?.resultImages?.length) {
      sendJson(res, 400, { error: "영상으로 묶을 이미지 작업이 없습니다." });
      return;
    }
    const frameCount = Math.max(2, Math.min(4, Number(body.frameCount || store.settings.gifCutPreset || 4)));
    const images = job.resultImages
      .filter((image) => image.path?.endsWith(".png"))
      .slice(0, frameCount);
    const video = await makeRevealVideoFromImages({
      job,
      images,
      seconds: body.seconds || store.settings.revealVideoSeconds || 1.2
    });
    await writeStore(store);
    sendJson(res, 200, { ...store, video });
    return;
  }

  if (req.method === "POST" && req.url === "/api/generate") {
    const body = await readBody(req);
    const store = await readStore();
    const prompt = String(body.prompt || "").trim();
    if (!prompt) {
      sendJson(res, 400, { error: "프롬프트를 입력해야 합니다." });
      return;
    }
    const settings = { ...store.settings, ...(body.settings || {}) };
    const activeRef = store.characterRefs.find((ref) => ref.id === settings.activeCharacterRefId);
    if (settings.useCharacterRef && activeRef?.imagePath) {
      settings.referenceImagePath = activeRef.imagePath;
      settings.characterLock = [settings.characterLock, activeRef.lock, `active reference: ${activeRef.title}`].filter(Boolean).join("; ");
    }
    const job = await generateImages({ prompt, settings, store });
    store.jobs.unshift(job);
    touchActiveProject(store, settings, job);
    store.settings = settings;
    store.stats.totalImages += job.resultImages.length;
    store.stats.totalJobs += 1;
    store.stats.sessionTokens += job.tokensUsed;
    store.stats.accumulatedTokens += job.tokensUsed;
    sendJson(res, 200, await writeStore(store));
    return;
  }

  sendJson(res, 404, { error: "Not found" });
}

async function serveStatic(req, res) {
  const urlPath = decodeURIComponent(new URL(req.url, `http://localhost:${port}`).pathname);
  const root = urlPath.startsWith("/generated/") ? __dirname : publicDir;
  const relative = urlPath.startsWith("/generated/") ? urlPath.slice(1) : urlPath === "/" ? "index.html" : urlPath.slice(1);
  const filePath = path.normalize(path.join(root, relative));
  if (!filePath.startsWith(root)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  try {
    const data = await fs.readFile(filePath);
    const ext = path.extname(filePath);
    const type = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".svg": "image/svg+xml; charset=utf-8",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".gif": "image/gif",
      ".webp": "image/webp"
    }[ext] || "application/octet-stream";
    res.writeHead(200, { "content-type": type });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}

await ensureStore();

createServer(async (req, res) => {
  try {
    if (req.url?.startsWith("/api/")) await handleApi(req, res);
    else await serveStatic(req, res);
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
}).listen(port, () => {
  console.log(`Codex Image Generator running at http://localhost:${port}`);
});
