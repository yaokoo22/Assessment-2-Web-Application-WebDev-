// Enhanced Backend - Extracts Album Cover & Artist from MP3 files
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const mm = require('music-metadata');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Create music folders if they don't exist
const musicFolder = path.join(__dirname, 'musics');
const sideAFolder = path.join(musicFolder, 'side a');
const sideBFolder = path.join(musicFolder, 'side b');
const coversFolder = path.join(__dirname, 'covers');

if (!fs.existsSync(musicFolder)) {
  fs.mkdirSync(musicFolder);
}
if (!fs.existsSync(sideAFolder)) {
  fs.mkdirSync(sideAFolder);
}
if (!fs.existsSync(sideBFolder)) {
  fs.mkdirSync(sideBFolder);
}
if (!fs.existsSync(coversFolder)) {
  fs.mkdirSync(coversFolder);
}

// Serve music files and covers
app.use('/musics', express.static(musicFolder));
app.use('/covers', express.static(coversFolder));

// User session
let userSession = {
  currentSide: 'A',
  currentTrackId: null,
  currentTime: 0,
  volume: 75,
  tapeMode: true,
  isPlaying: false
};

// Cache for metadata to avoid re-reading files
let metadataCache = {};

// Function to extract and save album cover
async function extractAlbumCover(filePath, trackId) {
  try {
    const metadata = await mm.parseFile(filePath);
    
    if (metadata.common.picture && metadata.common.picture.length > 0) {
      const picture = metadata.common.picture[0];
      const coverPath = path.join(coversFolder, `${trackId}.jpg`);
      
      fs.writeFileSync(coverPath, picture.data);
      return `/covers/${trackId}.jpg`;
    }
  } catch (error) {
    console.error(`Error extracting cover for ${filePath}:`, error.message);
  }
  
  return null;
}

// Function to scan music folders and load tracks with metadata
async function loadMusicFiles() {
  const audioExtensions = ['.mp3', '.wav', '.ogg', '.m4a', '.flac'];
  
  const getSongsFromFolder = async (folderPath, side) => {
    if (!fs.existsSync(folderPath)) return [];
    
    const files = fs.readdirSync(folderPath);
    const tracks = [];
    
    for (let index = 0; index < files.length; index++) {
      const file = files[index];
      
      if (!audioExtensions.includes(path.extname(file).toLowerCase())) {
        continue;
      }
      
      const filePath = path.join(folderPath, file);
      const stats = fs.statSync(filePath);
      const trackId = `${side}-${index}`;
      
      // Default values
      let title = path.basename(file, path.extname(file))
        .replace(/_/g, ' ')
        .replace(/-/g, ' ')
        .trim();
      let artist = 'Unknown Artist';
      let album = 'Unknown Album';
      let albumCover = null;
      
      // Try to read metadata
      try {
        if (metadataCache[filePath]) {
          // Use cached metadata
          const cached = metadataCache[filePath];
          title = cached.title || title;
          artist = cached.artist || artist;
          album = cached.album || album;
          albumCover = cached.albumCover;
        } else {
          // Parse metadata
          const metadata = await mm.parseFile(filePath);
          
          if (metadata.common.title) {
            title = metadata.common.title;
          }
          if (metadata.common.artist) {
            artist = metadata.common.artist;
          }
          if (metadata.common.album) {
            album = metadata.common.album;
          }
          
          // Extract album cover
          albumCover = await extractAlbumCover(filePath, trackId);
          
          // Cache the metadata
          metadataCache[filePath] = {
            title,
            artist,
            album,
            albumCover
          };
        }
      } catch (error) {
        console.error(`Error reading metadata for ${file}:`, error.message);
      }
      
      tracks.push({
        id: trackId,
        title: title,
        artist: artist,
        album: album,
        filename: file,
        url: `/musics/side ${side.toLowerCase()}/${encodeURIComponent(file)}`,
        albumCover: albumCover,
        size: stats.size,
        trackNumber: index + 1
      });
    }
    
    return tracks;
  };
  
  const sideA = await getSongsFromFolder(sideAFolder, 'A');
  const sideB = await getSongsFromFolder(sideBFolder, 'B');
  
  return { sideA, sideB };
}

// === ROUTES ===

// Health check
app.get('/api/health', async (req, res) => {
  const playlists = await loadMusicFiles();
  res.json({ 
    status: 'Server is running!', 
    timestamp: new Date(),
    sideA: playlists.sideA.length + ' tracks',
    sideB: playlists.sideB.length + ' tracks'
  });
});

// Get all playlists (automatically scans folders)
app.get('/api/playlists', async (req, res) => {
  try {
    const playlists = await loadMusicFiles();
    res.json(playlists);
  } catch (error) {
    console.error('Error loading playlists:', error);
    res.status(500).json({ error: 'Failed to load playlists' });
  }
});

// Get specific side
app.get('/api/playlists/:side', async (req, res) => {
  try {
    const side = req.params.side.toUpperCase();
    const playlists = await loadMusicFiles();
    
    if (side === 'A') {
      res.json({ side: 'A', tracks: playlists.sideA });
    } else if (side === 'B') {
      res.json({ side: 'B', tracks: playlists.sideB });
    } else {
      res.status(404).json({ error: 'Side not found. Use A or B' });
    }
  } catch (error) {
    console.error('Error loading side:', error);
    res.status(500).json({ error: 'Failed to load side' });
  }
});

// Get current session
app.get('/api/session', (req, res) => {
  res.json(userSession);
});

// Update session (save playback state)
app.post('/api/session', (req, res) => {
  const { currentSide, currentTrackId, currentTime, volume, tapeMode, isPlaying } = req.body;
  
  if (currentSide) userSession.currentSide = currentSide;
  if (currentTrackId !== undefined) userSession.currentTrackId = currentTrackId;
  if (currentTime !== undefined) userSession.currentTime = currentTime;
  if (volume !== undefined) userSession.volume = volume;
  if (tapeMode !== undefined) userSession.tapeMode = tapeMode;
  if (isPlaying !== undefined) userSession.isPlaying = isPlaying;
  
  res.json({ 
    success: true, 
    message: 'Session saved',
    session: userSession 
  });
});

// Update tape mode
app.put('/api/session/tape-mode', (req, res) => {
  const { enabled } = req.body;
  userSession.tapeMode = enabled;
  
  res.json({ 
    success: true, 
    tapeMode: userSession.tapeMode
  });
});

// Update volume
app.put('/api/session/volume', (req, res) => {
  const { volume } = req.body;
  
  if (volume < 0 || volume > 100) {
    return res.status(400).json({ error: 'Volume must be between 0 and 100' });
  }
  
  userSession.volume = volume;
  res.json({ success: true, volume: userSession.volume });
});

// Refresh playlists (rescan folders and clear cache)
app.post('/api/refresh', async (req, res) => {
  try {
    metadataCache = {}; // Clear cache
    const playlists = await loadMusicFiles();
    res.json({
      success: true,
      message: 'Playlists refreshed',
      sideA: playlists.sideA.length,
      sideB: playlists.sideB.length
    });
  } catch (error) {
    console.error('Error refreshing playlists:', error);
    res.status(500).json({ error: 'Failed to refresh playlists' });
  }
});

// Reset session
app.post('/api/session/reset', (req, res) => {
  userSession = {
    currentSide: 'A',
    currentTrackId: null,
    currentTime: 0,
    volume: 75,
    tapeMode: true,
    isPlaying: false
  };
  
  res.json({ 
    success: true, 
    message: 'Session reset'
  });
});

// Start server
const PORT = process.env.PORT || 5000;

async function startServer() {
  app.listen(PORT, async () => {
    console.log(`\n🎵 TAPE PLAYER BACKEND - AUTO-LOAD MODE WITH METADATA\n`);
    console.log(`Server: http://localhost:${PORT}`);
    console.log(`Health: http://localhost:${PORT}/api/health\n`);
    
    console.log(`📁 MUSIC FOLDERS:`);
    console.log(`   Side A: ${sideAFolder}`);
    console.log(`   Side B: ${sideBFolder}`);
    console.log(`   Covers: ${coversFolder}\n`);
    
    console.log(`🔄 Loading tracks and extracting metadata...\n`);
    
    try {
      const playlists = await loadMusicFiles();
      console.log(`🎶 LOADED TRACKS:`);
      console.log(`   Side A: ${playlists.sideA.length} tracks`);
      console.log(`   Side B: ${playlists.sideB.length} tracks\n`);
      
      if (playlists.sideA.length === 0 && playlists.sideB.length === 0) {
        console.log(`⚠️  No music files found!`);
        console.log(`   Drop your MP3/WAV files into:`);
        console.log(`   - ${sideAFolder}`);
        console.log(`   - ${sideBFolder}\n`);
      } else {
        console.log(`✅ Ready to play!\n`);
        
        // Show sample tracks
        if (playlists.sideA.length > 0) {
          console.log(`📀 Side A Sample:`);
          playlists.sideA.slice(0, 3).forEach(track => {
            console.log(`   - ${track.title} by ${track.artist}`);
          });
          console.log();
        }
      }
    } catch (error) {
      console.error('Error during startup:', error);
    }
  });
}

startServer();