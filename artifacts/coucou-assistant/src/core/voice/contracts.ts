export type IrisVoiceState =
  | 'idle'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'happy'
  | 'confused'
  | 'error'
  | 'sleeping';

export type IrisVoiceEvent =
  | { type: 'iris.state.changed'; previous: IrisVoiceState; state: IrisVoiceState }
  | { type: 'voice.started' }
  | { type: 'voice.stopped'; reason: 'user' | 'inactivity' | 'error' }
  | { type: 'voice.activity.started' }
  | { type: 'voice.activity.stopped' }
  | { type: 'wake-word.armed' }
  | { type: 'wake-word.detected' }
  | { type: 'wake-word.disarmed' }
  | { type: 'transcription.started' }
  | { type: 'transcription.completed'; text: string }
  | { type: 'thinking.started' }
  | { type: 'thinking.completed' }
  | { type: 'speech.started'; text: string }
  | { type: 'speech.progress'; charIndex: number }
  | { type: 'speech.completed' }
  | { type: 'speech.interrupted' }
  | { type: 'assistant.notice'; message: string }
  | { type: 'assistant.error'; message: string };

export interface SpeechRecognitionCallbacks {
  onFinalTranscript: (text: string) => void;
  onError: (message: string) => void;
}

export interface SpeechRecognitionStartOptions {
  languages?: readonly string[];
}

export interface SpeechRecognitionProvider {
  start(callbacks: SpeechRecognitionCallbacks, options?: SpeechRecognitionStartOptions): void;
  pause(): void;
  resume(): void;
  stop(): void;
}

export interface TextToSpeechCallbacks {
  onStart: () => void;
  onBoundary: (charIndex: number) => void;
}

export interface TextToSpeechProvider {
  readonly available: boolean;
  speak(text: string, callbacks: TextToSpeechCallbacks): Promise<void>;
  cancel(): void;
}

export interface VoiceActivityCallbacks {
  onSpeechStart: () => void;
  onSpeechEnd: () => void;
}

export interface VoiceActivityProvider {
  start(callbacks: VoiceActivityCallbacks): Promise<boolean>;
  stop(): void;
}

/** Pluggable contract for a wake-word listener, separate from command recognition. */
export interface WakeWordProvider {
  readonly available?: boolean;
  start(onWake: (initialCommand?: string) => void, onError: (message: string) => void): Promise<void>;
  stop(): void;
}

export class VoiceProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VoiceProviderError';
  }
}
