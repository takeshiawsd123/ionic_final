import { registerPlugin } from '@capacitor/core';

export interface MediaStoreAudioFile {
  id: string;
  uri: string;
  name: string;
  title?: string;
  artist?: string;
  album?: string;
  durationMs?: number;
  size?: number;
  dateModified?: number;
  year?: number;
  trackNumber?: number;
  mimeType?: string;
}

export interface MediaStorePermissionResult {
  granted: boolean;
}

export interface MediaStoreAudioFilesResult {
  files: MediaStoreAudioFile[];
}

export interface MediaStoreArtworkResult {
  artwork?: string;
}

export interface MediaStoreFolder {
  uri: string;
  name?: string;
}

export interface MediaStoreFileActionResult {
  deleted?: boolean;
  renamed?: boolean;
  uri?: string;
  name?: string;
}

export interface MediaStoreScannerPlugin {
  checkPermissions(): Promise<MediaStorePermissionResult>;
  requestPermissions(): Promise<MediaStorePermissionResult>;
  getAudioFiles(options?: { modifiedAfter?: number }): Promise<MediaStoreAudioFilesResult>;
  getArtwork(options: { uri: string }): Promise<MediaStoreArtworkResult>;
  pickFolder(): Promise<MediaStoreFolder | null>;
  getSavedFolder(): Promise<MediaStoreFolder | null>;
  clearFolder(): Promise<void>;
  getFolderAudioFiles(options?: { uri?: string }): Promise<MediaStoreAudioFilesResult>;
  getManifestUrl(): Promise<string | null>;
  setManifestUrl(url: string | null): Promise<void>;
  deleteFile(options: { uri: string }): Promise<MediaStoreFileActionResult>;
  renameFile(options: { uri: string; name: string }): Promise<MediaStoreFileActionResult>;
}

const MediaStoreScanner = registerPlugin<MediaStoreScannerPlugin>('MediaStoreScanner', {
  web: () => import('./media-store-scanner.web').then((m) => new m.MediaStoreScannerWeb()),
});

export default MediaStoreScanner;
