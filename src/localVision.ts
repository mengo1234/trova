export type LocalVisionModel = {
  id: string;
  label: string;
  purpose: string;
  textToImage?: boolean;
};

export const LOCAL_VISION_MODELS: LocalVisionModel[] = [
  {
    id: "Xenova/clip-vit-base-patch32",
    label: "CLIP",
    purpose: "fallback leggero e ricerca semantica base",
    textToImage: true,
  },
  {
    id: "onnx-community/dinov3-vits16-pretrain-lvd1689m-ONNX",
    label: "DINOv3",
    purpose: "somiglianza visiva, schemi, forme e layout",
  },
  {
    id: "onnx-community/siglip2-base-patch16-224-ONNX",
    label: "SigLIP2",
    purpose: "ricerca immagine-testo moderna e multilingua",
  },
];

type ProgressInfo = {
  status?: string;
  file?: string;
  progress?: number;
};

type ImageExtractor = {
  (image: string): Promise<{ data: Float32Array | number[]; dims?: number[] }>;
};

const extractorPromises = new Map<string, Promise<ImageExtractor>>();
const textEmbedderPromises = new Map<string, Promise<(text: string) => Promise<number[]>>>();
let transformersFetchGuardInstalled = false;

export type LocalVisionProgress = {
  label: string;
  progress?: number;
  model?: string;
};

export function localVisionModel() {
  return LOCAL_VISION_MODELS[0].id;
}

export function localVisionModelLabel(modelId: string) {
  return LOCAL_VISION_MODELS.find((model) => model.id === modelId)?.label ?? modelId;
}

export function localVisionModelsLabel() {
  return LOCAL_VISION_MODELS.map((model) => model.label).join(" + ");
}

export async function embedImageWithLocalVision(
  imageDataUrl: string,
  onProgress?: (progress: LocalVisionProgress) => void,
) {
  return embedImageWithModel(LOCAL_VISION_MODELS[0].id, imageDataUrl, onProgress);
}

export async function prepareLocalVisionModels(onProgress?: (progress: LocalVisionProgress) => void) {
  const tinyPixel =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";
  const ready: string[] = [];

  for (const model of LOCAL_VISION_MODELS) {
    try {
      await embedImageWithModel(model.id, tinyPixel, onProgress);
      if (model.textToImage) {
        await embedTextWithModel(model.id, "setup", onProgress);
      }
      ready.push(model.label);
    } catch (err) {
      onProgress?.({
        label: `${model.label} non installato: ${shortError(err)}`,
        model: model.id,
      });
    }
  }

  return ready;
}

export async function embedTextWithLocalVisionModels(
  text: string,
  onProgress?: (progress: LocalVisionProgress) => void,
) {
  const results: Array<{ model: string; label: string; embedding: number[] }> = [];
  for (const model of LOCAL_VISION_MODELS.filter((item) => item.textToImage)) {
    try {
      const embedding = await embedTextWithModel(model.id, text, onProgress);
      results.push({ model: model.id, label: model.label, embedding });
    } catch (err) {
      onProgress?.({
        label: `${model.label} testo→immagine non disponibile: ${shortError(err)}`,
        model: model.id,
      });
    }
  }
  return results;
}

export async function embedImageWithAllLocalVisionModels(
  imageDataUrl: string,
  onProgress?: (progress: LocalVisionProgress) => void,
) {
  const results: Array<{ model: string; label: string; embedding: number[] }> = [];
  for (const model of LOCAL_VISION_MODELS) {
    try {
      const embedding = await embedImageWithModel(model.id, imageDataUrl, onProgress);
      results.push({ model: model.id, label: model.label, embedding });
    } catch (err) {
      onProgress?.({
        label: `${model.label} non disponibile: ${shortError(err)}`,
        model: model.id,
      });
    }
  }
  return results;
}

export async function embedImageWithModel(
  modelId: string,
  imageDataUrl: string,
  onProgress?: (progress: LocalVisionProgress) => void,
) {
  const label = localVisionModelLabel(modelId);
  const extractor = await getExtractor(modelId, onProgress);
  onProgress?.({ label: `Creo embedding ${label} locale...`, model: modelId });
  const tensor = await extractor(imageDataUrl);
  return normalize(extractVector(tensor.data, tensor.dims));
}

export async function embedTextWithModel(
  modelId: string,
  text: string,
  onProgress?: (progress: LocalVisionProgress) => void,
) {
  const label = localVisionModelLabel(modelId);
  const embedder = await getTextEmbedder(modelId, onProgress);
  onProgress?.({ label: `Creo query visuale ${label} locale...`, model: modelId });
  return embedder(text);
}

async function getExtractor(modelId: string, onProgress?: (progress: LocalVisionProgress) => void) {
  if (!extractorPromises.has(modelId)) {
    extractorPromises.set(modelId, loadExtractor(modelId, onProgress));
  }
  return extractorPromises.get(modelId)!;
}

async function loadExtractor(modelId: string, onProgress?: (progress: LocalVisionProgress) => void) {
  const label = localVisionModelLabel(modelId);
  onProgress?.({ label: `Carico ${label} locale...`, model: modelId });
  const { env, pipeline } = await import("@huggingface/transformers");

  configureTransformersEnv(env);

  const extractor = await pipeline("image-feature-extraction", modelId, {
    dtype: "q8",
    progress_callback: (info: ProgressInfo) => {
      const file = info.file ? ` · ${shortFile(info.file)}` : "";
      const progress = typeof info.progress === "number" ? info.progress : undefined;
      onProgress?.({
        label:
          info.status === "ready"
            ? `${label} pronto`
            : `${label}: ${info.status ?? "download"}${file}`,
        progress,
        model: modelId,
      });
    },
  } as any);

  onProgress?.({ label: `${label} pronto`, progress: 100, model: modelId });
  return extractor as ImageExtractor;
}

async function getTextEmbedder(modelId: string, onProgress?: (progress: LocalVisionProgress) => void) {
  if (!textEmbedderPromises.has(modelId)) {
    textEmbedderPromises.set(modelId, loadTextEmbedder(modelId, onProgress));
  }
  return textEmbedderPromises.get(modelId)!;
}

async function loadTextEmbedder(modelId: string, onProgress?: (progress: LocalVisionProgress) => void) {
  const label = localVisionModelLabel(modelId);
  onProgress?.({ label: `Carico testo→immagine ${label} locale...`, model: modelId });
  const transformers = await import("@huggingface/transformers");
  const { env, AutoTokenizer, CLIPTextModelWithProjection } = transformers as any;

  configureTransformersEnv(env);

  const progressCallback = (info: ProgressInfo) => {
    const file = info.file ? ` · ${shortFile(info.file)}` : "";
    const progress = typeof info.progress === "number" ? info.progress : undefined;
    onProgress?.({
      label:
        info.status === "ready"
          ? `${label} testo pronto`
          : `${label} testo: ${info.status ?? "download"}${file}`,
      progress,
      model: modelId,
    });
  };

  const [tokenizer, textModel] = await Promise.all([
    AutoTokenizer.from_pretrained(modelId, { progress_callback: progressCallback } as any),
    CLIPTextModelWithProjection.from_pretrained(modelId, {
      dtype: "q8",
      progress_callback: progressCallback,
    } as any),
  ]);

  onProgress?.({ label: `${label} testo pronto`, progress: 100, model: modelId });
  return async (text: string) => {
    const inputs = await tokenizer([text], { padding: true, truncation: true });
    const output = await textModel(inputs);
    const tensor = output.text_embeds ?? output.pooler_output ?? output.last_hidden_state;
    return normalize(extractVector(tensor.data, tensor.dims));
  };
}

function extractVector(values: Float32Array | number[], dims?: number[]) {
  const vector = Array.from(values);
  if (!dims || dims.length <= 2) return vector;

  const hiddenSize = dims[dims.length - 1];
  const tokenCount = Math.floor(vector.length / hiddenSize);
  if (!hiddenSize || !tokenCount) return vector;

  const pooled = new Array(hiddenSize).fill(0);
  for (let token = 0; token < tokenCount; token += 1) {
    for (let i = 0; i < hiddenSize; i += 1) {
      pooled[i] += vector[token * hiddenSize + i];
    }
  }
  return pooled.map((value) => value / tokenCount);
}

function normalize(values: number[]) {
  const norm = Math.sqrt(values.reduce((total, value) => total + value * value, 0));
  if (!norm) return values;
  return values.map((value) => value / norm);
}

function configureTransformersEnv(env: any) {
  env.allowRemoteModels = true;
  env.allowLocalModels = false;
  env.useBrowserCache = false;
  env.remoteHost = "https://huggingface.co/";
  env.remotePathTemplate = "{model}/resolve/{revision}/";

  if (transformersFetchGuardInstalled) return;
  transformersFetchGuardInstalled = true;
  const baseFetch = env.fetch ?? globalThis.fetch.bind(globalThis);
  env.fetch = async (resource: RequestInfo | URL, init?: RequestInit) => {
    const response = await baseFetch(resource, init);
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("text/html")) {
      const url = typeof resource === "string" ? resource : resource instanceof URL ? resource.href : resource.url;
      throw new Error(`risposta HTML al posto del modello da ${shortUrl(url)}`);
    }
    return response;
  };
}

function shortUrl(url: string) {
  return url.length > 120 ? `${url.slice(0, 117)}...` : url;
}

function shortFile(file: string) {
  const parts = file.split("/");
  return parts.slice(-2).join("/");
}

function shortError(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return message.length > 86 ? `${message.slice(0, 83)}...` : message;
}
