import {
  VoiceProviderError,
  type SpeechRecognitionCallbacks,
  type SpeechRecognitionProvider,
  type SpeechRecognitionStartOptions,
} from './contracts';

type RecognitionAlternative = { transcript: string };
type RecognitionResult = {
  isFinal: boolean;
  [index: number]: RecognitionAlternative;
};
type RecognitionResultEvent = {
  resultIndex: number;
  results: ArrayLike<RecognitionResult>;
};
type RecognitionErrorEvent = { error: string };

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: RecognitionResultEvent) => void) | null;
  onerror: ((event: RecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  abort: () => void;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;
type SpeechRecognitionWindow = Window & {
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
};

const RESTART_DELAY_MS = 250;

export class BrowserSpeechRecognitionProvider implements SpeechRecognitionProvider {
  private recognition: SpeechRecognitionLike | null = null;
  private callbacks: SpeechRecognitionCallbacks | null = null;
  private active = false;
  private paused = false;
  private restartTimer: number | null = null;
  private languages: readonly string[] = ['pt-PT'];
  private languageIndex = 0;

  get available(): boolean {
    return Boolean(this.getConstructor());
  }

  start(callbacks: SpeechRecognitionCallbacks, options: SpeechRecognitionStartOptions = {}): void {
    const constructor = this.getConstructor();
    if (!constructor) {
      throw new VoiceProviderError('O reconhecimento de voz não está disponível neste navegador ou WebView.');
    }
    this.stop();
    this.callbacks = callbacks;
    this.active = true;
    this.paused = false;
    this.languages = options.languages?.filter((language) => language.trim()) ?? ['pt-PT'];
    if (!this.languages.length) this.languages = ['pt-PT'];
    this.languageIndex = 0;
    if (!this.startRecognition(constructor)) {
      this.active = false;
      throw new VoiceProviderError('Não foi possível iniciar o microfone. Verifica as permissões e tenta novamente.');
    }
  }

  pause(): void {
    if (!this.active || this.paused) return;
    this.paused = true;
    this.clearRestartTimer();
    const recognition = this.recognition;
    this.recognition = null;
    try {
      recognition?.abort();
    } catch {
      // A sessão pode já ter terminado no browser.
    }
  }

  resume(): void {
    if (!this.active || !this.paused) return;
    const constructor = this.getConstructor();
    if (!constructor) {
      throw new VoiceProviderError('O reconhecimento de voz deixou de estar disponível.');
    }
    this.paused = false;
    if (!this.startRecognition(constructor)) {
      this.paused = true;
      throw new VoiceProviderError('Não foi possível retomar o reconhecimento de voz.');
    }
  }

  stop(): void {
    this.active = false;
    this.paused = false;
    this.clearRestartTimer();
    const recognition = this.recognition;
    this.recognition = null;
    try {
      recognition?.abort();
    } catch {
      // A sessão pode já ter terminado no browser.
    }
    this.callbacks = null;
  }

  private getConstructor(): SpeechRecognitionConstructor | undefined {
    if (typeof window === 'undefined') return undefined;
    const speechWindow = window as SpeechRecognitionWindow;
    return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
  }

  private startRecognition(constructor: SpeechRecognitionConstructor): boolean {
    let recognition: SpeechRecognitionLike;
    try {
      recognition = new constructor();
    } catch {
      return false;
    }

    this.recognition = recognition;
    recognition.lang = this.languages[this.languageIndex] ?? 'pt-PT';
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onresult = (event) => {
      if (!this.active || this.paused) return;
      const transcripts: string[] = [];
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const transcript = result?.[0]?.transcript.trim();
        if (result?.isFinal && transcript) transcripts.push(transcript);
      }
      if (transcripts.length) this.callbacks?.onFinalTranscript(transcripts.join(' '));
    };
    recognition.onerror = (event) => {
      if (!this.active || event.error === 'no-speech' || event.error === 'aborted') return;
      const message = event.error === 'not-allowed' || event.error === 'service-not-allowed'
        ? 'O acesso ao microfone foi recusado. Permite-o nas definições do sistema.'
        : event.error === 'audio-capture'
          ? 'Não encontrei um microfone disponível.'
          : event.error === 'network'
            ? 'O reconhecimento de voz não está disponível agora.'
            : 'Não foi possível ativar o comando de voz.';
      this.callbacks?.onError(message);
    };
    recognition.onend = () => {
      if (this.recognition === recognition) this.recognition = null;
      if (!this.active || this.paused) return;
      if (this.languages.length > 1) this.languageIndex = (this.languageIndex + 1) % this.languages.length;
      this.restartTimer = window.setTimeout(() => {
        this.restartTimer = null;
        if (this.active && !this.paused && !this.startRecognition(constructor)) {
          this.callbacks?.onError('Não foi possível retomar o reconhecimento de voz.');
        }
      }, RESTART_DELAY_MS);
    };

    try {
      recognition.start();
      return true;
    } catch {
      if (this.recognition === recognition) this.recognition = null;
      return false;
    }
  }

  private clearRestartTimer(): void {
    if (this.restartTimer === null || typeof window === 'undefined') return;
    window.clearTimeout(this.restartTimer);
    this.restartTimer = null;
  }
}
