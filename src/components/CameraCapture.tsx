import { useEffect, useRef, useState, useCallback } from 'react';
import { Camera, X, RotateCcw } from 'lucide-react';

interface CameraCaptureProps {
  onCapture: (blob: Blob) => void;
  onClose: () => void;
}

/**
 * Full-screen camera capture using the HTML5 Camera API (getUserMedia).
 * Falls back gracefully with a clear error if permissions are denied or
 * no camera is available (common on desktop test rigs), rather than
 * silently failing.
 */
export function CameraCapture({ onCapture, onClose }: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [ready, setReady] = useState(false);

  const startStream = useCallback(async (mode: 'environment' | 'user') => {
    setError(null);
    setReady(false);
    try {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: mode, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setReady(true);
    } catch (err) {
      setError(
        (err as DOMException).name === 'NotAllowedError'
          ? 'Camera permission denied. Enable it in your browser/site settings.'
          : 'No camera available on this device.'
      );
    }
  }, []);

  useEffect(() => {
    startStream(facingMode);
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, [facingMode, startStream]);

  const handleShutter = () => {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (blob) onCapture(blob);
      },
      'image/jpeg',
      0.85 // compressed for cheap sync over field/cellular connections
    );
  };

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      <div className="flex justify-between items-center p-4">
        <button onClick={onClose} className="p-3 rounded-full bg-white/10 min-h-[44px] min-w-[44px]" aria-label="Close camera">
          <X className="text-white" size={24} />
        </button>
        <button
          onClick={() => setFacingMode((m) => (m === 'environment' ? 'user' : 'environment'))}
          className="p-3 rounded-full bg-white/10 min-h-[44px] min-w-[44px]"
          aria-label="Flip camera"
        >
          <RotateCcw className="text-white" size={24} />
        </button>
      </div>

      <div className="flex-1 relative flex items-center justify-center">
        {error ? (
          <p className="text-red-400 text-center px-8 font-semibold">{error}</p>
        ) : (
          <video ref={videoRef} playsInline muted className="w-full h-full object-cover" />
        )}
      </div>

      <div className="p-8 flex justify-center">
        <button
          onClick={handleShutter}
          disabled={!ready}
          className="w-20 h-20 rounded-full bg-white border-4 border-slate-400 active:scale-95 transition-transform disabled:opacity-30"
          aria-label="Capture photo"
        >
          <Camera className="mx-auto text-slate-900" size={28} />
        </button>
      </div>
    </div>
  );
}
