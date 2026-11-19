const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT || 3000);
const DB_PATH = path.join(__dirname, 'db.json');
const FRAME_SIZE = 417;
const FRAME_COUNT = 96;

function silentMp3() {
  const buffer = Buffer.alloc(FRAME_SIZE * FRAME_COUNT);
  for (let i = 0; i < FRAME_COUNT; i++) {
    const offset = i * FRAME_SIZE;
    buffer[offset] = 0xff;
    buffer[offset + 1] = 0xfb;
    buffer[offset + 2] = 0x90;
    buffer[offset + 3] = 0x64;
  }
  return buffer;
}

function defaultTracks() {
  return [
    { id: 'demo-song-1', title: 'Sunset Drive', artist: 'Sample Artist', album: 'Offline Mix', duration: 2, mimeType: 'audio/mpeg', size: FRAME_SIZE * FRAME_COUNT, addedAt: 1 },
    { id: 'demo-song-2', title: 'Rainy Day', artist: 'Sample Artist', album: 'Sad Songs', duration: 2, mimeType: 'audio/mpeg', size: FRAME_SIZE * FRAME_COUNT, addedAt: 2 },
    { id: 'demo-song-3', title: 'Happy Morning', artist: 'Another Artist', album: 'Happy Songs', duration: 2, mimeType: 'audio/mpeg', size: FRAME_SIZE * FRAME_COUNT, addedAt: 3 }
  ];
}

function loadDb() {
  try {
    const data = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    if (!Array.isArray(data.playbackStates)) data.playbackStates = [];
    return data;
  } catch (e) {
    const data = { tracks: defaultTracks(), playlists: [], playbackStates: [] };
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
    return data;
  }
}

let db = loadDb();

function saveDb() {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

function headers(extra = {}) {
  return Object.assign({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,PUT,POST,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Expose-Headers': 'Content-Range, Accept-Ranges'
  }, extra);
}

function sendJson(res, status, body) {
  res.writeHead(status, headers({ 'Content-Type': 'application/json' }));
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1000000) req.destroy();
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function ensureDefaults(userId) {
  if (db.playlists.some((p) => p.userId === userId)) return;
  const now = Date.now();
  const defaults = [
    { id: 'favorites', name: 'Favorites', trackIds: ['demo-song-1', 'demo-song-3'] },
    { id: 'sad-songs', name: 'Sad Songs', trackIds: ['demo-song-2'] },
    { id: 'happy-songs', name: 'Happy Songs', trackIds: ['demo-song-1', 'demo-song-3'] }
  ];
  for (const item of defaults) {
    db.playlists.push({
      id: `${userId}:${item.id}`,
      userId,
      name: item.name,
      trackIds: item.trackIds,
      updatedAt: now
    });
  }
  saveDb();
}

function tracksByIds(ids) {
  if (!ids || ids.length === 0) return db.tracks;
  const set = new Set(ids);
  return db.tracks.filter((t) => set.has(t.id));
}

function withTracks(playlist) {
  const known = tracksByIds(playlist.trackIds);
  const knownIds = new Set(known.map((t) => t.id));
  const custom = (playlist.tracks || []).filter(
    (t) => playlist.trackIds.includes(t.id) && !knownIds.has(t.id)
  );
  return Object.assign({}, playlist, { tracks: [...known, ...custom] });
}

function sendAudio(req, res) {
  const audio = silentMp3();
  const range = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '');
  if (range) {
    const start = Math.min(Number(range[1]), audio.length - 1);
    const end = range[2] ? Math.min(Number(range[2]), audio.length - 1) : audio.length - 1;
    if (start > end) {
      res.writeHead(416, headers({ 'Content-Range': `bytes */${audio.length}` }));
      res.end();
      return;
    }
    res.writeHead(206, headers({
      'Content-Type': 'audio/mpeg',
      'Accept-Ranges': 'bytes',
      'Content-Length': String(end - start + 1),
      'Content-Range': `bytes ${start}-${end}/${audio.length}`
    }));
    res.end(audio.subarray(start, end + 1));
    return;
  }
  res.writeHead(200, headers({
    'Content-Type': 'audio/mpeg',
    'Accept-Ranges': 'bytes',
    'Content-Length': String(audio.length)
  }));
  res.end(audio);
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, headers());
    res.end();
    return;
  }
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    if (url.pathname === '/api/health') {
      sendJson(res, 200, { ok: true });
      return;
    }

    const playbackState = /^\/api\/users\/([^/]+)\/playback-state$/.exec(url.pathname);
    if (playbackState && req.method === 'GET') {
      const userId = decodeURIComponent(playbackState[1]);
      const state = db.playbackStates.find((item) => item.userId === userId);
      sendJson(res, 200, state || null);
      return;
    }
    if (playbackState && req.method === 'PUT') {
      const userId = decodeURIComponent(playbackState[1]);
      const body = await readBody(req);
      const record = {
        userId,
        trackId: String(body.trackId || ''),
        position: Number(body.position) || 0,
        duration: Number(body.duration) || 0,
        queueIds: Array.isArray(body.queueIds) ? body.queueIds.filter((v) => typeof v === 'string') : [],
        updatedAt: Number(body.updatedAt) || Date.now(),
      };
      const index = db.playbackStates.findIndex((item) => item.userId === userId);
      if (index >= 0) db.playbackStates[index] = record;
      else db.playbackStates.push(record);
      saveDb();
      sendJson(res, 200, record);
      return;
    }

    const playlistList = /^\/api\/users\/([^/]+)\/playlists$/.exec(url.pathname);
    if (playlistList && req.method === 'GET') {
      const userId = decodeURIComponent(playlistList[1]);
      ensureDefaults(userId);
      const playlists = db.playlists.filter((p) => p.userId === userId).map(withTracks);
      sendJson(res, 200, playlists);
      return;
    }

    const playlistItem = /^\/api\/users\/([^/]+)\/playlists\/([^/]+)$/.exec(url.pathname);
    if (playlistItem && req.method === 'PUT') {
      const userId = decodeURIComponent(playlistItem[1]);
      const id = decodeURIComponent(playlistItem[2]);
      const body = await readBody(req);
      const record = {
        id,
        userId,
        name: String(body.name || 'Untitled playlist'),
        trackIds: Array.isArray(body.trackIds) ? body.trackIds.filter((v) => typeof v === 'string') : [],
        tracks: Array.isArray(body.tracks) ? body.tracks.filter((v) => v && typeof v.id === 'string') : [],
        updatedAt: Number(body.updatedAt) || Date.now()
      };
      const index = db.playlists.findIndex((p) => p.userId === userId && p.id === id);
      if (index >= 0) db.playlists[index] = record;
      else db.playlists.push(record);
      saveDb();
      sendJson(res, 200, withTracks(record));
      return;
    }
    if (playlistItem && req.method === 'DELETE') {
      const userId = decodeURIComponent(playlistItem[1]);
      const id = decodeURIComponent(playlistItem[2]);
      db.playlists = db.playlists.filter((p) => !(p.userId === userId && p.id === id));
      saveDb();
      sendJson(res, 200, { deleted: true });
      return;
    }

    const trackList = /^\/api\/users\/([^/]+)\/tracks$/.exec(url.pathname);
    if (trackList && req.method === 'GET') {
      const ids = (url.searchParams.get('ids') || '').split(',').filter(Boolean);
      sendJson(res, 200, tracksByIds(ids));
      return;
    }

    const audioItem = /^\/api\/users\/([^/]+)\/audio\/([^/]+)$/.exec(url.pathname);
    if (audioItem && req.method === 'GET') {
      sendAudio(req, res);
      return;
    }

    sendJson(res, 404, { error: 'Not found' });
  } catch (e) {
    sendJson(res, 500, { error: 'Server error' });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`REST API listening on http://0.0.0.0:${PORT}/api`);
});
