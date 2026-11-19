import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { PlaybackState } from '../models/track.model';
import { ApiService } from './api.service';
import { UserService } from './user.service';

const STORAGE_KEY = 'mp_playback_state';

@Injectable({ providedIn: 'root' })
export class PlaybackStateService {
  private api = inject(ApiService);
  private user = inject(UserService);

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => {
        void this.sync();
      });
    }
  }

  getLocal(): PlaybackState | null {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    try {
      const state = JSON.parse(raw) as PlaybackState;
      if (!state.trackId || !Array.isArray(state.queueIds) || !isFinite(state.position)) return null;
      return state;
    } catch (e) {
      return null;
    }
  }

  saveLocal(state: PlaybackState): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  clear(): void {
    localStorage.removeItem(STORAGE_KEY);
  }

  async sync(): Promise<void> {
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;
    const local = this.getLocal();
    try {
      const remote = await firstValueFrom(this.api.getPlaybackState(this.user.getUserId()));
      if (remote && (!local || remote.updatedAt > local.updatedAt)) {
        this.saveLocal({ ...remote, pending: false });
      }
    } catch (e) {
    }
    const pending = this.getLocal();
    if (!pending?.pending) return;
    try {
      await firstValueFrom(this.api.savePlaybackState(this.user.getUserId(), { ...pending, pending: false }));
      this.saveLocal({ ...pending, pending: false });
    } catch (e) {
    }
  }
}
