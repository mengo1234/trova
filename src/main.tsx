import React, { useEffect, useMemo, useRef, useState } from "react";
import ReactDOM from "react-dom/client";
import LiquidGlass from "@nkzw/liquid-glass";
import { invoke as tauriInvokeRaw } from "@tauri-apps/api/core";
import {
  Archive,
  BrainCircuit,
  Camera,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Cloud,
  Code2,
  Cpu,
  Database,
  Download,
  FileText,
  Folder,
  Grid2X2,
  HardDrive,
  HelpCircle,
  Home,
  Image as ImageIcon,
  List,
  MessageSquare,
  Mic,
  Minus,
  MoreVertical,
  Music2,
  ExternalLink,
  Paperclip,
  Play,
  Plus,
  PlusCircle,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  Square,
  Moon,
  Sparkles,
  Star,
  Sun,
  UserRound,
  Video,
  Wrench,
  X,
} from "lucide-react";
import {
  createGeminiFileSearchStore,
  type GeminiCitation,
  isSupportedGeminiFile,
  queryGeminiFileSearch,
  queryGeminiFileSearchWithImage,
  uploadFilesToGeminiStore,
} from "./gemini";
import {
  LOCAL_VISION_MODELS,
  embedImageWithAllLocalVisionModels,
  embedImageWithModel,
  embedTextWithLocalVisionModels,
  prepareLocalVisionModels,
} from "./localVision";
import { GeneratedIcon, GeneratedTutorialAsset, type GeneratedIconName } from "./generatedIcons";
import setupAppMockupWide from "./assets/setup/generated/setup-app-mockup-wide.png";
import setupAppRealOnboarding from "./assets/setup/generated/setup-app-real-onboarding.png";
import setupAppRealSearch from "./assets/setup/generated/setup-app-real-search.png";
import setupAppRealSettings from "./assets/setup/generated/setup-app-real-settings.png";
import setupAppWindowArt from "./assets/setup/generated/setup-app-window.png";
import setupAudioArt from "./assets/setup/generated/setup-audio.png";
import setupCloudPrivacyArt from "./assets/setup/generated/setup-cloud-privacy.png";
import setupDocumentsArt from "./assets/setup/generated/setup-documents.png";
import setupFoldersArt from "./assets/setup/generated/setup-folders.png";
import setupImageSearchArt from "./assets/setup/generated/setup-image-search.png";
import setupLocalAiArt from "./assets/setup/generated/setup-local-ai.png";
import setupLocalSearchArt from "./assets/setup/generated/setup-local-search.png";
import setupOcrArt from "./assets/setup/generated/setup-ocr.png";
import setupTutorialLocalIndexArt from "./assets/setup/generated/setup-tutorial-local-index.png";
import setupTutorialModelDownloadsArt from "./assets/setup/generated/setup-tutorial-model-downloads.png";
import setupTutorialPreviewArt from "./assets/setup/generated/setup-tutorial-preview.png";
import setupTutorialPrivacyArt from "./assets/setup/generated/setup-tutorial-privacy.png";
import setupVideoArt from "./assets/setup/generated/setup-video.png";
import settingsAdvancedArt from "./assets/settings/generated/settings-advanced.png";
import settingsCloudArt from "./assets/settings/generated/settings-cloud.png";
import settingsComponentsArt from "./assets/settings/generated/settings-components.png";
import settingsFoldersArt from "./assets/settings/generated/settings-folders.png";
import settingsOverviewArt from "./assets/settings/generated/settings-overview.png";
import settingsRemoteArt from "./assets/settings/generated/settings-remote.png";
import settingsVisionArt from "./assets/settings/generated/settings-vision.png";
import homeDiscoveryCardArt from "./assets/home/home-discovery-card.svg";
import { HomeAnimatedScene } from "./HomeAnimatedScene";
import "./styles.css";

type ResultKind = "document" | "image" | "audio" | "video" | "code" | "other";
type SearchMode = "text" | "image" | "person";
type ResultSource = "local" | "gemini";

type IndexedFile = {
  id: string;
  name: string;
  path: string;
  kind: ResultKind;
  extension: string;
  size: number;
  modified?: number;
  snippet: string;
  page_hint?: number;
  timestamp?: number;
  matchType?: "text" | "fuzzy" | "semantic" | "visual" | "person" | "metadata";
  citations?: LocalCitation[];
  assetId?: string;
  score: number;
  source?: ResultSource;
  sourceType?: "local" | "remote";
  remoteId?: string;
  remotePath?: string;
  syncMode?: "cache";
  visual_preview?: string;
  pageNumber?: number;
  previewKind?: string;
  rankBreakdown?: Record<string, number>;
};

type PreviewPayload = {
  dataUrl: string;
  mimeType: string;
  size: number;
};

type FileTypeFilter = {
  mode: "include" | "exclude";
  extensions: string[];
};

type WatchPath = {
  id: string;
  path: string;
  enabled: boolean;
  recursive: boolean;
  isExcluded: boolean;
  fileTypeFilter?: FileTypeFilter;
  geminiEnabled: boolean;
  autoIndex: boolean;
  sourceType?: "local" | "remote";
  remoteId?: string;
  remotePath?: string;
  syncMode?: "cache";
};

type ConnectorConfig = {
  id: string;
  name: string;
  provider: string;
  sourceType: "remote";
  remoteName?: string;
  remotePath: string;
  cachePath: string;
  enabled: boolean;
  readOnly: boolean;
  autoSync: boolean;
  geminiEnabled: boolean;
  recursive: boolean;
  fileTypeFilter?: FileTypeFilter;
  syncMode: "cache";
  lastSyncAt?: number | null;
  lastSyncStatus?: string;
  lastSyncError?: string;
  lastTestAt?: number | null;
  lastTestOk?: boolean;
};

type RcloneStatus = {
  installed: boolean;
  command: string;
  version: string;
  remotes: string[];
  cacheRoot: string;
  providers: Array<{ id: string; label: string; type: string }>;
  connectors: ConnectorConfig[];
};

type RemoteActionResult = {
  ok: boolean;
  message?: string;
  filesSynced?: number;
  connector?: ConnectorConfig;
  connectors?: ConnectorConfig[];
  watchPath?: WatchPath;
  watchPaths?: WatchPath[];
  sample?: string[];
};

type IndexStatus = {
  running: boolean;
  phase: string;
  filesDiscovered: number;
  filesIndexed: number;
  filesSkipped: number;
  progress: number;
  watcherActive: boolean;
  watcherQueued?: number;
  watcherBusy?: boolean;
  watcherProcessed?: number;
  watcherRoots?: string[];
  watcherError?: string;
  lastWatcherEvent?: {
    event?: string;
    path?: string;
    status?: string;
    queuedAt?: number;
    processedAt?: number;
  } | null;
  lastIndexedAt?: number | null;
  indexSizeBytes: number;
  tikaAvailable: boolean;
  typesenseAvailable: boolean;
  typesenseError?: string;
  semanticReady?: boolean;
  semanticChunks?: number;
  semanticModel?: string;
  remoteConnectors?: number;
  remoteEnabled?: number;
  remoteSynced?: number;
  remoteErrors?: number;
};

type SemanticStatus = {
  model: string;
  primaryModel: string;
  fallbackModel: string;
  ready: boolean;
  runtimeReady: boolean;
  fallback: boolean;
  error?: string;
  totalChunks: number;
  embeddedChunks: number;
  filesWithChunks: number;
  models: Array<{ model: string; count: number }>;
};

type LocalCitation = {
  title: string;
  filePath?: string;
  pageNumber?: number;
  chunkIndex?: number;
  score?: number;
  snippet?: string;
  mediaId?: string;
};

type LocalAskAnswer = {
  answer: string;
  citations: LocalCitation[];
  chunks: Array<{
    filePath: string;
    fileName: string;
    chunkIndex: number;
    snippet: string;
    score: number;
  }>;
  model: string;
  source: "local";
  threadId?: string;
};

type LocalVisionAsset = {
  assetId: string;
  filePath: string;
  imagePath: string;
  assetKind: string;
  pageNumber?: number;
  timestamp?: number;
  embeddingModel?: string;
  embeddingModels?: string[];
  faceEmbeddingModel?: string;
};

type LocalVisionModelStatus = {
  model: string;
  label: string;
  embeddedAssets: number;
  totalAssets: number;
};

type LocalVisionStatus = {
  totalAssets: number;
  embeddedAssets: number;
  faceEmbeddedAssets: number;
  model: string;
  models?: LocalVisionModelStatus[];
};

type LocalComponent = {
  id: string;
  label: string;
  category: string;
  description: string;
  required: boolean;
  installed: boolean;
  status: string;
  version: string;
  installHint: string;
  actionLabel: string;
  installable?: boolean;
  manualAction?: boolean;
  state?: "ready" | "missing" | "manual";
};

type LocalComponentInstallResult = {
  ok: boolean;
  componentId: string;
  message: string;
  components?: LocalComponent[];
  steps?: Array<{
    label: string;
    command: string;
    ok: boolean;
    output: string;
    manualAction?: boolean;
    durationMs: number;
  }>;
};

type DoctorCheck = {
  id: string;
  label: string;
  category: string;
  state: "ready" | "missing" | "manual";
  required: boolean;
  detail: string;
  action: string;
  hint: string;
};

type DoctorStatus = {
  generatedAt: number;
  summary: {
    state: "ready" | "attention";
    readyRequired: number;
    required: number;
    missingRequired: number;
    installable: number;
    warnings: number;
  };
  checks: DoctorCheck[];
  logPath: string;
};

type ModelStatus = {
  cacheDir: string;
  text: {
    activeModel: string;
    embeddedChunks: number;
    totalChunks: number;
    fallback: boolean;
  };
  face: {
    model: string;
    embeddedAssets: number;
    totalAssets: number;
    ready: boolean;
    optInUse: string;
  };
  cache: {
    files: number;
    bytes: number;
  };
};

type RemoteAccessStatus = {
  enabled: boolean;
  running: boolean;
  bind: string;
  port: number;
  url: string;
  tokenPreview: string;
  token?: string;
  allowFileDownload: boolean;
  logPath: string;
  lastError?: string;
};

type UserFriendlyIssue = {
  id?: string;
  title: string;
  message: string;
  action?: "install" | "manual";
  actionLabel: string;
  severity?: "required" | "optional";
  area?: string;
  technicalId?: string;
};

type RuntimeInstallTask = {
  id: string;
  label: string;
  state: "ready" | "missing" | "optional";
  ready: boolean;
  required: boolean;
  installable: boolean;
  actionLabel: string;
  message: string;
  technical?: Record<string, string>;
};

type AutoSetupPlan = {
  id: string;
  title: string;
  runtimeDir?: string;
  steps: Array<{ id: string; label: string; message: string }>;
};

type AutoSetupJob = {
  id: string;
  status: "idle" | "running" | "done" | "failed";
  title: string;
  message: string;
  progress: number;
  currentStep?: string;
  plan?: AutoSetupPlan;
  steps?: Array<{ id: string; label: string; state: "pending" | "running" | "done" | "attention"; detail?: string }>;
  issues?: UserFriendlyIssue[];
  startedAt?: number | null;
  updatedAt?: number | null;
  finishedAt?: number | null;
};

type SimpleAppStatus = {
  generatedAt: number;
  status: "ready" | "preparing" | "needs_permission" | "attention";
  title: string;
  message: string;
  progress: number;
  actionLabel: string;
  issues: UserFriendlyIssue[];
  sections: Array<{ id: string; label: string; ready: boolean; state: string; message: string }>;
  job: AutoSetupJob;
  components: RuntimeInstallTask[];
  detailsAvailable: boolean;
  technical?: {
    logPath?: string;
    dataDir?: string;
    runtimeDir?: string;
  };
};

type LocalApiBootStatus = {
  ok: boolean;
  alreadyRunning: boolean;
  port: number;
  pid?: number;
  command: string;
  scriptPath: string;
  dataDir: string;
  message: string;
};

type KeyDiscovery = {
  geminiFound: boolean;
  geminiKey?: string;
  geminiSource?: string;
  nvidiaFound: boolean;
  nvidiaSource?: string;
  nvidiaSources?: string[];
  nvidiaKeyCount?: number;
  nvidiaModel?: string;
};

type NvidiaRerankResponse = {
  orderedIds: string[];
  model: string;
};

type NvidiaFileSummary = {
  summary: string;
  bullets: string[];
  fileType?: string;
  usefulFor?: string;
  questions?: string[];
  provider: "nvidia";
  model: string;
  filePath: string;
  fileName: string;
  contentChars: number;
  generatedAt: number;
  fromCache?: boolean;
};

type GeminiCandidate = {
  path: string;
  name: string;
  mimeType: string;
  size: number;
  modified?: number;
};

const filters: Array<{ id: string; label: string; icon: GeneratedIconName }> = [
  { id: "all", label: "Tutto", icon: "search" },
  { id: "text", label: "Testo", icon: "text" },
  { id: "images", label: "Immagini", icon: "image" },
  { id: "audio", label: "Audio", icon: "audio" },
  { id: "video", label: "Video", icon: "video" },
  { id: "code", label: "Codice", icon: "code" },
  { id: "documents", label: "Documenti", icon: "document" },
];

const defaultRemoteProviders = [
  { id: "local", label: "Cartella locale", type: "local" },
  { id: "ftp", label: "FTP", type: "network" },
  { id: "sftp", label: "SFTP", type: "network" },
  { id: "smb", label: "SMB", type: "network" },
  { id: "webdav", label: "WebDAV", type: "network" },
  { id: "drive", label: "Google Drive", type: "cloud" },
  { id: "dropbox", label: "Dropbox", type: "cloud" },
  { id: "s3", label: "S3", type: "cloud" },
  { id: "onedrive", label: "OneDrive", type: "cloud" },
  { id: "box", label: "Box", type: "cloud" },
];

const FINGERPRINT_MODEL = "trova-fingerprint-v1";

const fallbackWatchPaths: WatchPath[] = [
  watchPath("/home/fabio/Desktop", true),
  watchPath("/home/fabio/Documents", true),
  watchPath("/home/fabio/Downloads", true),
  watchPath("/home/fabio/Pictures", true),
  watchPath("/home/fabio/Music", true),
  watchPath("/home/fabio/Videos", true),
  watchPath("/home/fabio", true),
];

const setupStoryCards = [
  {
    title: "Ricerca PC reale",
    text: "Nome file, contenuto PDF/Office e testo estratto finiscono nello stesso indice locale.",
    image: setupLocalSearchArt,
    tone: "blue",
  },
  {
    title: "Cartelle pulite",
    text: "Scegli una volta le cartelle: dopo il setup la UI resta libera e il watcher lavora in background.",
    image: setupFoldersArt,
    tone: "yellow",
  },
  {
    title: "Immagini associate",
    text: "Se cerchi elefante, Trova combina testo, foto, preview PDF e risultati visuali.",
    image: setupImageSearchArt,
    tone: "green",
  },
  {
    title: "OCR e scansioni",
    text: "Le scansioni diventano cercabili con Tesseract quando il PDF non contiene testo vero.",
    image: setupOcrArt,
    tone: "red",
  },
];

const setupMediaCards = [
  { label: "PDF e documenti", image: setupDocumentsArt },
  { label: "Audio locale", image: setupAudioArt },
  { label: "Video keyframe", image: setupVideoArt },
  { label: "Cloud esplicito", image: setupCloudPrivacyArt },
  { label: "AI locale", image: setupLocalAiArt },
  { label: "App pronta", image: setupAppWindowArt },
];

const setupTutorialArtSources = [
  setupTutorialLocalIndexArt,
  setupTutorialModelDownloadsArt,
  setupTutorialPreviewArt,
  setupTutorialPrivacyArt,
];

const setupPreviewScreens = [
  { label: "Ricerca reale", image: setupAppRealSearch },
  { label: "Impostazioni", image: setupAppRealSettings },
  { label: "Tutorial", image: setupAppRealOnboarding },
  { label: "Vista completa", image: setupAppMockupWide },
];

const RECENT_FILES_KEY = "trova.recentFiles";

function readRecentFiles(): IndexedFile[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(RECENT_FILES_KEY) ?? "[]");
    return Array.isArray(parsed)
      ? (parsed.filter((item) => item?.id && item?.path && item?.name).slice(0, 12) as IndexedFile[])
      : [];
  } catch {
    return [];
  }
}

function App() {
  const desktopBackendAvailable = hasTauriBackend();
  const forceTutorial = new URLSearchParams(window.location.search).has("tutorial");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [mode, setMode] = useState<SearchMode>("text");
  const [viewMode, setViewMode] = useState<"list" | "grid">("list");
  const [results, setResults] = useState<IndexedFile[]>([]);
  const [recentFiles, setRecentFiles] = useState<IndexedFile[]>(readRecentFiles);
  const [watchPaths, setWatchPaths] = useState<WatchPath[]>(fallbackWatchPaths);
  const [status, setStatus] = useState<IndexStatus | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showAddFolderDialog, setShowAddFolderDialog] = useState(false);
  const [folderDraft, setFolderDraft] = useState("/home/fabio/Documents");
  const [folderDraftError, setFolderDraftError] = useState("");
  const [isPickingFolder, setIsPickingFolder] = useState(false);
  const [setupComplete, setSetupComplete] = useState(
    () => !forceTutorial && window.localStorage.getItem("trova.setupComplete") === "true",
  );
  const [showSetup, setShowSetup] = useState(
    () => forceTutorial || window.localStorage.getItem("trova.setupComplete") !== "true",
  );
  const [imageQueryFile, setImageQueryFile] = useState<File | null>(null);
  const [imageQueryPreview, setImageQueryPreview] = useState("");
  // Multi-file: tutti i file allegati alla conversazione corrente
  type AttachedFile = { file: File; previewUrl?: string; kind: "image" | "text" | "binary" };
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [error, setError] = useState("");
  const [localQuestion, setLocalQuestion] = useState("");
  const [localAnswer, setLocalAnswer] = useState<LocalAskAnswer | null>(null);
  const [isLocalAskBusy, setIsLocalAskBusy] = useState(false);
  // Chat multi-turn con AI (NVIDIA Nemotron / Gemma 4 / Ollama / LM Studio)
  type ChatMessage = { role: "user" | "assistant"; content: string; citations?: { filePath?: string; snippet?: string; name?: string }[]; toolsUsed?: { fn: string; args: Record<string, unknown> }[]; createdAt?: number };
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatThreadId, setChatThreadId] = useState<string>("");
  const [agentMode, setAgentMode] = useState<boolean>(false);
  const [chatThreadsList, setChatThreadsList] = useState<Array<{ id: string; title: string; messageCount: number; lastMessageAt: number }>>([]);
  const [showThreadHistory, setShowThreadHistory] = useState<boolean>(false);
  // Pin documents + @mention autocomplete
  type PinnedDoc = { filePath: string; name: string; kind?: string; indexed?: boolean };
  const [pinnedDocuments, setPinnedDocuments] = useState<PinnedDoc[]>([]);
  type MentionSuggestion = { filePath: string; name: string; kind?: string; extension?: string; snippet?: string };
  const [mentionSuggestions, setMentionSuggestions] = useState<MentionSuggestion[]>([]);
  const [mentionQuery, setMentionQuery] = useState<string>("");
  const [showMentionDropdown, setShowMentionDropdown] = useState<boolean>(false);
  const [aiProviderStatus, setAiProviderStatus] = useState<{ providers: Array<{ id: string; label: string; configured: boolean; models?: Array<{ key: string; label: string; category?: string }> }>; activeProvider: string; activeModel: string } | null>(null);
  const [aiProviderConfig, setAiProviderConfig] = useState<{ provider: string; modelKey: string; agentEnabled: boolean; systemPrompt?: string; temperature?: number; maxTokens?: number; ragDepth?: number }>({ provider: "auto", modelKey: "nemotron-super-49b", agentEnabled: false, systemPrompt: "", temperature: 0.2, maxTokens: 1500, ragDepth: 6 });
  // Voce: stato sintesi e riconoscimento
  const [isListening, setIsListening] = useState(false);
  const [speakingIndex, setSpeakingIndex] = useState<number | null>(null);
  const [ollamaInstall, setOllamaInstall] = useState<{ label: string; progress: number; detail?: string; running: boolean } | null>(null);
  // Hotkey globale
  const [hotkeyConfig, setHotkeyConfig] = useState<{ shortcut: string; mode: string; enabled: boolean }>({ shortcut: "", mode: "spotlight", enabled: false });
  const [capturingHotkey, setCapturingHotkey] = useState(false);
  const [semanticStatus, setSemanticStatus] = useState<SemanticStatus | null>(null);
  const [localVisionStatus, setLocalVisionStatus] = useState<LocalVisionStatus | null>(null);
  const [localVisionMessage, setLocalVisionMessage] = useState("Foto e video non ancora preparati");
  const [localVisionProgress, setLocalVisionProgress] = useState(0);
  const [isLocalVisionBusy, setIsLocalVisionBusy] = useState(false);
  const [localComponents, setLocalComponents] = useState<LocalComponent[]>([]);
  const [componentsStatus, setComponentsStatus] = useState("Controllo cosa serve...");
  const [isCheckingComponents, setIsCheckingComponents] = useState(false);
  const [installingComponentId, setInstallingComponentId] = useState("");
  const [componentInstallStatus, setComponentInstallStatus] = useState("");
  const [doctorStatus, setDoctorStatus] = useState<DoctorStatus | null>(null);
  const [modelStatus, setModelStatus] = useState<ModelStatus | null>(null);
  const [simpleAppStatus, setSimpleAppStatus] = useState<SimpleAppStatus | null>(null);
  const [autoSetupJob, setAutoSetupJob] = useState<AutoSetupJob | null>(null);
  const [remoteAccessStatus, setRemoteAccessStatus] = useState<RemoteAccessStatus | null>(null);
  const [remoteAccessBusy, setRemoteAccessBusy] = useState(false);
  const [connectors, setConnectors] = useState<ConnectorConfig[]>([]);
  const [rcloneStatus, setRcloneStatus] = useState<RcloneStatus | null>(null);
  const [remoteStatusMessage, setRemoteStatusMessage] = useState("Archivi esterni non ancora controllati");
  const [remoteBusyId, setRemoteBusyId] = useState("");
  const [geminiApiKey, setGeminiApiKey] = useState("");
  const [geminiStoreName, setGeminiStoreName] = useState(
    () => window.localStorage.getItem("trova.geminiStoreName") ?? "",
  );
  const [geminiStatus, setGeminiStatus] = useState("File Search non configurato");
  const [nvidiaStatus, setNvidiaStatus] = useState("NVIDIA non configurato");
  const [nvidiaCloudEnabled, setNvidiaCloudEnabled] = useState(
    () => window.localStorage.getItem("trova.nvidiaCloudEnabled") === "true",
  );
  const [geminiAnswer, setGeminiAnswer] = useState("");
  const [geminiCitations, setGeminiCitations] = useState<GeminiCitation[]>([]);
  const [isGeminiBusy, setIsGeminiBusy] = useState(false);
  const geminiFileInput = useRef<HTMLInputElement | null>(null);
  const imageQueryInput = useRef<HTMLInputElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [darkMode, setDarkMode] = useState<boolean>(() => window.localStorage.getItem("trova.theme") === "dark");

  // Applica tema scuro
  useEffect(() => {
    document.documentElement.classList.toggle("dark", darkMode);
    window.localStorage.setItem("trova.theme", darkMode ? "dark" : "light");
  }, [darkMode]);

  // Scorciatoie tastiera globali
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const typing = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA");
      // "/" focalizza la ricerca (se non sto gia scrivendo)
      if (event.key === "/" && !typing) {
        event.preventDefault();
        searchInputRef.current?.focus();
      }
      // Esc chiude settings o pulisce
      if (event.key === "Escape") {
        if (showSettings) setShowSettings(false);
      }
      // Ctrl/Cmd+K: nuova conversazione
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        startNewChatThread();
        searchInputRef.current?.focus();
      }
      // Ctrl/Cmd+D: toggle dark mode
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "d") {
        event.preventDefault();
        setDarkMode((value) => !value);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showSettings]);
  const lastImageEmbeddings = useRef<number[][]>([]);
  const lastFaceEmbedding = useRef<number[]>([]);
  const modelWarmupStarted = useRef(false);

  const visibleResults = useMemo(() => {
    return results.filter((item) => {
      if (filter === "all") return true;
      if (filter === "text") return item.kind === "document" || item.kind === "code";
      if (filter === "images") return item.kind === "image";
      if (filter === "documents") return item.kind === "document";
      return item.kind === filter;
    });
  }, [filter, results]);
  const hasSearchIntent = Boolean(query.trim() || imageQueryPreview || results.length);

  function rememberRecentFile(item: IndexedFile) {
    setRecentFiles((current) => {
      const next = [item, ...current.filter((recent) => recent.path !== item.path)].slice(0, 12);
      try {
        window.localStorage.setItem(RECENT_FILES_KEY, JSON.stringify(next));
      } catch {
        /* ignore quota errors */
      }
      return next;
    });
  }

  useEffect(() => {
    void hydrate();
  }, []);

  // Auto-avvia la preparazione completa al primo avvio in background, anche mentre l'utente legge il tutorial.
  const autoSetupKickoffStarted = useRef(false);
  useEffect(() => {
    if (autoSetupKickoffStarted.current) return;
    // Aspetta che hydrate abbia caricato lo stato del job esistente
    if (autoSetupJob === undefined) return;
    const alreadyDone = window.localStorage.getItem("trova.setupComplete") === "true";
    const setupAlreadyHandled = alreadyDone && autoSetupJob?.status === "done";
    const setupRunning = autoSetupJob?.status === "running";
    if (setupAlreadyHandled || setupRunning) {
      autoSetupKickoffStarted.current = true;
      return;
    }
    autoSetupKickoffStarted.current = true;
    setComponentInstallStatus("Preparo tutto in background...");
    void startAutomaticSetup();
  }, [autoSetupJob?.status, autoSetupJob?.id]);

  useEffect(() => {
    window.scrollTo(0, 0);
    const frame = window.requestAnimationFrame(() => window.scrollTo(0, 0));
    return () => window.cancelAnimationFrame(frame);
  }, [showSettings]);

  useEffect(() => {
    if (autoSetupJob?.status !== "running" || !autoSetupJob.id) return;
    let cancelled = false;
    const tick = async () => {
      const job = await safeInvoke<AutoSetupJob | null>("get_auto_setup_status", {}, autoSetupJob);
      if (cancelled || !job) return;
      setAutoSetupJob(job);
      setComponentInstallStatus(job.message || "");
      if (job.status !== "running") void refreshAfterSetup();
    };
    const timer = window.setInterval(() => void tick(), 1200);
    void tick();
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [autoSetupJob?.id, autoSetupJob?.status]);

  useEffect(() => {
    setLocalVisionMessage("Foto e video pronti da preparare");
  }, []);

  // Polling installazione Ollama+Gemma in corso (per la barra di progresso live)
  useEffect(() => {
    if (!ollamaInstall?.running) return;
    let cancelled = false;
    const tick = async () => {
      const next = await safeInvoke<{ label: string; progress: number; detail?: string; running: boolean }>(
        "get_ollama_install_status", {}, { label: "", progress: 0, running: false }
      );
      if (cancelled || !next) return;
      setOllamaInstall(next);
      if (!next.running) {
        // Reload provider status (Ollama dovrebbe essere ora online)
        const status = await safeInvoke<typeof aiProviderStatus>("get_ai_provider_status", {}, null);
        if (status) setAiProviderStatus(status);
      }
    };
    const timer = window.setInterval(() => void tick(), 1500);
    void tick();
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [ollamaInstall?.running]);

  // Cattura combinazione tasti per la hotkey globale
  function captureHotkeyKeydown(event: React.KeyboardEvent) {
    event.preventDefault();
    const parts: string[] = [];
    if (event.ctrlKey) parts.push("Control");
    if (event.metaKey) parts.push("Super");
    if (event.altKey) parts.push("Alt");
    if (event.shiftKey) parts.push("Shift");
    const key = event.key;
    // Ignora se e stato premuto solo un modificatore
    if (!["Control", "Meta", "Alt", "Shift"].includes(key)) {
      const named = key === " " ? "Space" : key.length === 1 ? key.toUpperCase() : key;
      parts.push(named);
      const combo = parts.join("+");
      setHotkeyConfig((prev) => ({ ...prev, shortcut: combo }));
      setCapturingHotkey(false);
    }
  }

  async function saveHotkey(next: { shortcut: string; mode: string; enabled: boolean }) {
    setHotkeyConfig(next);
    if (!hasTauriBackend()) {
      // In modalita web/dev la hotkey globale non esiste: salvo solo la preferenza UI
      return;
    }
    const result = await desktopInvoke<{ shortcut: string; mode: string; enabled: boolean } | null>(
      "set_global_hotkey", { shortcut: next.shortcut, mode: next.mode, enabled: next.enabled }, null
    );
    if (result) setHotkeyConfig(result);
    else if (next.enabled) setError("Scorciatoia non valida o non registrabile. Provane un'altra (es. Control+Space).");
  }

  async function installOllamaGemma() {
    await safeInvoke<{ ok: boolean; started: boolean }>("install_ollama_gemma", {}, { ok: false, started: false });
    setOllamaInstall({ label: "Avvio...", progress: 1, running: true });
  }

  async function hydrate() {
    const [paths, indexStatus, visionStatus, semantic, components, remoteConnectors, rclone, doctor, models, remoteAccess, simpleStatus, setupJob, aiProvStatus, aiProvConfig] = await Promise.all([
      safeInvoke<WatchPath[]>("load_watch_paths", {}, fallbackWatchPaths),
      safeInvoke<IndexStatus | null>("get_index_status", {}, null),
      safeInvoke<LocalVisionStatus | null>("get_local_vision_status", {}, null),
      safeInvoke<SemanticStatus | null>("get_semantic_status", {}, null),
      safeInvoke<LocalComponent[]>("get_local_components", {}, []),
      safeInvoke<ConnectorConfig[]>("get_connectors", {}, []),
      safeInvoke<RcloneStatus | null>("get_rclone_status", {}, null),
      safeInvoke<DoctorStatus | null>("get_doctor_status", {}, null),
      safeInvoke<ModelStatus | null>("get_model_status", {}, null),
      safeInvoke<RemoteAccessStatus | null>("get_remote_access_status", {}, null),
      safeInvoke<SimpleAppStatus | null>("get_simple_app_status", {}, null),
      safeInvoke<AutoSetupJob | null>("get_auto_setup_status", {}, null),
      safeInvoke<{ providers: Array<{ id: string; label: string; configured: boolean; models?: Array<{ key: string; label: string; category?: string }> }>; activeProvider: string; activeModel: string } | null>("get_ai_provider_status", {}, null),
      safeInvoke<{ provider: string; modelKey: string; agentEnabled: boolean } | null>("get_ai_provider_config", {}, null),
    ]);
    if (aiProvStatus) setAiProviderStatus(aiProvStatus);
    if (aiProvConfig) setAiProviderConfig({ provider: aiProvConfig.provider || "auto", modelKey: aiProvConfig.modelKey || "nemotron-super-49b", agentEnabled: Boolean(aiProvConfig.agentEnabled) });
    void loadPinnedDocuments();
    const hk = await desktopInvoke<{ shortcut: string; mode: string; enabled: boolean }>("get_global_hotkey", {}, { shortcut: "", mode: "spotlight", enabled: false });
    if (hk) setHotkeyConfig(hk);
    setWatchPaths(paths.length ? paths : fallbackWatchPaths);
    setStatus(indexStatus);
    setLocalVisionStatus(visionStatus);
    setSemanticStatus(semantic);
    setLocalComponents(components);
    setComponentsStatus(componentSummary(components));
    setConnectors(remoteConnectors);
    setRcloneStatus(rclone);
    setDoctorStatus(doctor);
    setModelStatus(models);
    setSimpleAppStatus(simpleStatus);
    setAutoSetupJob(setupJob);
    setRemoteAccessStatus(remoteAccess);
    setRemoteStatusMessage(remoteSummary(remoteConnectors, rclone));
    const keys = await safeInvoke<KeyDiscovery | null>("discover_api_keys", {}, null);
    if (keys?.geminiFound && keys.geminiKey && !geminiApiKey.trim()) {
      setGeminiApiKey(keys.geminiKey);
      setGeminiStatus(`Gemini key caricata da ${displayPathName(keys.geminiSource ?? "Claude")}`);
    }
    if (keys?.nvidiaFound) {
      const countLabel = keys.nvidiaKeyCount && keys.nvidiaKeyCount > 1 ? `${keys.nvidiaKeyCount} chiavi` : "1 chiave";
      setNvidiaStatus(
        nvidiaCloudEnabled
          ? `NVIDIA pronta (${countLabel}) · ${keys.nvidiaModel ?? "DeepSeek"}`
          : `NVIDIA trovata (${countLabel}), online spento`,
      );
    }
    if (visionStatus?.totalAssets) {
      setLocalVisionMessage(
        `${visionStatus.embeddedAssets}/${visionStatus.totalAssets} elementi foto e video pronti`,
      );
      setLocalVisionProgress(Math.round((visionStatus.embeddedAssets / visionStatus.totalAssets) * 100));
    }
    if (!desktopBackendAvailable) {
      setError("");
    }
  }

  async function refreshLocalComponents() {
    setIsCheckingComponents(true);
    setComponentsStatus("Ricontrollo componenti locali...");
    try {
      const components = await tauriInvoke<LocalComponent[]>("get_local_components", {});
      setLocalComponents(components);
      setComponentsStatus(componentSummary(components));
      setDoctorStatus(await safeInvoke<DoctorStatus | null>("get_doctor_status", {}, doctorStatus));
      setModelStatus(await safeInvoke<ModelStatus | null>("get_model_status", {}, modelStatus));
      setSimpleAppStatus(await safeInvoke<SimpleAppStatus | null>("get_simple_app_status", {}, simpleAppStatus));
    } catch (err) {
      setComponentsStatus(`Controllo non riuscito: ${shortError(err)}`);
    } finally {
      setIsCheckingComponents(false);
    }
  }

  async function installLocalComponent(componentId: string) {
    const target = localComponents.find((component) => component.id === componentId);
    if (!target) return;
    if (target.installed) {
      await refreshLocalComponents();
      return;
    }
    if (componentId.startsWith("vision")) {
      await prepareLocalVisionInBackground();
      return;
    }
    setInstallingComponentId(componentId);
    setComponentInstallStatus(`Sto preparando ${friendlyComponentLabel(target.id, target.label)}...`);
    try {
      const result = await tauriInvoke<LocalComponentInstallResult>("install_local_component", { id: componentId });
      if (result.components?.length) {
        setLocalComponents(result.components);
        setComponentsStatus(componentSummary(result.components));
      } else {
        await refreshLocalComponents();
      }
      const lastStep = result.steps?.[result.steps.length - 1];
      const lastOutput = lastStep?.output?.split("\n").find((line: string) => line.trim()) ?? "";
      setComponentInstallStatus(result.ok ? "Fatto." : `Non ci sono riuscito: ${result.message}${lastOutput ? ` · ${lastOutput}` : ""}`);
    } catch (err) {
      setComponentInstallStatus(`Non ci sono riuscito: ${shortError(err)}`);
      await refreshLocalComponents();
    } finally {
      setInstallingComponentId("");
      void refreshRemoteStatus();
    }
  }

  async function startAutomaticSetup(options: { repair?: boolean } = {}) {
    setComponentInstallStatus(options.repair ? "Sistemo Trova in background..." : "Preparo tutto in background...");
    try {
      const command = options.repair ? "repair_app" : "start_auto_setup";
      const job = await tauriInvoke<AutoSetupJob>(command, {
        paths: watchPaths,
        allowSystemChanges: true,
      });
      setAutoSetupJob(job);
      void prepareLocalVisionInBackground(true);
      await pollAutomaticSetup(job.id);
    } catch (err) {
      setComponentInstallStatus(`Non sono riuscito ad avviare la preparazione: ${shortError(err)}`);
    }
  }

  async function pollAutomaticSetup(jobId: string) {
    for (let attempt = 0; attempt < 180; attempt += 1) {
      const job = await safeInvoke<AutoSetupJob | null>("get_auto_setup_status", {}, autoSetupJob);
      if (job) {
        setAutoSetupJob(job);
        setComponentInstallStatus(job.message || "");
      }
      if (!job || job.id !== jobId || job.status !== "running") break;
      await delay(900);
    }
    await refreshAfterSetup();
  }

  async function refreshAfterSetup() {
    const [nextStatus, semantic, vision, components, simpleStatus, doctor, models] = await Promise.all([
      safeInvoke<IndexStatus | null>("get_index_status", {}, status),
      safeInvoke<SemanticStatus | null>("get_semantic_status", {}, semanticStatus),
      safeInvoke<LocalVisionStatus | null>("get_local_vision_status", {}, localVisionStatus),
      safeInvoke<LocalComponent[]>("get_local_components", {}, localComponents),
      safeInvoke<SimpleAppStatus | null>("get_simple_app_status", {}, simpleAppStatus),
      safeInvoke<DoctorStatus | null>("get_doctor_status", {}, doctorStatus),
      safeInvoke<ModelStatus | null>("get_model_status", {}, modelStatus),
    ]);
    setStatus(nextStatus);
    setSemanticStatus(semantic);
    setLocalVisionStatus(vision);
    setLocalComponents(components);
    setComponentsStatus(componentSummary(components));
    setSimpleAppStatus(simpleStatus);
    setDoctorStatus(doctor);
    setModelStatus(models);
    setWatchPaths(await safeInvoke<WatchPath[]>("load_watch_paths", {}, watchPaths));
    void refreshRemoteStatus();
  }

  function completeSetup() {
    window.localStorage.setItem("trova.setupComplete", "true");
    setSetupComplete(true);
    setShowSettings(false);
    setShowSetup(false);
    // Setup gia avviato in background dal primo render: lo rilanciamo solo se non esiste un job in corso o terminato.
    if (!autoSetupJob || autoSetupJob.status === "idle") {
      void startAutomaticSetup();
    }
  }

  async function toggleGeminiCloudSetup() {
    const enabled = !watchPaths.some((path) => path.enabled && !path.isExcluded && path.geminiEnabled);
    const nextPaths = watchPaths.map((path) =>
      path.enabled && !path.isExcluded ? { ...path, geminiEnabled: enabled } : path,
    );
    await savePaths(nextPaths);
    setGeminiStatus(enabled ? "Gemini cloud attivo sulle cartelle abilitate" : "Gemini cloud spento");
    if (enabled && status?.filesIndexed) {
      void syncGeminiCloudFolders();
    }
  }

  function toggleNvidiaCloudSetup() {
    const next = !nvidiaCloudEnabled;
    setNvidiaCloudEnabled(next);
    window.localStorage.setItem("trova.nvidiaCloudEnabled", String(next));
    setNvidiaStatus(next ? "NVIDIA online attiva se la chiave e disponibile" : "NVIDIA online spenta");
  }

  async function prepareLocalVisionInBackground(force = false) {
    if (modelWarmupStarted.current && !force) return;
    modelWarmupStarted.current = true;
    setIsLocalVisionBusy(true);
    try {
      setLocalVisionMessage("Preparo foto e video in background...");
      const ready = await prepareLocalVisionModels((progress) => {
        setLocalVisionMessage(progress.label);
        if (typeof progress.progress === "number") {
          setLocalVisionProgress(Math.round(progress.progress));
        }
      });
      setLocalVisionMessage(
        ready.length
          ? "Foto e video pronti per la ricerca."
          : "Ricerca immagini base pronta, migliorie da completare.",
      );
      setLocalVisionStatus(await safeInvoke<LocalVisionStatus | null>("get_local_vision_status", {}, null));
      void refreshLocalComponents();
    } catch (err) {
      setLocalVisionMessage(`Preparazione non completata: ${shortError(err)}`);
    } finally {
      setIsLocalVisionBusy(false);
    }
  }

  async function savePaths(nextPaths: WatchPath[]) {
    setWatchPaths(nextPaths);
    const saved = await safeInvoke<WatchPath[]>("save_watch_paths", { paths: nextPaths }, nextPaths);
    setWatchPaths(saved);
  }

  async function refreshRemoteStatus() {
    const [remoteConnectors, rclone] = await Promise.all([
      safeInvoke<ConnectorConfig[]>("get_connectors", {}, connectors),
      safeInvoke<RcloneStatus | null>("get_rclone_status", {}, rcloneStatus),
    ]);
    setConnectors(remoteConnectors);
    setRcloneStatus(rclone);
    setRemoteStatusMessage(remoteSummary(remoteConnectors, rclone));
  }

  async function saveConnectors(nextConnectors: ConnectorConfig[]) {
    setConnectors(nextConnectors);
    const saved = await tauriInvoke<{ connectors: ConnectorConfig[]; watchPaths: WatchPath[] }>("save_connectors", {
      connectors: nextConnectors,
    });
    setConnectors(saved.connectors);
    setWatchPaths(saved.watchPaths);
    setRemoteStatusMessage(remoteSummary(saved.connectors, rcloneStatus));
  }

  async function addConnectorDraft(provider: string) {
    const name = window.prompt("Nome dell'archivio in Trova", provider === "local" ? "Archivio locale" : "Drive lavoro");
    if (!name) return;
  const remotePath = window.prompt(
      provider === "local" ? "Percorso cartella da copiare sul PC" : "Percorso dentro l'archivio",
      provider === "local" ? "/home/fabio/Documents" : "",
    );
    if (remotePath === null) return;
    const remoteName = provider === "local"
      ? ""
      : window.prompt("Nome archivio gia configurato", provider === "drive" ? "gdrive" : provider) || "";
    const connector = connectorDraft({ name, provider, remotePath, remoteName });
    await saveConnectors([...connectors, connector]);
  }

  async function testConnector(connector: ConnectorConfig) {
    setRemoteBusyId(connector.id);
    setRemoteStatusMessage(`Test ${connector.name} in corso...`);
    try {
      const result = await tauriInvoke<RemoteActionResult>("test_remote_connector", { connector });
      if (result.connector) {
        setConnectors(upsertConnectorState(connectors, result.connector));
      }
      setRemoteStatusMessage(`${result.ok ? "OK" : "Errore"} ${connector.name}: ${result.message ?? ""}`);
    } catch (err) {
      setRemoteStatusMessage(`Test non riuscito: ${shortError(err)}`);
    } finally {
      setRemoteBusyId("");
      void refreshRemoteStatus();
    }
  }

  async function syncConnector(connector: ConnectorConfig) {
    setRemoteBusyId(connector.id);
    setRemoteStatusMessage(`Aggiorno ${connector.name} sul PC...`);
    try {
      const result = await tauriInvoke<RemoteActionResult>("sync_remote_connector", { connector });
      if (result.connector) {
        setConnectors(upsertConnectorState(connectors, result.connector));
      }
      if (result.watchPaths?.length) setWatchPaths(result.watchPaths);
      setRemoteStatusMessage(`${connector.name}: ${result.filesSynced ?? 0} file aggiornati sul PC`);
      const nextStatus = await safeInvoke<IndexStatus | null>("get_index_status", {}, status);
      setStatus(nextStatus);
    } catch (err) {
      setRemoteStatusMessage(`Aggiornamento non riuscito: ${shortError(err)}`);
    } finally {
      setRemoteBusyId("");
      void refreshRemoteStatus();
    }
  }

  async function syncAllConnectors() {
    setRemoteBusyId("all");
    setRemoteStatusMessage("Aggiorno tutti gli archivi automatici...");
    try {
      const summary = await tauriInvoke<{ synced: number; skipped: number; errors: number }>("sync_all_remotes", {});
      setRemoteStatusMessage(`Archivi: ${summary.synced} completati, ${summary.skipped} saltati, ${summary.errors} errori`);
      await refreshRemoteStatus();
      setWatchPaths(await safeInvoke<WatchPath[]>("load_watch_paths", {}, watchPaths));
    } catch (err) {
      setRemoteStatusMessage(`Aggiornamento archivi non riuscito: ${shortError(err)}`);
    } finally {
      setRemoteBusyId("");
    }
  }

  async function refreshDoctorStatus() {
    const [doctor, models, remoteAccess, simpleStatus] = await Promise.all([
      safeInvoke<DoctorStatus | null>("get_doctor_status", {}, doctorStatus),
      safeInvoke<ModelStatus | null>("get_model_status", {}, modelStatus),
      safeInvoke<RemoteAccessStatus | null>("get_remote_access_status", {}, remoteAccessStatus),
      safeInvoke<SimpleAppStatus | null>("get_simple_app_status", {}, simpleAppStatus),
    ]);
    setDoctorStatus(doctor);
    setModelStatus(models);
    setRemoteAccessStatus(remoteAccess);
    setSimpleAppStatus(simpleStatus);
  }

  async function exportDoctorLog() {
    setComponentInstallStatus("Esporto diagnostica locale senza segreti...");
    try {
      const result = await tauriInvoke<{ ok: boolean; path: string }>("export_diagnostic_log", {});
      setComponentInstallStatus(`Diagnostica esportata: ${result.path}`);
      await refreshDoctorStatus();
    } catch (err) {
      setComponentInstallStatus(`Export diagnostica non riuscito: ${shortError(err)}`);
    }
  }

  async function setRemoteAccess(active: boolean) {
    setRemoteAccessBusy(true);
    try {
      const command = active ? "start_remote_access" : "stop_remote_access";
      const next = await tauriInvoke<RemoteAccessStatus>(command, {});
      setRemoteAccessStatus(next);
      setComponentInstallStatus(active ? `Accesso attivo su ${next.url} · codice ${next.token ?? next.tokenPreview}` : "Accesso da altri dispositivi spento");
      await refreshDoctorStatus();
    } catch (err) {
      setComponentInstallStatus(`Accesso da altri dispositivi non riuscito: ${shortError(err)}`);
    } finally {
      setRemoteAccessBusy(false);
    }
  }

  async function addPath() {
    playUiSound("open");
    setFolderDraftError("");
    if (hasTauriBackend()) {
      const selected = await pickFolderFromDesktop();
      if (selected) {
        await addSelectedPath(selected);
        return;
      }
      return;
    }
    setFolderDraftError("");
    setFolderDraft("/home/fabio/Documents");
    setShowAddFolderDialog(true);
  }

  async function pickFolderFromDesktop() {
    setIsPickingFolder(true);
    try {
      return await tauriInvokeRaw<string | null>("pick_folder", {});
    } catch (err) {
      console.warn("Selettore cartella desktop non disponibile", err);
      setFolderDraftError("Selettore desktop non disponibile: incolla qui il percorso.");
      setFolderDraft("/home/fabio/Documents");
      setShowAddFolderDialog(true);
      return null;
    } finally {
      setIsPickingFolder(false);
    }
  }

  async function addSelectedPath(path: string) {
    const selected = normalizeFolderDraft(path);
    if (!selected) {
      playUiSound("error");
      setFolderDraftError("Scrivi o incolla il percorso della cartella.");
      setShowAddFolderDialog(true);
      return;
    }
    if (watchPaths.some((item) => normalizeFolderDraft(item.path) === selected)) {
      playUiSound("error");
      setFolderDraft(selected);
      setFolderDraftError("Questa cartella e gia nella lista.");
      setShowAddFolderDialog(true);
      return;
    }
    await savePaths([...watchPaths, watchPath(selected, true)]);
    playUiSound("confirm");
    setFolderDraftError("");
    setShowAddFolderDialog(false);
    setShowSettings(true);
  }

  async function confirmAddPath() {
    await addSelectedPath(folderDraft);
  }

  async function addConnectedUsbPath() {
    playUiSound("open");
    setFolderDraftError("");
    if (!hasTauriBackend()) {
      setFolderDraftError("Questa azione funziona nell'app desktop con chiavetta collegata.");
      return;
    }
    const selected = await pickFolderFromDesktop();
    if (!selected) return;
    await addSelectedPath(selected);
  }

  async function indexConfiguredPaths() {
    setIsScanning(true);
    setError("");
    try {
      const nextStatus = await tauriInvoke<IndexStatus>("start_indexing", { paths: watchPaths });
      setStatus(nextStatus);
      setWatchPaths(await safeInvoke<WatchPath[]>("load_watch_paths", {}, watchPaths));
      void refreshRemoteStatus();
      setSemanticStatus(await safeInvoke<SemanticStatus | null>("get_semantic_status", {}, null));
      setLocalVisionStatus(await safeInvoke<LocalVisionStatus | null>("get_local_vision_status", {}, null));
      setDoctorStatus(await safeInvoke<DoctorStatus | null>("get_doctor_status", {}, doctorStatus));
      setModelStatus(await safeInvoke<ModelStatus | null>("get_model_status", {}, modelStatus));
      setSimpleAppStatus(await safeInvoke<SimpleAppStatus | null>("get_simple_app_status", {}, simpleAppStatus));
      void refreshLocalComponents();
      await runLocalSearch();
      void indexLocalVisionAssets();
      void syncGeminiCloudFolders();
    } catch (err) {
      setError(String(err));
    } finally {
      setIsScanning(false);
    }
  }

  async function setWatcher(active: boolean) {
    setError("");
    try {
      const nextStatus = active
        ? await tauriInvoke<IndexStatus>("start_watcher", { paths: watchPaths })
        : await tauriInvoke<IndexStatus>("stop_watcher", {});
      setStatus(nextStatus);
    } catch (err) {
      setError(String(err));
    }
  }

  async function runLocalSearch(imageEmbeddings?: number[][], overrideMode?: SearchMode) {
    setError("");
    try {
      const queries = imageEmbeddings?.filter((embedding) => embedding.length) ?? [];
      const activeMode = overrideMode ?? mode;
      const runSearchWithQueries = async (visualQueries: number[][]) => {
        const nextResults = await tauriInvoke<IndexedFile[]>("search_index", {
          request: {
            textQuery: query,
            imageQuery: visualQueries[0] ?? [],
            imageQueries: visualQueries,
            faceQuery: activeMode === "person" ? lastFaceEmbedding.current : [],
            faceQueries: activeMode === "person" && lastFaceEmbedding.current.length ? [lastFaceEmbedding.current] : [],
            mode: activeMode,
            filters: [filter],
            useLocal: true,
            useGemini: Boolean(geminiApiKey && geminiStoreName),
            semantic: true,
            fuzzy: true,
            limit: 250,
            includeSnippets: true,
            includeAssets: true,
          },
        });
        setResults(nextResults);
        if (nvidiaCloudEnabled && query.trim() && nextResults.length > 1) {
          void rerankResultsWithNvidia(query.trim(), nextResults);
        }
        return nextResults;
      };

      await runSearchWithQueries(queries);

      if (!queries.length && query.trim()) {
        try {
          setIsLocalVisionBusy(true);
          const visualTextQueries = await embedTextWithLocalVisionModels(query.trim(), (progress) => {
            setLocalVisionMessage(progress.label);
            if (typeof progress.progress === "number") {
              setLocalVisionProgress(Math.round(progress.progress));
            }
          });
          queries.push(...visualTextQueries.map((result) => result.embedding));
          if (visualTextQueries.length) {
            setLocalVisionMessage(
              `Ricerca testo→immagini attiva con ${visualTextQueries.map((result) => result.label).join(" + ")}`,
            );
            await runSearchWithQueries(visualTextQueries.map((result) => result.embedding));
          }
        } catch (visionErr) {
          setLocalVisionMessage(`Ricerca foto da testo non disponibile: ${shortError(visionErr)}`);
        } finally {
          setIsLocalVisionBusy(false);
        }
      }
    } catch (err) {
      setError(String(err));
    }
  }

  async function rerankResultsWithNvidia(textQuery: string, localResults: IndexedFile[]) {
    try {
      setNvidiaStatus("NVIDIA sta ordinando i risultati...");
      const response = await tauriInvoke<NvidiaRerankResponse>("rerank_with_nvidia", {
        request: {
          query: textQuery,
          results: localResults.slice(0, 18).map((item) => ({
            id: item.id,
            name: item.name,
            kind: item.kind,
            snippet: item.snippet,
            score: item.score,
            visualPreview: item.visual_preview ?? "",
          })),
        },
      });
      if (!response.orderedIds.length || response.model === "local-order") return;
      setResults(reorderByIds(localResults, response.orderedIds));
      setNvidiaStatus(`NVIDIA ha ordinato i risultati: ${response.model.split("/").pop()}`);
    } catch (err) {
      setNvidiaStatus(`NVIDIA pronta, rerank saltato: ${shortError(err)}`);
    }
  }

  async function askLocalFiles() {
    const rawQuestion = (localQuestion.trim() || query.trim()).trim();
    const question = expandSlashCommand(rawQuestion);
    if (!question) {
      setError("Scrivi una domanda o una query prima di chiedere ai file.");
      return;
    }
    setIsLocalAskBusy(true);
    setError("");
    // File caricati: testo come contesto inline, immagini convertite in data URL base64
    // per passarle al modello vision NVIDIA Llama 3.2 Vision.
    const filesToInclude = attachedFiles.length ? attachedFiles.map((entry) => entry.file) : (imageQueryFile ? [imageQueryFile] : []);
    let contextNote = "";
    const imagesDataUrls: string[] = [];
    const textFiles = filesToInclude.filter((file) => !file.type.startsWith("image/"));
    const imageFiles = filesToInclude.filter((file) => file.type.startsWith("image/"));
    const perFileBudget = textFiles.length > 0 ? Math.floor(16000 / textFiles.length) : 0;
    for (const file of textFiles) {
      try {
        const name = file.name;
        const isText = /\.(txt|md|json|csv|yml|yaml|html|xml|log|js|ts|tsx|jsx|py|rs|java|c|cpp|go|sh)$/i.test(name)
          || file.type.startsWith("text/")
          || file.type === "application/json";
        if (isText) {
          const textContent = await file.text();
          const truncated = textContent.slice(0, perFileBudget);
          contextNote += `\n\nFile caricato dall'utente: ${name}\n\`\`\`\n${truncated}${textContent.length > perFileBudget ? "\n[...troncato]" : ""}\n\`\`\``;
        } else {
          contextNote += `\n\nFile caricato dall'utente: ${name} (${file.type || "binario"}, ${Math.round(file.size / 1024)} KB).`;
        }
      } catch (readErr) {
        contextNote += `\n\nFile caricato dall'utente: ${file.name} (lettura non riuscita: ${shortError(readErr)}).`;
      }
    }
    // Immagini: leggi come data URL, max 3 (NVIDIA NIM limit pratico), max 4MB ciascuna
    for (const file of imageFiles.slice(0, 3)) {
      if (file.size > 4 * 1024 * 1024) {
        contextNote += `\n\nImmagine ${file.name} troppo grande (${Math.round(file.size / 1024 / 1024)} MB), saltata.`;
        continue;
      }
      try {
        const dataUrl = await fileToDataUrl(file);
        imagesDataUrls.push(dataUrl);
      } catch (imgErr) {
        contextNote += `\n\nImmagine ${file.name} non leggibile: ${shortError(imgErr)}.`;
      }
    }
    const enrichedQuestion = contextNote ? `${question}${contextNote}` : question;
    const nextHistory: ChatMessage[] = [...chatMessages, { role: "user", content: enrichedQuestion, createdAt: Date.now() }];
    setChatMessages(nextHistory);
    setLocalQuestion("");
    // Streaming token-by-token via /api/chat/stream se non ci sono immagini/agenti.
    // Vision NVIDIA e agenti richiedono modalita sync.
    const useStreaming = imagesDataUrls.length === 0 && !agentMode && !aiProviderConfig.agentEnabled;
    try {
      if (useStreaming) {
        const response = await fetch("http://127.0.0.1:17654/api/chat/stream", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            messages: nextHistory.map((message) => ({ role: message.role, content: message.content })),
            threadId: chatThreadId || undefined,
            provider: aiProviderConfig.provider,
            modelKey: aiProviderConfig.modelKey,
            includeRag: true,
            systemPromptExtra: aiProviderConfig.systemPrompt || "",
            temperature: aiProviderConfig.temperature,
            maxTokens: aiProviderConfig.maxTokens,
            ragDepth: aiProviderConfig.ragDepth,
          }),
        });
        if (!response.ok || !response.body) throw new Error(`stream ${response.status}`);
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let assistantBuffer = "";
        let citations: Array<{ filePath?: string; snippet?: string; name?: string }> = [];
        let receivedThreadId = chatThreadId;
        // Aggiungo subito un messaggio assistente vuoto da popolare
        setChatMessages([...nextHistory, { role: "assistant", content: "", createdAt: Date.now() }]);
        let lastFlush = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          for (const rawLine of lines) {
            const line = rawLine.trim();
            if (!line.startsWith("data:")) continue;
            const payload = line.slice(5).trim();
            if (payload === "[DONE]") continue;
            try {
              const parsed = JSON.parse(payload);
              if (parsed.type === "citations" && Array.isArray(parsed.citations)) citations = parsed.citations;
              else if (parsed.type === "delta" && parsed.delta) assistantBuffer += parsed.delta;
              else if (parsed.type === "done" && parsed.threadId) receivedThreadId = parsed.threadId;
              else if (parsed.type === "error") throw new Error(parsed.error);
            } catch (parseErr) {
              if ((parseErr as Error).message?.startsWith("Nessun provider")) throw parseErr;
            }
          }
          // Throttle render (max ~25fps)
          const now = Date.now();
          if (now - lastFlush > 40) {
            lastFlush = now;
            setChatMessages([...nextHistory, { role: "assistant", content: assistantBuffer, citations, createdAt: Date.now() }]);
          }
        }
        setChatMessages([...nextHistory, { role: "assistant", content: assistantBuffer || "(Nessuna risposta)", citations, createdAt: Date.now() }]);
        setChatThreadId(receivedThreadId);
        setLocalAnswer({ answer: assistantBuffer, citations: (citations || []).map((c) => ({ title: c.name || c.filePath?.split("/").pop() || "file", filePath: c.filePath, chunkIndex: 0, score: 0.5, snippet: c.snippet || "" })) });
      } else {
        // Non-streaming: agent mode OPPURE vision (immagini caricate)
        const result = await tauriInvoke<{ threadId: string; answer: string; citations?: Array<{ filePath?: string; snippet?: string; name?: string }>; toolsUsed?: Array<{ fn: string; args: Record<string, unknown> }>; provider?: string; modelKey?: string }>("chat_with_workspace", {
          messages: nextHistory.map((message) => ({ role: message.role, content: message.content })),
          threadId: chatThreadId || undefined,
          agentMode: imagesDataUrls.length === 0 && (agentMode || aiProviderConfig.agentEnabled),
          provider: aiProviderConfig.provider,
          modelKey: aiProviderConfig.modelKey,
          images: imagesDataUrls,
          systemPromptExtra: aiProviderConfig.systemPrompt || "",
          temperature: aiProviderConfig.temperature,
          maxTokens: aiProviderConfig.maxTokens,
          ragDepth: aiProviderConfig.ragDepth,
        });
        setChatMessages([...nextHistory, { role: "assistant", content: result.answer || "(Nessuna risposta)", citations: result.citations, toolsUsed: result.toolsUsed, createdAt: Date.now() }]);
        setChatThreadId(result.threadId || chatThreadId);
        setLocalAnswer({ answer: result.answer || "", citations: (result.citations || []).map((c) => ({ title: c.name || c.filePath?.split("/").pop() || "file", filePath: c.filePath, chunkIndex: 0, score: 0.5, snippet: c.snippet || "" })) });
      }
      setSemanticStatus(await safeInvoke<SemanticStatus | null>("get_semantic_status", {}, semanticStatus));
    } catch (err) {
      // Fallback al vecchio ask_files se chat_with_workspace fallisce (es. nessun provider AI)
      try {
        const answer = await tauriInvoke<LocalAskAnswer>("ask_files", { request: { question, filters: [filter], limit: 6 } });
        setLocalAnswer(answer);
        setChatMessages([...nextHistory, { role: "assistant", content: answer.answer || "", citations: (answer.citations || []).map((c) => ({ filePath: c.filePath, snippet: c.snippet, name: c.title })), createdAt: Date.now() }]);
      } catch (innerErr) {
        setError(`${shortError(err)}${innerErr ? ` — fallback fallito: ${shortError(innerErr)}` : ""}`);
        // Tolgo l'ultimo messaggio user dato che non c'e risposta
        setChatMessages(nextHistory.slice(0, -1));
      }
    } finally {
      setIsLocalAskBusy(false);
    }
  }

  function startNewChatThread() {
    setChatMessages([]);
    setChatThreadId("");
    setLocalAnswer(null);
  }

  // --- VOCE: TTS (legge risposte) ---
  function speakText(text: string, index: number) {
    if (typeof window === "undefined" || !window.speechSynthesis) {
      setError("La sintesi vocale non e disponibile in questo ambiente.");
      return;
    }
    window.speechSynthesis.cancel();
    if (speakingIndex === index) {
      setSpeakingIndex(null);
      return;
    }
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "it-IT";
    utterance.onend = () => setSpeakingIndex(null);
    utterance.onerror = () => setSpeakingIndex(null);
    setSpeakingIndex(index);
    window.speechSynthesis.speak(utterance);
  }

  // --- VOCE: STT (dettatura microfono) ---
  const recognitionRef = useRef<any>(null);
  function toggleDictation() {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setError("Il riconoscimento vocale non e disponibile in questo browser/app.");
      return;
    }
    if (isListening && recognitionRef.current) {
      recognitionRef.current.stop();
      setIsListening(false);
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.lang = "it-IT";
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.onresult = (event: any) => {
      let transcript = "";
      for (let i = 0; i < event.results.length; i += 1) {
        transcript += event.results[i][0].transcript;
      }
      setLocalQuestion(transcript);
    };
    recognition.onend = () => setIsListening(false);
    recognition.onerror = () => setIsListening(false);
    recognitionRef.current = recognition;
    setIsListening(true);
    recognition.start();
  }

  // --- Slash commands ---
  const SLASH_COMMANDS: Record<string, string> = {
    "/riassumi": "Riassumi in modo chiaro e conciso: ",
    "/traduci": "Traduci in italiano (o in inglese se gia italiano): ",
    "/spiega": "Spiega in modo semplice, come a un principiante: ",
    "/correggi": "Correggi errori e migliora questo testo: ",
    "/elenca": "Fai un elenco puntato dei punti principali di: ",
  };
  function expandSlashCommand(text: string): string {
    const trimmed = text.trimStart();
    for (const [cmd, prefix] of Object.entries(SLASH_COMMANDS)) {
      if (trimmed.toLowerCase().startsWith(cmd + " ") || trimmed.toLowerCase() === cmd) {
        return prefix + trimmed.slice(cmd.length).trim();
      }
    }
    return text;
  }

  async function loadChatThreadsList() {
    const list = await safeInvoke<Array<{ id: string; title: string; messageCount: number; lastMessageAt: number }>>("list_chat_threads", {}, []);
    setChatThreadsList(list || []);
  }

  async function loadChatThread(threadId: string) {
    const result = await safeInvoke<{ threadId: string; messages: ChatMessage[] }>("get_chat_thread", { threadId }, { threadId: "", messages: [] });
    if (result?.messages) {
      setChatMessages(result.messages);
      setChatThreadId(threadId);
      setShowThreadHistory(false);
    }
  }

  async function deleteChatThreadAt(threadId: string) {
    await safeInvoke<{ ok: boolean }>("delete_chat_thread", { threadId }, { ok: false });
    if (threadId === chatThreadId) startNewChatThread();
    await loadChatThreadsList();
  }

  async function loadPinnedDocuments() {
    const list = await safeInvoke<PinnedDoc[]>("list_pinned_documents", {}, []);
    setPinnedDocuments(list || []);
  }

  async function pinDocument(filePath: string) {
    if (!filePath) return;
    await safeInvoke<{ ok: boolean; pinned: string[] }>("pin_document", { filePath }, { ok: false, pinned: [] });
    await loadPinnedDocuments();
  }

  async function unpinDocument(filePath: string) {
    await safeInvoke<{ ok: boolean; pinned: string[] }>("unpin_document", { filePath }, { ok: false, pinned: [] });
    await loadPinnedDocuments();
  }

  async function updateMentionSuggestions(text: string, caret: number) {
    // Trova un @qualcosa che termina al cursore o stiamo digitando
    const before = text.slice(0, caret);
    const match = before.match(/@(\S*)$/);
    if (!match) {
      setShowMentionDropdown(false);
      return;
    }
    const partial = match[1];
    setMentionQuery(partial);
    const list = await safeInvoke<MentionSuggestion[]>("search_files_for_mention", { query: partial, limit: 8 }, []);
    setMentionSuggestions(list || []);
    setShowMentionDropdown((list || []).length > 0);
  }

  function applyMention(suggestion: MentionSuggestion) {
    // Sostituisce @parziale con @nome del file selezionato
    const current = localQuestion;
    const re = /@(\S*)$/;
    const next = current.replace(re, `@${suggestion.name.includes(" ") ? `"${suggestion.name}"` : suggestion.name} `);
    setLocalQuestion(next);
    setShowMentionDropdown(false);
  }

  async function exportChatThread(format: "markdown" | "json" = "markdown") {
    if (!chatThreadId) {
      setError("Nessuna conversazione da esportare.");
      return;
    }
    const result = await safeInvoke<{ format: string; content: string }>("export_chat_thread", { threadId: chatThreadId, format }, { format, content: "" });
    if (!result?.content) return;
    const blob = new Blob([result.content], { type: format === "json" ? "application/json" : "text/markdown" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `trova-chat-${chatThreadId}.${format === "json" ? "json" : "md"}`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function findSimilarToText() {
    const textQuery = (query.trim() || localQuestion.trim()).trim();
    if (!textQuery) {
      setError("Scrivi una query per trovare file simili.");
      return;
    }
    setIsLocalAskBusy(true);
    setError("");
    try {
      const similar = await tauriInvoke<IndexedFile[]>("find_similar_files", {
        request: {
          textQuery,
          filters: [filter],
          limit: 80,
        },
      });
      setResults(similar);
      setSemanticStatus(await safeInvoke<SemanticStatus | null>("get_semantic_status", {}, semanticStatus));
    } catch (err) {
      setError(String(err));
    } finally {
      setIsLocalAskBusy(false);
    }
  }

  async function ensureGeminiStore() {
    if (!geminiApiKey.trim()) {
      throw new Error("Inserisci prima una Gemini API key.");
    }
    if (geminiStoreName) return geminiStoreName;

    setGeminiStatus("Creo File Search Store multimodale...");
    const store = await createGeminiFileSearchStore(geminiApiKey.trim());
    setGeminiStoreName(store);
    window.localStorage.setItem("trova.geminiStoreName", store);
    return store;
  }

  async function uploadGeminiFiles(files: FileList | null) {
    if (!files?.length) return;

    setIsGeminiBusy(true);
    setError("");
    try {
      const store = await ensureGeminiStore();
      const selected = Array.from(files).filter(isSupportedGeminiFile).slice(0, 24);
      if (!selected.length) {
        throw new Error("Google online accetta PDF, DOCX, TXT/MD e immagini PNG/JPEG.");
      }
      const count = await uploadFilesToGeminiStore({
        apiKey: geminiApiKey.trim(),
        storeName: store,
        files: selected,
        onProgress: setGeminiStatus,
      });
      setGeminiStatus(`${count} file pronti online`);
    } catch (err) {
      setError(String(err));
      setGeminiStatus("Errore Google online");
    } finally {
      setIsGeminiBusy(false);
      if (geminiFileInput.current) geminiFileInput.current.value = "";
    }
  }

  async function syncGeminiCloudFolders() {
    if (!geminiApiKey.trim() || !watchPaths.some((path) => path.geminiEnabled && path.enabled && !path.isExcluded)) {
      return;
    }

    setIsGeminiBusy(true);
    try {
      const store = await ensureGeminiStore();
      const candidates = await tauriInvoke<GeminiCandidate[]>("list_gemini_candidates");
      const uploaded = readUploadedGeminiKeys();
      const pending = candidates
        .filter((candidate) => !uploaded.has(geminiCandidateKey(candidate)))
        .slice(0, 36);

      if (!pending.length) {
        setGeminiStatus(candidates.length ? "Google online gia aggiornato" : "Nessun file online da aggiornare");
        return;
      }

      let uploadedCount = 0;
      for (const batch of chunk(pending, 6)) {
        const files = await Promise.all(
          batch.map(async (candidate) => {
            const base64 = await tauriInvoke<string>("read_file_base64", { path: candidate.path });
            return fileFromBase64(candidate.name, candidate.mimeType, base64);
          }),
        );
        uploadedCount += await uploadFilesToGeminiStore({
          apiKey: geminiApiKey.trim(),
          storeName: store,
          files,
          onProgress: setGeminiStatus,
        });
        batch.forEach((candidate) => uploaded.add(geminiCandidateKey(candidate)));
        window.localStorage.setItem("trova.geminiUploaded", JSON.stringify(Array.from(uploaded).slice(-800)));
      }
      setGeminiStatus(`${uploadedCount} file online aggiornati`);
    } catch (err) {
      setGeminiStatus(`Gemini sync saltata: ${shortError(err)}`);
    } finally {
      setIsGeminiBusy(false);
    }
  }

  async function askGemini() {
    setIsGeminiBusy(true);
    setError("");
    try {
      const store = await ensureGeminiStore();
      setGeminiStatus("Cerco anche online...");
      const response =
        imageQueryFile && mode !== "text"
          ? await queryGeminiFileSearchWithImage({
              apiKey: geminiApiKey.trim(),
              storeName: store,
              query,
              image: imageQueryFile,
              mode,
            })
          : await queryGeminiFileSearch({
              apiKey: geminiApiKey.trim(),
              storeName: store,
              query: `Cerca "${query}" nei miei file. Rispondi in italiano e cita documenti, pagine o immagini trovate.`,
              metadataFilter:
                filter === "images" ? 'kind = "image"' : filter === "documents" ? 'kind = "pdf"' : undefined,
            });
      setGeminiAnswer(response.text);
      setGeminiCitations(response.citations);
      setGeminiStatus(`${response.citations.length} citazioni Gemini trovate`);
    } catch (err) {
      setError(String(err));
      setGeminiStatus("Errore durante la query Gemini");
    } finally {
      setIsGeminiBusy(false);
    }
  }

  function classifyFile(file: File): "image" | "text" | "binary" {
    if (file.type.startsWith("image/")) return "image";
    if (
      file.type.startsWith("text/")
      || file.type === "application/json"
      || /\.(txt|md|json|csv|yml|yaml|html|xml|log|js|ts|tsx|jsx|py|rs|java|c|cpp|go|sh)$/i.test(file.name)
    ) return "text";
    return "binary";
  }

  function addAttachedFiles(fileList: FileList | File[] | null) {
    const list = Array.from(fileList || []);
    if (!list.length) return;
    const next: AttachedFile[] = list.map((file) => {
      const kind = classifyFile(file);
      return { file, kind, previewUrl: kind === "image" ? URL.createObjectURL(file) : undefined };
    });
    setAttachedFiles((prev) => [...prev, ...next].slice(-10)); // max 10 file alla volta
    // Primo file immagine: avvia anche la ricerca per immagine (compat con flow esistente)
    const firstImage = next.find((item) => item.kind === "image");
    if (firstImage) {
      void uploadImageQuery([firstImage.file] as unknown as FileList);
    }
  }

  function removeAttachedFile(index: number) {
    setAttachedFiles((prev) => {
      const target = prev[index];
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      const next = prev.filter((_, i) => i !== index);
      // Se ho rimosso l'immagine che era anche imageQueryFile, pulisci la ricerca per immagine
      if (target && imageQueryFile && target.file === imageQueryFile) {
        clearImageQuery();
      }
      return next;
    });
  }

  async function uploadImageQuery(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setImageQueryFile(file);
    setImageQueryPreview(URL.createObjectURL(file));
    setMode("image");
    setError("");
    try {
      const dataUrl = await fileToDataUrl(file);
      const embeddings: number[][] = [];
      const fallbackEmbedding = await tauriInvoke<number[]>("visual_embedding_from_data_url", { dataUrl });
      const faceEmbedding = await safeInvoke<number[]>("face_embedding_from_data_url", { dataUrl }, []);
      embeddings.push(fallbackEmbedding.length ? fallbackEmbedding : await imageFingerprintEmbedding(dataUrl));
      lastImageEmbeddings.current = embeddings;
      lastFaceEmbedding.current = faceEmbedding;
      await runLocalSearch(embeddings);

      setIsLocalVisionBusy(true);
      try {
        const localEmbeddings = await embedImageWithAllLocalVisionModels(dataUrl, (progress) => {
          setLocalVisionMessage(progress.label);
          if (typeof progress.progress === "number") {
            setLocalVisionProgress(Math.round(progress.progress));
          }
        });
        embeddings.push(...localEmbeddings.map((result) => result.embedding));
        lastImageEmbeddings.current = embeddings;
        setLocalVisionMessage(
          localEmbeddings.length
            ? "Foto caricata: cerco immagini, pagine e scene simili."
            : "Uso la ricerca immagini base.",
        );
        if (localEmbeddings.length) await runLocalSearch(embeddings);
      } catch (visionErr) {
        setLocalVisionMessage("Uso la ricerca immagini base.");
        setError(`Ricerca immagini avanzata non pronta: ${String(visionErr)}`);
      } finally {
        setIsLocalVisionBusy(false);
      }

      if (geminiApiKey && geminiStoreName && watchPaths.some((path) => path.geminiEnabled)) {
        setIsGeminiBusy(true);
        const response = await queryGeminiFileSearchWithImage({
          apiKey: geminiApiKey.trim(),
          storeName: geminiStoreName,
          query,
          image: file,
          mode: "image",
        });
        setGeminiAnswer(response.text);
        setGeminiCitations(response.citations);
        setGeminiStatus(`${response.citations.length} citazioni Gemini trovate`);
        setIsGeminiBusy(false);
      }
    } catch (err) {
      setError(String(err));
    } finally {
      if (imageQueryInput.current) imageQueryInput.current.value = "";
    }
  }

  function clearImageQuery() {
    setImageQueryFile(null);
    setImageQueryPreview("");
    setMode("text");
    lastImageEmbeddings.current = [];
    lastFaceEmbedding.current = [];
  }

  async function indexLocalVisionAssets() {
    setIsLocalVisionBusy(true);
    setError("");
    setLocalVisionProgress(0);
    try {
      const assets = await tauriInvoke<LocalVisionAsset[]>("list_visual_assets");
      const pendingJobs = assets.flatMap((asset) => {
        const existingModels = new Set(asset.embeddingModels ?? (asset.embeddingModel ? [asset.embeddingModel] : []));
        return LOCAL_VISION_MODELS.filter((model) => !existingModels.has(model.id)).map((model) => ({
          asset,
          model,
        }));
      });
      if (!assets.length) {
        setLocalVisionMessage("Non ho ancora trovato immagini, PDF o video da preparare.");
        setLocalVisionStatus(await safeInvoke<LocalVisionStatus | null>("get_local_vision_status", {}, null));
        return;
      }
      if (!pendingJobs.length) {
        setLocalVisionMessage(`${assets.length}/${assets.length} elementi gia pronti.`);
        setLocalVisionProgress(100);
        setLocalVisionStatus(await safeInvoke<LocalVisionStatus | null>("get_local_vision_status", {}, null));
        return;
      }

      let completedJobs = 0;
      const failedModels = new Set<string>();
      for (const asset of assets) {
        const existingModels = new Set(asset.embeddingModels ?? (asset.embeddingModel ? [asset.embeddingModel] : []));
        const missingModels = LOCAL_VISION_MODELS.filter((model) => !existingModels.has(model.id));
        if (!missingModels.length) continue;

        const dataUrl = await tauriInvoke<string>("read_image_data_url", { path: asset.imagePath });
        if (!existingModels.has(FINGERPRINT_MODEL)) {
          try {
            const fingerprint = await imageFingerprintEmbedding(dataUrl);
            const nextStatus = await tauriInvoke<LocalVisionStatus>("update_visual_asset_embedding", {
              assetId: asset.assetId,
              embedding: fingerprint,
              model: FINGERPRINT_MODEL,
            });
            setLocalVisionStatus(nextStatus);
          } catch {
            // Neural models below remain the main path if canvas fingerprinting fails.
          }
        }
        for (const model of missingModels) {
          setLocalVisionMessage(`${friendlyVisionModelLabel(model.id, model.label)}: ${completedJobs + 1}/${pendingJobs.length}`);
          try {
            const embedding = await embedImageWithModel(model.id, dataUrl, (progress) => {
              setLocalVisionMessage(`${friendlyVisionModelLabel(model.id, progress.label)} · ${completedJobs + 1}/${pendingJobs.length}`);
            });
            const nextStatus = await tauriInvoke<LocalVisionStatus>("update_visual_asset_embedding", {
              assetId: asset.assetId,
              embedding,
              model: model.id,
            });
            setLocalVisionStatus(nextStatus);
          } catch (err) {
            failedModels.add(model.label);
            const reason = shortError(err);
            setLocalVisionMessage(`${friendlyVisionModelLabel(model.id, model.label)} da riprovare: ${reason}`);
          } finally {
            completedJobs += 1;
            setLocalVisionProgress(Math.round((completedJobs / pendingJobs.length) * 100));
          }
        }
      }

      const finalStatus = await tauriInvoke<LocalVisionStatus>("get_local_vision_status");
      setLocalVisionStatus(finalStatus);
      setLocalVisionMessage(
        failedModels.size
          ? `${finalStatus.embeddedAssets}/${finalStatus.totalAssets} elementi pronti · alcuni da riprovare`
          : `${finalStatus.embeddedAssets}/${finalStatus.totalAssets} elementi foto e video pronti`,
      );
      await runLocalSearch();
    } catch (err) {
      setError(String(err));
      setLocalVisionMessage("Foto e video non completati");
    } finally {
      setIsLocalVisionBusy(false);
    }
  }

  return (
    <main className="window">
      <header className="titlebar">
        <div className="app-title">
          <span className="google-mark" />
          <span>Trova</span>
        </div>
        <button className="title-action" onClick={() => setShowSettings((value) => !value)}>
          <GeneratedIcon name="settings" size={22} />
          <span>Impostazioni</span>
        </button>
      </header>

      {showSetup && (
        <SetupTutorial
          paths={watchPaths}
          status={status}
          localVisionStatus={localVisionStatus}
          localVisionMessage={localVisionMessage}
          localVisionBusy={isLocalVisionBusy}
          localVisionProgress={localVisionProgress}
          autoSetupJob={autoSetupJob}
          simpleStatus={simpleAppStatus}
          geminiCloudEnabled={watchPaths.some((path) => path.enabled && !path.isExcluded && path.geminiEnabled)}
          nvidiaCloudEnabled={nvidiaCloudEnabled}
          geminiStatus={geminiStatus}
          nvidiaStatus={nvidiaStatus}
          desktopBackendAvailable={desktopBackendAvailable}
          onIndex={() => void indexConfiguredPaths()}
          onAutoSetup={() => void startAutomaticSetup()}
          onPrepareVision={() => void prepareLocalVisionInBackground(true)}
          onToggleGeminiCloud={() => void toggleGeminiCloudSetup()}
          onToggleNvidiaCloud={toggleNvidiaCloudSetup}
          onOpenSettings={() => {
            setShowSettings(true);
            setSetupComplete(true);
            setShowSetup(false);
          }}
          onClose={completeSetup}
        />
      )}

      {showAddFolderDialog && (
        <AddFolderDialog
          value={folderDraft}
          error={folderDraftError}
          onChange={(value) => {
            playUiSound("select");
            setFolderDraft(value);
            setFolderDraftError("");
          }}
          onClose={() => {
            playUiSound("close");
            setShowAddFolderDialog(false);
          }}
          onConfirm={() => void confirmAddPath()}
          canBrowse={desktopBackendAvailable}
          isPicking={isPickingFolder}
          onAddUsbConnected={() => void addConnectedUsbPath()}
          onBrowse={async () => {
            playUiSound("open");
            if (!desktopBackendAvailable) {
              setFolderDraftError("Nell'app desktop qui si apre il selettore cartelle del PC.");
              return;
            }
            const selected = await pickFolderFromDesktop();
            if (selected) {
              playUiSound("select");
              setFolderDraft(selected);
              setFolderDraftError("");
            }
          }}
        />
      )}

      <button
        type="button"
        className="theme-toggle-button"
        onClick={() => setDarkMode((value) => !value)}
        title={darkMode ? "Tema chiaro (Ctrl+D)" : "Tema scuro (Ctrl+D)"}
        aria-label="Cambia tema"
      >
        {darkMode ? <Sun size={18} /> : <Moon size={18} />}
      </button>

      <div className={`app-shell ${setupComplete ? "clean-shell" : ""}`}>
        {!setupComplete && (
        <aside className="sidebar">
          <nav className="side-nav" aria-label="Navigazione">
            <button className={!showSettings ? "active" : ""} onClick={() => setShowSettings(false)}>
              <GeneratedIcon name="search" size={22} />
              <span>Cerca</span>
            </button>
            <button onClick={addPath}>
              <GeneratedIcon name="folder" size={22} />
              <span>Aggiungi cartella</span>
            </button>
          </nav>

          <IndexCard status={status} isScanning={isScanning} onIndex={indexConfiguredPaths} />

          <LocalVisionCard
            status={localVisionStatus}
            message={localVisionMessage}
            progress={localVisionProgress}
            busy={isLocalVisionBusy}
            onIndex={indexLocalVisionAssets}
          />

          <section className="ai-stack-card">
            <div className="ai-stack-title">
              <GeneratedIcon name="cloud" size={22} />
              <span>Online</span>
            </div>
            <input
              className="api-key-input"
              value={geminiApiKey}
              onChange={(event) => setGeminiApiKey(event.target.value)}
              type="password"
              placeholder="Gemini API key"
            />
            <div className="ai-actions">
              <button onClick={() => geminiFileInput.current?.click()} disabled={isGeminiBusy}>
                Prepara
              </button>
              <button onClick={askGemini} disabled={isGeminiBusy}>
                Cerca online
              </button>
            </div>
            <input
              ref={geminiFileInput}
              className="hidden-input"
              type="file"
              multiple
              accept=".pdf,.docx,.txt,.md,.png,.jpg,.jpeg"
              onChange={(event) => void uploadGeminiFiles(event.currentTarget.files)}
            />
            <p>{geminiStatus}</p>
            <div className="gemma-line">
              <GeneratedIcon name="semantic" size={18} />
              <span>Modelli locali opzionali: utili per descrizioni e ordine dei risultati.</span>
            </div>
            <div className="gemma-line">
              <GeneratedIcon name="sparkle" size={18} />
              <span>{nvidiaStatus}</span>
            </div>
          </section>

          <Locations paths={watchPaths} onToggleCloud={(path) => void savePaths(togglePath(watchPaths, path, "geminiEnabled"))} />

          <section className="privacy-card">
            <GeneratedIcon name="shield" size={30} />
            <div>
              <strong>Locale prima, cloud esplicito</strong>
              <p>Gemini riceve solo file delle cartelle con toggle cloud.</p>
              <button onClick={() => setShowSettings(true)}>Gestisci privacy</button>
            </div>
          </section>

          <button className="settings" onClick={() => setShowSettings((value) => !value)}>
            <GeneratedIcon name="settings" size={24} />
            <span>Impostazioni</span>
          </button>
        </aside>
        )}

        <section className={`workspace ${showSettings ? "settings-workspace" : "home-workspace"}`}>
          {!showSettings && <HomeAnimatedScene />}
          {!showSettings && (
            <div className="search-row">
              <LiquidGlassSurface variant="search">
                <div
                  className={`search-box ${attachedFiles.length ? "with-attachment" : ""} ${isDraggingFile ? "dropping" : ""}`}
                  onDragOver={(event) => { event.preventDefault(); setIsDraggingFile(true); }}
                  onDragLeave={() => setIsDraggingFile(false)}
                  onDrop={(event) => {
                    event.preventDefault();
                    setIsDraggingFile(false);
                    addAttachedFiles(event.dataTransfer?.files || null);
                  }}
                >
                  <GeneratedIcon name="search" size={28} />
                  <input
                    ref={searchInputRef}
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        const text = query.trim();
                        if (attachedFiles.length && text) {
                          // File caricati + testo: domanda all'AI con i file come contesto
                          setLocalQuestion(text);
                          void askLocalFiles();
                        } else {
                          // Comportamento classico: ricerca testo / per immagine
                          void runLocalSearch();
                        }
                      }
                    }}
                    placeholder={attachedFiles.length
                      ? `Chiedi qualcosa su ${attachedFiles.length === 1 ? attachedFiles[0].file.name : `${attachedFiles.length} file caricati`}...`
                      : "Cerca testo, oppure trascina un file qui (o premi +) e fai una domanda..."}
                  />
                  {(query || attachedFiles.length > 0) && (
                    <button className="icon-button" onClick={() => { setQuery(""); attachedFiles.forEach((file) => file.previewUrl && URL.revokeObjectURL(file.previewUrl)); setAttachedFiles([]); clearImageQuery(); }} aria-label="Svuota">
                      <X size={20} />
                    </button>
                  )}
                  <i />
                  <button className="icon-button icon-button-add" onClick={() => imageQueryInput.current?.click()} aria-label="Carica file" title="Carica file (anche trascinalo qui)">
                    <Plus size={26} strokeWidth={2.4} />
                  </button>
                  <input
                    ref={imageQueryInput}
                    className="hidden-input"
                    type="file"
                    multiple
                    accept="image/png,image/jpeg,image/webp,application/pdf,text/plain,text/markdown,.md,.txt,.docx,.doc,.csv,.json,.html,.xml,.yaml,.yml,.py,.js,.ts,.tsx,.jsx,.rs,.go,.java,.c,.cpp,.sh"
                    onChange={(event) => { addAttachedFiles(event.currentTarget.files); event.currentTarget.value = ""; }}
                  />
                </div>
              </LiquidGlassSurface>
              {attachedFiles.length > 0 && (
                <div className="search-attached-files" role="status">
                  {attachedFiles.map((attached, index) => (
                    <span key={`${attached.file.name}-${index}`} className={`search-attached-chip kind-${attached.kind}`} title={attached.file.name}>
                      {attached.kind === "image" && attached.previewUrl
                        ? <img src={attached.previewUrl} alt="" />
                        : <Paperclip size={12} />}
                      <em>{attached.file.name}</em>
                      <button type="button" onClick={() => removeAttachedFile(index)} aria-label="Rimuovi">
                        <X size={12} />
                      </button>
                    </span>
                  ))}
                  <span className="search-attached-hint">scrivi e premi Invio per chiedere all'AI</span>
                </div>
              )}
            </div>
          )}

          {imageQueryPreview && (
            <section className="image-query-card">
              <img src={imageQueryPreview} alt="Query immagine" />
              <div>
                <strong>{mode === "person" ? "Ricerca stessa persona" : "Ricerca tramite immagine"}</strong>
                <span>{imageQueryFile?.name}</span>
              </div>
              <button onClick={() => {
                const nextMode = mode === "person" ? "image" : "person";
                setMode(nextMode);
                void runLocalSearch(lastImageEmbeddings.current, nextMode);
              }}>
                <GeneratedIcon name={mode === "person" ? "image" : "semantic"} size={20} />
                <span>{mode === "person" ? "Simili" : "Persona"}</span>
              </button>
            </section>
          )}

          {hasSearchIntent && (
            <nav className="filters" aria-label="Filtri">
              {filters.map((item) => {
                return (
                  <button
                    key={item.id}
                    className={item.id === filter ? "active" : ""}
                    onClick={() => setFilter(item.id)}
                  >
                    <GeneratedIcon name={item.icon} size={20} />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>
          )}

          {hasSearchIntent && (
            <LocalAskPanel
              question={localQuestion}
              query={query}
              answer={localAnswer}
              busy={isLocalAskBusy}
              semanticStatus={semanticStatus}
              chatMessages={chatMessages}
              agentMode={agentMode || aiProviderConfig.agentEnabled}
              activeProviderLabel={aiProviderStatus?.providers?.find((p) => p.configured)?.label || "Modello AI non configurato"}
              activeModelLabel={aiProviderStatus?.providers?.find((p) => p.id === aiProviderConfig.provider || (aiProviderConfig.provider === "auto" && p.configured))?.models?.find((m) => m.key === aiProviderConfig.modelKey)?.label || aiProviderConfig.modelKey}
              onQuestionChange={setLocalQuestion}
              onAsk={() => void askLocalFiles()}
              onSimilar={() => void findSimilarToText()}
              onToggleAgent={() => setAgentMode((value) => !value)}
              onNewThread={startNewChatThread}
              onOpenSettings={() => setShowSettings(true)}
              onExport={() => void exportChatThread("markdown")}
              onShowHistory={async () => { await loadChatThreadsList(); setShowThreadHistory(true); }}
              chatThreadsList={chatThreadsList}
              showThreadHistory={showThreadHistory}
              onCloseHistory={() => setShowThreadHistory(false)}
              onPickThread={loadChatThread}
              onDeleteThread={deleteChatThreadAt}
              pinnedDocuments={pinnedDocuments}
              onUnpinDocument={unpinDocument}
              onPinFromCitation={(filePath) => void pinDocument(filePath)}
              mentionSuggestions={mentionSuggestions}
              showMentionDropdown={showMentionDropdown}
              onQuestionChangeWithCaret={(value, caret) => { setLocalQuestion(value); void updateMentionSuggestions(value, caret); }}
              onPickMention={applyMention}
              onSpeak={speakText}
              speakingIndex={speakingIndex}
              onToggleDictation={toggleDictation}
              isListening={isListening}
              onOpenCitation={(filePath) => { if (filePath) void safeInvoke("open_in_folder", { path: filePath }, null); }}
            />
          )}

          {error && <div className="error">{error}</div>}

          {showSettings ? (
            <SettingsPanel
              paths={watchPaths}
              status={status}
              geminiStatus={geminiStatus}
              nvidiaStatus={nvidiaStatus}
              nvidiaCloudEnabled={nvidiaCloudEnabled}
              localVisionMessage={localVisionMessage}
              localVisionStatus={localVisionStatus}
              localVisionBusy={isLocalVisionBusy}
              semanticStatus={semanticStatus}
              localComponents={localComponents}
              componentsStatus={componentsStatus}
              isCheckingComponents={isCheckingComponents}
              isScanning={isScanning}
              installingComponentId={installingComponentId}
              componentInstallStatus={componentInstallStatus}
              doctorStatus={doctorStatus}
              modelStatus={modelStatus}
              simpleStatus={simpleAppStatus}
              autoSetupJob={autoSetupJob}
              remoteAccessStatus={remoteAccessStatus}
              remoteAccessBusy={remoteAccessBusy}
              connectors={connectors}
              rcloneStatus={rcloneStatus}
              remoteStatusMessage={remoteStatusMessage}
              remoteBusyId={remoteBusyId}
              onSave={savePaths}
              onAdd={addPath}
              onSaveConnectors={saveConnectors}
              onAddConnector={addConnectorDraft}
              onTestConnector={(connector) => void testConnector(connector)}
              onSyncConnector={(connector) => void syncConnector(connector)}
              onSyncAllConnectors={() => void syncAllConnectors()}
              onToggleNvidiaCloud={toggleNvidiaCloudSetup}
              onIndex={indexConfiguredPaths}
              onAutoSetup={() => void startAutomaticSetup()}
              onRepair={() => void startAutomaticSetup({ repair: true })}
              onWatcher={setWatcher}
              onRefreshComponents={() => void refreshLocalComponents()}
              onRefreshDoctor={() => void refreshDoctorStatus()}
              onExportDoctor={() => void exportDoctorLog()}
              onRemoteAccess={(active) => void setRemoteAccess(active)}
              onInstallComponent={(componentId) => void installLocalComponent(componentId)}
              onClear={async () => {
                setStatus(await safeInvoke<IndexStatus | null>("clear_index", {}, status));
                setLocalVisionStatus(await safeInvoke<LocalVisionStatus | null>("get_local_vision_status", {}, null));
                setResults([]);
              }}
              aiProviderStatus={aiProviderStatus}
              aiProviderConfig={aiProviderConfig}
              onSaveAiProvider={async (config) => {
                setAiProviderConfig(config);
                await safeInvoke<{ ok: boolean }>("set_ai_provider", config, { ok: false });
              }}
              hotkeyConfig={hotkeyConfig}
              capturingHotkey={capturingHotkey}
              onStartCaptureHotkey={() => setCapturingHotkey(true)}
              onCaptureHotkeyKeydown={captureHotkeyKeydown}
              onSaveHotkey={saveHotkey}
              ollamaInstall={ollamaInstall}
              onInstallOllamaGemma={installOllamaGemma}
              onReloadAiStatus={async () => {
                const next = await safeInvoke<typeof aiProviderStatus>("get_ai_provider_status", {}, null);
                if (next) setAiProviderStatus(next);
              }}
            />
          ) : (
            <>
              {hasSearchIntent && (
                <section className="results-toolbar">
                  <strong>{visibleResults.length.toLocaleString("it-IT")} risultati reali</strong>
                  <div>
                    <span>Ordina per: Rilevanza</span>
                    <button
                      className={`view ${viewMode === "list" ? "active" : ""}`}
                      onClick={() => setViewMode("list")}
                      aria-label="Lista"
                    >
                      <List size={18} />
                    </button>
                    <button
                      className={`view ${viewMode === "grid" ? "active" : ""}`}
                      onClick={() => setViewMode("grid")}
                      aria-label="Griglia"
                    >
                      <Grid2X2 size={17} />
                    </button>
                  </div>
                </section>
              )}

              {(geminiAnswer || geminiCitations.length > 0) && (
                <GeminiAnswer answer={geminiAnswer} citations={geminiCitations} />
              )}

              {visibleResults.length ? (
                <section className={`results-list ${viewMode === "grid" ? "grid-results" : ""}`}>
                  {visibleResults.map((item, index) => (
                    <ResultRow
                      key={item.id}
                      item={item}
                      index={index}
                      query={query}
                      nvidiaEnabled={nvidiaCloudEnabled}
                      onOpen={rememberRecentFile}
                    />
                  ))}
                </section>
              ) : !hasSearchIntent ? (
                <HomeCommandCenter
                  status={status}
                  localVisionStatus={localVisionStatus}
                  localVisionMessage={localVisionMessage}
                  localVisionBusy={isLocalVisionBusy}
                  geminiStatus={geminiStatus}
                  nvidiaStatus={nvidiaStatus}
                  recentFiles={recentFiles}
                  nvidiaEnabled={nvidiaCloudEnabled}
                  onPrepareFiles={indexConfiguredPaths}
                  onPrepareVision={indexLocalVisionAssets}
                  onSettings={() => setShowSettings(true)}
                  autoSetupJob={autoSetupJob}
                />
              ) : (
                <EmptyState
                  hasIndex={Boolean(status?.filesIndexed)}
                  compact={false}
                  query={query}
                  desktopBackendAvailable={desktopBackendAvailable}
                  onIndex={indexConfiguredPaths}
                  onSettings={() => setShowSettings(true)}
                />
              )}
              {!hasSearchIntent && (
                <nav className="home-dock" aria-label="Azioni rapide">
                  <button className="active" type="button">
                    <GeneratedIcon name="search" size={22} />
                    <span>Cerca</span>
                  </button>
                  <button type="button" onClick={addPath}>
                    <GeneratedIcon name="folder" size={22} />
                    <span>Aggiungi cartella</span>
                  </button>
                  <button type="button" onClick={() => setShowSettings(true)}>
                    <GeneratedIcon name="settings" size={22} />
                    <span>Impostazioni</span>
                  </button>
                </nav>
              )}
              {hasSearchIntent && (
                <p className="footer-note">
                  {status?.filesIndexed ? `${status.filesIndexed.toLocaleString("it-IT")} file pronti` : "Premi Prepara tutto nelle impostazioni"}
                </p>
              )}
            </>
          )}
        </section>
      </div>
    </main>
  );
}

function AddFolderDialog({
  value,
  error,
  onChange,
  onClose,
  onConfirm,
  canBrowse,
  isPicking,
  onBrowse,
  onAddUsbConnected,
}: {
  value: string;
  error: string;
  onChange: (value: string) => void;
  onClose: () => void;
  onConfirm: () => void;
  canBrowse: boolean;
  isPicking: boolean;
  onBrowse: () => void | Promise<void>;
  onAddUsbConnected: () => void | Promise<void>;
}) {
  const suggestions = [
    { path: "/home/fabio", label: "Tutto il mio PC", icon: "database" as GeneratedIconName },
    { path: "/home/fabio/Documents", label: "Documents", icon: "document" as GeneratedIconName },
    { path: "/home/fabio/Downloads", label: "Downloads", icon: "archive" as GeneratedIconName },
    { path: "/home/fabio/Pictures", label: "Pictures", icon: "image" as GeneratedIconName },
  ];
  const normalizedValue = normalizeFolderDraft(value);
  const selectedLabel =
    suggestions.find((suggestion) => suggestion.path === normalizedValue)?.label ||
    displayPathName(normalizedValue || "/home/fabio");
  const selectedIcon = iconForPath(normalizedValue || "/home/fabio");

  return (
    <div className="add-folder-overlay" role="presentation" onClick={onClose}>
      <section className="add-folder-app" role="dialog" aria-modal="true" aria-label="Aggiungi cartella" onClick={(event) => event.stopPropagation()}>
        <header className="add-folder-appbar">
          <div className="add-folder-brand">
            <span className="google-mark" />
            <strong>Trova</strong>
          </div>
          <div className="add-folder-searchbar">
            <Search size={18} />
            <span>Cerca in Trova...</span>
            <kbd>Ctrl + K</kbd>
          </div>
          <button type="button" className="add-folder-icon-btn" aria-label="Impostazioni">
            <Settings size={20} />
          </button>
          <div className="add-folder-window-controls" aria-hidden="true">
            <span><Minus size={16} /></span>
            <span><Square size={15} /></span>
            <button type="button" onClick={onClose} aria-label="Chiudi">
              <X size={18} />
            </button>
          </div>
        </header>

        <div className="add-folder-color-line" aria-hidden="true">
          <i /><i /><i /><i />
        </div>

        <div className="add-folder-body">
          <aside className="add-folder-sidebar" aria-label="Navigazione Trova">
            <nav className="add-folder-side-nav">
              <button type="button" className="active"><Home size={20} /><span>Home</span></button>
              <button type="button"><Search size={20} /><span>Ricerca</span></button>
              <button type="button"><Folder size={20} /><span>Cartelle</span></button>
              <button type="button"><Star size={20} /><span>Preferiti</span></button>
              <button type="button"><Clock3 size={20} /><span>Recenti</span></button>
              <button type="button"><Settings size={20} /><span>Impostazioni</span></button>
            </nav>
            <button type="button" className="add-folder-side-cta">
              <PlusCircle size={20} />
              <span>Aggiungi cartella</span>
            </button>
            <div className="add-folder-side-footer">
              <button type="button"><HelpCircle size={18} /><span>Guida</span></button>
              <button type="button"><MessageSquare size={18} /><span>Feedback</span></button>
            </div>
            <div className="add-folder-index-card">
              <span><i />Indicizzazione attiva</span>
              <small>Tutto aggiornato</small>
              <b><Check size={18} /></b>
            </div>
          </aside>

          <div className="add-folder-stage">
            <div className="add-folder-dialog">
              <div className="add-folder-head">
                <div className="add-folder-icon">
                  <GeneratedIcon name="folder" size={58} />
                </div>
                <div>
                  <strong>Aggiungi cartella</strong>
                  <span>Scegli una cartella del PC dove Trova deve cercare.</span>
                </div>
              </div>

              <div className="add-folder-form-row">
                <label className="add-folder-field">
                  <span>Percorso cartella</span>
                  <input
                    value={value}
                    onChange={(event) => onChange(event.currentTarget.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") onConfirm();
                      if (event.key === "Escape") onClose();
                    }}
                    autoFocus
                    placeholder="/home/fabio/Documents"
                  />
                </label>
                <button
                  type="button"
                  className={`add-folder-browse ${canBrowse ? "" : "browser-fallback"}`}
                  onClick={() => void onBrowse()}
                  disabled={isPicking}
                >
                  <GeneratedIcon name="folder" size={22} />
                  <span>{isPicking ? "Apro selettore..." : "Scegli dal PC"}</span>
                </button>
              </div>

              <div className="add-folder-usb-row">
                <button type="button" className="add-folder-usb-btn" onClick={() => void onAddUsbConnected()} disabled={isPicking}>
                  <HardDrive size={18} />
                  <span>{isPicking ? "Cerco chiavetta..." : "Chiavetta collegata"}</span>
                </button>
                <small>Aggiunge la cartella scelta con tutte le sottocartelle.</small>
              </div>

              <div className="add-folder-suggestions" aria-label="Percorsi rapidi">
                {suggestions.map((suggestion) => {
                  const active = normalizedValue === suggestion.path;
                  return (
                    <button
                      key={suggestion.path}
                      type="button"
                      className={active ? "active" : ""}
                      onClick={() => onChange(suggestion.path)}
                    >
                      <GeneratedIcon name={suggestion.icon} size={42} />
                      <span>{suggestion.label}</span>
                      {active && <b><Check size={16} /></b>}
                    </button>
                  );
                })}
              </div>

              <aside className="add-folder-preview" aria-label="Anteprima cartella scelta">
                <div className="add-folder-preview-icon">
                  <GeneratedIcon name={selectedIcon} size={66} />
                </div>
                <div className="add-folder-preview-copy">
                  <strong>{selectedLabel}</strong>
                  <span>{normalizedValue || "Nessuna cartella scelta"}</span>
                  <div className="add-folder-preview-line">
                    <i />
                  </div>
                  <small><i />Locale, sottocartelle incluse</small>
                </div>
              </aside>

              {error && <p className="add-folder-error">{error}</p>}

              <div className="add-folder-actions">
                <button type="button" onClick={onClose}>Annulla</button>
                <button type="button" className="primary-action" onClick={onConfirm}>
                  <PlusCircle size={20} />
                  <span>Aggiungi</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function SetupTutorial({
  paths,
  status,
  localVisionStatus,
  localVisionMessage,
  localVisionBusy,
  localVisionProgress,
  autoSetupJob,
  simpleStatus,
  geminiCloudEnabled,
  nvidiaCloudEnabled,
  geminiStatus,
  nvidiaStatus,
  desktopBackendAvailable,
  onIndex,
  onAutoSetup,
  onPrepareVision,
  onToggleGeminiCloud,
  onToggleNvidiaCloud,
  onOpenSettings,
  onClose,
}: {
  paths: WatchPath[];
  status: IndexStatus | null;
  localVisionStatus: LocalVisionStatus | null;
  localVisionMessage: string;
  localVisionBusy: boolean;
  localVisionProgress: number;
  autoSetupJob: AutoSetupJob | null;
  simpleStatus: SimpleAppStatus | null;
  geminiCloudEnabled: boolean;
  nvidiaCloudEnabled: boolean;
  geminiStatus: string;
  nvidiaStatus: string;
  desktopBackendAvailable: boolean;
  onIndex: () => void;
  onAutoSetup: () => void;
  onPrepareVision: () => void;
  onToggleGeminiCloud: () => void;
  onToggleNvidiaCloud: () => void;
  onOpenSettings: () => void;
  onClose: () => void;
}) {
  const [pageIndex, setPageIndex] = useState(0);
  const backdropRef = useRef<HTMLElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const activePaths = paths.filter((path) => path.enabled && !path.isExcluded);
  const indexedFiles = status?.filesIndexed ?? 0;
  const visualReady = localVisionStatus?.embeddedAssets ?? 0;
  const visualTotal = localVisionStatus?.totalAssets ?? 0;
  const modelStatuses = localVisionStatus?.models ?? [];
  const modelProgress = Math.max(0, Math.min(100, localVisionBusy ? localVisionProgress : localVisionStatus ? 100 : 0));
  const globalVisionProgress = visualTotal ? Math.round((visualReady / visualTotal) * 100) : modelProgress;
  const cloudLabel = [geminiCloudEnabled ? "Gemini" : "", nvidiaCloudEnabled ? "NVIDIA" : ""]
    .filter(Boolean)
    .join(" + ");
  const activePathLabel = activePaths.slice(0, 2).map((path) => displayPathName(path.path)).join(", ");
  const indexedLabel = indexedFiles ? `${indexedFiles.toLocaleString("it-IT")} file pronti` : "Premi Prepara tutto";
  const cloudReady = geminiCloudEnabled || nvidiaCloudEnabled;
  const setupRunning = autoSetupJob?.status === "running";
  const setupProgress = setupRunning ? Math.max(4, Math.min(100, autoSetupJob?.progress ?? 0)) : 0;
  useEffect(() => {
    setupTutorialArtSources.forEach((source) => {
      const image = new window.Image();
      image.src = source;
    });
  }, []);
  const pages = [
    {
      title: "Sto preparando tutto per te.",
      text: "Trova cerca nei tuoi documenti, foto, audio e video. La preparazione e gia partita in background: non devi premere niente.",
      image: setupTutorialLocalIndexArt,
      body: (
        <div className="setup-page-grid">
          <article className="setup-stat-panel tone-blue">
            <GeneratedIcon name="database" size={25} />
            <div>
              <span>Ricerca nei file</span>
              <strong>{indexedFiles ? indexedFiles.toLocaleString("it-IT") : (setupRunning ? `${setupProgress}%` : "Da preparare")}</strong>
              <small>{setupRunning ? "Preparazione in corso..." : indexedLabel}</small>
            </div>
          </article>
          <article className="setup-stat-panel tone-yellow">
            <GeneratedIcon name="folder" size={25} />
            <div>
              <span>Cartelle</span>
              <strong>{activePaths.length || 3}</strong>
              <small>{activePathLabel || "Documenti, Download, Immagini"}</small>
            </div>
          </article>
          {setupRunning && (
            <div className="setup-total-progress setup-auto-progress" aria-label="Preparazione in corso">
              <span style={{ width: `${setupProgress}%` }} />
            </div>
          )}
          <p className="setup-page-note">Continua pure a leggere il tutorial: prepara tutto da solo. Quando finisci, sara gia (o quasi) pronto.</p>
        </div>
      ),
    },
    {
      title: "Foto e video diventano cercabili.",
      text: "Trova legge immagini, pagine PDF e scene video. Il download dei modelli parte da solo: ti mostro solo il progresso.",
      image: setupTutorialModelDownloadsArt,
      body: (
        <div className="setup-model-downloads">
          <div className="setup-download-head">
            <span className="setup-download-icon">
              <GeneratedIcon name="vision" size={40} />
            </span>
            <div>
              <strong>Preparazione foto e video</strong>
              <span>{localVisionMessage || (localVisionBusy ? "Preparo i modelli vision in background." : "Parte da solo quando arriva il turno.")}</span>
            </div>
          </div>
          <div className="setup-total-progress">
            <span style={{ width: `${Math.max(0, Math.min(100, globalVisionProgress))}%` }} />
          </div>
          <div className="setup-model-list">
            {LOCAL_VISION_MODELS.map((model) => {
              const saved = modelStatuses.find((item) => item.model === model.id);
              const total = saved?.totalAssets ?? visualTotal;
              const complete = saved?.embeddedAssets ?? 0;
              const active = localVisionMessage.toLowerCase().includes(model.label.toLowerCase());
              const percent = total ? Math.round((complete / total) * 100) : active ? Math.max(12, globalVisionProgress) : modelProgress;
              return (
                <article className={active || percent >= 100 ? "setup-model-item active" : "setup-model-item"} key={model.id}>
                  <span className="model-mark">{friendlyVisionMark(model.id, model.label)}</span>
                  <div>
                    <strong>{friendlyVisionModelLabel(model.id, model.label)}</strong>
                    <small>{friendlyVisionModelPurpose(model.id, model.purpose)}</small>
                    <i><span style={{ width: `${Math.max(0, Math.min(100, percent))}%` }} /></i>
                  </div>
                  <em>{percent >= 100 ? "Pronto" : active || localVisionBusy ? `${percent}%` : "In attesa"}</em>
                </article>
              );
            })}
          </div>
        </div>
      ),
    },
    {
      title: "Vedi subito dove si trova.",
      text: "I risultati mostrano anteprime, pagina del PDF o minuto del video. Poi puoi aprire la cartella originale con un click.",
      image: setupTutorialPreviewArt,
      body: (
        <div className="setup-preview-capabilities">
          {setupMediaCards.slice(0, 4).map((card) => (
            <article key={card.label}>
              <img src={card.image} alt="" />
              <span>{card.label}</span>
            </article>
          ))}
          <div className="setup-folder-callout">
            <div>
              <strong>Apri nella cartella</strong>
              <span>Ogni risultato mantiene il percorso originale del file.</span>
            </div>
            <GeneratedTutorialAsset name="buttonOpenFolder" className="setup-folder-art" />
          </div>
        </div>
      ),
    },
    {
      title: "Prima sul PC. Online solo se lo scegli.",
      text: "La ricerca locale resta sempre accesa. Google e NVIDIA restano spenti finche non abiliti tu le cartelle online.",
      image: setupTutorialPrivacyArt,
      body: (
        <div className="setup-cloud-page">
          <div className="cloud-choice-grid">
            <button className={`cloud-choice ${geminiCloudEnabled ? "active" : ""}`} onClick={onToggleGeminiCloud}>
              <span className="provider-logo google-provider-logo" aria-hidden="true">
                <span>G</span>
              </span>
              <div>
                <strong>Google online</strong>
                <small>{geminiCloudEnabled ? "Attivo solo sulle cartelle scelte" : "Spento: nessun file va a Google"}</small>
              </div>
              <i>{geminiCloudEnabled ? "On" : "Off"}</i>
            </button>
            <button className={`cloud-choice ${nvidiaCloudEnabled ? "active" : ""}`} onClick={onToggleNvidiaCloud}>
              <span className="provider-logo nvidia-provider-logo" aria-hidden="true">
                <span>NVIDIA</span>
              </span>
              <div>
                <strong>NVIDIA online</strong>
                <small>{nvidiaCloudEnabled ? "Aiuta a ordinare i risultati migliori" : "Spento: ordine solo locale"}</small>
              </div>
              <i>{nvidiaCloudEnabled ? "On" : "Off"}</i>
            </button>
          </div>
          <div className="setup-mini-steps">
            <span className="done"><GeneratedIcon name="folder" size={16} /> Cartelle</span>
            <span className={indexedFiles ? "done" : ""}><GeneratedIcon name="database" size={16} /> File pronti</span>
            <span className={visualReady ? "done" : ""}><GeneratedIcon name="vision" size={16} /> Foto pronte</span>
            <span className={cloudReady ? "done" : ""}><GeneratedIcon name="cloud" size={16} /> Online scelto</span>
          </div>
          <button className="setup-wide-action" onClick={onOpenSettings}>
            <GeneratedIcon name="settings" size={18} />
            <span>Apri impostazioni</span>
          </button>
        </div>
      ),
    },
  ];
  const page = pages[pageIndex];
  const isLastPage = pageIndex === pages.length - 1;
  const goNext = () => setPageIndex((value) => Math.min(pages.length - 1, value + 1));
  const goBack = () => setPageIndex((value) => Math.max(0, value - 1));
  useEffect(() => {
    if (!panelRef.current) return;
    panelRef.current.scrollTop = 0;
    panelRef.current.scrollLeft = 0;
  }, [pageIndex]);

  return (
    <section ref={backdropRef} className="setup-backdrop" role="dialog" aria-modal="true" aria-label="Setup iniziale Trova">
      <LiquidGlass
        aberrationIntensity={2.4}
        blurAmount={0.14}
        borderRadius={24}
        className="setup-liquid-glass-shell"
        displacementScale={54}
        elasticity={0.22}
        mode="prominent"
        mouseContainer={backdropRef}
        overLight
        padding="0"
        saturation={185}
        style={{ left: "50%", position: "fixed", top: "50%", zIndex: 1 }}
      >
      <div ref={panelRef} className="setup-panel setup-wizard-panel">
        <div className="setup-wizard-top">
            <div className="setup-brand">
              <span className="google-mark" />
              <strong>Setup Trova</strong>
            </div>
          <div className="setup-page-count">
            <span>{pageIndex + 1}</span>
            <i>/ {pages.length}</i>
          </div>
        </div>

        <div className="setup-wizard-main">
          <div className="setup-wizard-copy">
            <h1>{page.title}</h1>
            <p>{page.text}</p>
            {pageIndex === 0 && (
              <div className="local-engine-line">
                <span>Stato app</span>
                <strong>{simpleStatus?.title ?? "Pronto a preparare"} · {simpleStatus?.message ?? "Tutto resta sul tuo PC, salvo scelta online."}</strong>
              </div>
            )}
            {!desktopBackendAvailable && pageIndex === 0 && (
              <div className="desktop-mode-warning">
                <GeneratedIcon name="database" size={16} />
                <span>Modalita browser: Trova legge davvero le cartelle tramite il servizio locale.</span>
              </div>
            )}
            {page.body}
          </div>

          <div className="setup-wizard-art">
            <img src={page.image} alt="" />
            <div className="setup-live-chip">
              {pageIndex === 0 && <><GeneratedIcon name="search" size={16} /><span>{indexedFiles ? `${indexedFiles.toLocaleString("it-IT")} file` : "Da preparare"}</span></>}
              {pageIndex === 1 && <><GeneratedIcon name="archive" size={16} /><span>{localVisionBusy ? `${globalVisionProgress}% pronto` : "Foto e video"}</span></>}
              {pageIndex === 2 && <><GeneratedIcon name="folder" size={16} /><span>Anteprime</span></>}
              {pageIndex === 3 && <><GeneratedIcon name="shield" size={16} /><span>{cloudLabel || "Locale prima"}</span></>}
            </div>
          </div>
        </div>

        <div className="setup-wizard-footer">
          <button className="setup-nav-button" onClick={goBack} disabled={pageIndex === 0} aria-label="Indietro">
            <ChevronLeft size={16} />
            <span>Indietro</span>
          </button>
          <div className="setup-dots" aria-label="Avanzamento tutorial">
            {pages.map((item, index) => (
              <button
                key={item.title}
                className={index === pageIndex ? "active" : ""}
                onClick={() => setPageIndex(index)}
                aria-label={`Vai alla pagina ${index + 1}`}
              />
            ))}
          </div>
          <button
            className={isLastPage ? "setup-nav-button primary-action" : "setup-nav-button primary-action"}
            onClick={isLastPage ? onClose : goNext}
            aria-label={isLastPage ? "Entra in Trova" : "Avanti"}
          >
            {isLastPage ? <Check size={16} /> : <ChevronRight size={16} />}
            <span>{isLastPage ? "Entra in Trova" : "Avanti"}</span>
          </button>
        </div>

        <p className="setup-provider-note">
          {setupRunning ? autoSetupJob?.message : `${geminiStatus} · ${nvidiaStatus}`}
        </p>
      </div>
      </LiquidGlass>
    </section>
  );
}

function EmptyState({
  hasIndex,
  compact,
  query,
  desktopBackendAvailable,
  onIndex,
  onSettings,
}: {
  hasIndex: boolean;
  compact: boolean;
  query: string;
  desktopBackendAvailable: boolean;
  onIndex: () => void;
  onSettings: () => void;
}) {
  const technicalFallback = !desktopBackendAvailable;
  const trimmedQuery = query.trim();
  const title = technicalFallback
    ? "Trova tutto, al volo"
    : hasIndex
      ? trimmedQuery
        ? "Qui non c'e ancora nulla"
        : "Trova tutto, al volo"
      : "Accendi Trova sui tuoi file";
  const description = technicalFallback
    ? "Scrivi una parola o carica una foto: documenti, immagini e dettagli saltano fuori subito."
      : hasIndex
        ? trimmedQuery
        ? `Non ho trovato corrispondenze per "${trimmedQuery}" nelle cartelle pronte.`
        : "Scrivi qualcosa nella barra di ricerca o carica una foto per iniziare."
      : "Avvia la ricerca sulle cartelle scelte nel setup e lascia che Trova metta ordine nel tuo PC.";

  return (
    <LiquidGlassSurface variant="card" className={compact ? "compact" : ""}>
      <section className={`empty-state ${compact ? "compact" : ""}`}>
        <img className="home-discovery-art" src={homeDiscoveryCardArt} alt="" aria-hidden="true" />
        <h2>{title}</h2>
        <p>{description}</p>
        {!compact && (
          <div>
            <button onClick={onIndex}>
              <GeneratedIcon name="database" size={16} />
              <span>Prepara</span>
            </button>
            <button onClick={onSettings}>
              <GeneratedIcon name="settings" size={16} />
              <span>Impostazioni</span>
            </button>
          </div>
        )}
      </section>
    </LiquidGlassSurface>
  );
}

function HomeCommandCenter({
  status,
  localVisionStatus,
  localVisionMessage,
  localVisionBusy,
  geminiStatus,
  nvidiaStatus,
  recentFiles,
  nvidiaEnabled,
  onPrepareFiles,
  onPrepareVision,
  onSettings,
  autoSetupJob,
}: {
  status: IndexStatus | null;
  localVisionStatus: LocalVisionStatus | null;
  localVisionMessage: string;
  localVisionBusy: boolean;
  geminiStatus: string;
  nvidiaStatus: string;
  recentFiles: IndexedFile[];
  nvidiaEnabled: boolean;
  onPrepareFiles: () => void | Promise<void>;
  onPrepareVision: () => void | Promise<void>;
  onSettings: () => void;
  autoSetupJob: AutoSetupJob | null;
}) {
  const discovered = status?.filesDiscovered ?? 0;
  const indexed = status?.filesIndexed ?? 0;
  const progress = Math.max(0, Math.min(100, Math.round(status?.progress ?? (indexed ? 100 : 0))));
  const visionReady = localVisionStatus?.embeddedAssets ?? 0;
  const visionTotal = localVisionStatus?.totalAssets ?? 0;
  const isProviderEnabled = (message: string) => {
    const normalized = message.toLowerCase();
    return !normalized.includes("spento") && !normalized.includes("non configurato") && !normalized.includes("non configurata");
  };
  const onlineConfigured = isProviderEnabled(geminiStatus) || isProviderEnabled(nvidiaStatus);
  const fileDetail = discovered || indexed
    ? `${indexed.toLocaleString("it-IT")} / ${Math.max(discovered, indexed).toLocaleString("it-IT")}`
    : "0 / 0";
  const fileStatus = status?.running ? status.phase || "Preparo" : indexed ? "File pronti" : "File da preparare";
  const visionStatus = localVisionBusy
    ? "Preparazione in corso"
    : visionReady
      ? `${visionReady.toLocaleString("it-IT")} / ${Math.max(visionTotal, visionReady).toLocaleString("it-IT")} elementi completi`
      : "Foto e video pronti da preparare";

  const autoSetupRunning = autoSetupJob?.status === "running";
  const autoSetupDone = autoSetupJob?.status === "done";
  const autoSetupFailed = autoSetupJob?.status === "failed";
  const autoSetupProgress = Math.max(0, Math.min(100, autoSetupJob?.progress ?? 0));
  const autoSetupTitle = autoSetupJob?.title || "Sto preparando Trova";
  const autoSetupMessage = autoSetupJob?.message || "Scarico modelli e creo l'indice in background.";

  return (
    <section className="home-command-center" aria-label="Stato ricerca Trova">
      {(autoSetupRunning || autoSetupFailed) && (
        <article className={`home-autosetup-banner ${autoSetupFailed ? "failed" : "running"}`} role="status" aria-live="polite">
          <div className="home-autosetup-icon">
            <GeneratedIcon name={autoSetupFailed ? "shield" : "database"} size={36} />
          </div>
          <div className="home-autosetup-copy">
            <strong>{autoSetupFailed ? "Qualcosa non va" : autoSetupTitle}</strong>
            <span>{autoSetupMessage}</span>
          </div>
          <div className="home-autosetup-percent" aria-hidden="true">{autoSetupProgress}%</div>
          <div className="home-autosetup-bar" aria-label="Avanzamento preparazione" aria-valuemin={0} aria-valuemax={100} aria-valuenow={autoSetupProgress} role="progressbar">
            <span style={{ width: `${autoSetupProgress}%` }} />
          </div>
        </article>
      )}
      {autoSetupDone && (
        <article className="home-autosetup-banner done" role="status">
          <div className="home-autosetup-icon">
            <Check size={32} strokeWidth={2.5} />
          </div>
          <div className="home-autosetup-copy">
            <strong>Tutto pronto</strong>
            <span>Trova ha preparato i tuoi file. Inizia a cercare.</span>
          </div>
        </article>
      )}
      <article className="home-search-status-card">
        <div className="home-status-icon document">
          <GeneratedIcon name="database" size={48} />
        </div>
        <div className="home-status-copy">
          <strong>Ricerca nei file</strong>
          <span>{fileStatus}</span>
        </div>
        <span className="home-status-percent">{progress}%</span>
        <div className="home-status-progress" aria-label="Avanzamento ricerca nei file">
          <span style={{ width: `${progress}%` }} />
        </div>
        <div className="home-status-meta">
          <span><i /> Documenti base</span>
          <span>{fileDetail}</span>
        </div>
      </article>

      {recentFiles.length > 0 && <HomeRecentCarousel items={recentFiles} nvidiaEnabled={nvidiaEnabled} />}

      {status?.running && (
        <button className="home-command-primary" onClick={onPrepareFiles} disabled>
          <GeneratedIcon name="database" size={22} />
          <span>Sto preparando...</span>
        </button>
      )}
    </section>
  );
}

function HomeRecentCarousel({ items, nvidiaEnabled }: { items: IndexedFile[]; nvidiaEnabled: boolean }) {
  return (
    <section className="home-recent-panel" aria-label="Cronologia file aperti">
      <div className="home-recent-head">
        <strong>Cronologia</strong>
        <span>File aperti da Trova</span>
      </div>
      <div className="home-recent-carousel">
        {items.map((item) => (
          <HomeRecentCard key={`${item.id}-${item.path}`} item={item} nvidiaEnabled={nvidiaEnabled} />
        ))}
      </div>
    </section>
  );
}

function HomeRecentCard({ item, nvidiaEnabled }: { item: IndexedFile; nvidiaEnabled: boolean }) {
  const [previewSrc, setPreviewSrc] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const icon = iconFor(item);

  useEffect(() => {
    let cancelled = false;
    setPreviewSrc("");
    if (!item.visual_preview) return;
    void tauriInvoke<string>("read_image_data_url", { path: item.visual_preview })
      .then((dataUrl) => {
        if (!cancelled) setPreviewSrc(dataUrl);
      })
      .catch(() => {
        if (!cancelled) setPreviewSrc("");
      });
    return () => {
      cancelled = true;
    };
  }, [item.visual_preview]);

  return (
    <>
      <button type="button" className="home-recent-card" onClick={() => setPreviewOpen(true)}>
        <span className={`home-recent-thumb ${item.kind}`}>
          {previewSrc ? <img src={previewSrc} alt="" /> : <GeneratedIcon name={icon} size={38} />}
        </span>
        <span className="home-recent-name">{item.name}</span>
        <small>{displayPathName(item.path)}</small>
      </button>
      {previewOpen && <FilePreviewModal item={item} nvidiaEnabled={nvidiaEnabled} onClose={() => setPreviewOpen(false)} />}
    </>
  );
}

function LiquidGlassSurface({
  variant,
  className = "",
  children,
}: {
  variant: "search" | "card";
  className?: string;
  children: React.ReactNode;
}) {
  const isSearch = variant === "search";

  return (
    <div className={`liquid-glass-host liquid-glass-${variant} ${className}`.trim()} data-liquid-glass-surface={variant}>
      <LiquidGlass
        className="liquid-glass-core"
        mode="standard"
        displacementScale={isSearch ? 64 : 54}
        blurAmount={isSearch ? 0.1 : 0.085}
        saturation={130}
        aberrationIntensity={2}
        elasticity={isSearch ? 0.35 : 0.24}
        cornerRadius={isSearch ? 999 : 22}
        padding="0"
      >
        <div className="liquid-glass-content">{children}</div>
      </LiquidGlass>
    </div>
  );
}

function SystemHealthStrip({
  status,
  localVisionStatus,
  semanticStatus,
  connectors,
  rcloneStatus,
  localVisionBusy,
  isScanning,
}: {
  status: IndexStatus | null;
  localVisionStatus: LocalVisionStatus | null;
  semanticStatus: SemanticStatus | null;
  connectors: ConnectorConfig[];
  rcloneStatus: RcloneStatus | null;
  localVisionBusy: boolean;
  isScanning: boolean;
}) {
  const activeConnectors = connectors.filter((connector) => connector.enabled).length;
  const syncedConnectors = connectors.filter((connector) => connector.lastSyncAt && !connector.lastSyncError).length;
  const errorConnectors = connectors.filter((connector) => connector.lastSyncError).length;
  const visualAssets = localVisionStatus?.totalAssets ?? 0;
  const visualReady = localVisionStatus?.embeddedAssets ?? 0;
  const semanticChunks = semanticStatus?.embeddedChunks ?? status?.semanticChunks ?? 0;

  return (
    <section className="system-health-strip" aria-label="Stato locale Trova">
      <StatusTile
        tone="blue"
        icon="database"
        label="Indice"
        value={(status?.filesIndexed ?? 0).toLocaleString("it-IT")}
        detail={`${(status?.filesSkipped ?? 0).toLocaleString("it-IT")} saltati`}
        active={isScanning}
      />
      <StatusTile
        tone={status?.watcherActive ? "green" : "gray"}
        icon="watcher"
        label="Watcher"
        value={status?.watcherBusy ? "sync" : status?.watcherActive ? `${status.watcherQueued ?? 0}` : "off"}
        detail={status?.lastWatcherEvent?.event ? `${status.lastWatcherEvent.event}` : "coda eventi"}
        active={Boolean(status?.watcherBusy)}
      />
      <StatusTile
        tone={semanticChunks ? "yellow" : "gray"}
        icon="semantic"
        label="Semantica"
        value={semanticChunks.toLocaleString("it-IT")}
        detail={shortModelName(semanticStatus?.model ?? status?.semanticModel ?? "")}
      />
      <StatusTile
        tone={visualReady ? "green" : "gray"}
        icon="vision"
        label="Vision"
        value={`${visualReady.toLocaleString("it-IT")}/${visualAssets.toLocaleString("it-IT")}`}
        detail={localVisionBusy ? "preparo" : "asset"}
        active={localVisionBusy}
      />
      <StatusTile
        tone={errorConnectors ? "red" : activeConnectors ? "blue" : "gray"}
        icon="remote"
        label="Remote"
        value={`${syncedConnectors}/${activeConnectors}`}
        detail={rcloneStatus?.installed ? "rclone" : "cache local"}
      />
    </section>
  );
}

function StatusTile({
  icon,
  label,
  value,
  detail,
  tone,
  active,
}: {
  icon: GeneratedIconName;
  label: string;
  value: string;
  detail: string;
  tone: "blue" | "green" | "yellow" | "red" | "gray";
  active?: boolean;
}) {
  return (
    <article className={`status-tile tone-${tone} ${active ? "active" : ""}`}>
      <GeneratedIcon name={icon} size={32} />
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{detail}</small>
      </div>
    </article>
  );
}

function LocalVisionCard({
  status,
  message,
  progress,
  busy,
  onIndex,
}: {
  status: LocalVisionStatus | null;
  message: string;
  progress: number;
  busy: boolean;
  onIndex: () => void;
}) {
  const total = status?.totalAssets ?? 0;
  const embedded = status?.embeddedAssets ?? 0;
  const value = total ? Math.round((embedded / total) * 100) : progress;
  const modelStatuses = status?.models ?? [];

  return (
    <section className="local-vision-card">
      <div className="ai-stack-title">
        <GeneratedIcon name="vision" size={24} />
        <span>Foto e video</span>
      </div>
      <button onClick={onIndex} disabled={busy}>
        <GeneratedIcon name="vision" size={18} />
        <span>{busy ? "Preparo..." : "Prepara"}</span>
      </button>
      <div className="local-vision-meter">
        <span style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
      </div>
      <p>{message}</p>
      <small>
        {embedded.toLocaleString("it-IT")} / {total.toLocaleString("it-IT")} elementi completi ·{" "}
        {status?.model ? "ricerca immagini" : "in attesa"}
      </small>
      {modelStatuses.length > 0 && (
        <div className="local-vision-models">
          {modelStatuses.map((model) => (
            <span key={model.model}>
              {model.label} {model.embeddedAssets.toLocaleString("it-IT")}/
              {model.totalAssets.toLocaleString("it-IT")}
            </span>
          ))}
        </div>
      )}
    </section>
  );
}

function IndexCard({
  status,
  isScanning,
  onIndex,
}: {
  status: IndexStatus | null;
  isScanning: boolean;
  onIndex: () => void;
}) {
  const progress = isScanning ? 78 : status?.progress ?? 0;
  return (
    <section className="index-section">
      <div className="section-label">RICERCA</div>
      <button className="index-card" onClick={onIndex} aria-label="Aggiorna ricerca">
        <div className="index-top">
          <strong>{isScanning ? "Preparazione in corso" : "Ricerca nei file"}</strong>
          <span className="progress-ring">{progress}%</span>
        </div>
        <div className="index-meta">
          <span>File pronti</span>
          <span>
            {(status?.filesIndexed ?? 0).toLocaleString("it-IT")} /{" "}
            {(status?.filesDiscovered ?? 0).toLocaleString("it-IT")}
          </span>
        </div>
        <div className="progress-line">
          <span style={{ width: `${progress}%` }} />
        </div>
        <div className="details-link">
          <span>
            Documenti {status?.tikaAvailable ? "pronti" : "base"} · Aggiornamenti{" "}
            {status?.watcherActive ? "attivi" : "spenti"}
          </span>
          <ChevronRight size={17} />
        </div>
      </button>
    </section>
  );
}

function Locations({
  paths,
  onToggleCloud,
}: {
  paths: WatchPath[];
  onToggleCloud: (path: WatchPath) => void;
}) {
  return (
    <section className="locations">
      <div className="section-label with-plus">
        <span>POSIZIONI INDICIZZATE</span>
        <span>+</span>
      </div>
      {paths.slice(0, 7).map((path) => {
        const icon = iconForPath(path.path);
        return (
          <button key={path.id} onClick={() => onToggleCloud(path)}>
            <GeneratedIcon name={icon} size={22} />
            <span>
              <strong>{displayPathName(path.path)}</strong>
              <small>{path.path}</small>
            </span>
            <GeneratedIcon name={path.geminiEnabled ? "cloud" : "shield"} size={18} />
          </button>
        );
      })}
    </section>
  );
}

function SettingsPanel({
  paths,
  status,
  geminiStatus,
  nvidiaStatus,
  nvidiaCloudEnabled,
  localVisionMessage,
  localVisionStatus,
  localVisionBusy,
  semanticStatus,
  localComponents,
  componentsStatus,
  isCheckingComponents,
  isScanning,
  installingComponentId,
  componentInstallStatus,
  doctorStatus,
  modelStatus,
  simpleStatus,
  autoSetupJob,
  remoteAccessStatus,
  remoteAccessBusy,
  connectors,
  rcloneStatus,
  remoteStatusMessage,
  remoteBusyId,
  onSave,
  onAdd,
  onSaveConnectors,
  onAddConnector,
  onTestConnector,
  onSyncConnector,
  onSyncAllConnectors,
  onToggleNvidiaCloud,
  onIndex,
  onAutoSetup,
  onRepair,
  onWatcher,
  onRefreshComponents,
  onRefreshDoctor,
  onExportDoctor,
  onRemoteAccess,
  onInstallComponent,
  onClear,
  aiProviderStatus,
  aiProviderConfig,
  onSaveAiProvider,
  hotkeyConfig,
  capturingHotkey,
  onStartCaptureHotkey,
  onCaptureHotkeyKeydown,
  onSaveHotkey,
  ollamaInstall,
  onInstallOllamaGemma,
  onReloadAiStatus,
}: {
  paths: WatchPath[];
  status: IndexStatus | null;
  geminiStatus: string;
  nvidiaStatus: string;
  nvidiaCloudEnabled: boolean;
  localVisionMessage: string;
  localVisionStatus: LocalVisionStatus | null;
  localVisionBusy: boolean;
  semanticStatus: SemanticStatus | null;
  localComponents: LocalComponent[];
  componentsStatus: string;
  isCheckingComponents: boolean;
  isScanning: boolean;
  installingComponentId: string;
  componentInstallStatus: string;
  doctorStatus: DoctorStatus | null;
  modelStatus: ModelStatus | null;
  simpleStatus: SimpleAppStatus | null;
  autoSetupJob: AutoSetupJob | null;
  remoteAccessStatus: RemoteAccessStatus | null;
  remoteAccessBusy: boolean;
  connectors: ConnectorConfig[];
  rcloneStatus: RcloneStatus | null;
  remoteStatusMessage: string;
  remoteBusyId: string;
  onSave: (paths: WatchPath[]) => void | Promise<void>;
  onAdd: () => void;
  onSaveConnectors: (connectors: ConnectorConfig[]) => void | Promise<void>;
  onAddConnector: (provider: string) => void;
  onTestConnector: (connector: ConnectorConfig) => void;
  onSyncConnector: (connector: ConnectorConfig) => void;
  onSyncAllConnectors: () => void;
  onToggleNvidiaCloud: () => void;
  onIndex: () => void;
  onAutoSetup: () => void;
  onRepair: () => void;
  onWatcher: (active: boolean) => void;
  onRefreshComponents: () => void;
  onRefreshDoctor: () => void;
  onExportDoctor: () => void;
  onRemoteAccess: (active: boolean) => void;
  onInstallComponent: (componentId: string) => void;
  onClear: () => void;
  aiProviderStatus: { providers: Array<{ id: string; label: string; configured: boolean; models?: Array<{ key: string; label: string; category?: string }>; hint?: string }>; activeProvider: string; activeModel: string } | null;
  aiProviderConfig: { provider: string; modelKey: string; agentEnabled: boolean };
  onSaveAiProvider: (config: { provider: string; modelKey: string; agentEnabled: boolean }) => void;
  hotkeyConfig: { shortcut: string; mode: string; enabled: boolean };
  capturingHotkey: boolean;
  onStartCaptureHotkey: () => void;
  onCaptureHotkeyKeydown: (event: React.KeyboardEvent) => void;
  onSaveHotkey: (config: { shortcut: string; mode: string; enabled: boolean }) => void;
  ollamaInstall: { label: string; progress: number; detail?: string; running: boolean } | null;
  onInstallOllamaGemma: () => void;
  onReloadAiStatus?: () => void;
}) {
  const enabledPaths = paths.filter((path) => path.enabled && !path.isExcluded);
  const excludedPaths = paths.filter((path) => path.isExcluded);
  const cloudPaths = enabledPaths.filter((path) => path.geminiEnabled);
  const [activeTab, setActiveTab] = useState<"overview" | "folders" | "components" | "doctor" | "vision" | "remote" | "access" | "cloud" | "advanced">("overview");
  const settingsTabs: Array<{
    id: "overview" | "folders" | "components" | "doctor" | "vision" | "remote" | "access" | "cloud" | "advanced";
    label: string;
    icon: GeneratedIconName;
  }> = [
    { id: "overview", label: "Stato", icon: "database" },
    { id: "folders", label: "Cartelle", icon: "folder" },
    { id: "components", label: "Preparazione", icon: "tools" },
    { id: "doctor", label: "Stato app", icon: "shield" },
    { id: "vision", label: "Foto e video", icon: "vision" },
    { id: "remote", label: "Archivi esterni", icon: "remote" },
    { id: "access", label: "Altri dispositivi", icon: "code" },
    { id: "cloud", label: "Online", icon: "cloud" },
    { id: "advanced", label: "Dettagli tecnici", icon: "settings" },
  ];
  const activeTabCopy = {
    overview: ["Tutto sotto controllo", "Trova prepara il PC e tiene la ricerca aggiornata.", settingsOverviewArt],
    folders: ["Cartelle scelte", "Decidi una volta dove cercare e cosa escludere.", settingsFoldersArt],
    components: ["Prepara tutto", "Installa, scarica e sistema quello che serve in background.", settingsComponentsArt],
    doctor: ["Stato app", "Messaggi chiari: pronto, preparo, serve conferma o riprova.", settingsComponentsArt],
    vision: ["Foto e video", "Trova immagini simili, scene nei video e testo nelle scansioni.", settingsVisionArt],
    remote: ["Archivi esterni", "Aggiungi dischi, cartelle condivise o cloud solo quando vuoi.", settingsRemoteArt],
    access: ["Usa da altri dispositivi", "Attiva solo se vuoi cercare da un altro browser.", settingsRemoteArt],
    cloud: ["Online", "Google e NVIDIA restano spenti finche non li scegli.", settingsCloudArt],
    advanced: ["Dettagli tecnici", "Log, strumenti, ricerca e manutenzione per chi vuole vedere sotto.", settingsAdvancedArt],
  }[activeTab];
  const modelStatuses = localVisionStatus?.models ?? [];
  const installedRequired = localComponents.filter((item) => item.required && item.installed).length;
  const totalRequired = localComponents.filter((item) => item.required).length;
  const missingComponents = localComponents.filter((item) => !item.installed);

  return (
    <section className="settings-panel settings-console">
      <div className="settings-head">
        <div>
          <span className="settings-eyebrow">Trova semplice</span>
          <h2>Impostazioni</h2>
          <p>Scegli dove cercare. Trova prepara il resto da solo e ti avvisa solo quando serve una conferma.</p>
        </div>
      </div>

      <nav className="settings-tabs" aria-label="Sezioni impostazioni">
        {settingsTabs.map((tab) => {
          return (
            <button key={tab.id} className={activeTab === tab.id ? "active" : ""} onClick={() => setActiveTab(tab.id)}>
              <GeneratedIcon name={tab.icon} size={20} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </nav>

      {activeTab !== "overview" && (
        <section className={`settings-tab-stage settings-tab-${activeTab}`}>
          <div className="settings-tab-copy">
            <span>{activeTabCopy[0]}</span>
            <strong>{activeTabCopy[1]}</strong>
          </div>
          <img className="settings-tab-art" src={activeTabCopy[2]} alt="" />
        </section>
      )}

      {activeTab === "overview" && (
        <SettingsOverviewMockup
          status={status}
          simpleStatus={simpleStatus}
          autoSetupJob={autoSetupJob}
          localVisionStatus={localVisionStatus}
          semanticStatus={semanticStatus}
          localComponents={localComponents}
          connectors={connectors}
          enabledPaths={enabledPaths}
          cloudPaths={cloudPaths}
          geminiStatus={geminiStatus}
          nvidiaStatus={nvidiaStatus}
          nvidiaCloudEnabled={nvidiaCloudEnabled}
          onToggleNvidiaCloud={onToggleNvidiaCloud}
          onIndex={onIndex}
          onAutoSetup={onAutoSetup}
          onRepair={onRepair}
        />
      )}

      {activeTab === "components" && (
        <div className="settings-tab-panel">
          <div className="settings-components-summary">
            <section className="settings-privacy-panel color-blue">
              <div className="settings-section-title">
                <GeneratedIcon name="tools" size={34} />
                <div>
                  <strong>Preparazione automatica</strong>
                  <span>{installedRequired}/{totalRequired || 0} parti pronte</span>
                </div>
              </div>
              <p className="settings-help-text">{componentsStatus}</p>
              {componentInstallStatus && <p className="settings-install-status">{componentInstallStatus}</p>}
              <div className="settings-component-actions">
                <button onClick={onAutoSetup} disabled={autoSetupJob?.status === "running"}>
                  <GeneratedIcon name="sparkle" size={18} />
                  <span>{autoSetupJob?.status === "running" ? "Sto preparando..." : "Prepara tutto"}</span>
                </button>
                <button onClick={onRefreshComponents} disabled={isCheckingComponents}>
                  <GeneratedIcon name="sync" size={18} />
                  <span>{isCheckingComponents ? "Controllo..." : "Ricontrolla"}</span>
                </button>
              </div>
            </section>
            <section className={`settings-privacy-panel ${missingComponents.length ? "color-red" : "color-green"}`}>
              <div className="settings-section-title">
                <GeneratedIcon name="shield" size={34} />
                <div>
                  <strong>{missingComponents.length ? "Da completare" : "Tutto pronto"}</strong>
                  <span>{missingComponents.length ? `${missingComponents.length} cose da sistemare` : "Le parti principali sono disponibili"}</span>
                </div>
              </div>
              <div className="settings-preset-list">
                {(missingComponents.length ? missingComponents : localComponents.slice(0, 3)).map((component) => (
                  <span key={component.id}>{friendlyComponentLabel(component.id, component.label)}: {component.installed ? "pronto" : "da preparare"}</span>
                ))}
              </div>
            </section>
          </div>

          <div className="settings-components-grid">
            {localComponents.map((component) => (
              <article className={`settings-component-card ${component.installed ? "installed" : "missing"}`} key={component.id}>
                <div className="component-card-head">
                  <span>{friendlyComponentCategory(component.category)}</span>
                  <i>{component.required ? "Necessario" : "Facoltativo"}</i>
                </div>
                <div className="component-title-row">
                  <strong>{friendlyComponentLabel(component.id, component.label)}</strong>
                  <em>{component.installed ? "Pronto" : "Da preparare"}</em>
                </div>
                <p>{friendlyComponentDescription(component.id, component.description)}</p>
                <small>{component.installed ? "Funziona" : "Trova prova a sistemarlo da solo."}</small>
                <details className="technical-details-inline">
                  <summary>Dettagli tecnici</summary>
                  <span>{component.label} · {component.version}</span>
                  <span>{component.installHint}</span>
                </details>
                <button
                  onClick={() => {
                    if (!component.installed && component.installable === false) return;
                    if (component.id.startsWith("vision")) onIndex();
                    else onInstallComponent(component.id);
                  }}
                  disabled={isCheckingComponents || installingComponentId === component.id || (!component.installed && component.installable === false)}
                >
                  {installingComponentId === component.id ? "Preparo..." : component.installed ? "Controlla" : component.installable === false ? "Apri dettagli" : "Sistema"}
                </button>
              </article>
            ))}
          </div>
        </div>
      )}

      {activeTab === "doctor" && (
        <div className="settings-tab-panel">
          <div className="settings-components-summary">
            <section className={`settings-privacy-panel ${simpleStatus?.status === "ready" ? "color-green" : simpleStatus?.status === "preparing" ? "color-blue" : "color-red"}`}>
              <div className="settings-section-title">
                <GeneratedIcon name="shield" size={34} />
                <div>
                  <strong>{simpleStatus?.title ?? "Stato app"}</strong>
                  <span>{simpleStatus?.message ?? "Premi Ricontrolla per leggere lo stato."}</span>
                </div>
              </div>
              <p className="settings-help-text">
                Ti mostro parole semplici. I nomi tecnici restano nei dettagli, senza chiavi o password.
              </p>
              <div className="settings-component-actions">
                <button onClick={onRepair} disabled={autoSetupJob?.status === "running"}>
                  <GeneratedIcon name="sparkle" size={18} />
                  <span>{autoSetupJob?.status === "running" ? "Sto sistemando..." : "Sistema"}</span>
                </button>
                <button onClick={onRefreshDoctor}>
                  <GeneratedIcon name="sync" size={18} />
                  <span>Ricontrolla</span>
                </button>
                <button onClick={onExportDoctor}>
                  <GeneratedIcon name="archive" size={18} />
                  <span>Esporta log</span>
                </button>
              </div>
              {componentInstallStatus && <p className="settings-install-status">{componentInstallStatus}</p>}
              {simpleStatus?.issues?.length ? (
                <div className="simple-issue-list">
                  {simpleStatus.issues.map((issue) => (
                    <article key={issue.id ?? issue.title}>
                      <strong>{issue.title}</strong>
                      <span>{issue.message}</span>
                      <button onClick={issue.action === "install" ? onRepair : onRefreshDoctor}>{issue.actionLabel}</button>
                    </article>
                  ))}
                </div>
              ) : null}
            </section>
            <section className="settings-privacy-panel color-blue">
              <div className="settings-section-title">
                <GeneratedIcon name="semantic" size={34} />
                <div>
                  <strong>Pronto per capire i file</strong>
                  <span>{modelStatus ? `${modelStatus.text.embeddedChunks} pezzi letti · ${modelStatus.face.embeddedAssets}/${modelStatus.face.totalAssets} volti locali` : "In attesa"}</span>
                </div>
              </div>
              <div className="provider-status detailed">
                <span><strong>Domande</strong>{semanticStatus?.ready ? "pronte" : "da preparare"}</span>
                <span><strong>Persona</strong>{modelStatus?.face.optInUse ?? "Solo quando la scegli"}</span>
                <span><strong>Spazio locale</strong>{modelStatus ? `${modelStatus.cache.files} file · ${Math.round(modelStatus.cache.bytes / 1024)} KB` : "n/d"}</span>
              </div>
            </section>
          </div>

          <details className="technical-details-block">
            <summary>Dettagli tecnici</summary>
            <div className="doctor-check-grid">
            {(doctorStatus?.checks ?? []).map((check) => (
              <article className={`doctor-check ${check.state}`} key={check.id}>
                <div>
                  <span>{check.category}</span>
                  <strong>{check.label}</strong>
                </div>
                <em>{check.state === "ready" ? "Pronto" : check.state === "manual" ? "Manuale" : "Manca"}</em>
                <p>{check.detail}</p>
                <small>{check.hint}</small>
              </article>
            ))}
            {!doctorStatus?.checks?.length && (
              <section className="remote-empty">
                <GeneratedIcon name="shield" size={30} />
                <strong>Dettagli non caricati</strong>
                <span>Premi Ricontrolla per leggere lo stato reale del PC.</span>
              </section>
            )}
            </div>
          </details>
        </div>
      )}

      {activeTab === "remote" && (
        <div className="settings-tab-panel">
          <div className="settings-components-summary">
            <section className="settings-privacy-panel color-blue">
              <div className="settings-section-title">
                <GeneratedIcon name="remote" size={34} />
                <div>
                  <strong>Archivi esterni</strong>
                  <span>{rcloneStatus?.installed ? "Pronti da collegare" : "Da preparare"}</span>
                </div>
              </div>
              <p className="settings-help-text">{remoteStatusMessage}</p>
              <details className="technical-details-inline">
                <summary>Dettagli tecnici</summary>
                <span><strong>Programma</strong>{rcloneStatus?.command || "non trovato"}</span>
                <span><strong>Cache</strong>{rcloneStatus?.cacheRoot || ".trova/remotes"}</span>
                <span><strong>Collegamenti</strong>{rcloneStatus?.remotes?.join(", ") || "nessuno configurato"}</span>
              </details>
              <div className="settings-component-actions">
                <button onClick={onSyncAllConnectors} disabled={remoteBusyId === "all"}>
                  <GeneratedIcon name="sync" size={18} />
                  <span>{remoteBusyId === "all" ? "Aggiorno..." : "Aggiorna archivi"}</span>
                </button>
                <button onClick={onIndex}>
                  <GeneratedIcon name="database" size={18} />
                  <span>Prepara ricerca</span>
                </button>
              </div>
            </section>
            <section className="settings-privacy-panel color-green">
              <div className="settings-section-title">
                <GeneratedIcon name="cloud" size={34} />
                <div>
                  <strong>Provider supportati</strong>
                  <span>Dischi di rete e cloud vengono copiati prima sul PC</span>
                </div>
              </div>
              <div className="remote-provider-grid">
                {(rcloneStatus?.providers ?? defaultRemoteProviders).map((provider) => (
                  <button key={provider.id} onClick={() => onAddConnector(provider.id)}>
                    <span>{provider.label}</span>
                    <small>{provider.type}</small>
                  </button>
                ))}
              </div>
            </section>
          </div>

          <div className="watch-list-head">
            <div>
              <h3>Archivi collegati</h3>
              <p>Ogni archivio viene copiato in una cartella locale e poi cercato come gli altri file.</p>
            </div>
            <span>{connectors.length.toLocaleString("it-IT")} archivi</span>
          </div>

          <div className="remote-list">
            {connectors.length === 0 && (
              <section className="remote-empty">
                <GeneratedIcon name="remote" size={30} />
                <strong>Nessun archivio collegato</strong>
                <span>Aggiungi una cartella condivisa, un disco di rete o un cloud quando ti serve.</span>
              </section>
            )}
            {connectors.map((connector) => (
              <article className={`remote-row ${connector.lastSyncError ? "error" : ""}`} key={connector.id}>
                <div className="watch-main">
                  <div className="watch-icon"><GeneratedIcon name="remote" size={25} /></div>
                  <div>
                    <strong>{connector.name}</strong>
                    <span>{connector.provider === "local" ? connector.remotePath : `${connector.remoteName || "remote"}:${connector.remotePath || ""}`}</span>
                    <div className="watch-chips">
                      <i>{connector.enabled ? "Attivo" : "Spento"}</i>
                      <i>{connector.autoSync ? "Si aggiorna da solo" : "Manuale"}</i>
                      <i>{connector.readOnly ? "Solo lettura" : "Scrittura permessa"}</i>
                      <i>{connector.geminiEnabled ? "Online scelto" : "Solo PC"}</i>
                      <i>{connector.lastSyncError || connector.lastSyncStatus || "Mai aggiornato"}</i>
                    </div>
                  </div>
                </div>

                <div className="remote-controls">
                  <label>
                    <input
                      type="checkbox"
                      checked={connector.enabled}
                      onChange={() => onSaveConnectors(toggleConnector(connectors, connector, "enabled"))}
                    />
                    Attivo
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={connector.autoSync}
                      onChange={() => onSaveConnectors(toggleConnector(connectors, connector, "autoSync"))}
                    />
                    Aggiorna da solo
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={connector.geminiEnabled}
                      onChange={() => onSaveConnectors(toggleConnector(connectors, connector, "geminiEnabled"))}
                    />
                    Online
                  </label>
                  <button onClick={() => onTestConnector(connector)} disabled={remoteBusyId === connector.id}>
                    Prova
                  </button>
                  <button onClick={() => onSyncConnector(connector)} disabled={remoteBusyId === connector.id}>
                    {remoteBusyId === connector.id ? "Aggiorno..." : "Aggiorna"}
                  </button>
                </div>

                <div className="watch-filter-row">
                  <select
                    value={connector.fileTypeFilter?.mode ?? "include"}
                    onChange={(event) => onSaveConnectors(updateConnector(connectors, connector, {
                      fileTypeFilter: {
                        mode: event.currentTarget.value as FileTypeFilter["mode"],
                        extensions: connector.fileTypeFilter?.extensions ?? [],
                      },
                    }))}
                    aria-label={`Filtro remote ${connector.name}`}
                  >
                    <option value="include">Includi solo</option>
                    <option value="exclude">Escludi</option>
                  </select>
                  <input
                    value={connector.fileTypeFilter?.extensions?.join(", ") ?? ""}
                    onChange={(event) => onSaveConnectors(updateConnector(connectors, connector, {
                      fileTypeFilter: {
                        mode: connector.fileTypeFilter?.mode ?? "include",
                        extensions: parseExtensions(event.currentTarget.value),
                      },
                    }))}
                    placeholder=".pdf, .docx, .png"
                    aria-label={`Estensioni remote ${connector.name}`}
                  />
                  <button onClick={() => onSaveConnectors(updateConnector(connectors, connector, {
                    fileTypeFilter: { mode: "include", extensions: [".pdf", ".docx", ".pptx", ".xlsx", ".txt", ".md"] },
                  }))}>
                    Documenti
                  </button>
                  <button onClick={() => onSaveConnectors(updateConnector(connectors, connector, {
                    fileTypeFilter: { mode: "include", extensions: [".png", ".jpg", ".jpeg", ".webp", ".mp4", ".mov", ".mp3", ".wav"] },
                  }))}>
                    Media
                  </button>
                  <button onClick={() => onSaveConnectors(updateConnector(connectors, connector, { fileTypeFilter: undefined }))}>
                    Tutto
                  </button>
                </div>
              </article>
            ))}
          </div>
        </div>
      )}

      {activeTab === "access" && (
        <div className="settings-tab-panel settings-cloud-split">
          <section className={`settings-privacy-panel ${remoteAccessStatus?.running ? "color-green" : "color-blue"}`}>
            <div className="settings-section-title">
                <GeneratedIcon name="remote" size={34} />
                <div>
                <strong>Usa da altri dispositivi</strong>
                <span>{remoteAccessStatus?.running ? "Attivo con codice di accesso" : "Spento di default"}</span>
              </div>
            </div>
            <p className="settings-help-text">
              Attivalo solo quando vuoi cercare da un altro browser. Senza codice di accesso non risponde.
            </p>
            <div className="provider-status detailed">
              <span><strong>URL</strong>{remoteAccessStatus?.url ?? "http://127.0.0.1:18754"}</span>
              <span><strong>Rete</strong>{remoteAccessStatus ? `${remoteAccessStatus.bind}:${remoteAccessStatus.port}` : "127.0.0.1:18754"}</span>
              <span><strong>Codice</strong>{remoteAccessStatus?.tokenPreview || "generato all'avvio"}</span>
              <span><strong>Registro</strong>{remoteAccessStatus?.logPath || ".trova/remote-access.log"}</span>
            </div>
            <div className="settings-component-actions">
              <button onClick={() => onRemoteAccess(!remoteAccessStatus?.running)} disabled={remoteAccessBusy}>
                <GeneratedIcon name={remoteAccessStatus?.running ? "archive" : "remote"} size={18} />
                <span>{remoteAccessBusy ? "Aggiorno..." : remoteAccessStatus?.running ? "Spegni" : "Attiva"}</span>
              </button>
              <button onClick={onRefreshDoctor}>
                <GeneratedIcon name="sync" size={18} />
                <span>Controlla</span>
              </button>
            </div>
            {remoteAccessStatus?.lastError && <p className="settings-install-status">{remoteAccessStatus.lastError}</p>}
          </section>
          <section className="settings-privacy-panel color-red">
            <div className="settings-section-title">
              <GeneratedIcon name="shield" size={34} />
              <div>
                <strong>Regole sicurezza</strong>
                <span>Codice, registro e download controllato</span>
              </div>
            </div>
            <div className="settings-preset-list">
              <span>Disattivato finche non premi Avvia locale.</span>
              <span>Codice obbligatorio per ogni richiesta.</span>
              <span>I download passano solo da file gia preparati.</span>
              <span>Ogni richiesta viene registrata.</span>
            </div>
          </section>
        </div>
      )}

      {activeTab === "cloud" && (
        <div className="settings-tab-panel">
          <div className="settings-cloud-split">
            <section className="settings-privacy-panel color-blue">
              <div className="settings-section-title">
                  <GeneratedIcon name="cloud" size={34} />
                  <div>
                  <strong>Google online</strong>
                  <span>{cloudPaths.length ? `${cloudPaths.length} cartelle abilitate` : "Spento su tutte le cartelle"}</span>
                </div>
              </div>
              <p className="settings-help-text">Google riceve solo file nelle cartelle con Online attivo. Tutto il resto resta sul PC.</p>
              <div className="provider-status detailed">
                <span><strong>Stato</strong>{geminiStatus}</span>
              </div>
            </section>
            <section className="settings-privacy-panel color-green">
              <div className="settings-section-title">
                <GeneratedIcon name="sparkle" size={34} />
                <div>
                  <strong>NVIDIA online</strong>
                  <span>{nvidiaCloudEnabled ? "Attivo sui risultati migliori" : "Spento, ordine locale"}</span>
                </div>
              </div>
              <p className="settings-help-text">Serve solo ad aiutare l'ordine dei risultati migliori. Il contenuto completo resta locale salvo scelte online esplicite.</p>
              <label className="settings-cloud-toggle large">
                <input type="checkbox" checked={nvidiaCloudEnabled} onChange={onToggleNvidiaCloud} />
                Usa NVIDIA online
              </label>
              <div className="provider-status detailed">
                <span><strong>Stato</strong>{nvidiaStatus}</span>
              </div>
            </section>
          </div>

          <section className="settings-ai-models">
            <div className="settings-section-title">
              <GeneratedIcon name="sparkle" size={28} />
              <div>
                <strong>Modello AI per chat e domande</strong>
                <span>Sceglie il provider che risponde quando chiedi qualcosa nella ricerca.</span>
              </div>
            </div>
            <p className="settings-help-text">
              <strong>Niente da scaricare per i cloud free:</strong> NVIDIA e Google rispondono via API, gratis nei loro free tier. NVIDIA Nemotron 49B + Llama 3.2 Vision e Gemma 4 27B multimodale (vede immagini) sono attivi senza download.
              <br />Solo Ollama / LM Studio sono modelli che girano interamente offline sul tuo PC e richiedono il download dei pesi (10-50GB) attraverso la loro app.
            </p>
            {/* Card installazione Gemma offline (auto, nabbi-friendly) */}
            {!aiProviderStatus?.providers?.find((p) => p.id === "ollama" && p.configured) && (
              <div className="ai-ollama-callout">
                <div>
                  <strong>Vuoi Gemma 4 anche offline (100% privato)?</strong>
                  <span>Clicco e basta. Trova scarica Ollama (~600MB) + Gemma 3 4B (~3GB) in background. Funziona senza internet dopo l'installazione.</span>
                </div>
                {ollamaInstall?.running ? (
                  <div className="ai-ollama-progress">
                    <strong>{ollamaInstall.label}</strong>
                    <span>{ollamaInstall.detail || "in corso..."}</span>
                    <div className="ai-ollama-bar">
                      <span style={{ width: `${Math.max(2, Math.min(100, ollamaInstall.progress))}%` }} />
                    </div>
                    <em>{ollamaInstall.progress}%</em>
                  </div>
                ) : ollamaInstall && !ollamaInstall.running && ollamaInstall.progress === 100 ? (
                  <div className="ai-ollama-done">✅ {ollamaInstall.detail || "Pronto"}</div>
                ) : (
                  <button type="button" className="settings-link-button primary" onClick={() => onInstallOllamaGemma()}>
                    Installa Gemma offline (auto)
                  </button>
                )}
              </div>
            )}
            {!aiProviderStatus?.providers?.find((p) => p.id === "gemini" && p.configured) && (
              <div className="ai-gemini-callout">
                <div>
                  <strong>Vuoi anche Gemma 4 (Google)?</strong>
                  <span>Apri il link, clicca "Get API Key" e incolla la chiave qui sotto. Gratis, niente download.</span>
                </div>
                <button type="button" className="settings-link-button" onClick={() => window.open("https://aistudio.google.com/apikey", "_blank")}>
                  Apri Google AI Studio
                </button>
                <div className="ai-gemini-key-row">
                  <input
                    type="password"
                    placeholder="Incolla qui la chiave Gemini (inizia con AIza...)"
                    onKeyDown={async (event) => {
                      if (event.key === "Enter") {
                        const value = event.currentTarget.value.trim();
                        if (value) {
                          await safeInvoke<{ ok: boolean }>("set_gemini_api_key", { apiKey: value }, { ok: false });
                          event.currentTarget.value = "";
                          // Reload provider status tramite callback dell'App
                          onReloadAiStatus?.();
                        }
                      }
                    }}
                  />
                  <span className="ai-gemini-hint">Premi Invio per salvare</span>
                </div>
              </div>
            )}
            <div className="ai-provider-grid">
              {(aiProviderStatus?.providers || []).map((provider) => (
                <div
                  key={provider.id}
                  className={`ai-provider-card ${provider.configured ? "configured" : "missing"} ${aiProviderConfig.provider === provider.id ? "selected" : ""}`}
                >
                  <header>
                    <strong>{provider.label}</strong>
                    <em>{provider.configured ? "configurato" : "non disponibile"}</em>
                  </header>
                  {provider.models && provider.models.length > 0 ? (
                    <div className="ai-model-list">
                      {provider.models.map((model) => (
                        <label key={`${provider.id}-${model.key}`} className={`ai-model-row ${aiProviderConfig.provider === provider.id && aiProviderConfig.modelKey === model.key ? "active" : ""}`}>
                          <input
                            type="radio"
                            name="ai-provider-model"
                            checked={aiProviderConfig.provider === provider.id && aiProviderConfig.modelKey === model.key}
                            disabled={!provider.configured}
                            onChange={() => onSaveAiProvider({ ...aiProviderConfig, provider: provider.id, modelKey: model.key })}
                          />
                          <span><strong>{model.label}</strong><i>{model.category || "chat"}</i></span>
                        </label>
                      ))}
                    </div>
                  ) : (
                    <p className="ai-provider-hint">{provider.hint || "Avvia il servizio locale per vederlo qui."}</p>
                  )}
                </div>
              ))}
              <div className={`ai-provider-card ${aiProviderConfig.provider === "auto" ? "selected" : ""}`}>
                <header>
                  <strong>Auto</strong>
                  <em>raccomandato</em>
                </header>
                <label className="ai-model-row">
                  <input
                    type="radio"
                    name="ai-provider-model"
                    checked={aiProviderConfig.provider === "auto"}
                    onChange={() => onSaveAiProvider({ ...aiProviderConfig, provider: "auto", modelKey: aiProviderConfig.modelKey || "nemotron-super-49b" })}
                  />
                  <span><strong>Scegli da solo</strong><i>NVIDIA → Ollama → LM Studio → Gemini</i></span>
                </label>
              </div>
            </div>

            <label className="settings-cloud-toggle large">
              <input
                type="checkbox"
                checked={aiProviderConfig.agentEnabled}
                onChange={(event) => onSaveAiProvider({ ...aiProviderConfig, agentEnabled: event.currentTarget.checked })}
              />
              Permetti agli agenti AI di cercare sul web e leggere link
            </label>

            <div className="ai-advanced-config">
              <label className="ai-config-field">
                <span>Istruzioni personalizzate per l'AI (system prompt)</span>
                <textarea
                  rows={2}
                  placeholder="Es: Rispondi sempre in modo formale e conciso. Sei un assistente legale."
                  defaultValue={aiProviderConfig.systemPrompt || ""}
                  onBlur={(event) => onSaveAiProvider({ ...aiProviderConfig, systemPrompt: event.currentTarget.value })}
                />
              </label>
              <div className="ai-config-sliders">
                <label>
                  <span>Creativita (temperatura): {(aiProviderConfig.temperature ?? 0.2).toFixed(1)}</span>
                  <input type="range" min={0} max={1} step={0.1} value={aiProviderConfig.temperature ?? 0.2}
                    onChange={(event) => onSaveAiProvider({ ...aiProviderConfig, temperature: Number(event.currentTarget.value) })} />
                </label>
                <label>
                  <span>Lunghezza max risposta: {aiProviderConfig.maxTokens ?? 1500} token</span>
                  <input type="range" min={256} max={4096} step={256} value={aiProviderConfig.maxTokens ?? 1500}
                    onChange={(event) => onSaveAiProvider({ ...aiProviderConfig, maxTokens: Number(event.currentTarget.value) })} />
                </label>
                <label>
                  <span>File nel contesto: {aiProviderConfig.ragDepth ?? 6}</span>
                  <input type="range" min={3} max={12} step={1} value={aiProviderConfig.ragDepth ?? 6}
                    onChange={(event) => onSaveAiProvider({ ...aiProviderConfig, ragDepth: Number(event.currentTarget.value) })} />
                </label>
              </div>
              <p className="settings-help-text" style={{ marginTop: 6 }}>
                Scorciatoie chat: <code>/riassumi</code> <code>/traduci</code> <code>/spiega</code> <code>/correggi</code> <code>/elenca</code> — scrivile prima del testo per applicarle al volo.
              </p>
            </div>
            <p className="settings-help-text">Con gli agenti attivi, l'AI puo decidere autonomamente di fare ricerche web (DuckDuckGo), aprire URL e calcolare numeri. I tuoi file restano locali — solo le query e gli URL escono.</p>
          </section>
        </div>
      )}

      {activeTab === "vision" && (
        <div className="settings-tab-panel settings-vision-grid">
          <section className="settings-privacy-panel color-green">
            <div className="settings-section-title">
                <GeneratedIcon name="vision" size={34} />
                <div>
                <strong>Foto e video</strong>
                <span>{(localVisionStatus?.embeddedAssets ?? 0).toLocaleString("it-IT")} pronti su {(localVisionStatus?.totalAssets ?? 0).toLocaleString("it-IT")}</span>
              </div>
            </div>
            <p className="settings-help-text">{localVisionMessage}</p>
            <button className="settings-inline-action" onClick={onIndex}>
              <GeneratedIcon name="database" size={18} />
              <span>Prepara foto e video</span>
            </button>
          </section>
          <section className="settings-privacy-panel">
            <div className="settings-section-title">
                <GeneratedIcon name="semantic" size={34} />
                <div>
                <strong>Ricerca per immagini</strong>
                <span>Somiglianze, oggetti, schemi e pagine</span>
              </div>
            </div>
            <div className="settings-model-list">
              {modelStatuses.map((model) => (
                <div className="settings-model-row" key={model.model}>
                  <span>{friendlyVisionModelLabel(model.model, model.label)}</span>
                  <strong>{model.embeddedAssets}/{model.totalAssets}</strong>
                </div>
              ))}
              {!modelStatuses.length && <p className="settings-help-text">Prepara immagini, PDF o video per vedere cosa e pronto.</p>}
            </div>
          </section>
        </div>
      )}

      {activeTab === "advanced" && (
        <div className="settings-tab-panel settings-advanced-grid">
          <section className="settings-privacy-panel color-red">
            <div className="settings-section-title">
                <GeneratedIcon name="archive" size={34} />
                <div>
                <strong>Manutenzione ricerca</strong>
                <span>Azioni utili quando cambi molte cartelle.</span>
              </div>
            </div>
            <div className="settings-danger-actions">
              <button onClick={onIndex}><GeneratedIcon name="database" size={18} /> Rileggi i file</button>
              <button onClick={onClear}><GeneratedIcon name="archive" size={18} /> Cancella ricerca</button>
              <button onClick={() => onWatcher(!status?.watcherActive)}><GeneratedIcon name="watcher" size={18} /> {status?.watcherActive ? "Ferma aggiornamenti" : "Avvia aggiornamenti"}</button>
            </div>
          </section>

          <section className="settings-privacy-panel" style={{ gridColumn: "1 / -1" }}>
            <div className="settings-section-title">
              <GeneratedIcon name="search" size={34} />
              <div>
                <strong>Scorciatoia globale</strong>
                <span>Apri Trova da qualsiasi app con una combinazione di tasti.</span>
              </div>
            </div>
            <p className="settings-help-text">Premi "Registra tasti" e poi la combinazione che vuoi (es. Control+Spazio). Funziona solo nell'app desktop installata.</p>
            <div className="hotkey-config-row">
              <button
                type="button"
                className={`hotkey-capture ${capturingHotkey ? "capturing" : ""}`}
                onClick={onStartCaptureHotkey}
                onKeyDown={capturingHotkey ? onCaptureHotkeyKeydown : undefined}
              >
                {capturingHotkey ? "Premi i tasti ora..." : (hotkeyConfig.shortcut || "Nessuna scorciatoia")}
              </button>
              <label className="hotkey-mode-option">
                <input type="radio" name="hotkey-mode" checked={hotkeyConfig.mode === "spotlight"}
                  onChange={() => onSaveHotkey({ ...hotkeyConfig, mode: "spotlight" })} />
                <span>Casella di ricerca al centro (veloce)</span>
              </label>
              <label className="hotkey-mode-option">
                <input type="radio" name="hotkey-mode" checked={hotkeyConfig.mode === "app"}
                  onChange={() => onSaveHotkey({ ...hotkeyConfig, mode: "app" })} />
                <span>Apri il programma intero</span>
              </label>
              <label className="settings-cloud-toggle large">
                <input type="checkbox" checked={hotkeyConfig.enabled}
                  onChange={(event) => onSaveHotkey({ ...hotkeyConfig, enabled: event.currentTarget.checked })}
                  disabled={!hotkeyConfig.shortcut} />
                Attiva la scorciatoia globale
              </label>
            </div>
          </section>
          <section className="settings-privacy-panel">
            <div className="settings-section-title">
              <GeneratedIcon name="settings" size={34} />
              <div>
                <strong>Preset consigliati</strong>
                <span>Usali nella tab Cartelle sui singoli percorsi.</span>
              </div>
            </div>
            <div className="settings-preset-list">
              <span>Documenti: .pdf .docx .pptx .xlsx .txt .md</span>
              <span>Media: .png .jpg .webp .mp4 .mov .mp3 .wav</span>
              <span>Codice: .ts .tsx .js .py .rs .json .css .html</span>
            </div>
          </section>
        </div>
      )}

      {activeTab === "folders" && (
        <div className="settings-tab-panel">
          <div className="watch-list-head">
            <div>
              <h3>Cartelle dove cercare</h3>
              <p>Scegli quali cartelle leggere, cosa escludere e se una cartella puo andare online.</p>
            </div>
            <span>{paths.length.toLocaleString("it-IT")} percorsi</span>
          </div>

          <div className="watch-list">
            {paths.map((path) => {
              const icon = iconForPath(path.path);
              const extensionValue = path.fileTypeFilter?.extensions?.join(", ") ?? "";
              return (
                <article className={`watch-row detailed ${path.isExcluded ? "excluded" : ""}`} key={path.id}>
              <div className="watch-main">
                <div className="watch-icon"><GeneratedIcon name={icon} size={25} /></div>
                <div>
                  <strong>{displayPathName(path.path)}</strong>
                  <span>{path.path}</span>
                  <div className="watch-chips">
                    <i>{path.enabled && !path.isExcluded ? "Sul PC" : "Spenta"}</i>
                    <i>{path.recursive ? "Anche sottocartelle" : "Solo questa cartella"}</i>
                    <i>{path.autoIndex ? "Si aggiorna da sola" : "Manuale"}</i>
                    <i>{path.geminiEnabled ? "Online scelto" : "Solo PC"}</i>
                    {path.fileTypeFilter?.extensions?.length ? <i>{path.fileTypeFilter.mode}: {extensionValue}</i> : <i>Tutti i tipi</i>}
                  </div>
                </div>
              </div>

              <div className="watch-controls">
                <label>
                  <input type="checkbox" checked={path.enabled} onChange={() => onSave(togglePath(paths, path, "enabled"))} />
                  Sul PC
                </label>
                <label>
                  <input type="checkbox" checked={path.recursive} onChange={() => onSave(togglePath(paths, path, "recursive"))} />
                  Sottocartelle
                </label>
                <label>
                  <input type="checkbox" checked={path.autoIndex} onChange={() => onSave(togglePath(paths, path, "autoIndex"))} />
                  Aggiorna da sola
                </label>
                <label>
                  <input type="checkbox" checked={path.geminiEnabled} onChange={() => onSave(togglePath(paths, path, "geminiEnabled"))} />
                  Online
                </label>
                <label>
                  <input type="checkbox" checked={path.isExcluded} onChange={() => onSave(togglePath(paths, path, "isExcluded"))} />
                  Escludi
                </label>
              </div>

              <div className="watch-filter-row">
                <select
                  value={path.fileTypeFilter?.mode ?? "include"}
                  onChange={(event) => onSave(updatePath(paths, path, {
                    fileTypeFilter: {
                      mode: event.currentTarget.value as FileTypeFilter["mode"],
                      extensions: path.fileTypeFilter?.extensions ?? [],
                    },
                  }))}
                  aria-label={`Modalita filtro ${displayPathName(path.path)}`}
                >
                  <option value="include">Includi solo</option>
                  <option value="exclude">Escludi</option>
                </select>
                <input
                  value={extensionValue}
                  onChange={(event) => onSave(updatePath(paths, path, {
                    fileTypeFilter: {
                      mode: path.fileTypeFilter?.mode ?? "include",
                      extensions: parseExtensions(event.currentTarget.value),
                    },
                  }))}
                  placeholder=".pdf, .docx, .png"
                  aria-label={`Estensioni ${displayPathName(path.path)}`}
                />
                <button onClick={() => onSave(updatePath(paths, path, {
                  fileTypeFilter: { mode: "include", extensions: [".pdf", ".docx", ".pptx", ".xlsx", ".txt", ".md"] },
                }))}>
                  Documenti
                </button>
                <button onClick={() => onSave(updatePath(paths, path, {
                  fileTypeFilter: { mode: "include", extensions: [".png", ".jpg", ".jpeg", ".webp", ".mp4", ".mov", ".mp3", ".wav"] },
                }))}>
                  Media
                </button>
                <button onClick={() => onSave(updatePath(paths, path, { fileTypeFilter: undefined }))}>
                  Tutto
                </button>
              </div>
                </article>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}

function SettingsOverviewMockup({
  status,
  simpleStatus,
  autoSetupJob,
  localVisionStatus,
  semanticStatus,
  localComponents,
  connectors,
  enabledPaths,
  cloudPaths,
  geminiStatus,
  nvidiaStatus,
  nvidiaCloudEnabled,
  onToggleNvidiaCloud,
  onIndex,
  onAutoSetup,
  onRepair,
}: {
  status: IndexStatus | null;
  simpleStatus: SimpleAppStatus | null;
  autoSetupJob: AutoSetupJob | null;
  localVisionStatus: LocalVisionStatus | null;
  semanticStatus: SemanticStatus | null;
  localComponents: LocalComponent[];
  connectors: ConnectorConfig[];
  enabledPaths: WatchPath[];
  cloudPaths: WatchPath[];
  geminiStatus: string;
  nvidiaStatus: string;
  nvidiaCloudEnabled: boolean;
  onToggleNvidiaCloud: () => void;
  onIndex: () => void;
  onAutoSetup: () => void;
  onRepair: () => void;
}) {
  const running = autoSetupJob?.status === "running" || simpleStatus?.status === "preparing";
  const ready = simpleStatus?.status === "ready";
  const missingRequired = localComponents.filter((component) => component.required && !component.installed).length;
  const visionReady = localVisionStatus?.embeddedAssets ?? 0;
  const visionTotal = localVisionStatus?.totalAssets ?? 0;
  const activeConnectors = connectors.filter((connector) => connector.enabled).length;
  const syncedConnectors = connectors.filter((connector) => connector.lastSyncAt && !connector.lastSyncError).length;
  const heroTitle = running ? autoSetupJob?.title || "Preparazione in corso" : ready ? "Tutto sotto controllo" : simpleStatus?.title ?? "Stato generale";
  const heroMessage = running ? autoSetupJob?.message || "Trova prepara il PC in background." : simpleStatus?.message ?? "Trova e pronta a cercare nei tuoi file locali.";
  const heroProgress = Math.max(0, Math.min(100, autoSetupJob?.progress ?? simpleStatus?.progress ?? (ready ? 100 : 0)));

  return (
    <div className="settings-tab-panel settings-overview-mockup">
      <section className={`overview-hero ${ready ? "ready" : running ? "running" : "attention"}`}>
        <div>
          <span>Stato generale</span>
          <strong>{heroTitle}</strong>
          <p>{heroMessage}</p>
          <div className="overview-hero-progress" aria-label="Avanzamento stato generale">
            <i style={{ width: `${ready ? 100 : Math.max(heroProgress, 8)}%` }} />
          </div>
        </div>
        <div className="overview-shield">
          {running ? <RefreshCw size={82} /> : <ShieldCheck size={92} />}
        </div>
      </section>

      <section className="overview-metric-row" aria-label="Stato rapido">
        <OverviewMetricCard
          icon="database"
          title="Indice"
          status={status?.filesIndexed ? "Pronto" : "Da preparare"}
          value={`${status?.progress ?? 0}%`}
          tone={status?.filesIndexed ? "green" : "yellow"}
        />
        <OverviewMetricCard
          icon="vision"
          title="Foto e video"
          status={visionReady ? "Pronto" : "Da preparare"}
          value={visionTotal ? `${visionReady}/${visionTotal}` : "-"}
          tone={visionReady ? "green" : "yellow"}
        />
        <OverviewMetricCard
          icon="tools"
          title="Componenti"
          status={missingRequired ? "Da sistemare" : "Pronto"}
          value={missingRequired ? `${missingRequired}` : "OK"}
          tone={missingRequired ? "red" : "green"}
        />
        <OverviewMetricCard
          icon="remote"
          title="Connessioni"
          status={activeConnectors ? "Attive" : "Spente"}
          value={`${syncedConnectors}/${activeConnectors}`}
          tone={activeConnectors ? "blue" : "red"}
        />
      </section>

      <section className="overview-summary-card">
        <strong>In sintesi</strong>
        <div className="overview-summary-grid">
          <span><GeneratedIcon name="folder" size={20} /> Cartelle attive <b>{enabledPaths.length}</b></span>
          <span><GeneratedIcon name="vision" size={20} /> Modelli vision <b>{visionTotal ? "Preparati" : "Da scaricare"}</b></span>
          <span><GeneratedIcon name="document" size={20} /> File indicizzati <b>{(status?.filesIndexed ?? 0).toLocaleString("it-IT")}</b></span>
          <span><GeneratedIcon name="search" size={20} /> File Search <b>{cloudPaths.length ? "Attivo" : "Spento"}</b></span>
          <span><GeneratedIcon name="watcher" size={20} /> Ultima scansione <b>{status?.lastIndexedAt ? formatDate(status.lastIndexedAt) : "-"}</b></span>
          <label>
            <GeneratedIcon name="sparkle" size={20} />
            NVIDIA rerank
            <input type="checkbox" checked={nvidiaCloudEnabled} onChange={onToggleNvidiaCloud} />
            <b>{nvidiaCloudEnabled ? "Attivo" : "Spento"}</b>
          </label>
        </div>
        <div className="overview-provider-line">
          <span>Google: {geminiStatus}</span>
          <span>NVIDIA: {nvidiaStatus}</span>
          <span>Semantica: {semanticStatus?.ready ? "Pronta" : "Da preparare"}</span>
        </div>
      </section>

      <section className="overview-actions-card">
        <strong>Azioni rapide</strong>
        <div>
          <button onClick={onIndex}>
            <GeneratedIcon name="database" size={22} />
            <span>Scansiona ora</span>
          </button>
          <button onClick={onAutoSetup} disabled={running}>
            <GeneratedIcon name="image" size={22} />
            <span>{running ? "Preparazione..." : "Prepara foto e video"}</span>
          </button>
          <button onClick={onRepair} disabled={running}>
            <GeneratedIcon name="document" size={22} />
            <span>Apri log</span>
          </button>
        </div>
      </section>
    </div>
  );
}

function OverviewMetricCard({
  icon,
  title,
  status,
  value,
  tone,
}: {
  icon: GeneratedIconName;
  title: string;
  status: string;
  value: string;
  tone: "blue" | "green" | "yellow" | "red";
}) {
  return (
    <article className={`overview-metric-card tone-${tone}`}>
      <GeneratedIcon name={icon} size={28} />
      <span>{title}</span>
      <strong>{status}</strong>
      <small>{value}</small>
    </article>
  );
}

function SimpleStatusPanel({
  simpleStatus,
  autoSetupJob,
  onAutoSetup,
  onRepair,
}: {
  simpleStatus: SimpleAppStatus | null;
  autoSetupJob: AutoSetupJob | null;
  onAutoSetup: () => void;
  onRepair: () => void;
}) {
  const running = autoSetupJob?.status === "running" || simpleStatus?.status === "preparing";
  const progress = Math.max(0, Math.min(100, autoSetupJob?.progress ?? simpleStatus?.progress ?? 0));
  const title = running ? autoSetupJob?.title || "Sto preparando" : simpleStatus?.title ?? "Stato app";
  const message = running ? autoSetupJob?.message || "Sto preparando tutto in background." : simpleStatus?.message ?? "Premi Prepara tutto per controllare il PC.";
  return (
    <section className={`simple-status-panel ${simpleStatus?.status ?? "attention"}`}>
      <div className="settings-section-title">
        <GeneratedIcon name={running ? "sync" : simpleStatus?.status === "ready" ? "shield" : "tools"} size={36} />
        <div>
          <strong>{title}</strong>
          <span>{message}</span>
        </div>
      </div>
      <div className="simple-status-progress">
        <span style={{ width: `${running ? progress : simpleStatus?.status === "ready" ? 100 : Math.max(progress, 12)}%` }} />
      </div>
      <div className="settings-component-actions">
        <button onClick={onAutoSetup} disabled={running}>
          <GeneratedIcon name="sparkle" size={18} />
          <span>{running ? "Preparazione in corso" : "Prepara tutto"}</span>
        </button>
        <button onClick={onRepair} disabled={running}>
          <GeneratedIcon name="tools" size={18} />
          <span>Sistema</span>
        </button>
      </div>
      {autoSetupJob?.steps?.length ? (
        <div className="auto-setup-steps">
          {autoSetupJob.steps.map((step) => (
            <span className={step.state} key={step.id}>{step.label}</span>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function Metric({ label, value, suffix }: { label: string; value: number; suffix?: string }) {
  return (
    <div className="metric">
      <strong>{value.toLocaleString("it-IT")}</strong>
      <span>{suffix ?? label}</span>
      {suffix && <small>{label}</small>}
    </div>
  );
}

function LocalAskPanel({
  question,
  query,
  answer,
  busy,
  semanticStatus,
  chatMessages = [],
  agentMode = false,
  activeProviderLabel = "",
  activeModelLabel = "",
  onQuestionChange,
  onAsk,
  onSimilar,
  onToggleAgent,
  onNewThread,
  onOpenSettings,
  onExport,
  onShowHistory,
  chatThreadsList = [],
  showThreadHistory = false,
  onCloseHistory,
  onPickThread,
  onDeleteThread,
  pinnedDocuments = [],
  onUnpinDocument,
  onPinFromCitation,
  mentionSuggestions = [],
  showMentionDropdown = false,
  onQuestionChangeWithCaret,
  onPickMention,
  onSpeak,
  speakingIndex = null,
  onToggleDictation,
  isListening = false,
  onOpenCitation,
}: {
  question: string;
  query: string;
  answer: LocalAskAnswer | null;
  busy: boolean;
  semanticStatus: SemanticStatus | null;
  chatMessages?: { role: "user" | "assistant"; content: string; citations?: { filePath?: string; snippet?: string; name?: string }[]; toolsUsed?: { fn: string; args: Record<string, unknown> }[] }[];
  agentMode?: boolean;
  activeProviderLabel?: string;
  activeModelLabel?: string;
  onQuestionChange: (value: string) => void;
  onAsk: () => void;
  onSimilar: () => void;
  onToggleAgent?: () => void;
  onNewThread?: () => void;
  onOpenSettings?: () => void;
  onExport?: () => void;
  onShowHistory?: () => void;
  chatThreadsList?: Array<{ id: string; title: string; messageCount: number; lastMessageAt: number }>;
  showThreadHistory?: boolean;
  onCloseHistory?: () => void;
  onPickThread?: (threadId: string) => void;
  onDeleteThread?: (threadId: string) => void;
  pinnedDocuments?: Array<{ filePath: string; name: string; kind?: string; indexed?: boolean }>;
  onUnpinDocument?: (filePath: string) => void;
  onPinFromCitation?: (filePath: string) => void;
  mentionSuggestions?: Array<{ filePath: string; name: string; kind?: string; extension?: string; snippet?: string }>;
  showMentionDropdown?: boolean;
  onQuestionChangeWithCaret?: (value: string, caret: number) => void;
  onPickMention?: (suggestion: { filePath: string; name: string; kind?: string; extension?: string; snippet?: string }) => void;
  onSpeak?: (text: string, index: number) => void;
  speakingIndex?: number | null;
  onToggleDictation?: () => void;
  isListening?: boolean;
  onOpenCitation?: (filePath: string) => void;
}) {
  const semanticLabel = semanticStatus?.ready
    ? `${semanticStatus.embeddedChunks.toLocaleString("it-IT")} pezzi pronti`
    : "Domande in attesa della preparazione";
  const hasChat = chatMessages.length > 0;
  const fallbackAnswer = !hasChat && answer ? answer : null;

  return (
    <section className="local-ask-panel">
      <div className="local-ask-head">
        <GeneratedIcon name="semantic" size={22} />
        <strong>Fai una domanda</strong>
        <span>{semanticLabel}</span>
        {(activeProviderLabel || activeModelLabel) && (
          <span className="local-ask-model" title="Modello AI attivo">{activeModelLabel || activeProviderLabel}</span>
        )}
        <div className="local-ask-actions">
          {onToggleAgent && (
            <button
              type="button"
              className={`local-ask-toggle ${agentMode ? "active" : ""}`}
              onClick={onToggleAgent}
              title={agentMode ? "Agente attivo: l'AI puo cercare sul web e leggere link" : "Agente spento: l'AI usa solo i tuoi file"}
            >
              <GeneratedIcon name="sparkle" size={14} />
              <span>Agente {agentMode ? "On" : "Off"}</span>
            </button>
          )}
          {onNewThread && hasChat && (
            <button type="button" className="local-ask-toggle" onClick={onNewThread} title="Inizia una nuova conversazione">
              <span>Nuova</span>
            </button>
          )}
          {onShowHistory && (
            <button type="button" className="local-ask-toggle subtle" onClick={onShowHistory} title="Cronologia conversazioni">
              <Clock3 size={14} />
            </button>
          )}
          {onExport && hasChat && (
            <button type="button" className="local-ask-toggle subtle" onClick={onExport} title="Esporta conversazione in Markdown">
              <Download size={14} />
            </button>
          )}
          {onOpenSettings && (
            <button type="button" className="local-ask-toggle subtle" onClick={onOpenSettings} title="Cambia provider AI o modello">
              <GeneratedIcon name="settings" size={14} />
            </button>
          )}
        </div>
      </div>

      {showThreadHistory && (
        <div className="local-thread-history" role="dialog" aria-label="Cronologia conversazioni">
          <header>
            <strong>Conversazioni passate</strong>
            <button type="button" onClick={onCloseHistory} aria-label="Chiudi"><X size={14} /></button>
          </header>
          {chatThreadsList.length === 0 ? (
            <p className="local-thread-empty">Nessuna conversazione salvata.</p>
          ) : (
            <ul>
              {chatThreadsList.map((thread) => (
                <li key={thread.id}>
                  <button type="button" className="thread-item" onClick={() => onPickThread?.(thread.id)}>
                    <strong>{thread.title || "(senza titolo)"}</strong>
                    <small>{thread.messageCount} messaggi{thread.lastMessageAt ? ` · ${new Date(thread.lastMessageAt).toLocaleDateString("it-IT")}` : ""}</small>
                  </button>
                  <button type="button" className="thread-delete" onClick={() => onDeleteThread?.(thread.id)} aria-label="Elimina conversazione">
                    <X size={12} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {hasChat && (
        <div className="local-chat-thread" aria-label="Conversazione AI">
          {chatMessages.map((message, index) => (
            <div key={`${message.role}-${index}`} className={`local-chat-message ${message.role}`}>
              <div className="local-chat-author">
                {message.role === "user" ? "Tu" : "Trova AI"}
                {message.role === "assistant" && message.toolsUsed?.length ? (
                  <span className="local-chat-tools">· tool: {message.toolsUsed.map((tool) => tool.fn).join(", ")}</span>
                ) : null}
                {message.role === "assistant" && message.content && onSpeak && (
                  <button
                    type="button"
                    className={`local-chat-speak ${speakingIndex === index ? "active" : ""}`}
                    onClick={() => onSpeak(message.content, index)}
                    title={speakingIndex === index ? "Ferma lettura" : "Leggi ad alta voce"}
                  >
                    {speakingIndex === index ? <Square size={13} /> : <Play size={13} />}
                  </button>
                )}
              </div>
              <div className="local-chat-bubble"><pre>{message.content}</pre></div>
              {message.role === "assistant" && message.citations && message.citations.length > 0 && (
                <div className="local-citations">
                  {message.citations.slice(0, 5).map((citation, i) => (
                    <span key={`${citation.filePath || citation.name || i}-${i}`} className="local-citation-row">
                      <span
                        className={citation.filePath && onOpenCitation ? "local-citation-link" : ""}
                        onClick={() => { if (citation.filePath && onOpenCitation) onOpenCitation(citation.filePath); }}
                        title={citation.filePath ? `Apri ${citation.filePath}` : undefined}
                      >
                        {i + 1}. {citation.name || citation.filePath?.split("/").pop() || "file"}
                        {citation.snippet ? ` · ${citation.snippet.slice(0, 80)}${citation.snippet.length > 80 ? "..." : ""}` : ""}
                      </span>
                      {citation.filePath && onPinFromCitation && !pinnedDocuments.some((d) => d.filePath === citation.filePath) && (
                        <button type="button" className="local-citation-pin" onClick={() => onPinFromCitation(citation.filePath!)} title="Fissa questo file nel contesto AI">
                          📌
                        </button>
                      )}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
          {busy && (
            <div className="local-chat-message assistant pending">
              <div className="local-chat-author">Trova AI</div>
              <div className="local-chat-bubble"><span className="thinking-dots"><i /><i /><i /></span></div>
            </div>
          )}
        </div>
      )}

      {pinnedDocuments.length > 0 && (
        <div className="local-pinned-row" role="status" aria-label="Documenti fissati">
          <span className="local-pinned-label">📌 Fissati nel contesto:</span>
          {pinnedDocuments.map((doc) => (
            <span key={doc.filePath} className="local-pinned-chip" title={doc.filePath}>
              {doc.name}
              <button type="button" onClick={() => onUnpinDocument?.(doc.filePath)} aria-label={`Rimuovi ${doc.name}`}>
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="local-ask-row" style={{ position: "relative" }}>
        <input
          value={question}
          onChange={(event) => {
            const value = event.currentTarget.value;
            const caret = event.currentTarget.selectionStart || value.length;
            if (onQuestionChangeWithCaret) onQuestionChangeWithCaret(value, caret);
            else onQuestionChange(value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !showMentionDropdown) onAsk();
            if (event.key === "Escape") {
              // Chiudi dropdown mention con esc
            }
          }}
          placeholder={hasChat ? "Continua la conversazione... (usa @nome per riferirti a un file)" : query.trim() ? `Domanda su "${query.trim()}"` : "Chiedi qualcosa ai file pronti (digita @ per menzionare un file)"}
        />
        {onToggleDictation && (
          <button onClick={onToggleDictation} className={`local-mic-button ${isListening ? "listening" : ""}`} title={isListening ? "Ferma dettatura" : "Detta con il microfono"} type="button">
            <Mic size={18} />
          </button>
        )}
        <button onClick={onAsk} disabled={busy}>
          <GeneratedIcon name="search" size={18} />
          <span>{busy ? "Cerco..." : "Chiedi"}</span>
        </button>
        <button onClick={onSimilar} disabled={busy}>
          <GeneratedIcon name="sparkle" size={18} />
          <span>Simili</span>
        </button>
        {showMentionDropdown && mentionSuggestions.length > 0 && (
          <div className="local-mention-dropdown" role="listbox">
            {mentionSuggestions.map((suggestion) => (
              <button
                key={suggestion.filePath}
                type="button"
                role="option"
                aria-selected="false"
                onClick={() => onPickMention?.(suggestion)}
              >
                <strong>{suggestion.name}</strong>
                {suggestion.kind ? <em>{suggestion.kind}</em> : null}
                {suggestion.snippet ? <small>{suggestion.snippet.slice(0, 80)}{suggestion.snippet.length > 80 ? "..." : ""}</small> : null}
              </button>
            ))}
          </div>
        )}
      </div>

      {fallbackAnswer && (
        <div className="local-answer">
          <pre>{fallbackAnswer.answer}</pre>
          <div className="local-citations">
            {fallbackAnswer.citations.slice(0, 5).map((citation, index) => (
              <span key={`${citation.filePath ?? citation.title}-${citation.chunkIndex ?? index}`}>
                {index + 1}. {citation.title}
                {citation.chunkIndex !== undefined ? ` · parte ${citation.chunkIndex + 1}` : ""}
                {citation.score ? ` · ${Math.round(citation.score * 100)}%` : ""}
              </span>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function GeminiAnswer({ answer, citations }: { answer: string; citations: GeminiCitation[] }) {
  return (
    <section className="gemini-answer">
      <div className="gemini-answer-head">
        <GeneratedIcon name="semantic" size={22} />
        <strong>Risposta online</strong>
      </div>
      {answer && <p>{answer}</p>}
      {citations.length > 0 && (
        <div className="citation-list">
          {citations.slice(0, 5).map((citation, index) => (
            <span key={`${citation.title}-${index}`}>
              {citation.title}
              {citation.pageNumber ? ` · pagina ${citation.pageNumber}` : ""}
              {citation.mediaId ? " · immagine citata" : ""}
            </span>
          ))}
        </div>
      )}
    </section>
  );
}

function ResultRow({
  item,
  index,
  query,
  nvidiaEnabled,
  onOpen,
}: {
  item: IndexedFile;
  index: number;
  query: string;
  nvidiaEnabled: boolean;
  onOpen?: (item: IndexedFile) => void;
}) {
  const icon = iconFor(item);
  const sourceLabel = sourceLabelForResult(item);
  const sourceClass = item.source === "gemini" ? "gemini" : item.sourceType === "remote" ? "remote" : "local";
  const [previewOpen, setPreviewOpen] = useState(false);
  const openPreview = () => {
    onOpen?.(item);
    setPreviewOpen(true);
  };

  return (
    <>
    <article
      className={`result-row ${item.kind}`}
      style={{ animationDelay: `${index * 40}ms` }}
      role="button"
      tabIndex={0}
      onClick={openPreview}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openPreview();
        }
      }}
    >
      <Preview item={item} />
      <div className="result-main">
        <div className="result-title-line">
          <span className={`title-file-icon ${item.kind}`} aria-hidden="true">
            <GeneratedIcon name={icon} size={22} />
          </span>
          <h2>{item.name}</h2>
          <span className={`source-pill ${sourceClass}`}>{sourceLabel}</span>
        </div>
        <div className="breadcrumb">{item.path}</div>
        <p dangerouslySetInnerHTML={{ __html: highlight(item.snippet, query) }} />
        <div className="result-chip-row">
          <span className={`match-chip ${item.matchType ?? "text"}`}>{matchLabel(item.matchType)}</span>
          <span className="page-chip">
            <GeneratedIcon name="archive" size={17} />
            <span>{item.extension || item.kind}</span>
          </span>
          <span className="page-chip">
            <GeneratedIcon name="sparkle" size={17} />
            <span>{Math.round(item.score)} score</span>
          </span>
          {item.page_hint && (
            <span className="page-chip">
              <GeneratedIcon name="document" size={17} />
              <span>Pagina {item.page_hint}</span>
            </span>
          )}
          {item.timestamp !== undefined && (
            <span className="page-chip">
              <GeneratedIcon name="video" size={17} />
              <span>{formatTimestamp(item.timestamp)}</span>
            </span>
          )}
        </div>
      </div>
      <div className="file-meta">
        <span>Modificato: {formatDate(item.modified)}</span>
        <span>Dimensione: {formatSize(item.size)}</span>
        {item.citations?.length ? <span>{item.citations.length} citazioni locali</span> : null}
        {item.remotePath ? <span>Archivio: {displayPathName(item.remotePath)}</span> : null}
      </div>
      <button className="more" aria-label="Altre opzioni" onClick={(event) => event.stopPropagation()}>
        <MoreVertical size={20} />
      </button>
    </article>
    {previewOpen && <FilePreviewModal item={item} nvidiaEnabled={nvidiaEnabled} onClose={() => setPreviewOpen(false)} />}
    </>
  );
}

function Preview({ item }: { item: IndexedFile }) {
  const [previewSrc, setPreviewSrc] = useState("");

  useEffect(() => {
    let cancelled = false;
    setPreviewSrc("");
    if (!item.visual_preview) return;
    void tauriInvoke<string>("read_image_data_url", { path: item.visual_preview })
      .then((dataUrl) => {
        if (!cancelled) setPreviewSrc(dataUrl);
      })
      .catch(() => {
        if (!cancelled) setPreviewSrc("");
      });
    return () => {
      cancelled = true;
    };
  }, [item.visual_preview]);

  if (previewSrc) {
    return (
      <div className="real-preview">
        <img src={previewSrc} alt="" />
        <span>{item.kind === "document" ? "Pagina trovata" : "Preview reale"}</span>
      </div>
    );
  }

  return <div className="no-preview">Nessuna preview reale</div>;
}

function FilePreviewModal({ item, nvidiaEnabled, onClose }: { item: IndexedFile; nvidiaEnabled: boolean; onClose: () => void }) {
  const [payload, setPayload] = useState<PreviewPayload | null>(null);
  const [aiSummary, setAiSummary] = useState<NvidiaFileSummary | null>(null);
  const [aiSummaryBusy, setAiSummaryBusy] = useState(false);
  const [aiSummaryError, setAiSummaryError] = useState("");
  const [error, setError] = useState("");
  const [opening, setOpening] = useState(false);
  const icon = iconFor(item);
  const canSummarize = isSummarizableFile(item);

  useEffect(() => {
    let cancelled = false;
    setPayload(null);
    setError("");
    void tauriInvoke<PreviewPayload>("read_file_data_url", { path: item.path })
      .then((nextPayload) => {
        if (!cancelled) setPayload(nextPayload);
      })
      .catch((err) => {
        if (!cancelled) setError(String(err?.message || err || "Preview non disponibile"));
      });
    return () => {
      cancelled = true;
    };
  }, [item.path]);

  useEffect(() => {
    setAiSummary(null);
    setAiSummaryError("");
  }, [item.path]);

  useEffect(() => {
    if (!nvidiaEnabled || !canSummarize || aiSummary || aiSummaryBusy) return;
    void summarizeWithNvidia(false);
  }, [nvidiaEnabled, canSummarize, item.path]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const openFolder = async () => {
    setOpening(true);
    try {
      await tauriInvoke("open_in_folder", { path: item.path });
    } catch (err) {
      setError(String(err?.message || err || "Non riesco ad aprire la cartella"));
    } finally {
      setOpening(false);
    }
  };

  const summarizeWithNvidia = async (refresh = false) => {
    if (!canSummarize) return;
    setAiSummaryBusy(true);
    setAiSummaryError("");
    try {
      const summary = await tauriInvoke<NvidiaFileSummary>("summarize_file_with_nvidia", {
        request: {
          filePath: item.path,
          consent: true,
          refresh,
          maxChars: 26_000,
        },
      });
      setAiSummary(summary);
    } catch (err) {
      setAiSummaryError(shortError(err));
    } finally {
      setAiSummaryBusy(false);
    }
  };

  return (
    <div className="preview-modal-backdrop" onClick={onClose}>
      <section className="preview-modal" aria-modal="true" role="dialog" onClick={(event) => event.stopPropagation()}>
        <header className="preview-modal-head">
          <span className={`title-file-icon ${item.kind}`} aria-hidden="true">
            <GeneratedIcon name={icon} size={23} />
          </span>
          <div>
            <strong>{item.name}</strong>
            <span>{item.path}</span>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Chiudi preview">
            <X size={18} />
          </button>
        </header>
        <div className="preview-modal-body">
          {payload ? <FilePreviewContent item={item} payload={payload} /> : <div className="preview-loading">{error || "Carico preview..."}</div>}
        </div>
        {canSummarize && (
          <NvidiaSummaryPanel
            summary={aiSummary}
            busy={aiSummaryBusy}
            error={aiSummaryError}
            nvidiaEnabled={nvidiaEnabled}
            onSummarize={() => void summarizeWithNvidia(false)}
            onRefresh={() => void summarizeWithNvidia(true)}
          />
        )}
        {error && payload && <p className="preview-error">{error}</p>}
        <footer className="preview-modal-actions">
          <button className="open-folder-button" onClick={openFolder} disabled={opening}>
            <GeneratedIcon name="folder" size={18} />
            <span>{opening ? "Apro..." : "Apri nella cartella"}</span>
            <ExternalLink size={14} />
          </button>
        </footer>
      </section>
    </div>
  );
}

function NvidiaSummaryPanel({
  summary,
  busy,
  error,
  nvidiaEnabled,
  onSummarize,
  onRefresh,
}: {
  summary: NvidiaFileSummary | null;
  busy: boolean;
  error: string;
  nvidiaEnabled: boolean;
  onSummarize: () => void;
  onRefresh: () => void;
}) {
  return (
    <section className="preview-ai-panel">
      <div className="preview-ai-head">
        <span>
          <GeneratedIcon name="sparkle" size={22} />
        </span>
        <div>
          <strong>Riassunto AI</strong>
          <small>
            {summary
              ? `${summary.model.split("/").pop()} · ${summary.fromCache ? "salvato" : "appena generato"}`
              : nvidiaEnabled
                ? "Uso NVIDIA online quando apri il file."
                : "Premi il pulsante per usare NVIDIA su questo file."}
          </small>
        </div>
        <button onClick={summary ? onRefresh : onSummarize} disabled={busy}>
          {busy ? "Riassumo..." : summary ? "Rigenera" : "Riassumi con NVIDIA"}
        </button>
      </div>
      {error && <p className="preview-ai-error">{error}</p>}
      {summary ? (
        <div className="preview-ai-content">
          <p>{summary.summary}</p>
          {summary.bullets?.length ? (
            <ul>
              {summary.bullets.map((bullet) => <li key={bullet}>{bullet}</li>)}
            </ul>
          ) : null}
          <div className="preview-ai-meta">
            {summary.fileType && <span><strong>Tipo</strong>{summary.fileType}</span>}
            {summary.usefulFor && <span><strong>Utile per</strong>{summary.usefulFor}</span>}
            <span><strong>Letto</strong>{summary.contentChars.toLocaleString("it-IT")} caratteri</span>
          </div>
          {summary.questions?.length ? (
            <div className="preview-ai-questions">
              <strong>Domande utili</strong>
              {summary.questions.map((question) => <span key={question}>{question}</span>)}
            </div>
          ) : null}
        </div>
      ) : (
        <p className="preview-ai-empty">
          {busy
            ? "Sto leggendo il testo estratto e preparo un riassunto semplice."
            : "Invia solo il testo estratto di questo file a NVIDIA per avere riassunto, punti chiave e domande utili."}
        </p>
      )}
    </section>
  );
}

function FilePreviewContent({ item, payload }: { item: IndexedFile; payload: PreviewPayload }) {
  const extension = item.extension.toLowerCase();
  const isTextLike = payload.mimeType.startsWith("text/") || item.kind === "code" || ["json", "md", "csv", "toml", "yaml", "yml"].includes(extension);

  if (payload.mimeType.startsWith("image/")) {
    return <img className="preview-media image-preview" src={payload.dataUrl} alt="" />;
  }
  if (payload.mimeType.startsWith("video/")) {
    return <video className="preview-media" src={payload.dataUrl} controls />;
  }
  if (payload.mimeType.startsWith("audio/")) {
    return <audio className="preview-audio" src={payload.dataUrl} controls />;
  }
  if (payload.mimeType === "application/pdf") {
    return <iframe className="preview-frame" src={payload.dataUrl} title={item.name} />;
  }
  if (isTextLike) {
    return <pre className="preview-text-content">{textFromDataUrl(payload.dataUrl)}</pre>;
  }
  return (
    <div className="preview-fallback">
      <GeneratedIcon name="document" size={58} />
      <strong>Preview pronta per questo formato</strong>
      <span>{item.extension || item.kind} · {formatSize(payload.size)}</span>
    </div>
  );
}

function isSummarizableFile(item: IndexedFile) {
  if (item.kind === "document" || item.kind === "code") return true;
  return ["txt", "md", "csv", "json", "toml", "yaml", "yml", "pdf", "docx", "rtf", "odt", "pptx", "xlsx"].includes(item.extension.toLowerCase());
}

function textFromDataUrl(dataUrl: string) {
  const comma = dataUrl.indexOf(",");
  if (comma < 0) return "";
  const header = dataUrl.slice(0, comma);
  const body = dataUrl.slice(comma + 1);
  try {
    if (header.includes(";base64")) {
      const binary = window.atob(body);
      const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
      return new TextDecoder("utf-8").decode(bytes);
    }
    return decodeURIComponent(body);
  } catch {
    return "";
  }
}

function watchPath(path: string, enabled: boolean): WatchPath {
  return {
    id: String(Math.abs(hashCode(path))),
    path,
    enabled,
    recursive: true,
    isExcluded: false,
    geminiEnabled: false,
    autoIndex: true,
    sourceType: "local",
  };
}

function normalizeFolderDraft(path: string) {
  const trimmed = path.trim();
  if (!trimmed) return "";
  if (/^[A-Za-z]:[\\/]?$/.test(trimmed) || trimmed === "/" || trimmed === "\\") return trimmed;
  return trimmed.replace(/[\\/]+$/, "");
}

function connectorDraft({
  name,
  provider,
  remotePath,
  remoteName,
}: {
  name: string;
  provider: string;
  remotePath: string;
  remoteName?: string;
}): ConnectorConfig {
  const id = String(Math.abs(hashCode(`${provider}:${remoteName ?? ""}:${remotePath}:${Date.now()}`)));
  return {
    id,
    name,
    provider,
    sourceType: "remote",
    remoteName,
    remotePath,
    cachePath: "",
    enabled: true,
    readOnly: true,
    autoSync: true,
    geminiEnabled: false,
    recursive: true,
    syncMode: "cache",
    lastSyncStatus: "mai sincronizzato",
    lastSyncError: "",
  };
}

function toggleConnector(connectors: ConnectorConfig[], target: ConnectorConfig, key: keyof ConnectorConfig) {
  return connectors.map((connector) =>
    connector.id === target.id ? { ...connector, [key]: !connector[key] } : connector,
  ) as ConnectorConfig[];
}

function updateConnector(connectors: ConnectorConfig[], target: ConnectorConfig, patch: Partial<ConnectorConfig>) {
  return connectors.map((connector) => {
    if (connector.id !== target.id) return connector;
    const next = { ...connector, ...patch };
    if (patch.fileTypeFilter && !patch.fileTypeFilter.extensions.length) {
      next.fileTypeFilter = undefined;
    }
    return next;
  });
}

function upsertConnectorState(connectors: ConnectorConfig[], connector: ConnectorConfig) {
  return connectors.some((item) => item.id === connector.id)
    ? connectors.map((item) => (item.id === connector.id ? connector : item))
    : [...connectors, connector];
}

function togglePath(paths: WatchPath[], target: WatchPath, key: keyof WatchPath) {
  return paths.map((path) =>
    path.id === target.id ? { ...path, [key]: !path[key] } : path,
  ) as WatchPath[];
}

function updatePath(paths: WatchPath[], target: WatchPath, patch: Partial<WatchPath>) {
  return paths.map((path) => {
    if (path.id !== target.id) return path;
    const next = { ...path, ...patch };
    if (patch.fileTypeFilter && !patch.fileTypeFilter.extensions.length) {
      next.fileTypeFilter = undefined;
    }
    return next;
  });
}

function parseExtensions(value: string) {
  return Array.from(
    new Set(
      value
        .split(/[,\s]+/)
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean)
        .map((item) => (item.startsWith(".") ? item : `.${item}`)),
    ),
  );
}

function friendlyVisionMark(id: string, fallback: string) {
  if (id.toLowerCase().includes("clip")) return "Fo";
  if (id.toLowerCase().includes("siglip")) return "Sc";
  if (id.toLowerCase().includes("dino")) return "De";
  return fallback.slice(0, 2);
}

function friendlyVisionModelLabel(id: string, fallback: string) {
  const lower = id.toLowerCase();
  if (lower.includes("clip")) return "Foto simili";
  if (lower.includes("siglip")) return "Scene e oggetti";
  if (lower.includes("dino")) return "Dettagli visivi";
  return fallback;
}

function friendlyVisionModelPurpose(id: string, fallback: string) {
  const lower = id.toLowerCase();
  if (lower.includes("clip")) return "Aiuta a trovare immagini collegate alle parole.";
  if (lower.includes("siglip")) return "Aiuta a riconoscere cose, loghi e scene.";
  if (lower.includes("dino")) return "Aiuta sui dettagli di disegni, schemi e pagine.";
  return fallback;
}

function friendlyComponentLabel(id: string, fallback: string) {
  const names: Record<string, string> = {
    "desktop-runtime": "App desktop",
    tika: "Lettura documenti",
    typesense: "Ricerca veloce",
    "text-embeddings": "Domande sui file",
    ffmpeg: "Video",
    ffprobe: "Dettagli video",
    poppler: "Anteprime PDF",
    "vision-fingerprint": "Ricerca per immagini",
    "vision-neural": "Somiglianza foto",
    tesseract: "Testo nelle immagini",
    whisper: "Parole in audio e video",
    rclone: "Archivi esterni",
    docker: "Servizi locali",
  };
  return names[id] ?? fallback;
}

function friendlyComponentCategory(category: string) {
  const lower = category.toLowerCase();
  if (lower.includes("document")) return "File";
  if (lower.includes("indice") || lower.includes("semant")) return "Ricerca";
  if (lower.includes("media") || lower.includes("vision") || lower.includes("audio")) return "Foto e video";
  if (lower.includes("remote")) return "Archivi";
  if (lower.includes("servizi")) return "Servizi";
  return category || "App";
}

function friendlyComponentDescription(id: string, fallback: string) {
  const text: Record<string, string> = {
    "desktop-runtime": "Fa partire Trova come app desktop con i dati sul tuo PC.",
    tika: "Legge PDF, Word, presentazioni e altri documenti.",
    typesense: "Rende la ricerca veloce e tollerante agli errori di battitura.",
    "text-embeddings": "Aiuta a trovare file simili e a fare domande sui documenti.",
    ffmpeg: "Prepara audio e video per anteprime e scene.",
    ffprobe: "Legge informazioni utili dai video.",
    poppler: "Crea anteprime precise delle pagine PDF.",
    "vision-fingerprint": "Permette la ricerca per immagini anche senza cloud.",
    "vision-neural": "Migliora la somiglianza tra foto, schemi e pagine.",
    tesseract: "Legge il testo dentro immagini e scansioni.",
    whisper: "Trascrive parole in audio e video sul dispositivo.",
    rclone: "Collega dischi di rete e cloud copiandoli prima sul PC.",
    docker: "Avvia servizi locali quando il sistema lo consente.",
  };
  return text[id] ?? fallback;
}

function simpleMediaUiMessage(status: LocalVisionStatus | null) {
  const total = status?.totalAssets ?? 0;
  if (!total) return "Pronte quando aggiungi immagini o video";
  return `${status?.embeddedAssets ?? 0}/${total} elementi pronti`;
}

function componentSummary(components: LocalComponent[]) {
  if (!components.length) return "Non ho ancora controllato cosa serve.";
  const required = components.filter((item) => item.required);
  const requiredReady = required.filter((item) => item.installed).length;
  const optionalMissing = components.filter((item) => !item.required && !item.installed).length;
  const missingRequired = required.length - requiredReady;
  if (missingRequired > 0) {
    return `${requiredReady}/${required.length} parti pronte. Ne sistemo ${missingRequired} quando premi Prepara tutto. Facoltative: ${optionalMissing}.`;
  }
  return `${requiredReady}/${required.length} parti pronte. Facoltative da attivare: ${optionalMissing}.`;
}

function remoteSummary(connectors: ConnectorConfig[], rclone: RcloneStatus | null) {
  const active = connectors.filter((item) => item.enabled).length;
  const synced = connectors.filter((item) => item.lastSyncAt && !item.lastSyncError).length;
  const errors = connectors.filter((item) => item.lastSyncError).length;
  const readyLine = rclone?.installed ? "Archivi esterni pronti" : "Archivi esterni da preparare";
  return `${readyLine}. ${active}/${connectors.length} attivi, ${synced} aggiornati, ${errors} con errore.`;
}

function reorderByIds(results: IndexedFile[], orderedIds: string[]) {
  const byId = new Map(results.map((item) => [item.id, item]));
  const used = new Set<string>();
  const ordered = orderedIds.flatMap((id) => {
    const item = byId.get(id);
    if (!item || used.has(id)) return [];
    used.add(id);
    return [item];
  });
  return [...ordered, ...results.filter((item) => !used.has(item.id))];
}

function readUploadedGeminiKeys() {
  try {
    return new Set<string>(JSON.parse(window.localStorage.getItem("trova.geminiUploaded") ?? "[]"));
  } catch {
    return new Set<string>();
  }
}

function geminiCandidateKey(candidate: GeminiCandidate) {
  return `${candidate.path}:${candidate.size}:${candidate.modified ?? 0}`;
}

function fileFromBase64(name: string, mimeType: string, base64: string) {
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new File([bytes], name, { type: mimeType });
}

async function imageFingerprintEmbedding(dataUrl: string) {
  const image = await loadImage(dataUrl);
  const canvas = document.createElement("canvas");
  canvas.width = 8;
  canvas.height = 8;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return [];
  context.drawImage(image, 0, 0, 8, 8);
  const pixels = context.getImageData(0, 0, 8, 8).data;
  const vector: number[] = [];
  const totals = [0, 0, 0];
  for (let index = 0; index < pixels.length; index += 4) {
    const r = pixels[index] / 255;
    const g = pixels[index + 1] / 255;
    const b = pixels[index + 2] / 255;
    vector.push(r, g, b);
    totals[0] += r;
    totals[1] += g;
    totals[2] += b;
  }
  vector.push(totals[0] / 64, totals[1] / 64, totals[2] / 64);
  return normalizeVector(vector);
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}

function normalizeVector(values: number[]) {
  const norm = Math.sqrt(values.reduce((total, value) => total + value * value, 0));
  return norm ? values.map((value) => value / norm) : values;
}

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

type UiSoundKind = "open" | "select" | "confirm" | "close" | "error";
let uiAudioContext: AudioContext | null = null;

function playUiSound(kind: UiSoundKind) {
  const AudioCtor = (window as Window & { webkitAudioContext?: typeof AudioContext }).AudioContext ||
    (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtor) return;
  try {
    uiAudioContext ||= new AudioCtor();
    const context = uiAudioContext;
    if (context.state === "suspended") void context.resume();
    const now = context.currentTime;
    const profile = {
      open: [520, 720, 0.035],
      select: [660, 880, 0.03],
      confirm: [620, 980, 0.045],
      close: [420, 320, 0.025],
      error: [180, 130, 0.05],
    }[kind];
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = kind === "error" ? "sawtooth" : "sine";
    oscillator.frequency.setValueAtTime(profile[0], now);
    oscillator.frequency.exponentialRampToValueAtTime(profile[1], now + 0.12);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(profile[2], now + 0.018);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.18);
  } catch {
    // Audio feedback is decorative; the UI must keep working if the browser blocks it.
  }
}

async function safeInvoke<T>(command: string, args: Record<string, unknown>, fallback: T): Promise<T> {
  try {
    return await tauriInvoke<T>(command, args);
  } catch {
    return fallback;
  }
}

// Comandi gestiti SOLO da Rust (hotkey globale, finestra spotlight): non passano
// dal backend HTTP. In modalita web (no Tauri) ritornano il fallback senza errori 500.
async function desktopInvoke<T>(command: string, args: Record<string, unknown>, fallback: T): Promise<T> {
  if (!hasTauriBackend()) return fallback;
  try {
    return await tauriInvokeRaw<T>(command, args);
  } catch {
    return fallback;
  }
}

let desktopLocalApiBoot: Promise<LocalApiBootStatus | null> | null = null;

async function tauriInvoke<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
  if (!hasTauriBackend()) {
    return localApiInvoke<T>(command, args);
  }
  try {
    return await localApiInvoke<T>(command, args);
  } catch (firstErr) {
    const localApi = await Promise.race([
      ensureDesktopLocalApi(),
      delay(2200).then(() => null),
    ]);
    if (localApi?.ok) {
      try {
        return await localApiInvoke<T>(command, args);
      } catch (secondErr) {
        console.warn("Local API non disponibile, provo backend Tauri legacy", secondErr);
      }
    } else {
      console.warn("Local API non disponibile, provo backend Tauri legacy", firstErr);
    }
  }
  return tauriInvokeRaw<T>(command, args);
}

function hasTauriBackend() {
  return Boolean((window as Window & { __TAURI_INTERNALS__?: { invoke?: unknown } }).__TAURI_INTERNALS__?.invoke);
}

async function ensureDesktopLocalApi() {
  if (!hasTauriBackend()) return null;
  if (!desktopLocalApiBoot) {
    desktopLocalApiBoot = tauriInvokeRaw<LocalApiBootStatus>("ensure_local_api", {})
      .catch((err) => {
        console.warn("Avvio API locale desktop non riuscito", err);
        return null;
      });
  }
  return desktopLocalApiBoot;
}

async function localApiInvoke<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
  const response = await fetch("http://127.0.0.1:17654/api/command", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ command, args }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.error ?? "Backend locale non disponibile. Avvia npm run local-api.");
  }
  return payload.result as T;
}

function iconFor(item: IndexedFile): GeneratedIconName {
  if (item.kind === "image") return "image";
  if (item.kind === "audio") return "audio";
  if (item.kind === "video") return "video";
  if (item.kind === "code") return "code";
  if (item.extension === "pdf") return "document";
  return "text";
}

function sourceLabelForResult(item: IndexedFile) {
  if (item.source === "gemini") return "Online";
  if (item.sourceType === "remote") return "Archivio esterno";
  return "Sul PC";
}

function matchLabel(matchType?: IndexedFile["matchType"]) {
  if (matchType === "semantic") return "Significato";
  if (matchType === "fuzzy") return "Parola simile";
  if (matchType === "visual") return "Immagine";
  if (matchType === "person") return "Persona";
  if (matchType === "metadata") return "Dettagli file";
  return "Testo";
}

function iconForPath(path: string): GeneratedIconName {
  const lower = path.toLowerCase();
  if (lower.includes("download")) return "archive";
  if (lower.includes("image") || lower.includes("picture") || lower.includes("foto")) return "image";
  if (lower.includes("music") || lower.includes("musica")) return "audio";
  if (lower.includes("video")) return "video";
  if (lower.includes("archive") || lower.includes("archivio")) return "archive";
  if (lower.includes("desktop")) return "database";
  return "folder";
}

function displayPathName(path: string) {
  return path.split(/[\\/]/).filter(Boolean).pop() || path;
}

function highlight(text: string, query: string) {
  const term = query.trim().split(/\s+/)[0];
  if (!term) return escapeHtml(text);
  const safe = escapeHtml(text);
  return safe.replace(new RegExp(`(${escapeRegExp(term)})`, "gi"), "<mark>$1</mark>");
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function shortError(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return message.length > 86 ? `${message.slice(0, 83)}...` : message;
}

function shortModelName(model: string) {
  return model.split("/").pop()?.replaceAll("-", " ") ?? model;
}

function formatDate(timestamp?: number) {
  if (!timestamp) return "Data non disponibile";
  return new Intl.DateTimeFormat("it-IT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(timestamp * 1000));
}

function formatSize(size: number) {
  if (!size) return "0 B";
  if (size > 1_000_000_000) return `${(size / 1_000_000_000).toFixed(1).replace(".", ",")} GB`;
  if (size > 1_000_000) return `${(size / 1_000_000).toFixed(1).replace(".", ",")} MB`;
  if (size > 1_000) return `${(size / 1_000).toFixed(1).replace(".", ",")} KB`;
  return `${size} B`;
}

function formatTimestamp(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safe / 60);
  const rest = String(safe % 60).padStart(2, "0");
  return `${minutes}:${rest}`;
}

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function hashCode(value: string) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}

// Casella di ricerca spotlight: minimale, centrata, sempre in primo piano.
// Cerca via backend e mostra i top risultati; Invio sul primo apre il file. Esc chiude.
function SpotlightSearch() {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<IndexedFile[]>([]);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", window.localStorage.getItem("trova.theme") === "dark");
    inputRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") void desktopInvoke("hide_spotlight_window", {}, null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const text = q.trim();
    if (!text) { setResults([]); return; }
    let cancelled = false;
    setBusy(true);
    const timer = window.setTimeout(async () => {
      const hits = await safeInvoke<IndexedFile[]>("search_index", {
        request: { textQuery: text, filters: ["all"], useLocal: true, semantic: true, fuzzy: true, limit: 8, includeSnippets: true },
      }, []);
      if (!cancelled) { setResults(hits || []); setBusy(false); }
    }, 220);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [q]);

  const openFile = (item: IndexedFile) => {
    try {
      const current = readRecentFiles();
      const next = [item, ...current.filter((recent) => recent.path !== item.path)].slice(0, 12);
      window.localStorage.setItem(RECENT_FILES_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
    void safeInvoke("open_in_folder", { path: item.path }, null);
    void desktopInvoke("hide_spotlight_window", {}, null);
  };

  return (
    <div className="spotlight-shell">
      <div className="spotlight-box">
        <GeneratedIcon name="search" size={24} />
        <input
          ref={inputRef}
          value={q}
          onChange={(event) => setQ(event.currentTarget.value)}
          onKeyDown={(event) => { if (event.key === "Enter" && results[0]) openFile(results[0]); }}
          placeholder="Cerca al volo nei tuoi file..."
        />
        {busy && <span className="spotlight-spinner" />}
      </div>
      {results.length > 0 && (
        <div className="spotlight-results">
          {results.map((item) => (
            <button key={item.id} type="button" className="spotlight-result" onClick={() => openFile(item)}>
              <GeneratedIcon name={iconFor(item)} size={18} />
              <span className="spotlight-result-name">{item.name}</span>
              <span className="spotlight-result-path">{item.path}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

type TrovaGlobal = typeof globalThis & {
  __trovaReactRoot?: ReturnType<typeof ReactDOM.createRoot>;
};

const trovaGlobal = globalThis as TrovaGlobal;
const rootElement = document.getElementById("root")!;
const root = trovaGlobal.__trovaReactRoot ?? ReactDOM.createRoot(rootElement);
trovaGlobal.__trovaReactRoot = root;

// Modalita spotlight: finestra leggera con solo la casella di ricerca al centro
const isSpotlight = new URLSearchParams(window.location.search).has("spotlight");

root.render(
  <React.StrictMode>
    {isSpotlight ? <SpotlightSearch /> : <App />}
  </React.StrictMode>,
);
