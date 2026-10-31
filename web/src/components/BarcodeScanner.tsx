import { useEffect, useRef, useState } from 'react';
import { Modal } from './Dialog.tsx';

// Chrome on Android, Mac and ChromeOS can read barcodes straight from the camera. Not in TypeScript's DOM types yet.
interface Detector { detect: (source: HTMLVideoElement) => Promise<{ rawValue: string }[]> }
type DetectorClass = new (opts: { formats: string[] }) => Detector;
const NativeDetector = (globalThis as unknown as { BarcodeDetector?: DetectorClass }).BarcodeDetector;

const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e'];

/**
 * The browser's own barcode reader, or else (Windows, the desktop app, Firefox, Android's in-app browser) a
 * WebAssembly one that ships with the app and is only downloaded the first time it's needed. No CDN, so it works
 * on a home server with no internet.
 */
async function barcodeDetector(): Promise<Detector> {
  if (NativeDetector) {
    const supported = await (NativeDetector as unknown as { getSupportedFormats?: () => Promise<string[]> }).getSupportedFormats?.().catch(() => []) ?? FORMATS;
    if (FORMATS.some((f) => supported.includes(f))) return new NativeDetector({ formats: FORMATS });
  }
  const [{ BarcodeDetector, prepareZXingModule }, { default: wasmUrl }] = await Promise.all([
    import('barcode-detector/ponyfill'),
    import('zxing-wasm/reader/zxing_reader.wasm?url'),
  ]);
  prepareZXingModule({ overrides: { locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? wasmUrl : prefix + path) } });
  return new BarcodeDetector({ formats: FORMATS as never });
}

/** Why the camera can't be used here, or null when it's worth trying. */
function cameraBlocked(): string | null {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    return 'The camera only works when Nighttime Ninja is opened over https (or in the desktop app). Type the numbers under the barcode instead.';
  }
  return null;
}

/** Reads a grocery barcode with the camera, or lets you type the numbers under it. */
export function BarcodeScanner({ onCode, onClose }: { onCode: (code: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [typed, setTyped] = useState('');
  const [problem, setProblem] = useState<string | null>(cameraBlocked);
  const [starting, setStarting] = useState(true);

  useEffect(() => {
    if (cameraBlocked()) return;
    let stream: MediaStream | null = null;
    let timer = 0;
    let stopped = false;
    (async () => {
      try {
        const [detector, media] = await Promise.all([
          barcodeDetector(),
          navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false }),
        ]);
        stream = media;
        if (stopped || !video.current) { for (const t of media.getTracks()) t.stop(); return; }
        video.current.srcObject = stream;
        await video.current.play();
        setStarting(false);
        const look = async () => {
          if (stopped || !video.current) return;
          const found = await detector.detect(video.current).catch(() => []);
          if (found[0]?.rawValue) { navigator.vibrate?.(80); onCode(found[0].rawValue); return; }
          timer = window.setTimeout(look, 250);
        };
        void look();
      } catch (e) {
        const name = (e as { name?: string }).name;
        setProblem(name === 'NotAllowedError' || name === 'SecurityError'
          ? "Camera access was turned down. Allow it for this site (or in Windows camera privacy settings), or type the numbers under the barcode."
          : name === 'NotFoundError' || name === 'OverconstrainedError'
            ? "There's no camera on this device. Type the numbers under the barcode instead."
            : "Couldn't start the camera. Type the numbers under the barcode instead.");
      }
    })();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      for (const t of stream?.getTracks() ?? []) t.stop();
    };
  }, [onCode]);

  const digits = typed.replace(/\D/g, '');
  return (
    <Modal label="Scan a barcode" onClose={onClose}>
      <h2>Scan a barcode</h2>
      {problem ? <p className="muted" style={{ margin: 0 }}>{problem}</p> : (
        <>
          <video ref={video} className="scanner-video" muted playsInline aria-label="Camera" />
          {starting && <p className="small muted" style={{ margin: 0 }}>Starting the camera…</p>}
        </>
      )}
      <form className="row" onSubmit={(e) => { e.preventDefault(); if (digits.length >= 6) onCode(digits); }}>
        <input inputMode="numeric" placeholder="Or type the numbers" value={typed} onChange={(e) => setTyped(e.target.value)} style={{ flex: 1 }} aria-label="Barcode numbers" />
        <button className="primary" disabled={digits.length < 6}>Look up</button>
      </form>
      <div className="row"><span className="spacer" /><button type="button" onClick={onClose}>Cancel</button></div>
    </Modal>
  );
}
