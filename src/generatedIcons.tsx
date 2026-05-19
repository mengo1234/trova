import iconArchive from "./assets/icons/generated/icon-archive.png";
import iconAudio from "./assets/icons/generated/icon-audio.png";
import iconCloud from "./assets/icons/generated/icon-cloud.png";
import iconCode from "./assets/icons/generated/icon-code.png";
import iconDatabase from "./assets/icons/generated/icon-database.png";
import iconDocumentStack from "./assets/icons/generated/icon-document-stack.png";
import iconFolder from "./assets/icons/generated/icon-folder.png";
import iconImage from "./assets/icons/generated/icon-image.png";
import iconRemote from "./assets/icons/generated/icon-remote.png";
import iconSearch from "./assets/icons/generated/icon-search.png";
import iconSemantic from "./assets/icons/generated/icon-semantic.png";
import iconSettings from "./assets/icons/generated/icon-settings.png";
import iconShield from "./assets/icons/generated/icon-shield.png";
import iconSparkle from "./assets/icons/generated/icon-sparkle.png";
import iconSync from "./assets/icons/generated/icon-sync.png";
import iconText from "./assets/icons/generated/icon-text.png";
import iconTools from "./assets/icons/generated/icon-tools.png";
import iconVideo from "./assets/icons/generated/icon-video.png";
import iconVision from "./assets/icons/generated/icon-vision.png";
import iconWatcher from "./assets/icons/generated/icon-watcher.png";
import tutorialButtonDownload from "./assets/icons/generated/tutorial-button-download.png";
import tutorialButtonFinish from "./assets/icons/generated/tutorial-button-finish.png";
import tutorialButtonIndex from "./assets/icons/generated/tutorial-button-index.png";
import tutorialButtonOpenFolder from "./assets/icons/generated/tutorial-button-open-folder.png";
import tutorialCloudToggle from "./assets/icons/generated/tutorial-cloud-toggle.png";
import tutorialControlIndex from "./assets/icons/generated/tutorial-control-index.png";
import tutorialControlModelDownloads from "./assets/icons/generated/tutorial-control-model-downloads.png";
import tutorialControlPreview from "./assets/icons/generated/tutorial-control-preview.png";
import tutorialControlPrivacy from "./assets/icons/generated/tutorial-control-privacy.png";
import tutorialModelCard from "./assets/icons/generated/tutorial-model-card.png";
import tutorialProgressDots from "./assets/icons/generated/tutorial-progress-dots.png";
import tutorialProgressMeter from "./assets/icons/generated/tutorial-progress-meter.png";

export const generatedIconAssets = {
  archive: iconArchive,
  audio: iconAudio,
  cloud: iconCloud,
  code: iconCode,
  database: iconDatabase,
  document: iconDocumentStack,
  folder: iconFolder,
  image: iconImage,
  remote: iconRemote,
  search: iconSearch,
  semantic: iconSemantic,
  settings: iconSettings,
  shield: iconShield,
  sparkle: iconSparkle,
  sync: iconSync,
  text: iconText,
  tools: iconTools,
  video: iconVideo,
  vision: iconVision,
  watcher: iconWatcher,
} as const;

export type GeneratedIconName = keyof typeof generatedIconAssets;

export const generatedTutorialAssets = {
  buttonDownload: tutorialButtonDownload,
  buttonFinish: tutorialButtonFinish,
  buttonIndex: tutorialButtonIndex,
  buttonOpenFolder: tutorialButtonOpenFolder,
  cloudToggle: tutorialCloudToggle,
  controlIndex: tutorialControlIndex,
  controlModelDownloads: tutorialControlModelDownloads,
  controlPreview: tutorialControlPreview,
  controlPrivacy: tutorialControlPrivacy,
  modelCard: tutorialModelCard,
  progressDots: tutorialProgressDots,
  progressMeter: tutorialProgressMeter,
} as const;

export type GeneratedTutorialAssetName = keyof typeof generatedTutorialAssets;

export function GeneratedIcon({
  name,
  size = 18,
  className = "",
}: {
  name: GeneratedIconName;
  size?: number;
  className?: string;
}) {
  return (
    <img
      className={`generated-icon ${className}`.trim()}
      src={generatedIconAssets[name]}
      alt=""
      aria-hidden="true"
      decoding="async"
      draggable={false}
      style={{ width: size, height: size }}
    />
  );
}

export function GeneratedTutorialAsset({
  name,
  className = "",
}: {
  name: GeneratedTutorialAssetName;
  className?: string;
}) {
  return (
    <img
      className={`generated-tutorial-asset ${className}`.trim()}
      src={generatedTutorialAssets[name]}
      alt=""
      aria-hidden="true"
    />
  );
}
