import { GoogleGenAI } from "@google/genai";

export type GeminiCitation = {
  title: string;
  text?: string;
  pageNumber?: number;
  mediaId?: string;
  fileSearchStore?: string;
};

export type GeminiQueryResult = {
  text: string;
  citations: GeminiCitation[];
};

const GEMINI_MODEL = "gemini-3-flash-preview";
const EMBEDDING_MODEL = "models/gemini-embedding-2";

export async function createGeminiFileSearchStore(apiKey: string) {
  const ai = new GoogleGenAI({ apiKey });
  const store = await ai.fileSearchStores.create({
    config: {
      displayName: `Trova-${new Date().toISOString().slice(0, 10)}`,
      embeddingModel: EMBEDDING_MODEL,
    },
  });

  if (!store.name) {
    throw new Error("Gemini non ha restituito il nome dello store File Search.");
  }

  return store.name;
}

export async function uploadFilesToGeminiStore({
  apiKey,
  files,
  storeName,
  onProgress,
}: {
  apiKey: string;
  files: File[];
  storeName: string;
  onProgress?: (message: string) => void;
}) {
  const ai = new GoogleGenAI({ apiKey });
  const supported = files.filter(isSupportedGeminiFile);

  for (const [index, file] of supported.entries()) {
    onProgress?.(`Carico ${index + 1}/${supported.length}: ${file.name}`);
    let operation = await ai.fileSearchStores.uploadToFileSearchStore({
      fileSearchStoreName: storeName,
      file,
      config: {
        displayName: file.name,
        mimeType: file.type || mimeTypeFromName(file.name),
        customMetadata: [
          { key: "source", stringValue: "Trova desktop" },
          { key: "kind", stringValue: kindFromFile(file) },
        ],
      },
    });

    while (!operation.done) {
      await wait(1800);
      operation = await ai.operations.get({ operation });
    }
  }

  return supported.length;
}

export async function queryGeminiFileSearch({
  apiKey,
  query,
  storeName,
  metadataFilter,
}: {
  apiKey: string;
  query: string;
  storeName: string;
  metadataFilter?: string;
}): Promise<GeminiQueryResult> {
  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: query,
    config: {
      tools: [
        {
          fileSearch: {
            fileSearchStoreNames: [storeName],
            ...(metadataFilter ? { metadataFilter } : {}),
          },
        },
      ],
    },
  });

  const grounding = response.candidates?.[0]?.groundingMetadata;
  const chunks = grounding?.groundingChunks ?? [];
  const citations = chunks
    .map((chunk: any): GeminiCitation | null => {
      const retrieved = chunk.retrievedContext;
      if (!retrieved) return null;
      return {
        title: retrieved.title ?? "Risultato Gemini",
        text: retrieved.text,
        pageNumber: retrieved.pageNumber,
        mediaId: retrieved.mediaId,
        fileSearchStore: retrieved.fileSearchStore,
      };
    })
    .filter(Boolean) as GeminiCitation[];

  return {
    text: response.text ?? "Gemini non ha restituito testo, ma potrebbe avere citazioni.",
    citations,
  };
}

export async function queryGeminiFileSearchWithImage({
  apiKey,
  query,
  image,
  storeName,
  mode,
}: {
  apiKey: string;
  query: string;
  image: File;
  storeName: string;
  mode: "image" | "person";
}): Promise<GeminiQueryResult> {
  const ai = new GoogleGenAI({ apiKey });
  const imagePart = await fileToInlineDataPart(image);
  const prompt =
    mode === "person"
      ? `Usa questa foto come esempio. Cerca nei miei file indicizzati immagini o documenti che contengono la stessa persona o un volto molto simile. Query testuale aggiuntiva: ${query || "nessuna"}. Rispondi in italiano e cita le fonti.`
      : `Usa questa immagine come esempio. Cerca nei miei file indicizzati oggetti, piantine, loghi, schemi, scene o immagini visivamente e semanticamente simili. Query testuale aggiuntiva: ${query || "nessuna"}. Rispondi in italiano e cita le fonti.`;

  try {
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: [
        {
          role: "user",
          parts: [{ text: prompt }, imagePart],
        },
      ] as any,
      config: {
        tools: [
          {
            fileSearch: {
              fileSearchStoreNames: [storeName],
            },
          },
        ],
      },
    });
    return responseToQueryResult(response);
  } catch {
    const description = await describeImageForSearch({ apiKey, image, mode });
    return queryGeminiFileSearch({
      apiKey,
      storeName,
      query: `${description}\n\nTrova nei miei file elementi corrispondenti. ${query}`,
    });
  }
}

async function describeImageForSearch({
  apiKey,
  image,
  mode,
}: {
  apiKey: string;
  image: File;
  mode: "image" | "person";
}) {
  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: [
      {
        role: "user",
        parts: [
          {
            text:
              mode === "person"
                ? "Descrivi questa persona/foto in modo utile per cercarla in un archivio privato. Non identificare la persona per nome."
                : "Descrivi questa immagine in modo utile per cercare file che contengono oggetti, schemi, piantine, loghi o scene simili.",
          },
          await fileToInlineDataPart(image),
        ],
      },
    ] as any,
  });
  return response.text ?? "";
}

export function isSupportedGeminiFile(file: File) {
  const name = file.name.toLowerCase();
  return (
    name.endsWith(".txt") ||
    name.endsWith(".md") ||
    name.endsWith(".pdf") ||
    name.endsWith(".docx") ||
    name.endsWith(".png") ||
    name.endsWith(".jpg") ||
    name.endsWith(".jpeg")
  );
}

function kindFromFile(file: File) {
  if (file.type.startsWith("image/")) return "image";
  if (file.name.toLowerCase().endsWith(".pdf")) return "pdf";
  return "document";
}

function mimeTypeFromName(name: string) {
  const lower = name.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".docx")) {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".md")) return "text/markdown";
  return "text/plain";
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function responseToQueryResult(response: any): GeminiQueryResult {
  const grounding = response.candidates?.[0]?.groundingMetadata;
  const chunks = grounding?.groundingChunks ?? [];
  const citations = chunks
    .map((chunk: any): GeminiCitation | null => {
      const retrieved = chunk.retrievedContext;
      if (!retrieved) return null;
      return {
        title: retrieved.title ?? "Risultato Gemini",
        text: retrieved.text,
        pageNumber: retrieved.pageNumber,
        mediaId: retrieved.mediaId,
        fileSearchStore: retrieved.fileSearchStore,
      };
    })
    .filter(Boolean) as GeminiCitation[];

  return {
    text: response.text ?? "Gemini non ha restituito testo, ma potrebbe avere citazioni.",
    citations,
  };
}

async function fileToInlineDataPart(file: File) {
  const dataUrl = await fileToDataUrl(file);
  const data = dataUrl.split(",")[1] ?? "";
  return {
    inlineData: {
      mimeType: file.type || mimeTypeFromName(file.name),
      data,
    },
  };
}

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
