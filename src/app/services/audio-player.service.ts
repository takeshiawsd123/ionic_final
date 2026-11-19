import { inject, Injectable, NgZone } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { Track, RepeatMode } from '../models/track.model';
import { PlaybackStateService } from './playback-state.service';

@Injectable({ providedIn: 'root' })
export class AudioPlayerService {
  private playbackState = inject(PlaybackStateService);
  private zone = inject(NgZone);
  private audio: HTMLAudioElement;
  private queue: Track[] = [];
  private currentIndex = -1;
  private lastPersistAt = 0;

  private currentTrackSubject = new BehaviorSubject<Track | null>(null);
  private isPlayingSubject = new BehaviorSubject<boolean>(false);
  private currentTimeSubject = new BehaviorSubject<number>(0);
  private durationSubject = new BehaviorSubject<number>(0);
  private volumeSubject = new BehaviorSubject<number>(1);
  private shuffleSubject = new BehaviorSubject<boolean>(false);
  private repeatSubject = new BehaviorSubject<RepeatMode>('off');

  readonly currentTrack$: Observable<Track | null> = this.currentTrackSubject.asObservable();
  readonly isPlaying$: Observable<boolean> = this.isPlayingSubject.asObservable();
  readonly currentTime$: Observable<number> = this.currentTimeSubject.asObservable();
  readonly duration$: Observable<number> = this.durationSubject.asObservable();
  readonly volume$: Observable<number> = this.volumeSubject.asObservable();
  readonly shuffle$: Observable<boolean> = this.shuffleSubject.asObservable();
  readonly repeat$: Observable<RepeatMode> = this.repeatSubject.asObservable();

  constructor() {
    this.audio = new Audio();
    this.audio.preload = 'metadata';
    this.bindEvents();
    const savedVolume = localStorage.getItem('mp_volume');
    if (savedVolume !== null) {
      const v = parseFloat(savedVolume);
      if (!isNaN(v)) {
        this.volumeSubject.next(v);
        this.audio.volume = v;
      }
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', () => this.persistNow());
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') this.persistNow();
      });
    }
  }
  private progressTimer: any = null;

  private bindEvents(): void {
    this.audio.addEventListener('timeupdate', () => {
      this.zone.run(() => {
        this.currentTimeSubject.next(this.audio.currentTime || 0);
        this.persistMaybe();
      });
    });
    this.audio.addEventListener('durationchange', () => this.syncDuration());
    this.audio.addEventListener('loadedmetadata', () => this.syncDuration());
    this.audio.addEventListener('loadeddata', () => this.syncDuration());
    this.audio.addEventListener('canplay', () => this.syncDuration());
    this.audio.addEventListener('playing', () => {
      this.syncDuration();
      this.startProgressTimer();
    });
    this.audio.addEventListener('ended', () => {
      this.zone.run(() => this.handleEnded());
    });
    this.audio.addEventListener('play', () => {
      this.zone.run(() => this.isPlayingSubject.next(true));
    });
    this.audio.addEventListener('pause', () => {
      this.stopProgressTimer();
      this.zone.run(() => this.isPlayingSubject.next(false));
    });
    this.audio.addEventListener('error', () => {
      this.stopProgressTimer();
      this.zone.run(() => {
        this.isPlayingSubject.next(false);
      });
    });
  }

  private startProgressTimer(): void {
    if (this.progressTimer) return;
    this.progressTimer = setInterval(() => {
      this.zone.run(() => {
        this.currentTimeSubject.next(this.audio.currentTime || 0);
        this.syncDuration();
      });
    }, 250);
  }

  private stopProgressTimer(): void {
    if (this.progressTimer) {
      clearInterval(this.progressTimer);
      this.progressTimer = null;
    }
  }

  private syncDuration(): void {
    this.zone.run(() => {
      const d = this.audio.duration;
      if (isFinite(d) && d > 0) {
        this.durationSubject.next(d);
        const t = this.currentTrackSubject.value;
        if (t && (!t.duration || t.duration === 0)) {
          t.duration = d;
        }
      }
    });
  }

  private handleEnded(): void {
    const repeat = this.repeatSubject.value;
    if (repeat === 'one') {
      this.audio.currentTime = 0;
      void this.audio.play();
      return;
    }
    if (this.queue.length === 0) {
      this.isPlayingSubject.next(false);
      return;
    }
    if (this.currentIndex < this.queue.length - 1) {
      this.playIndex(this.currentIndex + 1);
    } else if (repeat === 'all') {
      this.playIndex(0);
    } else {
      this.isPlayingSubject.next(false);
    }
  }

  setQueue(tracks: Track[], startIndex = 0): void {
    this.queue = [...tracks];
    if (tracks.length === 0) {
      this.currentIndex = -1;
      return;
    }
    this.playIndex(Math.max(0, Math.min(startIndex, tracks.length - 1)));
  }

  appendToQueue(tracks: Track[]): void {
    this.queue = [...this.queue, ...tracks];
  }

  playNext(track: Track): void {
    const existing = this.queue.findIndex((t) => t.id === track.id);
    if (existing >= 0) this.queue.splice(existing, 1);
    let insertAt = this.currentIndex + 1;
    if (existing >= 0 && existing < this.currentIndex) insertAt--;
    this.queue.splice(Math.max(0, insertAt), 0, track);
  }

  removeTrack(id: string): void {
    const index = this.queue.findIndex((t) => t.id === id);
    if (index < 0) return;
    const wasCurrent = index === this.currentIndex;
    this.queue = this.queue.filter((t) => t.id !== id);
    if (wasCurrent) {
      this.audio.pause();
      this.audio.removeAttribute('src');
      this.audio.load();
      this.currentIndex = -1;
      this.currentTrackSubject.next(null);
      this.currentTimeSubject.next(0);
      this.durationSubject.next(0);
    } else if (index < this.currentIndex) {
      this.currentIndex--;
    }
  }

  updateTrack(track: Track): void {
    const index = this.queue.findIndex((t) => t.id === track.id);
    if (index < 0) return;
    this.queue[index] = track;
    if (index === this.currentIndex) this.currentTrackSubject.next(track);
  }

  getQueue(): Track[] {
    return [...this.queue];
  }

  getCurrentIndex(): number {
    return this.currentIndex;
  }

  playTrack(track: Track, queue?: Track[]): void {
    if (queue) {
      const idx = queue.findIndex((t) => t.id === track.id);
      this.setQueue(queue, idx >= 0 ? idx : 0);
      return;
    }
    const idx = this.queue.findIndex((t) => t.id === track.id);
    if (idx >= 0) {
      this.playIndex(idx);
    } else {
      this.queue = [track, ...this.queue];
      this.playIndex(0);
    }
  }

  playIndex(index: number): void {
    if (index < 0 || index >= this.queue.length) return;
    this.currentIndex = index;
    const track = this.queue[index];
    this.currentTrackSubject.next(track);
    this.durationSubject.next(isFinite(track.duration) && track.duration > 0 ? track.duration : 0);
    this.currentTimeSubject.next(0);
    this.stopProgressTimer();
    this.audio.pause();
    this.audio.src = track.url;
    this.audio.currentTime = 0;
    this.audio.load();
    void this.audio.play().catch(() => {
      this.isPlayingSubject.next(false);
    });
    this.persistNow();
  }

  play(): void {
    if (this.audio.getAttribute('src')) {
      void this.audio.play().catch(() => this.isPlayingSubject.next(false));
    } else if (this.queue.length > 0) {
      this.playIndex(this.currentIndex >= 0 ? this.currentIndex : 0);
    }
  }

  pause(): void {
    this.audio.pause();
    this.persistNow();
  }

  next(): void {
    if (this.queue.length === 0) return;
    let nextIndex = this.currentIndex + 1;
    if (this.shuffleSubject.value) {
      nextIndex = this.randomIndex();
    }
    if (nextIndex >= this.queue.length) {
      if (this.repeatSubject.value === 'all') {
        nextIndex = 0;
      } else {
        this.isPlayingSubject.next(false);
        return;
      }
    }
    this.playIndex(nextIndex);
  }

  prev(): void {
    if (this.queue.length === 0) return;
    if (this.audio.currentTime > 3) {
      this.seek(0);
      return;
    }
    let prevIndex = this.currentIndex - 1;
    if (this.shuffleSubject.value) {
      prevIndex = this.randomIndex();
    }
    if (prevIndex < 0) {
      if (this.repeatSubject.value === 'all') {
        prevIndex = this.queue.length - 1;
      } else {
        prevIndex = 0;
      }
    }
    this.playIndex(prevIndex);
  }

  private randomIndex(): number {
    if (this.queue.length <= 1) return 0;
    let idx = Math.floor(Math.random() * this.queue.length);
    if (idx === this.currentIndex) {
      idx = (idx + 1) % this.queue.length;
    }
    return idx;
  }

  seek(time: number): void {
    if (isFinite(time)) {
      this.audio.currentTime = time;
      this.currentTimeSubject.next(time);
      this.persistNow();
    }
  }

  persistNow(): void {
    const track = this.currentTrackSubject.value;
    if (!track || this.currentIndex < 0) return;
    this.playbackState.saveLocal({
      trackId: this.rawId(track.id),
      position: Math.max(0, this.audio.currentTime || this.currentTimeSubject.value || 0),
      duration: isFinite(this.audio.duration) && this.audio.duration > 0
        ? this.audio.duration
        : track.duration || this.durationSubject.value || 0,
      queueIds: this.queue.map((item) => this.rawId(item.id)),
      updatedAt: Date.now(),
      pending: true,
    });
  }

  restore(track: Track, queue: Track[], position: number): void {
    const savedQueue = [...queue];
    const index = savedQueue.findIndex((item) => item.id === track.id);
    if (index >= 0) {
      this.currentIndex = index;
    } else {
      savedQueue.unshift(track);
      this.currentIndex = 0;
    }
    this.queue = savedQueue;
    this.currentTrackSubject.next(track);
    this.durationSubject.next(track.duration || 0);
    this.currentTimeSubject.next(position);
    this.stopProgressTimer();
    this.audio.pause();
    this.audio.removeAttribute('src');
    if (track.url) this.audio.src = track.url;
    this.audio.load();
    let applied = false;
    const applyPosition = () => {
      if (applied) return;
      applied = true;
      if (position > 0) {
        const max = isFinite(this.audio.duration) && this.audio.duration > 0
          ? Math.max(0, this.audio.duration - 0.25)
          : position;
        try {
          this.audio.currentTime = Math.min(position, max);
        } catch (e) {
        }
      }
      this.currentTimeSubject.next(this.audio.currentTime || position);
    };
    this.audio.addEventListener('loadedmetadata', applyPosition, { once: true });
    setTimeout(applyPosition, 2000);
  }

  private persistMaybe(): void {
    const now = Date.now();
    if (now - this.lastPersistAt < 3000) return;
    this.lastPersistAt = now;
    this.persistNow();
  }

  private rawId(id: string): string {
    return id.startsWith('srv_') ? id.slice(4) : id;
  }

  setVolume(v: number): void {
    const clamped = Math.max(0, Math.min(1, v));
    this.audio.volume = clamped;
    this.volumeSubject.next(clamped);
    localStorage.setItem('mp_volume', String(clamped));
  }

  toggleShuffle(): void {
    this.shuffleSubject.next(!this.shuffleSubject.value);
  }

  cycleRepeat(): void {
    const cur = this.repeatSubject.value;
    const next: RepeatMode = cur === 'off' ? 'all' : cur === 'all' ? 'one' : 'off';
    this.repeatSubject.next(next);
  }

  stop(): void {
    this.stopProgressTimer();
    this.audio.pause();
    this.audio.src = '';
    this.isPlayingSubject.next(false);
    this.currentTimeSubject.next(0);
  }

  toggle(): void {
    if (this.isPlayingSubject.value) {
      this.pause();
    } else {
      this.play();
    }
  }
}

