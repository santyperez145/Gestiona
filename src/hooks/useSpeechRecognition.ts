/**
 * useSpeechRecognition — Web Speech API hook for voice-to-text input.
 *
 * Uses the browser's SpeechRecognition API (supported in Chrome, Edge, Safari 15+).
 * Automatically requests microphone permission on first call.
 *
 * Features:
 *   - Continuous and single-shot modes
 *   - Interim results (live partial transcript)
 *   - Automatic language detection (defaults to 'es-AR')
 *   - Confidence score per result
 *   - Graceful degradation when API unavailable
 *
 * Usage:
 *   const { transcript, listening, start, stop, supported, reset } = useSpeechRecognition();
 *   <button onMouseDown={start} onMouseUp={stop}>
 *     {listening ? "Escuchando…" : "Hablar"}
 *   </button>
 *   <p>{transcript}</p>
 *
 * Use cases in Gestiona:
 *   - Voice search for products in POS ("buscar gaseosa")
 *   - Voice quantity input ("cinco")
 *   - Voice customer name in sales form
 *   - Voice note/description in expenses
 */
import { useState, useEffect, useRef, useCallback } from "react";

export interface SpeechResult {
  transcript: string;
  confidence: number;
  isFinal: boolean;
}

interface UseSpeechRecognitionOptions {
  /** Language code. Default: 'es-AR' */
  lang?: string;
  /** Continuous listening mode (default: false — single utterance) */
  continuous?: boolean;
  /** Return interim results while speaking (default: true) */
  interimResults?: boolean;
  /** Callback fired on each final result */
  onResult?: (result: SpeechResult) => void;
  /** Callback fired when recognition ends */
  onEnd?: () => void;
  /** Callback fired on error */
  onError?: (error: string) => void;
}

type SpeechRecognitionAPI = typeof window extends { SpeechRecognition: infer T }
  ? T
  : any;

function getSpeechRecognition(): SpeechRecognitionAPI | null {
  if (typeof window === "undefined") return null;
  return (window as any).SpeechRecognition ||
         (window as any).webkitSpeechRecognition ||
         null;
}

export function useSpeechRecognition({
  lang = "es-AR",
  continuous = false,
  interimResults = true,
  onResult,
  onEnd,
  onError,
}: UseSpeechRecognitionOptions = {}) {
  const SpeechRecognitionClass = getSpeechRecognition();
  const supported = SpeechRecognitionClass !== null;

  const [transcript, setTranscript] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<any>(null);
  const onResultRef = useRef(onResult);
  const onEndRef = useRef(onEnd);
  const onErrorRef = useRef(onError);

  // Keep refs updated without restarting recognition
  onResultRef.current = onResult;
  onEndRef.current = onEnd;
  onErrorRef.current = onError;

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
  }, []);

  const reset = useCallback(() => {
    stop();
    setTranscript("");
    setInterimTranscript("");
    setError(null);
  }, [stop]);

  const start = useCallback(() => {
    if (!supported) {
      setError("Tu navegador no soporta reconocimiento de voz");
      return;
    }
    if (listening) return;

    const recognition = new SpeechRecognitionClass();
    recognition.lang = lang;
    recognition.continuous = continuous;
    recognition.interimResults = interimResults;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      setListening(true);
      setError(null);
    };

    recognition.onresult = (event: any) => {
      let finalText = "";
      let interimText = "";

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0].transcript;
        if (result.isFinal) {
          finalText += text;
          onResultRef.current?.({ transcript: text, confidence: result[0].confidence, isFinal: true });
        } else {
          interimText += text;
        }
      }

      if (finalText) setTranscript(prev => prev + finalText);
      setInterimTranscript(interimText);
    };

    recognition.onerror = (event: any) => {
      const msg = event.error === "no-speech"
        ? "No se detectó voz"
        : event.error === "not-allowed"
        ? "Permiso de micrófono denegado"
        : event.error === "network"
        ? "Error de red"
        : `Error: ${event.error}`;
      setError(msg);
      onErrorRef.current?.(msg);
    };

    recognition.onend = () => {
      setListening(false);
      setInterimTranscript("");
      onEndRef.current?.();
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch (e: any) {
      setError(e.message);
    }
  }, [supported, lang, continuous, interimResults, listening, SpeechRecognitionClass]);

  // Cleanup on unmount
  useEffect(() => {
    return () => { recognitionRef.current?.abort(); };
  }, []);

  return {
    transcript,
    interimTranscript,
    fullTranscript: transcript + interimTranscript,
    listening,
    error,
    supported,
    start,
    stop,
    reset,
  };
}
