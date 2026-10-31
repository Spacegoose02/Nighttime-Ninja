import { useEffect, useRef, useState } from 'react';
import { Modal } from './Dialog.tsx';

// Chrome on Android (and some desktops) can read barcodes straight from the camera. Not in TypeScript's DOM types yet.
interface Detector { detect: (source: HTMLVideoElement) => Promise<{ rawValue: string }[]> }
type DetectorClass = new (opts: { formats: string[] }) => Detector;
const BarcodeDetector = (globalThis as unknown as { BarcodeDetector?: DetectorClass }).BarcodeDetector;

/** Reads a grocery barcode with the camera, or lets you type the numbers under it. */
export function BarcodeScanner({ onCode, onClose }: { onCode: (code: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [typed, setTyped] = useState('');
  const [problem, setProblem] = useState<string | null>(BarcodeDetector ? null : "This browser can't read barcodes from the camera. Type the numbers under the barcode instead.");

  useEffect(() => {
    if (!BarcodeDetector) return;
    let stream: MediaStream | null = null;
    let timer = 0;
    let stopped = false;
    const detector = new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'] });
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
        if (stopped || !video.current) return;
        video.current.srcObject = stream;
        await video.current.play();
        const look = async () => {
          if (stopped || !video.current) return;
          const found = await detector.detect(video.current).catch(() => []);
          if (found[0]?.rawValue) { navigator.vibrate?.(80); onCode(found[0].rawValue); return; }
          timer = window.setTimeout(look, 250);
        };
        void look();
      } catch {
        setProblem("Couldn't open the camera. Allow camera access, or type the numbers under the barcode.");
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
        <video ref={video} className="scanner-video" muted playsInline aria-label="Camera" />
      )}
      <form className="row" onSubmit={(e) => { e.preventDefault(); if (digits.length >= 6) onCode(digits); }}>
        <input inputMode="numeric" placeholder="Or type the numbers" value={typed} onChange={(e) => setTyped(e.target.value)} style={{ flex: 1 }} aria-label="Barcode numbers" />
        <button className="primary" disabled={digits.length < 6}>Look up</button>
      </form>
      <div className="row"><span className="spacer" /><button type="button" onClick={onClose}>Cancel</button></div>
    </Modal>
  );
}
