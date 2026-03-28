import { create } from 'zustand';
import { api } from '../lib/api';
import { FFT_SIZE, SMOOTHING_TIME_CONSTANT, PITCH_MIN, PITCH_MAX } from '../lib/constants';
import { audioBufferCache, cacheBuffer, clearAudioCaches } from '../lib/audio';

interface LoadedTrack {
  id: string;
  buffer: AudioBuffer;
  source: AudioBufferSourceNode | null;
  gainNode: GainNode | null;
  volume: number;
  muted: boolean;
  soloed: boolean;
  bpm: number;
  pitch: number;
}

interface UndoSnapshot {
  trackId: string;
  buffer: AudioBuffer;
  fileId?: string;
}

interface AudioState {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  projectBpm: number;
  canUndo: boolean;
  canRedo: boolean;
  bufferVersion: number;
  loadedTracks: Map<string, LoadedTrack>;
  soloActive: boolean;
  soloPlayingTrackId: string | null;
  soloCurrentTime: number;
  soloDuration: number;
  loadError: string | null;

  loadTrack: (trackId: string, fileId: string, projectId: string, trackBpm?: number) => Promise<void>;
  loadTrackFromBuffer: (trackId: string, buffer: AudioBuffer, trackBpm?: number) => void;
  unloadTrack: (trackId: string) => void;
  setProjectBpm: (bpm: number) => void;
  setTrackBpm: (trackId: string, bpm: number) => void;
  play: () => void;
  pause: () => void;
  stop: () => void;
  seekTo: (time: number) => void;
  playSoloTrack: (trackId: string) => void;
  stopSoloTrack: () => void;
  setTrackVolume: (trackId: string, volume: number) => void;
  setTrackMuted: (trackId: string, muted: boolean) => void;
  removeTrack: (trackId: string) => void;
  loopTrackToFill: (trackId: string, fileId?: string) => void;
  undo: () => void;
  redo: () => void;
  setTrackSoloed: (trackId: string, soloed: boolean) => void;
  setTrackPitch: (trackId: string, semitones: number) => void;
  cleanup: () => void;
}

let audioCtx: AudioContext | null = null;
let masterGain: GainNode | null = null;
let analyserNode: AnalyserNode | null = null;

export function getAnalyser(): AnalyserNode | null {
  return analyserNode;
}
let startedAt = 0;
let pausedAt = 0;
let rafId: number | null = null;
const undoStack: UndoSnapshot[] = [];
const redoStack: UndoSnapshot[] = [];
let soloSource: AudioBufferSourceNode | null = null;
let soloGain: GainNode | null = null;
let soloStartedAt = 0;
let soloRafId: number | null = null;

function getCtx() {
  if (!audioCtx) {
    audioCtx = new AudioContext();
    masterGain = audioCtx.createGain();
    analyserNode = audioCtx.createAnalyser();
    analyserNode.fftSize = FFT_SIZE;
    analyserNode.smoothingTimeConstant = SMOOTHING_TIME_CONSTANT;
    masterGain.connect(analyserNode);
    analyserNode.connect(audioCtx.destination);
  }
  return audioCtx;
}

function getMaster() {
  getCtx();
  return masterGain!;
}

export const useAudioStore = create<AudioState>((set, get) => {

  function recalcDuration() {
    const { loadedTracks } = get();
    let maxDur = 0;
    loadedTracks.forEach((t) => {
      if (t.buffer.duration > maxDur) maxDur = t.buffer.duration;
    });
    set({ duration: maxDur });
  }

  function updatePosition() {
    const ctx = audioCtx;
    if (!ctx || !get().isPlaying) return;
    const elapsed = ctx.currentTime - startedAt;
    const dur = get().duration;
    const wrapped = dur > 0 ? elapsed % dur : elapsed;
    set({ currentTime: wrapped });
    rafId = requestAnimationFrame(updatePosition);
  }

  let loopTimer: ReturnType<typeof setTimeout> | null = null;

  function startAllSources(offset: number) {
    const ctx = getCtx();
    const { loadedTracks } = get();

    // Clear any pending loop restart
    if (loopTimer) { clearTimeout(loopTimer); loopTimer = null; }

    loadedTracks.forEach((track) => {
      if (track.source) {
        try { track.source.stop(); } catch {}
      }

      const source = ctx.createBufferSource();
      source.buffer = track.buffer;
      source.playbackRate.value = 1;
      source.loop = false; // No individual looping — we loop all tracks together

      const gain = ctx.createGain();
      gain.gain.value = track.muted ? 0 : track.volume;
      source.connect(gain);
      gain.connect(getMaster());

      const trackOffset = offset % track.buffer.duration;
      source.start(0, trackOffset);

      track.source = source;
      track.gainNode = gain;
    });

    startedAt = ctx.currentTime - offset;
    updateSoloState();

    // Schedule a synchronized loop restart when the longest track ends
    const dur = get().duration;
    if (dur > 0) {
      const remaining = dur - (offset % dur);
      loopTimer = setTimeout(() => {
        if (get().isPlaying) {
          startAllSources(0);
        }
      }, remaining * 1000);
    }
  }

  function stopAllSources() {
    if (loopTimer) { clearTimeout(loopTimer); loopTimer = null; }
    const { loadedTracks } = get();
    loadedTracks.forEach((track) => {
      if (track.source) {
        try { track.source.stop(); } catch {}
        track.source = null;
        track.gainNode = null;
      }
    });
  }

  function updateSoloState() {
    const { loadedTracks } = get();
    const anySoloed = Array.from(loadedTracks.values()).some((t) => t.soloed);
    set({ soloActive: anySoloed });

    loadedTracks.forEach((track) => {
      if (track.gainNode) {
        if (track.muted) {
          track.gainNode.gain.value = 0;
        } else if (anySoloed) {
          track.gainNode.gain.value = track.soloed ? track.volume : 0;
        } else {
          track.gainNode.gain.value = track.volume;
        }
      }
    });
  }

  function restartIfPlaying() {
    const wasPlaying = get().isPlaying;
    if (wasPlaying) {
      const ctx = getCtx();
      const currentOffset = ctx.currentTime - startedAt;
      stopAllSources();
      if (rafId) cancelAnimationFrame(rafId);
      startAllSources(currentOffset);
      set({ isPlaying: true });
      rafId = requestAnimationFrame(updatePosition);
    }
    recalcDuration();
  }

  return {
    isPlaying: false,
    currentTime: 0,
    duration: 0,
    projectBpm: 0,
    canUndo: false,
    canRedo: false,
    bufferVersion: 0,
    loadedTracks: new Map(),
    soloActive: false,
    soloPlayingTrackId: null,
    soloCurrentTime: 0,
    soloDuration: 0,
    loadError: null,

    loadTrack: async (trackId, fileId, projectId, trackBpm = 0) => {
      if (audioBufferCache.has(fileId)) {
        const cachedBuf = audioBufferCache.get(fileId)!;
        set((s) => {
          const m = new Map(s.loadedTracks);
          const existing = m.get(trackId);
          m.set(trackId, {
            id: trackId, buffer: cachedBuf, source: null, gainNode: null,
            volume: existing?.volume ?? 1, muted: existing?.muted ?? false,
            soloed: existing?.soloed ?? false, bpm: trackBpm || existing?.bpm || 0, pitch: existing?.pitch ?? 0,
          });
          return { loadedTracks: m };
        });
        recalcDuration();
        return;
      }

      try {
        const arrayBuffer = await api.downloadFile(projectId, fileId);
        const tempCtx = new AudioContext();
        const buffer = await tempCtx.decodeAudioData(arrayBuffer);
        await tempCtx.close();
        cacheBuffer(fileId, buffer);

        set((s) => {
          const m = new Map(s.loadedTracks);
          m.set(trackId, {
            id: trackId, buffer, source: null, gainNode: null,
            volume: 1, muted: false, soloed: false, bpm: trackBpm, pitch: 0,
          });
          return { loadedTracks: m };
        });
        recalcDuration();
      } catch (err: any) {
        console.error('[AudioStore] Failed to load track:', trackId, 'fileId:', fileId, err);
        set({ loadError: `Track ${trackId}: ${err?.message || err}` });
      }
    },

    loadTrackFromBuffer: (trackId, buffer, trackBpm = 0) => {
      set((s) => {
        const m = new Map(s.loadedTracks);
        const existing = m.get(trackId);
        m.set(trackId, {
          id: trackId, buffer, source: null, gainNode: null,
          volume: existing?.volume ?? 1, muted: existing?.muted ?? false,
          soloed: existing?.soloed ?? false, bpm: trackBpm || existing?.bpm || 0,
          pitch: existing?.pitch ?? 0,
        });
        return { loadedTracks: m };
      });
      recalcDuration();
    },

    setProjectBpm: (bpm) => {
      set({ projectBpm: bpm });
      restartIfPlaying();
    },

    setTrackBpm: (trackId, bpm) => {
      const { loadedTracks } = get();
      const track = loadedTracks.get(trackId);
      if (track) {
        track.bpm = bpm;
        set({ loadedTracks: new Map(loadedTracks) });
        restartIfPlaying();
      }
    },

    unloadTrack: (trackId) => {
      const { loadedTracks } = get();
      const track = loadedTracks.get(trackId);
      if (track?.source) {
        try { track.source.stop(); } catch {}
      }
      loadedTracks.delete(trackId);
      set({ loadedTracks: new Map(loadedTracks) });
      recalcDuration();
    },

    play: () => {
      if (get().isPlaying) return;
      const ctx = getCtx();
      if (ctx.state === 'suspended') ctx.resume();
      pausedAt = 0;
      startAllSources(0);
      set({ isPlaying: true, currentTime: 0 });
      rafId = requestAnimationFrame(updatePosition);
    },

    pause: () => {
      if (!get().isPlaying) return;
      const ctx = getCtx();
      pausedAt = ctx.currentTime - startedAt;
      stopAllSources();
      if (rafId) cancelAnimationFrame(rafId);
      set({ isPlaying: false, currentTime: pausedAt });
    },

    stop: () => {
      stopAllSources();
      if (rafId) cancelAnimationFrame(rafId);
      pausedAt = 0;
      startedAt = 0;
      set({ isPlaying: false, currentTime: 0 });
    },

    seekTo: (time) => {
      const wasPlaying = get().isPlaying;
      stopAllSources();
      if (rafId) cancelAnimationFrame(rafId);
      pausedAt = time;
      set({ currentTime: time });
      if (wasPlaying) {
        startAllSources(time);
        set({ isPlaying: true });
        rafId = requestAnimationFrame(updatePosition);
      }
    },

    setTrackVolume: (trackId, volume) => {
      const { loadedTracks } = get();
      const track = loadedTracks.get(trackId);
      if (track) {
        track.volume = volume;
        if (track.gainNode && !track.muted) {
          track.gainNode.gain.value = volume;
        }
        set({ loadedTracks: new Map(loadedTracks) });
      }
    },

    setTrackMuted: (trackId, muted) => {
      const { loadedTracks } = get();
      const track = loadedTracks.get(trackId);
      if (track) {
        track.muted = muted;
        set({ loadedTracks: new Map(loadedTracks) });
        updateSoloState();
      }
    },

    removeTrack: (trackId) => {
      const { loadedTracks } = get();
      const track = loadedTracks.get(trackId);
      if (track) {
        if (track.source) {
          try { track.source.stop(); } catch {}
        }
        loadedTracks.delete(trackId);
        set({ loadedTracks: new Map(loadedTracks) });
        recalcDuration();
      }
    },

    loopTrackToFill: (trackId, fileId) => {
      const { loadedTracks, duration } = get();
      const track = loadedTracks.get(trackId);
      if (!track || !track.buffer || track.buffer.duration >= duration) return;

      // Save snapshot for undo
      undoStack.push({ trackId, buffer: track.buffer, fileId });
      redoStack.length = 0;
      set({ canUndo: true, canRedo: false });

      const origBuffer = track.buffer;
      const ctx = getCtx();
      // Cap to exactly the max duration so we don't overshoot
      const targetLength = Math.round(duration * origBuffer.sampleRate);
      const newBuffer = ctx.createBuffer(origBuffer.numberOfChannels, targetLength, origBuffer.sampleRate);

      for (let ch = 0; ch < origBuffer.numberOfChannels; ch++) {
        const newData = newBuffer.getChannelData(ch);
        const origData = origBuffer.getChannelData(ch);
        for (let i = 0; i < targetLength; i++) {
          newData[i] = origData[i % origData.length];
        }
      }

      track.buffer = newBuffer;
      set({ loadedTracks: new Map(loadedTracks), bufferVersion: get().bufferVersion + 1 });
      recalcDuration();
    },

    undo: () => {
      if (undoStack.length === 0) return;
      const snapshot = undoStack.pop()!;
      const { loadedTracks } = get();
      const track = loadedTracks.get(snapshot.trackId);
      if (track) {
        // Save current state for redo
        redoStack.push({ trackId: snapshot.trackId, buffer: track.buffer, fileId: snapshot.fileId });
        // Restore old buffer
        track.buffer = snapshot.buffer;
        set({ loadedTracks: new Map(loadedTracks), canUndo: undoStack.length > 0, canRedo: true, bufferVersion: get().bufferVersion + 1 });
        recalcDuration();
      }
    },

    redo: () => {
      if (redoStack.length === 0) return;
      const snapshot = redoStack.pop()!;
      const { loadedTracks } = get();
      const track = loadedTracks.get(snapshot.trackId);
      if (track) {
        // Save current state for undo
        undoStack.push({ trackId: snapshot.trackId, buffer: track.buffer, fileId: snapshot.fileId });
        // Restore redo buffer
        track.buffer = snapshot.buffer;
        set({ loadedTracks: new Map(loadedTracks), canUndo: true, canRedo: redoStack.length > 0, bufferVersion: get().bufferVersion + 1 });
        recalcDuration();
      }
    },

    setTrackSoloed: (trackId, soloed) => {
      const { loadedTracks } = get();
      const track = loadedTracks.get(trackId);
      if (track) {
        track.soloed = soloed;
        set({ loadedTracks: new Map(loadedTracks) });
        updateSoloState();
      }
    },

    setTrackPitch: (trackId, semitones) => {
      const { loadedTracks } = get();
      const track = loadedTracks.get(trackId);
      if (track) {
        track.pitch = Math.max(PITCH_MIN, Math.min(PITCH_MAX, semitones));
        set({ loadedTracks: new Map(loadedTracks) });
        // Restart playback to apply new pitch cleanly
        restartIfPlaying();
      }
    },

    playSoloTrack: (trackId) => {
      if (soloSource) { try { soloSource.stop(); } catch {} soloSource = null; }
      if (soloGain) { soloGain.disconnect(); soloGain = null; }
      if (soloRafId) { cancelAnimationFrame(soloRafId); soloRafId = null; }
      if (get().isPlaying) { get().pause(); }

      const track = get().loadedTracks.get(trackId);
      if (!track) return;

      const ctx = getCtx();
      if (ctx.state === 'suspended') ctx.resume();

      soloSource = ctx.createBufferSource();
      soloSource.buffer = track.buffer;
      soloSource.loop = false;

      soloGain = ctx.createGain();
      soloGain.gain.value = track.volume;
      soloSource.connect(soloGain);
      soloGain.connect(getMaster());

      soloSource.onended = () => {
        if (soloRafId) { cancelAnimationFrame(soloRafId); soloRafId = null; }
        set({ soloPlayingTrackId: null, soloCurrentTime: 0, soloDuration: 0 });
        soloSource = null;
        soloGain?.disconnect();
        soloGain = null;
      };

      soloStartedAt = ctx.currentTime;
      const dur = track.buffer.duration;
      soloSource.start(0);
      set({ soloPlayingTrackId: trackId, soloCurrentTime: 0, soloDuration: dur });

      function updateSoloPos() {
        if (!get().soloPlayingTrackId) return;
        const elapsed = (audioCtx?.currentTime || 0) - soloStartedAt;
        set({ soloCurrentTime: Math.min(elapsed, dur) });
        soloRafId = requestAnimationFrame(updateSoloPos);
      }
      soloRafId = requestAnimationFrame(updateSoloPos);
    },

    stopSoloTrack: () => {
      if (soloSource) { try { soloSource.stop(); } catch {} soloSource = null; }
      if (soloGain) { soloGain.disconnect(); soloGain = null; }
      if (soloRafId) { cancelAnimationFrame(soloRafId); soloRafId = null; }
      set({ soloPlayingTrackId: null, soloCurrentTime: 0, soloDuration: 0 });
    },

    cleanup: () => {
      stopAllSources();
      if (soloSource) { try { soloSource.stop(); } catch {} soloSource = null; }
      if (soloGain) { soloGain.disconnect(); soloGain = null; }
      if (rafId) cancelAnimationFrame(rafId);
      pausedAt = 0;
      startedAt = 0;
      if (soloRafId) { cancelAnimationFrame(soloRafId); soloRafId = null; }
      undoStack.length = 0;
      redoStack.length = 0;
      clearAudioCaches();
      set({ isPlaying: false, currentTime: 0, loadedTracks: new Map(), duration: 0, projectBpm: 0, soloPlayingTrackId: null, soloCurrentTime: 0, soloDuration: 0, canUndo: false, canRedo: false });
    },
  };
});
