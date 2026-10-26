import { VoiceProviderError, type SpeechRecognitionProvider, type WakeWordProvider } from './contracts';
import { BrowserSpeechRecognitionProvider } from './browserSpeech';

const WAKE_PHRASES = [
  /\b(?:acorda|acordar)\s+iris\b/,
  /\bwake\s+up\s+iris\b/,
];

export function extractWakeCommand(transcript: string): string | null {
  const normalized = transcript
    .toLocaleLowerCase('pt-PT')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  for (const phrase of WAKE_PHRASES) {
    const match = phrase.exec(normalized);
    if (!match || match.index === undefined) continue;
    const command = normalized.slice(match.index + match[0].length).trim();
    return command || null;
  }
  return null;
}

export class BrowserWakeWordProvider implements WakeWordProvider {
  private active = false;
  private onWake: ((initialCommand?: string) => void) | null = null;
  private onError: ((message: string) => void) | null = null;

  constructor(private readonly recognition: SpeechRecognitionProvider = new BrowserSpeechRecognitionProvider()) {}

  get available(): boolean {
    return this.recognition instanceof BrowserSpeechRecognitionProvider
      ? this.recognition.available
      : true;
  }

  async start(onWake: (initialCommand?: string) => void, onError: (message: string) => void): Promise<void> {
    if (this.active) return;
    this.onWake = onWake;
    this.onError = onError;
    this.active = true;

    try {
      this.recognition.start({
        onFinalTranscript: (transcript) => {
          const initialCommand = extractWakeCommand(transcript);
          if (initialCommand === null && !this.containsWakePhrase(transcript)) return;
          const onWake = this.onWake;
          this.stop();
          onWake?.(initialCommand ?? undefined);
        },
        onError: (message) => {
          if (!this.active) return;
          const onError = this.onError;
          this.stop();
          onError?.(message);
        },
      }, { languages: ['pt-PT', 'en-US'] });
    } catch (error) {
      this.active = false;
      this.onWake = null;
      this.onError = null;
      throw error instanceof Error
        ? error
        : new VoiceProviderError('Não foi possível iniciar a escuta da palavra de despertar.');
    }
  }

  stop(): void {
    this.active = false;
    this.recognition.stop();
    this.onWake = null;
    this.onError = null;
  }

  private containsWakePhrase(transcript: string): boolean {
    const normalized = transcript
      .toLocaleLowerCase('pt-PT')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return WAKE_PHRASES.some((phrase) => phrase.test(normalized));
  }
}
