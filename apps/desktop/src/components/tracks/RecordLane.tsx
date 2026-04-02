import { useState, useEffect, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';
import { api } from '../../lib/api';
import { useProjectStore } from '../../stores/projectStore';

interface RecordLaneProps {
  projectId?: string;
  onRecordingUploaded?: (fileId: string, fileName: string) => void;
}

export default function RecordLane({ projectId, onRecordingUploaded }: RecordLaneProps) {
  const [levelL, setLevelL] = useState(0);
  const [levelR, setLevelR] = useState(0);
  const [isRecording, setIsRecording] = useState(false);
  const [recordTime, setRecordTime] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState('');
  const timerRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(0);
  const levelHistoryRef = useRef<{ l: number; r: number }[]>([]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const wasRecordingRef = useRef(false);
  const fetchProject = useProjectStore((s) => s.fetchProject);

  // Register the global callback for C++ level data
  useEffect(() => {
    (window as any).__ghostAudioLevels__ = (left: number, right: number, recording: boolean) => {
      setLevelL(left);
      setLevelR(right);
      setIsRecording(recording);

      if (recording) {
        levelHistoryRef.current.push({ l: left, r: right });
      }

      // Detect recording just stopped → upload
      if (wasRecordingRef.current && !recording) {
        wasRecordingRef.current = false;
      }
      if (recording) {
        wasRecordingRef.current = true;
      }
    };

    (window as any).__ghostRecordingComplete__ = async (fileName: string, sizeKB: number) => {
      if (!projectId) return;
      setUploading(true);
      setUploadStatus(`Uploading ${fileName}...`);

      try {
        // Tell C++ to upload the recording via postMessage
        try {
          if ((window as any).chrome?.webview?.postMessage) {
            (window as any).chrome.webview.postMessage(`upload-recording:projectId=${encodeURIComponent(projectId)}&fileName=${encodeURIComponent(fileName)}`);
          }
        } catch {}

        setUploadStatus(`Saved: ${fileName} (${sizeKB}KB)`);
        setTimeout(() => {
          setUploadStatus('');
          setUploading(false);
          // Refresh project to show new track
          if (projectId) fetchProject(projectId);
        }, 2000);
      } catch (err: any) {
        setUploadStatus('Upload failed');
        setUploading(false);
      }
    };

    return () => {
      delete (window as any).__ghostAudioLevels__;
      delete (window as any).__ghostRecordingComplete__;
    };
  }, [projectId]);

  // Record timer
  useEffect(() => {
    if (isRecording) {
      startTimeRef.current = Date.now();
      timerRef.current = window.setInterval(() => {
        setRecordTime((Date.now() - startTimeRef.current) / 1000);
      }, 50);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [isRecording]);

  // Draw waveform on canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Match canvas resolution to actual display size
    const rect = canvas.getBoundingClientRect();
    const dpr = 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;

    let animId: number;
    const draw = () => {
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      const history = levelHistoryRef.current;
      const avg = (levelL + levelR) / 2;

      if (isRecording && history.length > 0) {
        // Pixels per sample at 30fps — auto-scroll when waveform exceeds width
        const pixelsPerSample = 2;
        const totalWidth = history.length * pixelsPerSample;
        const offsetX = Math.max(0, totalWidth - w);

        // Draw center line
        ctx.strokeStyle = 'rgba(255,255,255,0.06)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, h / 2);
        ctx.lineTo(w, h / 2);
        ctx.stroke();

        // Draw waveform bars
        for (let i = 0; i < history.length; i++) {
          const x = i * pixelsPerSample - offsetX;
          if (x < -pixelsPerSample || x > w) continue;

          const sample = history[i];
          const ampL = sample.l * h * 0.45;
          const ampR = sample.r * h * 0.45;

          // Top half = left channel (cyan-purple gradient)
          const gradTop = ctx.createLinearGradient(x, h / 2 - ampL, x, h / 2);
          gradTop.addColorStop(0, 'rgba(0, 255, 200, 0.9)');
          gradTop.addColorStop(1, 'rgba(124, 58, 237, 0.7)');
          ctx.fillStyle = gradTop;
          ctx.fillRect(x, h / 2 - ampL, pixelsPerSample - 1, ampL);

          // Bottom half = right channel
          const gradBot = ctx.createLinearGradient(x, h / 2, x, h / 2 + ampR);
          gradBot.addColorStop(0, 'rgba(124, 58, 237, 0.7)');
          gradBot.addColorStop(1, 'rgba(0, 255, 200, 0.9)');
          ctx.fillStyle = gradBot;
          ctx.fillRect(x, h / 2, pixelsPerSample - 1, ampR);
        }

        // Playhead — white line at current position
        const playheadX = Math.min(totalWidth - offsetX, w);
        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = 2;
        ctx.shadowColor = 'rgba(255,255,255,0.5)';
        ctx.shadowBlur = 6;
        ctx.beginPath();
        ctx.moveTo(playheadX, 0);
        ctx.lineTo(playheadX, h);
        ctx.stroke();
        ctx.shadowBlur = 0;

        // Glow triangle at top of playhead
        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath();
        ctx.moveTo(playheadX - 4, 0);
        ctx.lineTo(playheadX + 4, 0);
        ctx.lineTo(playheadX, 6);
        ctx.closePath();
        ctx.fill();

      } else if (!isRecording && history.length > 0) {
        // Show the finished recording waveform (static)
        const pixelsPerSample = Math.max(1, w / history.length);

        ctx.strokeStyle = 'rgba(255,255,255,0.06)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, h / 2);
        ctx.lineTo(w, h / 2);
        ctx.stroke();

        for (let i = 0; i < history.length; i++) {
          const x = i * pixelsPerSample;
          if (x > w) break;
          const sample = history[i];
          const ampL = sample.l * h * 0.45;
          const ampR = sample.r * h * 0.45;

          ctx.fillStyle = 'rgba(124, 58, 237, 0.6)';
          ctx.fillRect(x, h / 2 - ampL, Math.max(1, pixelsPerSample - 1), ampL);
          ctx.fillRect(x, h / 2, Math.max(1, pixelsPerSample - 1), ampR);
        }
      } else {
        // No recording — show live input visualization
        ctx.strokeStyle = 'rgba(255,255,255,0.04)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, h / 2);
        ctx.lineTo(w, h / 2);
        ctx.stroke();

        if (avg > 0.005) {
          const barCount = 80;
          const barWidth = w / barCount;
          for (let i = 0; i < barCount; i++) {
            const dist = Math.abs(i - barCount / 2) / (barCount / 2);
            const amplitude = avg * (1 - dist * 0.5) * (0.7 + Math.random() * 0.6);
            const barH = amplitude * h * 0.8;
            const gradient = ctx.createLinearGradient(0, (h - barH) / 2, 0, (h + barH) / 2);
            gradient.addColorStop(0, 'rgba(0, 255, 200, 0.5)');
            gradient.addColorStop(0.5, 'rgba(124, 58, 237, 0.7)');
            gradient.addColorStop(1, 'rgba(0, 255, 200, 0.5)');
            ctx.fillStyle = gradient;
            ctx.fillRect(i * barWidth + 1, (h - barH) / 2, barWidth - 2, barH);
          }
        }
      }

      animId = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(animId);
  }, [levelL, levelR, isRecording]);

  // Send command to C++ via WebView2 postMessage (native JS→C++ channel)
  const sendToPlugin = useCallback((msg: string) => {
    try {
      if ((window as any).chrome?.webview?.postMessage) {
        (window as any).chrome.webview.postMessage(msg);
      }
    } catch {}
  }, []);

  const handleRecord = useCallback(() => {
    if (isRecording) {
      sendToPlugin('stop-recording');
    } else {
      levelHistoryRef.current = [];
      setRecordTime(0);
      sendToPlugin('start-recording');
    }
  }, [isRecording, sendToPlugin]);

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    const ms = Math.floor((s % 1) * 10);
    return `${m}:${sec.toString().padStart(2, '0')}.${ms}`;
  };

  const meterPercent = (v: number) => Math.min(100, Math.round(v * 100));

  const hasSignal = levelL > 0.005 || levelR > 0.005;
  const hasRecordedData = levelHistoryRef.current.length > 0;

  return (
    <div className="rounded-xl overflow-hidden mt-2 border border-ghost-border/20" ref={containerRef}>
      {/* Header bar */}
      <div className="flex items-center gap-3 px-4 py-2 bg-ghost-surface/60">
        {/* Record button */}
        <motion.button
          onClick={handleRecord}
          className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${
            isRecording
              ? 'shadow-[0_0_24px_rgba(237,66,69,0.6),0_2px_8px_rgba(0,0,0,0.3)]'
              : 'shadow-[0_2px_8px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.15)] hover:shadow-[0_0_20px_rgba(237,66,69,0.4)]'
          }`}
          style={{ background: isRecording ? 'linear-gradient(180deg, #ED4245 0%, #A12D2F 100%)' : 'linear-gradient(180deg, #DC2626 0%, #991B1B 100%)' }}
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.9 }}
        >
          {isRecording ? (
            <div className="w-3.5 h-3.5 rounded-sm bg-white" />
          ) : (
            <div className="w-4 h-4 rounded-full bg-white" />
          )}
        </motion.button>

        <div className="flex flex-col">
          <span className="text-[12px] font-bold text-white uppercase tracking-wide">
            {isRecording ? 'Recording' : uploading ? 'Uploading...' : 'Record'}
          </span>
          <span className="text-[10px] text-ghost-text-muted/60">
            {isRecording ? formatTime(recordTime) : hasRecordedData && !isRecording ? 'Recording complete' : 'Waiting for input'}
          </span>
        </div>

        {isRecording && (
          <motion.span
            className="flex items-center gap-1.5 ml-2"
            animate={{ opacity: [1, 0.3, 1] }}
            transition={{ duration: 1, repeat: Infinity }}
          >
            <span className="w-2.5 h-2.5 rounded-full bg-red-500" />
            <span className="text-[11px] text-red-400 font-bold uppercase">REC</span>
          </motion.span>
        )}

        {uploadStatus && (
          <span className="text-[11px] text-ghost-green ml-2 font-medium">{uploadStatus}</span>
        )}

        <div className="flex-1" />

        {/* Timecode */}
        {isRecording && (
          <span className="text-[16px] font-mono text-white/80 tabular-nums mr-3">
            {formatTime(recordTime)}
          </span>
        )}

        {/* Level meters - vertical style */}
        <div className="flex items-end gap-1 h-7">
          <div className="flex flex-col items-center gap-0.5">
            <div className="w-3 h-6 rounded-sm bg-black/50 overflow-hidden flex flex-col-reverse">
              <div
                className="w-full rounded-sm transition-all duration-75"
                style={{
                  height: `${meterPercent(levelL)}%`,
                  background: levelL > 0.85 ? '#ED4245' : levelL > 0.5 ? '#F0B232' : '#23A559',
                }}
              />
            </div>
            <span className="text-[7px] text-ghost-text-muted/50">L</span>
          </div>
          <div className="flex flex-col items-center gap-0.5">
            <div className="w-3 h-6 rounded-sm bg-black/50 overflow-hidden flex flex-col-reverse">
              <div
                className="w-full rounded-sm transition-all duration-75"
                style={{
                  height: `${meterPercent(levelR)}%`,
                  background: levelR > 0.85 ? '#ED4245' : levelR > 0.5 ? '#F0B232' : '#23A559',
                }}
              />
            </div>
            <span className="text-[7px] text-ghost-text-muted/50">R</span>
          </div>
        </div>
      </div>

      {/* Waveform area — DAW-style */}
      <div className={`relative bg-[#080214] overflow-hidden transition-all ${isRecording ? 'h-[95px]' : hasRecordedData ? 'h-[95px]' : 'h-[60px]'}`}>
        <canvas
          ref={canvasRef}
          className="w-full h-full"
          style={{ display: 'block' }}
        />

        {/* Empty state */}
        {!isRecording && !hasSignal && !hasRecordedData && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span className="text-[12px] text-ghost-text-muted/30 font-medium">
              Route audio to this track to see levels
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
