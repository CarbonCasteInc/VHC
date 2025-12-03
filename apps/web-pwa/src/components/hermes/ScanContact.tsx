import React, { useEffect, useRef, useState } from 'react';
import { Button } from '@vh/ui';
import { useChatStore } from '../../store/hermesMessaging';
import { useRouter } from '@tanstack/react-router';

async function tryBarcodeScan(video: HTMLVideoElement): Promise<string | null> {
  if (typeof (window as any).BarcodeDetector === 'undefined') return null;
  const detector = new (window as any).BarcodeDetector({ formats: ['qr_code'] });
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
  video.srcObject = stream;
  await video.play();
  return new Promise((resolve) => {
    const interval = setInterval(async () => {
      const frame = await detector.detect(video);
      const code = frame?.[0]?.rawValue;
      if (code) {
        clearInterval(interval);
        stream.getTracks().forEach((t) => t.stop());
        resolve(code);
      }
    }, 400);
  });
}

export const ScanContact: React.FC = () => {
  const router = useRouter();
  const { getOrCreateChannel } = useChatStore();
  const [manual, setManual] = useState('');
  const [scanning, setScanning] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [error, setError] = useState<string | null>(null);

  const navigateToChannel = async (identityKey: string) => {
    const channel = await getOrCreateChannel(identityKey);
    router.navigate({ to: '/hermes/messages/$channelId', params: { channelId: channel.id } });
  };

  const startScan = async () => {
    if (!videoRef.current) return;
    setError(null);
    setScanning(true);
    try {
      const code = await tryBarcodeScan(videoRef.current);
      if (code) {
        await navigateToChannel(code);
      } else {
        setError('Camera scanning unavailable; use manual entry.');
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setScanning(false);
    }
  };

  useEffect(() => {
    return () => {
      const stream = videoRef.current?.srcObject as MediaStream | null;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <div className="rounded-xl border border-slate-200 bg-card p-3 shadow-sm dark:border-slate-700">
      <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Add contact</p>
      <div className="mt-2 flex gap-2">
        <input
          className="w-full rounded border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-teal-400 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-50"
          placeholder="Paste identity key"
          value={manual}
          onChange={(e) => setManual(e.target.value)}
        />
        <Button size="sm" onClick={() => void navigateToChannel(manual)} disabled={!manual.trim()}>
          Start chat
        </Button>
      </div>
      <div className="mt-3 space-y-2">
        <Button variant="ghost" size="sm" onClick={() => void startScan()} disabled={scanning}>
          {scanning ? 'Scanning…' : 'Scan QR'}
        </Button>
        <video ref={videoRef} className="h-32 w-full rounded-lg bg-slate-900/40" muted playsInline />
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
    </div>
  );
};
