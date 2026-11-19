export interface Track {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: number; // seconds
  url: string; // object URL (session)
  file?: File;
  blob?: Blob;
  artwork?: string; // data URL or object URL
  genre?: string;
  year?: number;
  trackNumber?: number;
  mimeType?: string;
  size?: number;
  dateModified?: number;
  sourceUri?: string;
  origin?: 'mediastore' | 'import' | 'folder' | 'server';
  addedAt: number;
}

export interface TrackDto {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  mimeType?: string;
  size?: number;
  artwork?: string;
  genre?: string;
  year?: number;
  trackNumber?: number;
  addedAt: number;
}

export interface PlaylistDto {
  id: string;
  userId: string;
  name: string;
  trackIds: string[];
  updatedAt: number;
  tracks?: TrackDto[];
}

export interface Playlist {
  id: string;
  name: string;
  trackIds: string[];
  tracks: TrackDto[];
  updatedAt: number;
  offlineReady: boolean;
  pending?: boolean;
}

export interface PlaybackState {
  trackId: string;
  position: number;
  duration: number;
  queueIds: string[];
  updatedAt: number;
  pending?: boolean;
}

export type RepeatMode = 'off' | 'one' | 'all';

export interface PlayerState {
  currentTrack: Track | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  shuffle: boolean;
  repeat: RepeatMode;
  queue: Track[];
  currentIndex: number;
}
