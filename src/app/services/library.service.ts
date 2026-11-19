import { inject, Injectable, NgZone } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { Capacitor } from '@capacitor/core';
import { Track } from '../models/track.model';
import MediaStoreScanner from '../plugins/media-store-scanner';

const DB_NAME = 'music-player-lib';
const DB_VERSION = 3;
const STORE_TRACKS = 'tracks';
const STORE_HANDLE = 'handle';
const STORE_PLAYLISTS = 'playlists';
const STORE_DOWNLOADS = 'downloads';
const STORE_PENDING = 'pendingOps';

@Injectable({ providedIn: 'root' })
export class LibraryService {
  private zone = inject(NgZone);
  private tracksSubject = new BehaviorSubject<Track[]>([]);
  readonly tracks$: Observable<Track[]> = this.tracksSubject.asObservable();

  private scanningSubject = new BehaviorSubject<boolean>(false);
  readonly scanning$: Observable<boolean> = this.scanningSubject.asObservable();

  private restoredSubject = new BehaviorSubject<boolean>(false);
  readonly restored$: Observable<boolean> = this.restoredSubject.asObservable();

  private needsFolderPermissionSubject = new BehaviorSubject<boolean>(false);
  readonly needsFolderPermission$: Observable<boolean> = this.needsFolderPermissionSubject.asObservable();

  private db: IDBDatabase | null = null;
  private scanPromise: Promise<void> | null = null;
  private autoScanStarted = false;

  constructor() {
    if (typeof indexedDB !== 'undefined') {
      this.initDb()
        .then(() => this.restoreLibrary())
        .then(() => this.autoScanIfNeeded())
        .catch((error) => {
          console.warn('Library initialization failed', error);
          this.restoredSubject.next(true);
        });
    } else {
      this.autoScanIfNeeded()
        .catch((error) => console.warn('Auto-scan failed', error))
        .then(() => this.restoredSubject.next(true));
    }
  }

  get isNativeAndroid(): boolean {
    return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
  }

  get tracks(): Track[] {
    return this.tracksSubject.value;
  }

  private async initDb(): Promise<void> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_TRACKS)) {
          db.createObjectStore(STORE_TRACKS, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(STORE_HANDLE)) {
          db.createObjectStore(STORE_HANDLE, { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains(STORE_PLAYLISTS)) {
          db.createObjectStore(STORE_PLAYLISTS, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(STORE_DOWNLOADS)) {
          db.createObjectStore(STORE_DOWNLOADS, { keyPath: 'trackId' });
        }
        if (!db.objectStoreNames.contains(STORE_PENDING)) {
          db.createObjectStore(STORE_PENDING, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => {
        this.db = req.result;
        resolve();
      };
      req.onerror = () => reject(req.error);
    });
  }

  private async restoreLibrary(): Promise<void> {
    if (!this.db) return;
    const records = await this.getAllRecords();
    const tracks: Track[] = [];
    for (const rec of records) {
      try {
        const blob = rec.blob as Blob | undefined;
        const isUriTrack = rec.origin === 'mediastore' && !!rec.sourceUri;
        const url = isUriTrack ? Capacitor.convertFileSrc(rec.sourceUri as string) : URL.createObjectURL(blob as Blob);
        tracks.push({
          id: rec.id,
          title: rec.title,
          artist: rec.artist,
          album: rec.album,
          duration: rec.duration,
          url,
          blob,
          artwork: rec.artwork,
          genre: rec.genre,
          year: rec.year,
          trackNumber: rec.trackNumber,
          mimeType: rec.mimeType,
          size: rec.size,
          dateModified: rec.dateModified,
          sourceUri: rec.sourceUri,
          origin: rec.origin,
          addedAt: rec.addedAt,
        });
      } catch (e) {
        // skip broken record
      }
    }
    this.zone.run(() => this.tracksSubject.next(tracks));
    this.restoredSubject.next(true);

    // Try to restore directory handle and rescan if permission granted
    const handle = await this.getStoredHandle();
    if (handle) {
      await this.tryAutoScanHandle(handle as FileSystemDirectoryHandle);
    }
  }
  private async getAllRecords(): Promise<any[]> {
    if (!this.db) return [];
    return new Promise((resolve) => {
      const tx = this.db!.transaction(STORE_TRACKS, 'readonly');
      const store = tx.objectStore(STORE_TRACKS);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
  }

  private async getStoredHandle(): Promise<FileSystemDirectoryHandle | null> {
    if (!this.db) return null;
    return new Promise((resolve) => {
      const tx = this.db!.transaction(STORE_HANDLE, 'readonly');
      const store = tx.objectStore(STORE_HANDLE);
      const req = store.get('dir');
      req.onsuccess = () => resolve(req.result ? req.result.handle : null);
      req.onerror = () => resolve(null);
    });
  }

  private async saveHandle(handle: FileSystemDirectoryHandle): Promise<void> {
    if (!this.db) return;
    return new Promise((resolve) => {
      const tx = this.db!.transaction(STORE_HANDLE, 'readwrite');
      const store = tx.objectStore(STORE_HANDLE);
      store.put({ key: 'dir', handle });
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  }

  async pickFolder(): Promise<void> {
    if (this.isNativeAndroid) {
      await MediaStoreScanner.pickFolder();
      await this.scanDeviceForAudio();
      return;
    }
    const w = window as any;
    if (!w.showDirectoryPicker) {
      await this.scanDeviceForAudio();
      return;
    }
    try {
      const handle = await w.showDirectoryPicker({ mode: 'read' });
      await this.saveHandle(handle);
      this.zone.run(() => this.needsFolderPermissionSubject.next(false));
      await this.scanDirectory(handle, false);
    } catch (e) {
      // user cancelled or error
    }
  }

  async scanDirectory(handle: FileSystemDirectoryHandle, replace = false): Promise<void> {
    this.scanningSubject.next(true);
    const files: File[] = [];
    await this.collectAudioFiles(handle, files);
    await this.addFiles(files, replace);
    this.scanningSubject.next(false);
  }

  private async collectAudioFiles(dir: FileSystemDirectoryHandle, out: File[]): Promise<void> {
    // @ts-ignore
    for await (const entry of dir.values()) {
      if (entry.kind === 'file') {
        const file = await entry.getFile();
        if (this.isAudioFile(file)) out.push(file);
      } else if (entry.kind === 'directory') {
        await this.collectAudioFiles(entry as FileSystemDirectoryHandle, out);
      }
    }
  }

  private isAudioFile(file: File): boolean {
    const ext = file.name.toLowerCase().split('.').pop() || '';
    if (ext === 'mp3') return true;
    const type = (file.type || '').toLowerCase();
    return type === 'audio/mpeg' || type === 'audio/mp3';
  }

  private async tryAutoScanHandle(handle: FileSystemDirectoryHandle): Promise<void> {
    try {
      const h: any = handle as any;
      if (typeof h.queryPermission === 'function') {
        const perm = await h.queryPermission({ mode: 'read' });
        if (perm === 'granted') {
          this.zone.run(() => this.needsFolderPermissionSubject.next(false));
          await this.scanDirectory(handle, false);
          return;
        }
      }
      this.zone.run(() => this.needsFolderPermissionSubject.next(true));
    } catch (e) {
      this.zone.run(() => this.needsFolderPermissionSubject.next(true));
    }
  }

  async rescanSavedFolder(): Promise<void> {
    if (this.isNativeAndroid) {
      await this.scanDeviceForAudio();
      return;
    }
    const handle = await this.getStoredHandle();
    if (!handle) {
      await this.scanDeviceForAudio();
      return;
    }
    try {
      const h: any = handle as any;
      let perm = 'prompt';
      if (typeof h.queryPermission === 'function') {
        perm = await h.queryPermission({ mode: 'read' });
      }
      if (perm !== 'granted' && typeof h.requestPermission === 'function') {
        perm = await h.requestPermission({ mode: 'read' });
      }
      if (perm === 'granted') {
        this.zone.run(() => this.needsFolderPermissionSubject.next(false));
        await this.scanDirectory(handle as FileSystemDirectoryHandle, false);
      } else {
        this.zone.run(() => this.needsFolderPermissionSubject.next(true));
      }
    } catch (e) {
      this.zone.run(() => this.needsFolderPermissionSubject.next(true));
    }
  }

  async tryAutoScanOnStart(): Promise<void> {
    const handle = await this.getStoredHandle();
    if (handle) {
      await this.tryAutoScanHandle(handle as FileSystemDirectoryHandle);
    }
  }

  get hasSavedFolder(): boolean {
    // best-effort; UI can also react to needsFolderPermission$
    return false;
  }
  async addFiles(files: File[] | FileList, replace = false): Promise<void> {
    const arr = Array.from(files as any) as File[];
    const audioFiles = arr.filter((f) => this.isAudioFile(f));
    if (audioFiles.length === 0) return;

    this.scanningSubject.next(true);
    const existing = replace ? [] : [...this.tracksSubject.value];
    const existingIds = new Set(existing.map((t) => t.id));
    const newTracks: Track[] = [];

    for (const file of audioFiles) {
      const id = this.makeId(file);
      if (existingIds.has(id)) continue;
      const track = await this.buildTrack(file, id);
      newTracks.push(track);
      existing.push(track);
      existingIds.add(id);
    }

    for (const t of newTracks) {
      await this.persistTrack(t);
    }

    this.zone.run(() => this.tracksSubject.next(existing));
    this.scanningSubject.next(false);
  }

  private makeId(file: File): string {
    return `${file.name}_${file.size}_${file.lastModified}`;
  }

  private async buildTrack(file: File, id: string): Promise<Track> {
    const url = URL.createObjectURL(file);
    const baseTitle = file.name.replace(/\.[^.]+$/, '');
    let title = baseTitle;
    let artist = 'Unknown Artist';
    let album = 'Unknown Album';
    let genre: string | undefined;
    let year: number | undefined;
    let trackNumber: number | undefined;
    let artwork: string | undefined;

    try {
      const meta = await this.readMetadata(file);
      if (meta) {
        title = meta.title || title;
        artist = meta.artist || artist;
        album = meta.album || album;
        genre = meta.genre;
        year = meta.year;
        trackNumber = meta.trackNumber;
        artwork = meta.artwork;
      }
    } catch (e) {
    }

    let duration = 0;
    try {
      duration = await this.getDuration(url);
    } catch (e) {
      duration = 0;
    }

    return {
      id,
      title,
      artist,
      album,
      duration,
      url,
      file,
      blob: file,
      artwork,
      genre,
      year,
      trackNumber,
      mimeType: file.type,
      size: file.size,
      addedAt: Date.now(),
    };
  }

  private readMetadata(file: File): Promise<any> {
    return new Promise((resolve) => {
      import('jsmediatags/dist/jsmediatags.min.js').then((mod: any) => {
        const reader = mod.default || mod;
        reader.read(file, {
          onSuccess: (tag: any) => {
            const t = tag.tags || {};
            let artwork: string | undefined;
            if (t.picture) {
              const pic = t.picture;
              const data = pic.data;
              let base64 = '';
              for (let i = 0; i < data.length; i++) {
                base64 += String.fromCharCode(data[i]);
              }
              artwork = `data:${pic.format};base64,${btoa(base64)}`;
            }
            resolve({
              title: t.title,
              artist: t.artist,
              album: t.album,
              genre: t.genre,
              year: t.year ? parseInt(t.year, 10) : undefined,
              trackNumber: t.track ? parseInt(String(t.track).split('/')[0], 10) : undefined,
              artwork,
            });
          },
          onError: () => resolve(null),
        });
      }).catch(() => resolve(null));
    });
  }

  private getDuration(url: string): Promise<number> {
    return new Promise((resolve) => {
      const a = new Audio();
      a.preload = 'metadata';
      a.src = url;
      const cleanup = () => {
        a.removeAttribute('src');
        a.load();
      };
      a.addEventListener('loadedmetadata', () => {
        const d = isFinite(a.duration) ? a.duration : 0;
        cleanup();
        resolve(d);
      });
      a.addEventListener('error', () => {
        cleanup();
        resolve(0);
      });
      setTimeout(() => {
        cleanup();
        resolve(0);
      }, 8000);
    });
  }

  private async persistTrack(track: Track): Promise<void> {
    if (!this.db) return;
    const isUriTrack = track.origin === 'mediastore' && !!track.sourceUri;
    if (!isUriTrack && !track.blob) return;
    const record: Record<string, unknown> = {
      id: track.id,
      title: track.title,
      artist: track.artist,
      album: track.album,
      duration: track.duration,
      artwork: track.artwork,
      genre: track.genre,
      year: track.year,
      trackNumber: track.trackNumber,
      mimeType: track.mimeType,
      size: track.size,
      dateModified: track.dateModified,
      sourceUri: track.sourceUri,
      origin: track.origin,
      addedAt: track.addedAt,
    };
    if (!isUriTrack) {
      record['blob'] = track.blob;
    }
    return new Promise((resolve) => {
      const tx = this.db!.transaction(STORE_TRACKS, 'readwrite');
      const store = tx.objectStore(STORE_TRACKS);
      store.put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  }

  async deleteTrack(track: Track): Promise<boolean> {
    if (track.sourceUri && this.isNativeAndroid) {
      const result = await MediaStoreScanner.deleteFile({ uri: track.sourceUri });
      if (!result.deleted) return false;
    }
    await this.removeTrack(track.id);
    return true;
  }

  async renameTrack(track: Track, name: string): Promise<Track | null> {
    const title = name.trim();
    if (!title) return null;
    let sourceUri = track.sourceUri;
    let savedName = title;
    if (track.sourceUri && this.isNativeAndroid) {
      const result = await MediaStoreScanner.renameFile({ uri: track.sourceUri, name: title });
      if (!result.renamed) return null;
      if (result.uri) sourceUri = result.uri;
      if (result.name) savedName = result.name;
    }
    const displayTitle = savedName.replace(/\.[^.]+$/, '') || title;
    await this.patchTrackRecord(track.id, { title: displayTitle, sourceUri });
    const updated: Track = {
      ...track,
      title: displayTitle,
      sourceUri,
      url: sourceUri && sourceUri !== track.sourceUri ? Capacitor.convertFileSrc(sourceUri) : track.url,
    };
    this.zone.run(() => this.tracksSubject.next(this.tracksSubject.value.map((t) => (t.id === track.id ? updated : t))));
    return updated;
  }

  private async getTrackRecord(id: string): Promise<any | null> {
    if (!this.db) return null;
    return new Promise((resolve) => {
      const tx = this.db!.transaction(STORE_TRACKS, 'readonly');
      const req = tx.objectStore(STORE_TRACKS).get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  }

  private async patchTrackRecord(id: string, patch: Record<string, unknown>): Promise<void> {
    const record = await this.getTrackRecord(id);
    if (!record || !this.db) return;
    return new Promise((resolve) => {
      const tx = this.db!.transaction(STORE_TRACKS, 'readwrite');
      tx.objectStore(STORE_TRACKS).put({ ...record, ...patch });
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  }

  async removeTrack(id: string): Promise<void> {
    const tracks = this.tracksSubject.value.filter((t) => t.id !== id);
    const removed = this.tracksSubject.value.find((t) => t.id === id);
    if (removed && !removed.sourceUri) {
      this.revokeObjectUrl(removed.url);
    }
    this.zone.run(() => this.tracksSubject.next(tracks));
    if (this.db) {
      await new Promise<void>((resolve) => {
        const tx = this.db!.transaction(STORE_TRACKS, 'readwrite');
        const store = tx.objectStore(STORE_TRACKS);
        store.delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
    }
  }

  private revokeObjectUrl(url: string): void {
    if (url.startsWith('blob:')) {
      URL.revokeObjectURL(url);
    }
  }

  async clearLibrary(): Promise<void> {
    for (const t of this.tracksSubject.value) {
      if (!t.sourceUri) {
        this.revokeObjectUrl(t.url);
      }
    }
    this.zone.run(() => this.tracksSubject.next([]));
    if (this.db) {
      await new Promise<void>((resolve) => {
        const tx = this.db!.transaction(STORE_TRACKS, 'readwrite');
        const store = tx.objectStore(STORE_TRACKS);
        store.clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
    }
    if (this.db) {
      await new Promise<void>((resolve) => {
        const tx = this.db!.transaction(STORE_HANDLE, 'readwrite');
        const store = tx.objectStore(STORE_HANDLE);
        store.clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
    }
    try {
      await MediaStoreScanner.clearFolder();
    } catch (e) {
    }
  }

  get canScanFolder(): boolean {
    return true;
  }

  getManifestUrl(): Promise<string | null> {
    return this.isNativeAndroid ? Promise.resolve(null) : MediaStoreScanner.getManifestUrl();
  }

  async setManifestUrl(url: string | null): Promise<void> {
    if (this.isNativeAndroid) return;
    await MediaStoreScanner.setManifestUrl(url);
    await this.scanDeviceForAudio();
  }

  async autoScanIfNeeded(): Promise<void> {
    if (this.autoScanStarted) return;
    this.autoScanStarted = true;
    await this.scanDeviceForAudio();
  }

  async scanDeviceForAudio(): Promise<void> {
    if (this.scanPromise) return this.scanPromise;
    this.scanPromise = this.runMediaStoreScan().finally(() => {
      this.scanPromise = null;
    });
    return this.scanPromise;
  }

  private async runMediaStoreScan(): Promise<void> {
    this.scanningSubject.next(true);
    try {
      let permission = await MediaStoreScanner.checkPermissions();
      if (!permission.granted) {
        permission = await MediaStoreScanner.requestPermissions();
      }
      this.zone.run(() => this.needsFolderPermissionSubject.next(!permission.granted));

      const mediaFiles = permission.granted ? (await MediaStoreScanner.getAudioFiles()).files : [];
      const folderFiles = (await MediaStoreScanner.getFolderAudioFiles()).files;
      const files = [...mediaFiles, ...folderFiles];
      const tracks = [...this.tracksSubject.value];
      let changed = false;

      for (const file of files) {
        const id = file.id.startsWith('saf_') ? file.id : `ms_${file.id}`;
        const index = tracks.findIndex((t) => t.id === id);
        const previous = index >= 0 ? tracks[index] : undefined;
        if (
          previous &&
          (previous.dateModified ?? 0) === (file.dateModified ?? 0) &&
          (previous.size ?? 0) === (file.size ?? 0)
        ) {
          continue;
        }

        const track: Track = {
          id,
          title: file.title || file.name.replace(/\.[^.]+$/, ''),
          artist: file.artist || 'Unknown Artist',
          album: file.album || 'Unknown Album',
          duration: file.durationMs && file.durationMs > 0 ? Math.round(file.durationMs / 1000) : previous?.duration ?? 0,
          url: Capacitor.convertFileSrc(file.uri),
          blob: previous?.blob,
          file: previous?.file,
          artwork: previous?.artwork,
          genre: previous?.genre,
          year: file.year || previous?.year,
          trackNumber: file.trackNumber || previous?.trackNumber,
          mimeType: file.mimeType || previous?.mimeType || 'audio/mpeg',
          size: file.size,
          dateModified: file.dateModified,
          sourceUri: file.uri,
          origin: 'mediastore',
          addedAt: previous?.addedAt ?? Date.now(),
        };

        if (!previous) {
          try {
            const art = await MediaStoreScanner.getArtwork({ uri: file.uri });
            if (art.artwork) track.artwork = art.artwork;
          } catch (e) {
          }
        }

        if (index >= 0) {
          tracks[index] = track;
        } else {
          tracks.push(track);
        }
        changed = true;
        await this.persistTrack(track);
      }

      if (changed) {
        this.zone.run(() => this.tracksSubject.next(tracks));
      }
    } catch (e) {
    } finally {
      this.scanningSubject.next(false);
    }
  }
}


