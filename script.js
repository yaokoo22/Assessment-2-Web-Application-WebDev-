// Configuration
const API_URL = 'http://localhost:5000';

// State
let playlists = { sideA: [], sideB: [] };
let currentSide = 'A';
let currentTrackIndex = 0;
let isPlaying = false;
let tapeMode = true;
let audioPlayer = document.getElementById('audioPlayer');
let trackListVisible = false;
let isMuted = false;
let lastVolume = 75;
let savedTimestamp = 0; // For continuing playback when switching sides

// Audio Context for frequency visualization
let audioContext;
let analyser;
let dataArray;
let bufferLength;
let animationId;

// Initialize
window.addEventListener('load', () => {
    loadPlaylists();
    loadSession();
    setupAudioListeners();
    initAudioContext();
    createFrequencyBars();
});

// Initialize Web Audio API
function initAudioContext() {
    try {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 128;
        
        const source = audioContext.createMediaElementSource(audioPlayer);
        source.connect(analyser);
        analyser.connect(audioContext.destination);
        
        bufferLength = analyser.frequencyBinCount;
        dataArray = new Uint8Array(bufferLength);
    } catch (error) {
        console.error('Web Audio API not supported:', error);
    }
}

// Create frequency bars
function createFrequencyBars() {
    const visualizer = document.getElementById('frequencyVisualizer');
    visualizer.innerHTML = '';
    
    const numBars = 50;
    for (let i = 0; i < numBars; i++) {
        const bar = document.createElement('div');
        bar.className = 'freq-bar';
        bar.style.height = '5%';
        visualizer.appendChild(bar);
    }
}

// Update frequency visualization
function updateFrequencyVisualization() {
    if (!analyser || !isPlaying) {
        animationId = requestAnimationFrame(updateFrequencyVisualization);
        return;
    }
    
    analyser.getByteFrequencyData(dataArray);
    
    const bars = document.querySelectorAll('.freq-bar');
    const step = Math.floor(dataArray.length / bars.length);
    
    bars.forEach((bar, index) => {
        const dataIndex = index * step;
        const value = dataArray[dataIndex];
        const height = (value / 255) * 100;
        bar.style.height = Math.max(height, 3) + '%';
    });
    
    animationId = requestAnimationFrame(updateFrequencyVisualization);
}

// Start frequency visualization
function startFrequencyVisualization() {
    if (audioContext && audioContext.state === 'suspended') {
        audioContext.resume();
    }
    updateFrequencyVisualization();
}

// Stop frequency visualization
function stopFrequencyVisualization() {
    if (animationId) {
        cancelAnimationFrame(animationId);
    }
    const bars = document.querySelectorAll('.freq-bar');
    bars.forEach(bar => {
        bar.style.height = '5%';
    });
}

// Toggle mute
function toggleMute() {
    const volumeIcon = document.getElementById('volumeIcon');
    
    if (isMuted) {
        // Unmute
        audioPlayer.volume = lastVolume / 100;
        document.getElementById('volumeBarFill').style.width = lastVolume + '%';
        volumeIcon.textContent = lastVolume > 50 ? '🔊' : lastVolume > 0 ? '🔉' : '🔈';
        isMuted = false;
    } else {
        // Mute
        lastVolume = Math.round(audioPlayer.volume * 100);
        audioPlayer.volume = 0;
        document.getElementById('volumeBarFill').style.width = '0%';
        volumeIcon.textContent = '🔇';
        isMuted = true;
    }
}

// Skip forward 10 seconds
function skipForward() {
    audioPlayer.currentTime = Math.min(audioPlayer.currentTime + 10, audioPlayer.duration);
}

// Skip backward 10 seconds
function skipBackward() {
    audioPlayer.currentTime = Math.max(audioPlayer.currentTime - 10, 0);
}

// Toggle track list
function toggleTrackList() {
    trackListVisible = !trackListVisible;
    const trackList = document.getElementById('trackList');
    trackList.style.display = trackListVisible ? 'block' : 'none';
}

// Volume control via mini bar
function changeVolume(event) {
    const bar = event.currentTarget;
    const clickX = event.offsetX;
    const width = bar.offsetWidth;
    const percentage = (clickX / width) * 100;
    
    audioPlayer.volume = percentage / 100;
    document.getElementById('volumeBarFill').style.width = percentage + '%';
    
    // Update volume icon
    const volumeIcon = document.getElementById('volumeIcon');
    if (percentage === 0) {
        volumeIcon.textContent = '🔇';
        isMuted = true;
    } else {
        volumeIcon.textContent = percentage > 50 ? '🔊' : '🔉';
        isMuted = false;
        lastVolume = percentage;
    }
    
    saveVolumeToBackend(percentage);
}

async function saveVolumeToBackend(value) {
    try {
        await fetch(`${API_URL}/api/session/volume`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ volume: parseInt(value) })
        });
    } catch (error) {
        console.error('Error saving volume:', error);
    }
}

// Load playlists
async function loadPlaylists() {
    try {
        setStatus('Loading tracks...');
        const response = await fetch(`${API_URL}/api/playlists`);
        const data = await response.json();
        
        playlists = data;
        
        if (playlists.sideA.length === 0 && playlists.sideB.length === 0) {
            setStatus('No tracks found');
        } else {
            setStatus(`Loaded ${playlists.sideA.length + playlists.sideB.length} tracks`);
            updateTrackList();
            
            if (getCurrentPlaylist().length > 0) {
                loadTrack(0);
            }
        }
    } catch (error) {
        console.error('Error loading playlists:', error);
        setStatus('Error: Cannot connect to server');
    }
}

// Load session
async function loadSession() {
    try {
        const response = await fetch(`${API_URL}/api/session`);
        const session = await response.json();
        
        if (session.currentSide) {
            currentSide = session.currentSide;
            updateSideUI();
        }
        
        if (session.volume !== undefined) {
            audioPlayer.volume = session.volume / 100;
            lastVolume = session.volume;
            document.getElementById('volumeBarFill').style.width = session.volume + '%';
        }
        
        if (session.tapeMode !== undefined) {
            tapeMode = session.tapeMode;
            updateTapeModeUI();
        }
        
        if (session.currentTime !== undefined) {
            savedTimestamp = session.currentTime;
        }
    } catch (error) {
        console.error('Error loading session:', error);
    }
}

// Save session
async function saveSession() {
    try {
        const currentTrack = getCurrentPlaylist()[currentTrackIndex];
        await fetch(`${API_URL}/api/session`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                currentSide: currentSide,
                currentTrackId: currentTrack?.id,
                currentTime: Math.floor(audioPlayer.currentTime),
                volume: Math.round(audioPlayer.volume * 100),
                tapeMode: tapeMode,
                isPlaying: isPlaying
            })
        });
    } catch (error) {
        console.error('Error saving session:', error);
    }
}

// Get current playlist
function getCurrentPlaylist() {
    return currentSide === 'A' ? playlists.sideA : playlists.sideB;
}

// Load track with album cover support
function loadTrack(index, restoreTime = false) {
    const playlist = getCurrentPlaylist();
    
    if (index < 0 || index >= playlist.length) return;
    
    currentTrackIndex = index;
    const track = playlist[index];
    
    audioPlayer.src = `${API_URL}${track.url}`;
    
    document.getElementById('trackTitle').textContent = track.title;
    document.getElementById('trackArtist').textContent = track.artist;
    
    // Load album cover if available
    const albumCover = document.getElementById('albumCover');
    if (track.albumCover) {
        albumCover.innerHTML = `<img src="${track.albumCover}" alt="${track.title}">`;
    } else {
        // Default music icon
        albumCover.innerHTML = '🎵';
    }
    
    // Restore timestamp if switching sides
    if (restoreTime && savedTimestamp > 0) {
        audioPlayer.addEventListener('loadedmetadata', () => {
            audioPlayer.currentTime = savedTimestamp;
            savedTimestamp = 0;
        }, { once: true });
    }
    
    updateTrackList();
    saveSession();
}

// Toggle play/pause
function togglePlay() {
    if (getCurrentPlaylist().length === 0) return;
    
    if (isPlaying) {
        audioPlayer.pause();
        isPlaying = false;
        document.getElementById('playBtn').innerHTML = '▶';
        stopDisc();
        stopFrequencyVisualization();
    } else {
        audioPlayer.play().catch(error => {
            console.error('Playback failed:', error);
            setStatus('Error playing track');
        });
        isPlaying = true;
        document.getElementById('playBtn').innerHTML = '⏸';
        startDisc();
        startFrequencyVisualization();
    }
    
    saveSession();
}

// Previous track
function previousTrack() {
    if (currentTrackIndex > 0) {
        loadTrack(currentTrackIndex - 1);
        if (isPlaying) audioPlayer.play();
    }
}

// Next track
function nextTrack() {
    const playlist = getCurrentPlaylist();
    
    if (tapeMode) {
        if (currentTrackIndex < playlist.length - 1) {
            loadTrack(currentTrackIndex + 1);
            if (isPlaying) audioPlayer.play();
        } else {
            flipTape();
        }
    } else {
        if (currentTrackIndex < playlist.length - 1) {
            loadTrack(currentTrackIndex + 1);
            if (isPlaying) audioPlayer.play();
        }
    }
}

// Switch side (with timestamp continuation)
function switchSide(side) {
    if (tapeMode && isPlaying) {
        setStatus('Stop playback to flip tape');
        return;
    }
    
    // Save current timestamp
    savedTimestamp = audioPlayer.currentTime;
    
    currentSide = side;
    currentTrackIndex = 0;
    updateSideUI();
    updateTrackList();
    
    if (getCurrentPlaylist().length > 0) {
        loadTrack(0, true); // Pass true to restore timestamp
    }
    
    saveSession();
}

// Flip tape (auto switch to other side, continue from timestamp)
function flipTape() {
    const newSide = currentSide === 'A' ? 'B' : 'A';
    
    // Save current timestamp
    savedTimestamp = audioPlayer.currentTime;
    
    currentSide = newSide;
    currentTrackIndex = 0;
    
    updateSideUI();
    updateTrackList();
    
    setStatus(`Flipped to Side ${newSide}`);
    
    if (getCurrentPlaylist().length > 0) {
        loadTrack(0, true); // Pass true to restore timestamp
        if (isPlaying) {
            setTimeout(() => audioPlayer.play(), 500);
        }
    }
    
    saveSession();
}

// Toggle tape mode
async function toggleTapeMode() {
    tapeMode = !tapeMode;
    updateTapeModeUI();
    
    try {
        await fetch(`${API_URL}/api/session/tape-mode`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabled: tapeMode })
        });
    } catch (error) {
        console.error('Error updating tape mode:', error);
    }
}

// Seek to position
function seekTo(event) {
    const progressBar = event.currentTarget;
    const clickX = event.offsetX;
    const width = progressBar.offsetWidth;
    const percentage = clickX / width;
    audioPlayer.currentTime = percentage * audioPlayer.duration;
}

// Update track list
function updateTrackList() {
    const playlist = getCurrentPlaylist();
    const trackListEl = document.getElementById('trackList');
    
    if (playlist.length === 0) {
        trackListEl.innerHTML = '<div class="track-item">No tracks on this side</div>';
        return;
    }
    
    trackListEl.innerHTML = playlist.map((track, index) => `
        <div class="track-item ${index === currentTrackIndex ? 'active' : ''}" onclick="selectTrack(${index})">
            <span><span class="track-number">${index + 1}.</span>${track.title}</span>
        </div>
    `).join('');
}

// Select track
function selectTrack(index) {
    loadTrack(index);
    if (isPlaying) audioPlayer.play();
}

// Update side UI
function updateSideUI() {
    document.getElementById('sideABtn').classList.toggle('active', currentSide === 'A');
    document.getElementById('sideBBtn').classList.toggle('active', currentSide === 'B');
}

// Update tape mode UI
function updateTapeModeUI() {
    document.getElementById('tapeModeToggle').classList.toggle('active', tapeMode);
    const label = document.querySelector('.tape-mode-label');
    label.textContent = tapeMode ? 'TAPE ON' : 'TAPE OFF';
    setStatus(`Tape Mode: ${tapeMode ? 'ON' : 'OFF'}`);
}

// Disc animations
function startDisc() {
    document.getElementById('albumDisc').classList.add('spinning');
}

function stopDisc() {
    document.getElementById('albumDisc').classList.remove('spinning');
}

// Audio event listeners
function setupAudioListeners() {
    audioPlayer.addEventListener('timeupdate', () => {
        const progress = (audioPlayer.currentTime / audioPlayer.duration) * 100;
        document.getElementById('progressFill').style.width = progress + '%';
        document.getElementById('currentTime').textContent = formatTime(audioPlayer.currentTime);
        document.getElementById('totalTime').textContent = formatTime(audioPlayer.duration);
    });

    audioPlayer.addEventListener('ended', () => {
        nextTrack();
    });

    audioPlayer.addEventListener('error', (e) => {
        console.error('Audio error:', e);
        setStatus('Error playing track');
        isPlaying = false;
        document.getElementById('playBtn').innerHTML = '▶';
        stopDisc();
        stopFrequencyVisualization();
    });
    
    // Handle when audio can play
    audioPlayer.addEventListener('canplay', () => {
        if (isPlaying) {
            audioPlayer.play();
        }
    });
}

// Format time
function formatTime(seconds) {
    if (isNaN(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// Set status
function setStatus(message) {
    document.getElementById('statusBar').textContent = message;
}

// Auto-save session
setInterval(() => {
    if (isPlaying) saveSession();
}, 10000);