import { useEffect, useRef, useState } from 'react';
import { voiceCommand, type VoiceCommand } from '../../../shared/voice.ts';

interface Recognition {
  continuous: boolean; interimResults: boolean; lang: string;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null; onerror: ((e: { error: string }) => void) | null;
  start(): void; stop(): void;
}
type RecognitionCtor = new () => Recognition;

function recognizer(): RecognitionCtor | null {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Whether this browser can listen. Reading aloud works almost everywhere; listening doesn't (Firefox, some WebViews). */
export const canListen = () => typeof window !== 'undefined' && !!recognizer();

/** Reads text aloud, cutting off whatever was being said. */
export function say(text: string): void {
  if (!('speechSynthesis' in window)) return;
  speechSynthesis.cancel();
  speechSynthesis.speak(new SpeechSynthesisUtterance(text));
}

/**
 * Hands-free cook mode: listens for "next", "back", "repeat", "set a timer for 10 minutes" and so on,
 * and hands each command over. Keeps listening until turned off, restarting when the browser stops on its own.
 */
export function useVoice(on: boolean, onCommand: (c: VoiceCommand) => void): { heard: string; error: string | null } {
  const [heard, setHeard] = useState('');
  const [error, setError] = useState<string | null>(null);
  const handler = useRef(onCommand);
  handler.current = onCommand;

  useEffect(() => {
    const Ctor = recognizer();
    if (!on || !Ctor) return;
    let stopped = false;
    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = false;
    rec.lang = navigator.language || 'en-US';
    rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (!e.results[i].isFinal) continue;
        const text = e.results[i][0].transcript;
        // Don't take orders from our own voice reading a step.
        if ('speechSynthesis' in window && speechSynthesis.speaking) continue;
        setHeard(text);
        const c = voiceCommand(text);
        if (c) handler.current(c);
      }
    };
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { stopped = true; setError('Microphone access was blocked. Allow it in your browser settings to use voice.'); }
    };
    // Browsers stop listening after a quiet spell; pick it back up.
    rec.onend = () => { if (!stopped) window.setTimeout(() => { if (!stopped) try { rec.start(); } catch { /* already started */ } }, 300); };
    setError(null);
    try { rec.start(); } catch { /* already started */ }
    return () => { stopped = true; rec.onend = null; rec.stop(); if ('speechSynthesis' in window) speechSynthesis.cancel(); };
  }, [on]);

  return { heard, error };
}
