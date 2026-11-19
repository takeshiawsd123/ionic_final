import type {
  MediaStoreArtworkResult,
  MediaStoreAudioFile,
  MediaStoreAudioFilesResult,
  MediaStoreFileActionResult,
  MediaStoreFolder,
  MediaStorePermissionResult,
  MediaStoreScannerPlugin,
} from './media-store-scanner';

interface ManifestFile {
  id?: string;
  uri: string;
  name?: string;
  title?: string;
  artist?: string;
  album?: string;
  durationMs?: number;
  size?: number;
  dateModified?: number;
}

const MANIFEST_URL_KEY = 'mp_manifest_url';
const FRAME_SIZE = 417;
const FRAME_COUNT = 96;

function silentMp3DataUrl(): string {
  const bytes = new Uint8Array(FRAME_SIZE * FRAME_COUNT);
  for (let i = 0; i < FRAME_COUNT; i++) {
    const offset = i * FRAME_SIZE;
    bytes[offset] = 0xff;
    bytes[offset + 1] = 0xfb;
    bytes[offset + 2] = 0x90;
    bytes[offset + 3] = 0x64;
  }
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `data:audio/mpeg;base64,${btoa(binary)}`;
}

function demoFiles(): MediaStoreAudioFile[] {
  const uri = silentMp3DataUrl();
  const size = FRAME_SIZE * FRAME_COUNT;
  return [
    {
      id: 'demo-1',
      uri,
      name: 'Demo Track 1.mp3',
      title: 'Demo Track 1',
      artist: 'Sample Artist',
      album: 'Web Demo',
      durationMs: 2000,
      size,
      dateModified: 1,
      mimeType: 'audio/mpeg',
    },
    {
      id: 'demo-2',
      uri,
      name: 'Demo Track 2.mp3',
      title: 'Demo Track 2',
      artist: 'Sample Artist',
      album: 'Web Demo',
      durationMs: 2000,
      size,
      dateModified: 2,
      mimeType: 'audio/mpeg',
    },
    {
      id: 'demo-3',
      uri,
      name: 'Demo Track 3.mp3',
      title: 'Demo Track 3',
      artist: 'Another Artist',
      album: 'Web Demo',
      durationMs: 2000,
      size,
      dateModified: 3,
      mimeType: 'audio/mpeg',
    },
  ];
}

function absoluteUri(uri: string, base: string = document.baseURI): string {
  if (/^(data:|content:|https?:|blob:)/i.test(uri)) return uri;
  return new URL(uri, base).href;
}

export class MediaStoreScannerWeb implements MediaStoreScannerPlugin {
  async checkPermissions(): Promise<MediaStorePermissionResult> {
    return { granted: true };
  }

  async requestPermissions(): Promise<MediaStorePermissionResult> {
    return { granted: true };
  }

  async getAudioFiles(): Promise<MediaStoreAudioFilesResult> {
    const configuredUrl = await this.getManifestUrl();
    const manifestUrl = absoluteUri(configuredUrl ?? 'assets/auto-scan-manifest.json');
    try {
      const response = await fetch(manifestUrl, { cache: 'no-store' });
      if (response.ok) {
        const data = (await response.json()) as { files?: ManifestFile[] };
        const files = data.files ?? [];
        if (files.length > 0) {
          return {
            files: files.map((file, index) => ({
              id: file.id ?? `web-${index}`,
              uri: absoluteUri(file.uri, manifestUrl),
              name: file.name ?? file.uri.split('/').pop() ?? `Track ${index + 1}.mp3`,
              title: file.title,
              artist: file.artist,
              album: file.album,
              durationMs: file.durationMs,
              size: file.size,
              dateModified: file.dateModified,
              mimeType: 'audio/mpeg',
            })),
          };
        }
      }
    } catch {
    }
    return { files: configuredUrl ? [] : demoFiles() };
  }

  async getArtwork(): Promise<MediaStoreArtworkResult> {
    return {};
  }

  async pickFolder(): Promise<MediaStoreFolder | null> {
    return null;
  }

  async getSavedFolder(): Promise<MediaStoreFolder | null> {
    return null;
  }

  async clearFolder(): Promise<void> {}

  async getFolderAudioFiles(): Promise<MediaStoreAudioFilesResult> {
    return { files: [] };
  }

  async getManifestUrl(): Promise<string | null> {
    const params = new URLSearchParams(window.location.search);
    const fromQuery = params.get('manifest');
    if (fromQuery) {
      localStorage.setItem(MANIFEST_URL_KEY, fromQuery);
      return fromQuery;
    }
    return localStorage.getItem(MANIFEST_URL_KEY);
  }

  async setManifestUrl(url: string | null): Promise<void> {
    if (url) localStorage.setItem(MANIFEST_URL_KEY, url);
    else localStorage.removeItem(MANIFEST_URL_KEY);
  }

  async deleteFile(): Promise<MediaStoreFileActionResult> {
    return { deleted: false };
  }

  async renameFile(): Promise<MediaStoreFileActionResult> {
    return { renamed: false };
  }
}
