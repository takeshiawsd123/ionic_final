import { inject, Injectable, NgZone } from '@angular/core';
import { BehaviorSubject, firstValueFrom } from 'rxjs';
import { Playlist, PlaylistDto, Track, TrackDto } from '../models/track.model';
import { ApiService } from './api.service';
import { UserService } from './user.service';

const DB_NAME = 'music-player-lib';
const DB_VERSION = 3;
const STORE_PLAYLISTS = 'playlists';
const STORE_DOWNLOADS = 'downloads';
const STORE_PENDING = 'pendingOps';

type PlaylistRecord = PlaylistDto & { pending?: boolean };
type PendingOp = {
  id: string;
  type: 'save' | 'delete';
  playlistId: string;
  record?: PlaylistRecord;
};

@Injectable({ providedIn: 'root' })
export class PlaylistService {
  private db: IDBDatabase | null = null;
  private dbReady: Promise<void> | null = null;
  private playlistsSubject = new BehaviorSubject<Playlist[]>([]);
  private syncingSubject = new BehaviorSubject<boolean>(false);
  private objectUrls = new Map<string, string>();

  readonly playlists$ = this.playlistsSubject.asObservable();
  readonly syncing$ = this.syncingSubject.asObservable();

  private api = inject(ApiService);
  private user = inject(UserService);
  private zone = inject(NgZone);

  constructor() {
    void this.initDb()
      .then(() => this.refresh())
      .then(() => this.syncPlaylists())
      .catch(() => {});
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => {
        void this.syncPlaylists();
      });
    }
  }

  get isOnline(): boolean {
    return typeof navigator === 'undefined' || navigator.onLine;
  }

  getApiBaseUrl(): string {
    return this.api.getBaseUrl();
  }

  async setApiBaseUrl(url: string | null): Promise<void> {
    this.api.setBaseUrl(url);
    await this.syncPlaylists();
  }

  async syncPlaylists(): Promise<void> {
    if (!this.isOnline || !this.db) return;
    this.syncingSubject.next(true);
    try {
      const remote = await firstValueFrom(this.api.getPlaylists(this.user.getUserId()));
      const local = await this.getAllPlaylists();
      const remoteIds = new Set(remote.map((p) => p.id));
      for (const playlist of remote) {
        await this.putPlaylist({ ...playlist, userId: this.user.getUserId(), pending: false });
      }
      for (const playlist of local) {
        if (!remoteIds.has(playlist.id) && !playlist.pending) {
          await this.deleteLocalPlaylist(playlist.id);
        }
      }
      await this.flushPending();
    } catch (e) {
    } finally {
      this.syncingSubject.next(false);
      await this.refresh();
    }
  }

  async listPlaylists(): Promise<Playlist[]> {
    const records = await this.getAllPlaylists();
    const result: Playlist[] = [];
    for (const record of records) {
      const offlineReady = await this.isOfflineReady(record.trackIds);
      result.push({
        id: record.id,
        name: record.name,
        trackIds: record.trackIds,
        tracks: record.tracks || [],
        updatedAt: record.updatedAt,
        offlineReady,
        pending: record.pending,
      });
    }
    return result.sort((a, b) => a.name.localeCompare(b.name));
  }

  async listServerTracks(): Promise<TrackDto[]> {
    if (!this.isOnline) return [];
    try {
      return await firstValueFrom(this.api.getTracks(this.user.getUserId(), []));
    } catch (e) {
      return [];
    }
  }

  async createPlaylist(name: string): Promise<Playlist> {
    const userId = this.user.getUserId();
    const id = `${userId}:${Date.now()}`;
    const updatedAt = Date.now();
    await this.savePlaylist(name, [], id);
    return (await this.listPlaylists()).find((item) => item.id === id) || {
      id,
      name,
      trackIds: [],
      tracks: [],
      updatedAt,
      offlineReady: true,
      pending: !this.isOnline,
    };
  }

  async addTrackToPlaylist(playlistId: string, track: Track): Promise<void> {
    const record = await this.getPlaylistRecord(playlistId);
    if (!record) return;
    const dto: TrackDto = {
      id: track.id,
      title: track.title,
      artist: track.artist,
      album: track.album,
      duration: track.duration,
      mimeType: track.mimeType,
      size: track.size,
      artwork: track.artwork,
      genre: track.genre,
      year: track.year,
      trackNumber: track.trackNumber,
      addedAt: track.addedAt,
    };
    const trackIds = record.trackIds.includes(dto.id) ? [...record.trackIds] : [...record.trackIds, dto.id];
    const tracks = [...(record.tracks || []).filter((t) => t.id !== dto.id), dto];
    await this.savePlaylist(record.name, trackIds, record.id, tracks);
  }

  async savePlaylist(name: string, trackIds: string[], id?: string, tracks?: TrackDto[]): Promise<void> {
    const existing = id ? await this.getPlaylistRecord(id) : undefined;
    const record: PlaylistRecord = {
      id: id || `${this.user.getUserId()}:${Date.now()}`,
      userId: this.user.getUserId(),
      name,
      trackIds,
      tracks: tracks || existing?.tracks || [],
      updatedAt: Date.now(),
      pending: !this.isOnline,
    };
    await this.putPlaylist(record);
    if (this.isOnline) {
      try {
        const saved = await firstValueFrom(this.api.savePlaylist(this.user.getUserId(), record));
        await this.putPlaylist({ ...saved, pending: false });
      } catch (e) {
        await this.queueOp({ id: this.createId(), type: 'save', playlistId: record.id, record });
      }
    } else {
      await this.queueOp({ id: this.createId(), type: 'save', playlistId: record.id, record });
    }
    await this.refresh();
  }

  async deletePlaylist(id: string): Promise<void> {
    await this.deleteLocalPlaylist(id);
    if (this.isOnline) {
      try {
        await firstValueFrom(this.api.deletePlaylist(this.user.getUserId(), id));
      } catch (e) {
        await this.queueOp({ id: this.createId(), type: 'delete', playlistId: id });
      }
    } else {
      await this.queueOp({ id: this.createId(), type: 'delete', playlistId: id });
    }
    await this.refresh();
  }

  async downloadPlaylist(id: string): Promise<void> {
    const record = await this.getPlaylistRecord(id);
    if (!record || !this.isOnline) return;
    for (const trackId of record.trackIds) {
      if (await this.getDownload(trackId)) continue;
      try {
        const blob = await firstValueFrom(this.api.downloadAudio(this.user.getUserId(), trackId));
        await this.putDownload(trackId, blob);
      } catch (e) {
      }
    }
    await this.refresh();
  }

  async getPlayableTrack(trackId: string): Promise<Track | null> {
    let blob = await this.getDownload(trackId);
    if (!blob) {
      if (!this.isOnline) return null;
      try {
        blob = await firstValueFrom(this.api.downloadAudio(this.user.getUserId(), trackId));
        await this.putDownload(trackId, blob);
      } catch (e) {
        return null;
      }
    }
    const dto = (await this.findTrackDto(trackId)) || {
      id: trackId,
      title: trackId,
      artist: 'Unknown Artist',
      album: 'Unknown Album',
      duration: 0,
      addedAt: Date.now(),
    };
    let url = this.objectUrls.get(trackId);
    if (!url) {
      url = URL.createObjectURL(blob);
      this.objectUrls.set(trackId, url);
    }
    return {
      id: `srv_${dto.id}`,
      title: dto.title,
      artist: dto.artist,
      album: dto.album,
      duration: dto.duration,
      url,
      artwork: dto.artwork,
      genre: dto.genre,
      year: dto.year,
      trackNumber: dto.trackNumber,
      mimeType: dto.mimeType || 'audio/mpeg',
      size: dto.size || blob.size,
      origin: 'server',
      sourceUri: `${this.api.getBaseUrl()}/users/${encodeURIComponent(this.user.getUserId())}/audio/${encodeURIComponent(trackId)}`,
      addedAt: dto.addedAt,
    };
  }

  private async refresh(): Promise<void> {
    const playlists = await this.listPlaylists();
    this.zone.run(() => this.playlistsSubject.next(playlists));
  }

  private async flushPending(): Promise<void> {
    if (!this.isOnline || !this.db) return;
    const ops = await this.getPendingOps();
    for (const op of ops) {
      try {
        if (op.type === 'save' && op.record) {
          const saved = await firstValueFrom(this.api.savePlaylist(this.user.getUserId(), op.record));
          await this.putPlaylist({ ...saved, pending: false });
        } else if (op.type === 'delete') {
          await firstValueFrom(this.api.deletePlaylist(this.user.getUserId(), op.playlistId));
        }
        await this.deletePendingOp(op.id);
      } catch (e) {
      }
    }
  }

  private async findTrackDto(trackId: string): Promise<TrackDto | undefined> {
    const records = await this.getAllPlaylists();
    for (const record of records) {
      const match = (record.tracks || []).find((track) => track.id === trackId);
      if (match) return match;
    }
    if (!this.isOnline) return undefined;
    try {
      const tracks = await firstValueFrom(this.api.getTracks(this.user.getUserId(), [trackId]));
      return tracks[0];
    } catch (e) {
      return undefined;
    }
  }

  private async isOfflineReady(trackIds: string[]): Promise<boolean> {
    for (const trackId of trackIds) {
      if (!(await this.getDownload(trackId))) return false;
    }
    return true;
  }

  private async queueOp(op: PendingOp): Promise<void> {
    const existing = await this.getPendingOps();
    for (const item of existing) {
      if (item.playlistId === op.playlistId) await this.deletePendingOp(item.id);
    }
    await this.putPendingOp(op);
  }

  private createId(): string {
    return `op-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  private async initDb(): Promise<void> {
    if (this.db) return;
    if (typeof indexedDB === 'undefined') return;
    if (this.dbReady) return this.dbReady;
    this.dbReady = new Promise<void>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
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
    }).catch((error) => {
      this.dbReady = null;
      throw error;
    });
    return this.dbReady;
  }

  private async request<T>(storeName: string, mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    await this.initDb();
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('Database not ready'));
        return;
      }
      const tx = this.db.transaction(storeName, mode);
      const req = action(tx.objectStore(storeName));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  private async getAllPlaylists(): Promise<PlaylistRecord[]> {
    const all = await this.request<PlaylistRecord[]>(STORE_PLAYLISTS, 'readonly', (store) => store.getAll());
    const userId = this.user.getUserId();
    return all.filter((record) => record.userId === userId);
  }

  private async getPlaylistRecord(id: string): Promise<PlaylistRecord | undefined> {
    return this.request<PlaylistRecord | undefined>(STORE_PLAYLISTS, 'readonly', (store) => store.get(id));
  }

  private async putPlaylist(record: PlaylistRecord): Promise<void> {
    await this.request(STORE_PLAYLISTS, 'readwrite', (store) => store.put(record));
  }

  private async deleteLocalPlaylist(id: string): Promise<void> {
    await this.request(STORE_PLAYLISTS, 'readwrite', (store) => store.delete(id));
  }

  private async getDownload(trackId: string): Promise<Blob | undefined> {
    const record = await this.request<{ trackId: string; blob: Blob } | undefined>(STORE_DOWNLOADS, 'readonly', (store) => store.get(trackId));
    return record?.blob;
  }

  private async putDownload(trackId: string, blob: Blob): Promise<void> {
    await this.request(STORE_DOWNLOADS, 'readwrite', (store) => store.put({ trackId, blob }));
  }

  private async getPendingOps(): Promise<PendingOp[]> {
    return this.request<PendingOp[]>(STORE_PENDING, 'readonly', (store) => store.getAll());
  }

  private async putPendingOp(op: PendingOp): Promise<void> {
    await this.request(STORE_PENDING, 'readwrite', (store) => store.put(op));
  }

  private async deletePendingOp(id: string): Promise<void> {
    await this.request(STORE_PENDING, 'readwrite', (store) => store.delete(id));
  }
}
