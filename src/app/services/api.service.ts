import { HttpClient, HttpHeaders } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { environment } from '../../environments/environment';
import { PlaybackState, PlaylistDto, TrackDto } from '../models/track.model';
import { UserService } from './user.service';

const BASE_URL_KEY = 'mp_api_base_url';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private baseSubject = new BehaviorSubject<string>(this.readBaseUrl());
  readonly baseUrl$ = this.baseSubject.asObservable();

  private http = inject(HttpClient);
  private user = inject(UserService);

  getBaseUrl(): string {
    return this.baseSubject.value;
  }

  setBaseUrl(url: string | null): void {
    const normalized = (url && url.trim()) || environment.apiBaseUrl;
    const value = normalized.replace(/\/+$/, '');
    localStorage.setItem(BASE_URL_KEY, value);
    this.baseSubject.next(value);
  }

  getPlaylists(userId: string) {
    return this.http.get<PlaylistDto[]>(this.url(`/users/${encodeURIComponent(userId)}/playlists`), {
      headers: this.headers(),
    });
  }

  savePlaylist(userId: string, playlist: PlaylistDto) {
    return this.http.put<PlaylistDto>(
      this.url(`/users/${encodeURIComponent(userId)}/playlists/${encodeURIComponent(playlist.id)}`),
      playlist,
      { headers: this.headers() }
    );
  }

  deletePlaylist(userId: string, playlistId: string) {
    return this.http.delete<void>(
      this.url(`/users/${encodeURIComponent(userId)}/playlists/${encodeURIComponent(playlistId)}`),
      { headers: this.headers() }
    );
  }

  getPlaybackState(userId: string) {
    return this.http.get<PlaybackState>(this.url(`/users/${encodeURIComponent(userId)}/playback-state`), {
      headers: this.headers(),
    });
  }

  savePlaybackState(userId: string, state: PlaybackState) {
    return this.http.put<PlaybackState>(
      this.url(`/users/${encodeURIComponent(userId)}/playback-state`),
      state,
      { headers: this.headers() }
    );
  }

  getTracks(userId: string, ids: string[]) {
    const query = ids.length ? `?ids=${encodeURIComponent(ids.join(','))}` : '';
    return this.http.get<TrackDto[]>(this.url(`/users/${encodeURIComponent(userId)}/tracks${query}`), {
      headers: this.headers(),
    });
  }

  downloadAudio(userId: string, trackId: string) {
    return this.http.get(
      this.url(`/users/${encodeURIComponent(userId)}/audio/${encodeURIComponent(trackId)}`),
      { headers: this.headers(), responseType: 'blob' }
    );
  }

  private url(path: string): string {
    return `${this.baseSubject.value}${path}`;
  }

  private headers(): HttpHeaders {
    const token = this.user.getToken();
    return token ? new HttpHeaders({ Authorization: `Bearer ${token}` }) : new HttpHeaders();
  }

  private readBaseUrl(): string {
    const stored = localStorage.getItem(BASE_URL_KEY);
    return (stored || environment.apiBaseUrl).replace(/\/+$/, '');
  }
}
