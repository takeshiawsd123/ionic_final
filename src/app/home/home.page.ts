import { Component, inject, OnInit, OnDestroy, ViewChild, ElementRef, ChangeDetectorRef } from '@angular/core';
import { ActionSheetController, AlertController, IonHeader, IonToolbar, IonTitle, IonContent, IonButtons, IonButton, IonIcon, IonSegment, IonSegmentButton, IonLabel, IonList, IonItem, IonThumbnail, IonRange, IonSpinner, IonSearchbar, IonFabButton, IonBadge, IonNote } from '@ionic/angular';
import { FormsModule } from '@angular/forms';
import { addIcons } from 'ionicons';
import {
  play, pause, playSkipForward, playSkipBack, shuffle, repeat, musicalNotes, folderOpen,
  add, search, list, volumeHigh, volumeLow, volumeMute, close, trash, albums, checkmark,
      person, disc, time, download, refresh, ellipsisVertical, create, arrowBack

} from 'ionicons/icons';
import { AudioPlayerService } from '../services/audio-player.service';
import { LibraryService } from '../services/library.service';
import { PlaylistService } from '../services/playlist.service';
import { PlaybackStateService } from '../services/playback-state.service';
import { Playlist, Track, RepeatMode } from '../models/track.model';
import { Subscription } from 'rxjs';

type Segment = 'library' | 'playlists' | 'player' | 'queue';
type DetailEvent = CustomEvent<{ value?: unknown }>;

@Component({
  selector: 'app-home',
  templateUrl: 'home.page.html',
  styleUrls: ['home.page.scss'],
  imports: [
    FormsModule,
    IonHeader, IonToolbar, IonTitle, IonContent, IonButtons, IonButton, IonIcon,
    IonSegment, IonSegmentButton, IonLabel, IonList, IonItem, IonThumbnail,
    IonRange, IonSpinner, IonSearchbar, IonFabButton, IonBadge, IonNote
  ],
})
export class HomePage implements OnInit, OnDestroy {
  @ViewChild('fileInput') fileInput!: ElementRef<HTMLInputElement>;

  segment: Segment = 'library';
  searchQuery = '';
  volume = 1;
  seeking = false;
  seekValue = 0;

  tracks: Track[] = [];
  filteredTracks: Track[] = [];
  groupedTracks: { letter: string; tracks: Track[] }[] = [];
  availableLetters: string[] = [];
  alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ#'.split('');
  activeIndexLetter: string | null = null;
  playlists: Playlist[] = [];
  playlistSyncing = false;
  selectedPlaylist: Playlist | null = null;
  selectedPlaylistTracks: Track[] = [];
  playlistDetailLoading = false;
  playlistPickerOpen = false;
  pickerTrack: Track | null = null;
  pickerPlaylistId: string | null = null;
  pickerCreating = false;
  newPlaylistName = '';
  pickerError = '';
  scanning = false;
  canScanFolder = false;
  needsFolderPermission = false;

  currentTrack: Track | null = null;
  isPlaying = false;
  currentTime = 0;
  duration = 0;
  shuffle = false;
  repeat: RepeatMode = 'off';
  queue: Track[] = [];
  currentIndex = -1;

  private subs: Subscription[] = [];
  private draggingIndex = false;
  private playbackRestored = false;

  public player = inject(AudioPlayerService);
  public library = inject(LibraryService);
  public playlist = inject(PlaylistService);
  private playbackState = inject(PlaybackStateService);
  private cdr = inject(ChangeDetectorRef);
  private actionSheet = inject(ActionSheetController);
  private alertController = inject(AlertController);

  ngOnInit(): void {
    addIcons({
      play, pause, playSkipForward, playSkipBack, shuffle, repeat, musicalNotes, folderOpen,
      add, search, list, volumeHigh, volumeLow, volumeMute, close, trash, albums, checkmark,
      person, disc, time, download, refresh, ellipsisVertical, create, arrowBack
    });
    this.subs.push(
      this.library.tracks$.subscribe((t) => {
        this.tracks = t;
        this.applyFilter();
        this.cdr.markForCheck();
      })
    );
    this.subs.push(this.library.scanning$.subscribe((s) => {
      this.scanning = s;
      this.cdr.markForCheck();
    }));
    this.subs.push(this.library.restored$.subscribe((ready) => {
      if (!ready || this.playbackRestored) return;
      this.playbackRestored = true;
      void this.restorePlayback();
      void this.playbackState.sync();
    }));
    this.subs.push(this.library.needsFolderPermission$.subscribe((v) => {
      this.needsFolderPermission = v;
      this.cdr.markForCheck();
    }));
    this.subs.push(this.playlist.playlists$.subscribe((p) => {
      this.playlists = p;
      const selected = this.selectedPlaylist ? p.find((item) => item.id === this.selectedPlaylist!.id) : null;
      if (selected) this.selectedPlaylist = selected;
      this.cdr.markForCheck();
    }));
    this.subs.push(this.playlist.syncing$.subscribe((v) => {
      this.playlistSyncing = v;
      this.cdr.markForCheck();
    }));
    this.subs.push(this.player.currentTrack$.subscribe((t) => {
      this.currentTrack = t;
      this.queue = this.player.getQueue();
      this.currentIndex = this.player.getCurrentIndex();
      this.cdr.markForCheck();
    }));
    this.subs.push(this.player.isPlaying$.subscribe((v) => {
      this.isPlaying = v;
      this.cdr.markForCheck();
    }));
    this.subs.push(this.player.currentTime$.subscribe((v) => {
      this.currentTime = v;
      this.cdr.markForCheck();
    }));
    this.subs.push(this.player.duration$.subscribe((v) => {
      this.duration = v;
      this.cdr.markForCheck();
    }));
    this.subs.push(this.player.shuffle$.subscribe((v) => {
      this.shuffle = v;
      this.cdr.markForCheck();
    }));
    this.subs.push(this.player.repeat$.subscribe((v) => {
      this.repeat = v;
      this.cdr.markForCheck();
    }));
    this.subs.push(this.player.volume$.subscribe((v) => {
      this.volume = v;
      this.cdr.markForCheck();
    }));
    this.canScanFolder = this.library.canScanFolder;
    void this.library.autoScanIfNeeded();
  }

  private async restorePlayback(): Promise<void> {
    const state = this.playbackState.getLocal();
    if (!state || !state.trackId) return;
    const queue = (await Promise.all(state.queueIds.map((id) => this.resolveSavedTrack(id, false))))
      .filter((track): track is Track => !!track);
    const current = await this.resolveSavedTrack(state.trackId, true) || queue[0];
    if (!current) return;
    const resolvedQueue = queue.length ? queue : [current];
    if (!resolvedQueue.some((track) => track.id === current.id)) resolvedQueue.unshift(current);
    this.player.restore(current, resolvedQueue, state.position);
    this.queue = this.player.getQueue();
    this.currentIndex = this.player.getCurrentIndex();
    this.cdr.markForCheck();
  }

  private async resolveSavedTrack(id: string, allowRemote: boolean): Promise<Track | null> {
    const raw = id.startsWith('srv_') ? id.slice(4) : id;
    const local = this.tracks.find((track) =>
      track.id === raw || track.id === id || `srv_${track.id}` === id
    );
    if (local) return local;
    for (const playlist of this.playlists) {
      const dto = playlist.tracks.find((item) => item.id === raw || item.id === id);
      if (dto) {
        return {
          id: `srv_${dto.id}`,
          title: dto.title,
          artist: dto.artist,
          album: dto.album,
          duration: dto.duration,
          url: '',
          artwork: dto.artwork,
          genre: dto.genre,
          year: dto.year,
          trackNumber: dto.trackNumber,
          mimeType: dto.mimeType,
          size: dto.size,
          origin: 'server',
          addedAt: dto.addedAt,
        };
      }
    }
    if (allowRemote && navigator.onLine) {
      try {
        return await this.playlist.getPlayableTrack(raw);
      } catch (error) {
        console.warn('Could not resolve saved track from REST', error);
      }
    }
    return null;
  }

  onSegmentChange(event: DetailEvent): void {
    const value = event.detail.value;
    if (value === 'library' || value === 'playlists' || value === 'player' || value === 'queue') {
      this.segment = value;
    }
  }

  ngOnDestroy(): void {
    this.subs.forEach((s) => s.unsubscribe());
  }
  applyFilter(): void {
    const q = this.searchQuery.trim().toLowerCase();
    const list = q
      ? this.tracks.filter((t) =>
          t.title.toLowerCase().includes(q) ||
          t.artist.toLowerCase().includes(q) ||
          t.album.toLowerCase().includes(q)
        )
      : [...this.tracks];
    this.filteredTracks = list.sort((a, b) =>
      a.title.localeCompare(b.title, undefined, { sensitivity: 'base', numeric: true })
    );
    this.buildGroups();
  }

  scrollToLetter(letter: string, behavior: ScrollBehavior = 'smooth'): void {
    const element = document.getElementById(`letter-${this.letterId(letter)}`);
    element?.scrollIntoView({ behavior, block: 'start' });
  }

  onIndexPointerDown(event: PointerEvent): void {
    this.draggingIndex = true;
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    this.updateLetterFromPoint(event.clientX, event.clientY);
  }

  onIndexPointerMove(event: PointerEvent): void {
    if (!this.draggingIndex) return;
    this.updateLetterFromPoint(event.clientX, event.clientY);
  }

  onIndexPointerUp(event: PointerEvent): void {
    this.draggingIndex = false;
    const element = event.currentTarget as HTMLElement;
    if (element.hasPointerCapture?.(event.pointerId)) element.releasePointerCapture(event.pointerId);
  }

  onIndexClick(letter: string, event: MouseEvent): void {
    if (event.detail !== 0) return;
    const nearest = this.nearestAvailableLetter(letter);
    if (!nearest) return;
    this.activeIndexLetter = nearest;
    this.scrollToLetter(nearest);
  }

  private updateLetterFromPoint(x: number, y: number): void {
    const target = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-letter]');
    const letter = target?.dataset['letter'];
    if (!letter) return;
    const nearest = this.nearestAvailableLetter(letter);
    if (!nearest) return;
    this.activeIndexLetter = nearest;
    this.scrollToLetter(nearest, 'auto');
  }

  private nearestAvailableLetter(letter: string): string | null {
    if (this.availableLetters.includes(letter)) return letter;
    const target = this.alphabet.indexOf(letter);
    let nearest: string | null = null;
    let distance = Infinity;
    for (const candidate of this.availableLetters) {
      const current = Math.abs(this.alphabet.indexOf(candidate) - target);
      if (current < distance) {
        nearest = candidate;
        distance = current;
      }
    }
    return nearest;
  }

  letterId(letter: string): string {
    return letter === '#' ? 'num' : letter;
  }

  private buildGroups(): void {
    const map = new Map<string, Track[]>();
    for (const track of this.filteredTracks) {
      const letter = this.firstLetter(track.title);
      const group = map.get(letter) || [];
      group.push(track);
      map.set(letter, group);
    }
    this.groupedTracks = [...map.entries()]
      .sort((a, b) => this.alphabet.indexOf(a[0]) - this.alphabet.indexOf(b[0]))
      .map(([letter, tracks]) => ({ letter, tracks }));
    this.availableLetters = this.groupedTracks.map((group) => group.letter);
  }

  private firstLetter(title: string): string {
    const char = (title || '').trim().charAt(0).toUpperCase();
    return /[A-Z]/.test(char) ? char : '#';
  }

  onSearchChange(): void {
    this.applyFilter();
  }

  triggerFilePicker(): void {
    this.fileInput?.nativeElement?.click();
  }

  async onFilesSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      await this.library.addFiles(input.files);
    }
    input.value = '';
  }

  async scanFolder(): Promise<void> {
    await this.library.pickFolder();
  }

  async rescanFolder(): Promise<void> {
    await this.library.rescanSavedFolder();
  }

  async syncPlaylists(): Promise<void> {
    await this.playlist.syncPlaylists();
  }

  async newPlaylist(): Promise<string | null> {
    return new Promise((resolve) => {
      let createdName: string | null = null;
      void (async () => {
        const alert = await this.alertController.create({
          header: 'New playlist',
          inputs: [{ name: 'name', type: 'text', placeholder: 'Playlist name' }],
          buttons: [
            { text: 'Cancel', role: 'cancel' },
            {
              text: 'Create',
              handler: async (data: { name?: string }) => {
                const name = (data?.name || '').trim();
                if (!name) return false;
                await this.playlist.createPlaylist(name);
                createdName = name;
                return true;
              },
            },
          ],
        });
        alert.onDidDismiss().then(() => resolve(createdName));
        await alert.present();
      })();
    });
  }

  async addTracksToPlaylist(item: Playlist): Promise<void> {
    const tracks = await this.playlist.listServerTracks();
    if (tracks.length === 0) {
      alert('No server tracks available. Check the REST API connection.');
      return;
    }
    const options = tracks.map((track, index) => `${index + 1}. ${track.title}`).join('\n');
    const value = prompt(`Enter track numbers to add:\n${options}`);
    if (!value) return;
    const ids = value
      .split(',')
      .map((part) => Number(part.trim()) - 1)
      .filter((index) => index >= 0 && index < tracks.length)
      .map((index) => tracks[index].id);
    if (ids.length === 0) return;
    await this.playlist.savePlaylist(item.name, [...new Set([...item.trackIds, ...ids])], item.id);
  }

  async downloadPlaylist(item: Playlist): Promise<void> {
    await this.playlist.downloadPlaylist(item.id);
  }

  async deletePlaylist(item: Playlist): Promise<void> {
    if (!confirm(`Delete "${item.name}"?`)) return;
    await this.playlist.deletePlaylist(item.id);
  }

  async playPlaylist(item: Playlist): Promise<void> {
    const tracks = await this.loadPlaylistTracks(item);
    if (tracks.length === 0) {
      alert('No playable tracks. Download the playlist first or connect to the REST API.');
      return;
    }
    this.player.playTrack(tracks[0], tracks);
    this.segment = 'player';
  }

  async openPlaylist(item: Playlist): Promise<void> {
    this.selectedPlaylist = item;
    this.selectedPlaylistTracks = [];
    this.playlistDetailLoading = true;
    try {
      this.selectedPlaylistTracks = await this.loadPlaylistTracks(item);
    } finally {
      this.playlistDetailLoading = false;
      this.cdr.markForCheck();
    }
  }

  closePlaylist(): void {
    this.selectedPlaylist = null;
    this.selectedPlaylistTracks = [];
    this.playlistDetailLoading = false;
  }

  async playPlaylistTrack(track: Track): Promise<void> {
    let playable = track.url ? track : null;
    if (!playable) {
      const id = track.id.startsWith('srv_') ? track.id.slice(4) : track.id;
      playable = await this.playlist.getPlayableTrack(id);
    }
    if (!playable || !playable.url) {
      alert('Download the playlist first or connect to the REST API.');
      return;
    }
    this.player.playTrack(playable, this.selectedPlaylistTracks);
  }

  private async loadPlaylistTracks(item: Playlist): Promise<Track[]> {
    const tracks: Track[] = [];
    for (const id of item.trackIds) {
      const local = this.tracks.find((t) => t.id === id || `srv_${t.id}` === id || t.id === `srv_${id}`);
      if (local) {
        tracks.push(local);
        continue;
      }
      const dto = item.tracks.find((t) => t.id === id || `srv_${t.id}` === id);
      const rawId = id.startsWith('srv_') ? id.slice(4) : id;
      tracks.push({
        id: `srv_${dto?.id || rawId}`,
        title: dto?.title || rawId,
        artist: dto?.artist || 'Unknown Artist',
        album: dto?.album || 'Unknown Album',
        duration: dto?.duration || 0,
        url: '',
        artwork: dto?.artwork,
        genre: dto?.genre,
        year: dto?.year,
        trackNumber: dto?.trackNumber,
        mimeType: dto?.mimeType,
        size: dto?.size,
        origin: 'server',
        addedAt: dto?.addedAt || Date.now(),
      });
    }
    return tracks.sort((a, b) =>
      a.title.localeCompare(b.title, undefined, { sensitivity: 'base', numeric: true })
    );
  }

  playTrack(track: Track): void {
    const list = this.filteredTracks.length ? this.filteredTracks : this.tracks;
    this.player.playTrack(track, list);
    this.segment = 'player';
  }

  async openTrackMenu(track: Track, event?: Event): Promise<void> {
    event?.stopPropagation();
    const sheet = await this.actionSheet.create({
      header: track.title,
      buttons: [
        { text: 'Play next', icon: 'play-skip-forward', handler: () => { this.playNext(track); } },
        { text: 'Add to playlist', icon: 'albums', handler: () => { void this.afterDismiss(sheet, () => this.addTrackToPlaylist(track)); } },
        { text: 'Rename', icon: 'create', handler: () => { void this.afterDismiss(sheet, () => this.renameTrack(track)); } },
        { text: 'Delete from device', icon: 'trash', role: 'destructive', handler: () => { void this.afterDismiss(sheet, () => this.deleteTrack(track)); } },
        { text: 'Cancel', role: 'cancel' },
      ],
    });
    await sheet.present();
  }

  playNext(track: Track): void {
    this.player.playNext(track);
    this.queue = this.player.getQueue();
    this.currentIndex = this.player.getCurrentIndex();
    this.cdr.markForCheck();
  }

  addTrackToPlaylist(track: Track): void {
    this.pickerTrack = track;
    this.pickerPlaylistId = null;
    this.pickerCreating = false;
    this.newPlaylistName = '';
    this.pickerError = '';
    this.playlistPickerOpen = true;
    this.cdr.markForCheck();
  }

  closePlaylistPicker(): void {
    this.playlistPickerOpen = false;
    this.pickerTrack = null;
    this.pickerPlaylistId = null;
    this.pickerCreating = false;
    this.newPlaylistName = '';
    this.pickerError = '';
    this.cdr.markForCheck();
  }

  selectPickerPlaylist(id: string): void {
    this.pickerPlaylistId = id;
    this.cdr.markForCheck();
  }

  async createPlaylistFromPicker(): Promise<void> {
    const name = this.newPlaylistName.trim();
    if (!name) {
      this.pickerError = 'Enter a playlist name.';
      this.cdr.markForCheck();
      return;
    }
    this.pickerError = '';
    try {
      const created = await this.playlist.createPlaylist(name);
      this.pickerPlaylistId = created.id;
      this.pickerCreating = false;
      this.newPlaylistName = '';
    } catch (e) {
      console.error('createPlaylist failed', e);
      this.pickerError = `Could not create playlist: ${(e as Error)?.message || 'Unknown error'}`;
    }
    this.cdr.markForCheck();
  }

  async confirmAddToPlaylist(): Promise<void> {
    if (!this.pickerTrack || !this.pickerPlaylistId) return;
    const track = this.pickerTrack;
    const playlistId = this.pickerPlaylistId;
    this.closePlaylistPicker();
    await this.playlist.addTrackToPlaylist(playlistId, track);
  }

  private async afterDismiss(
    overlay: { dismiss: () => Promise<boolean> },
    action: () => void | Promise<void>
  ): Promise<void> {
    await overlay.dismiss();
    await action();
  }

  async renameTrack(track: Track): Promise<void> {
    const alert = await this.alertController.create({
      header: 'Rename song',
      message: 'Enter a new name. The original file extension is kept.',
      inputs: [
        { name: 'name', type: 'text', value: track.title, placeholder: 'Song name' }
      ],
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Rename',
          handler: (data) => {
            const name = String(data?.name || '').trim();
            if (!name || name === track.title) return false;
            void this.applyRename(track, name);
            return true;
          }
        }
      ]
    });
    await alert.present();
  }

  private async applyRename(track: Track, name: string): Promise<void> {
    try {
      const updated = await this.library.renameTrack(track, name);
      if (!updated) {
        await this.showActionError('Could not rename the file on the device.');
        return;
      }
      this.player.updateTrack(updated);
      this.queue = this.player.getQueue();
      this.cdr.markForCheck();
    } catch (e) {
      await this.showActionError(`Could not rename the file: ${(e as Error)?.message || 'Unknown error'}`);
    }
  }

  async deleteTrack(track: Track): Promise<void> {
    const alert = await this.alertController.create({
      header: 'Delete song',
      message: `Delete "${track.title}" from your device? This cannot be undone.`,
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Delete',
          role: 'destructive',
          handler: () => {
            void this.applyDelete(track);
            return true;
          }
        }
      ]
    });
    await alert.present();
  }

  private async applyDelete(track: Track): Promise<void> {
    try {
      const deleted = await this.library.deleteTrack(track);
      if (!deleted) {
        await this.showActionError('Could not delete the file from the device.');
        return;
      }
      this.player.removeTrack(track.id);
      this.queue = this.player.getQueue();
      this.currentIndex = this.player.getCurrentIndex();
      this.cdr.markForCheck();
    } catch (e) {
      await this.showActionError(`Could not delete the file: ${(e as Error)?.message || 'Unknown error'}`);
    }
  }

  private async showActionError(message: string): Promise<void> {
    const alert = await this.alertController.create({
      header: 'Action failed',
      message,
      buttons: ['OK']
    });
    await alert.present();
  }

  togglePlay(): void {
    this.player.toggle();
  }

  next(): void {
    this.player.next();
  }

  prev(): void {
    this.player.prev();
  }

  onSeekStart(event: DetailEvent): void {
    this.seeking = true;
    this.seekValue = this.getRangeValue(event);
  }

  onSeekMove(event: DetailEvent): void {
    if (this.seeking) {
      this.seekValue = this.getRangeValue(event);
    }
  }

  onSeekEnd(event: DetailEvent): void {
    if (!this.seeking) return;
    const value = this.getRangeValue(event);
    this.seekValue = value;
    this.seeking = false;
    this.player.seek(value);
  }

  onSeekChange(event: DetailEvent): void {
    if (this.seeking) return;
    const value = this.getRangeValue(event);
    this.seekValue = value;
    this.player.seek(value);
  }

  private getRangeValue(event: DetailEvent): number {
    const value = event.detail.value;
    if (typeof value === 'number') return value;
    if (value && typeof value === 'object' && 'lower' in value && typeof value.lower === 'number') {
      return value.lower;
    }
    return 0;
  }

  get progressMax(): number {
    const max = this.duration || this.currentTrack?.duration || 0;
    return max > 0 ? max : 1;
  }

  get progressValue(): number {
    const value = this.seeking ? this.seekValue : this.currentTime;
    const max = this.progressMax;
    if (!isFinite(value) || value <= 0) return 0;
    return value >= max ? max : value;
  }

  setVolume(event: DetailEvent): void {
    const value = event.detail.value;
    this.player.setVolume(typeof value === 'number' ? value : 0);
  }

  toggleShuffle(): void {
    this.player.toggleShuffle();
  }

  cycleRepeat(): void {
    this.player.cycleRepeat();
  }
  removeFromQueue(index: number): void {
    const q = [...this.player.getQueue()];
    q.splice(index, 1);
    const cur = this.player.getCurrentIndex();
    let newCurrent = cur;
    if (index < cur) newCurrent = cur - 1;
    else if (index === cur) {
      this.player.next();
      newCurrent = this.player.getCurrentIndex();
    }
    if (q.length === 0) {
      this.player.stop();
      return;
    }
    this.player.setQueue(q, newCurrent >= 0 && newCurrent < q.length ? newCurrent : 0);
  }

  playQueueIndex(index: number): void {
    this.player.playIndex(index);
    this.segment = 'player';
  }

  formatTime(sec: number): string {
    if (!sec || !isFinite(sec)) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  trackArtwork(t: Track | null): string {
    if (!t) return '';
    return t.artwork || '';
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
  }

  async onDrop(event: DragEvent): Promise<void> {
    event.preventDefault();
    if (event.dataTransfer?.files) {
      await this.library.addFiles(event.dataTransfer.files);
    }
  }

  repeatState(): string {
    return this.repeat;
  }
}