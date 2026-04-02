import { useState, useEffect, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';
import { api } from '../../lib/api';

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
  const levelHistoryRef = useRef<number[]>([]);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Register the global callback for C++ level data
  useEffect(() => {
    (window as any).__ghostAudioLevels__ = (left: number, right: number, recording: boolean) => {
      setLevelL(left);
      setLevelR(right);
      setIsRecording(recording);

      // Store level history for waveform visualization during recording
      if (recording) {
        levelHistoryRef.current.push((left + right) / 2);
      }
    };

    (window as any).__ghostRecordingComplete__ = (fileName: string, sizeKB: number) => {
      setUploadStatus(`Saved: ${fileName} (${sizeKB}KB)`);
      setTimeout(() => setUploadStatus(''), 4000);
    };

    return () => {
      delete (window as any).__ghostAudioLevels__;
      delete (window as any).__ghostRecordingComplete__;
    };
  }, []);

  // Record timer
  useEffect(() => {
    if (isRecording) {
      const start = Date.now();
      timerRef.current = window.setInterval(() => {
        setRecordTime(Math.floor((Date.now() - start) / 1000));
      }, 200);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
      setRecordTime(0);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [isRecording]);

  // Draw live waveform on canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;
    const draw = () => {
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      const avg = (levelL + levelR) / 2;

      if (isRecording) {
        // Draw recorded waveform history
        const history = levelHistoryRef.current;
        const maxBars = w;
        const start = Math.max(0, history.length - maxBars);
        ctx.fillStyle = '#7C3AED';
        for (let i = start; i < history.length; i++) {
          const x = i - start;
          const barH = history[i] * h * 0.9;
          ctx.fillRect(x, (h - barH) / 2, 1, barH);
        }
        // Playhead line
        const px = Math.min(history.length - start, w - 1);
        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(px, 0);
        ctx.lineTo(px, h);
        ctx.stroke();
      } else {
        // Draw live input visualization (center-out bars)
        const barCount = 60;
        const barWidth = w / barCount;
        for (let i = 0; i < barCount; i++) {
          const dist = Math.abs(i - barCount / 2) / (barCount / 2);
          const amplitude = avg * (1 - dist * 0.6) * (0.8 + Math.random() * 0.4);
          const barH = amplitude * h * 0.85;
          const gradient = ctx.createLinearGradient(0, (h - barH) / 2, 0, (h + barH) / 2);
          gradient.addColorStop(0, 'rgba(0, 255, 200, 0.6)');
          gradient.addColorStop(0.5, 'rgba(124, 58, 237, 0.8)');
          gradient.addColorStop(1, 'rgba(0, 255, 200, 0.6)');
          ctx.fillStyle = gradient;
          ctx.fillRect(i * barWidth + 1, (h - barH) / 2, barWidth - 2, barH);
        }
      }

      animId = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(animId);
  }, [levelL, levelR, isRecording]);

  const handleRecord = useCallback(() => {
    if (isRecording) {
      // Stop recording
      const iframe = document.createElement('iframe');
      iframe.style.display = 'none';
      iframe.src = 'ghost://stop-recording';
      document.body.appendChild(iframe);
      setTimeout(() => iframe.remove(), 500);
      levelHistoryRef.current = [];
    } else {
      // Start recording
      levelHistoryRef.current = [];
      const iframe = document.createElement('iframe');
      iframe.style.display = 'none';
      iframe.src = 'ghost://start-recording';
      document.body.appendChild(iframe);
      setTimeout(() => iframe.remove(), 500);
    }
  }, [isRecording]);

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  const meterPercent = (v: number) => Math.min(100, Math.round(v * 100));

  return (
    <div className="rounded-xl overflow-hidden mt-2">
      <div className="flex items-center gap-3 px-4 py-2 bg-ghost-surface/60 border border-ghost-border/20 rounded-t-xl">
        {/* Record button */}
        <motion.button
          onClick={handleRecord}
          className={`w-9 h-9 rounded-full flex items-center justify-center transition-all ${
            isRecording
              ? 'shadow-[0_0_20px_rgba(237,66,69,0.5),0_2px_8px_rgba(0,0,0,0.3)]'
              : 'shadow-[0_2px_8px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.15)] hover:shadow-[0_0_20px_rgba(237,66,69,0.4)]'
          }`}
          style={{ background: isRecording ? 'linear-gradient(180deg, #ED4245 0%, #A12D2F 100%)' : 'linear-gradient(180deg, #DC2626 0%, #991B1B 100%)' }}
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.9 }}
        >
          {isRecording ? (
            <div className="w-3 h-3 rounded-sm bg-white" />
          ) : (
            <div className="w-3.5 h-3.5 rounded-full bg-white" />
          )}
        </motion.button>

        <span className="text-[11px] font-semibold text-ghost-text-muted/80 uppercase tracking-[0.1em]">
          {isRecording ? 'Recording' : 'Record'}
        </span>

        {isRecording && (
          <span className="text-[13px] font-mono text-red-400 animate-pulse">
            {formatTime(recordTime)}
          </span>
        )}

        {uploadStatus && (
          <span className="text-[11px] text-ghost-green ml-2">{uploadStatus}</span>
        )}

        <div className="flex-1" />

        {/* Level meters */}
        <div className="flex items-center gap-1.5">
          <span className="text-[9px] text-ghost-text-muted/60 font-medium">L</span>
          <div className="w-24 h-2 rounded-full bg-black/40 overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-75"
              style={{
                width: `${meterPercent(levelL)}%`,
                background: levelL > 0.85 ? '#ED4245' : levelL > 0.5 ? '#F0B232' : '#23A559',
              }}
            />
          </div>
          <span className="text-[9px] text-ghost-text-muted/60 font-medium">R</span>
          <div className="w-24 h-2 rounded-full bg-black/40 overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-75"
              style={{
                width: `${meterPercent(levelR)}%`,
                background: levelR > 0.85 ? '#ED4245' : levelR > 0.5 ? '#F0B232' : '#23A559',
              }}
            />
          </div>
        </div>
      </div>

      {/* Waveform / visualization area */}
      <div className="h-[72px] relative bg-[#0A0412] overflow-hidden border-x border-b border-ghost-border/20 rounded-b-xl">
        <canvas
          ref={canvasRef}
          width={800}
          height={72}
          className="w-full h-full"
        />
        {!isRecording && levelL < 0.01 && levelR < 0.01 && (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-[12px] text-ghost-text-muted/40 font-medium">
              Route audio to this track to see levels
            </span>
          </div>
        )}
        {isRecording && (
          <div className="absolute top-2 right-3">
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              <span className="text-[10px] text-red-400 font-semibold uppercase">REC</span>
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
