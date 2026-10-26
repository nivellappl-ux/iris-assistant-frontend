import {
  VoiceProviderError,
  type IrisVoiceEvent,
  type IrisVoiceState,
  type SpeechRecognitionProvider,
  type TextToSpeechProvider,
  type VoiceActivityProvider,
  type WakeWordProvider,
} from './contracts';
import { BrowserSpeechRecognitionProvider } from './browserSpeech';
import { IrisTextToSpeechProvider } from './irisTextToSpeech';
import { BrowserWakeWordProvider } from './browserWakeWord';
import { IrisEventBus } from './eventBus';
import { IrisStateMachine } from './stateMachine';
import { BrowserVoiceActivityDetector } from './voiceActivityDetector';

const INACTIVITY_TIMEOUT_MS = 120_000;
const THINKING_TIMEOUT_MS = 20_000;
const SPEECH_TIMEOUT_MS = 45_000;
const ERROR_RECOVERY_DELAY_MS = 1_600;
const MAX_SPOKEN_CHARACTERS = 1_400;

export type VoiceTurnHandler = (transcript: string) => string | Promise<string>;

export interface AudioControllerProviders {
  recognition?: SpeechRecognitionProvider;
  speech?: TextToSpeechProvider;
  activity?: VoiceActivityProvider;
  wakeWord?: WakeWordProvider;
  inactivityTimeoutMs?: number;
  thinkingTimeoutMs?: number;
  speechTimeoutMs?: number;
}

export class AudioController {
  private readonly events = new IrisEventBus();
  private readonly machine = new IrisStateMachine(this.events);
  private readonly recognition: SpeechRecognitionProvider;
  private readonly speech: TextToSpeechProvider;
  private readonly activity: VoiceActivityProvider;
  private readonly wakeWord: WakeWordProvider;
  private readonly inactivityTimeoutMs: number;
  private readonly thinkingTimeoutMs: number;
  private readonly speechTimeoutMs: number;
  private active = false;
  private wakeWordArmed = false;
  private processing = false;
  private turnHandler: VoiceTurnHandler | null = null;
  private wakeTurnHandler: VoiceTurnHandler | null = null;
  private inactivityTimer: ReturnType<typeof setTimeout> | null = null;
  private errorRecoveryTimer: ReturnType<typeof setTimeout> | null = null;
  private speechTimer: ReturnType<typeof setTimeout> | null = null;
  private speechGeneration = 0;

  constructor(providers: AudioControllerProviders = {}) {
    this.recognition = providers.recognition ?? new BrowserSpeechRecognitionProvider();
    this.speech = providers.speech ?? new IrisTextToSpeechProvider();
    this.activity = providers.activity ?? new BrowserVoiceActivityDetector();
    this.wakeWord = providers.wakeWord ?? new BrowserWakeWordProvider();
    this.inactivityTimeoutMs = providers.inactivityTimeoutMs ?? INACTIVITY_TIMEOUT_MS;
    this.thinkingTimeoutMs = providers.thinkingTimeoutMs ?? THINKING_TIMEOUT_MS;
    this.speechTimeoutMs = providers.speechTimeoutMs ?? SPEECH_TIMEOUT_MS;
  }

  get state(): IrisVoiceState {
    return this.machine.state;
  }

  get isActive(): boolean {
    return this.active;
  }

  get isWakeWordArmed(): boolean {
    return this.wakeWordArmed;
  }

  get wakeWordAvailable(): boolean {
    return this.wakeWord.available ?? true;
  }

  subscribe(listener: (event: IrisVoiceEvent) => void): () => void {
    return this.events.subscribe(listener);
  }

  async start(turnHandler: VoiceTurnHandler): Promise<void> {
    if (this.active) return;
    this.disarmWakeWord();
    await this.startActiveSession(turnHandler);
  }

  async armWakeWord(turnHandler: VoiceTurnHandler): Promise<void> {
    if (this.wakeWordArmed) return;
    if (this.active) this.stop('user');
    if (this.errorRecoveryTimer) clearTimeout(this.errorRecoveryTimer);
    this.errorRecoveryTimer = null;
    this.wakeTurnHandler = turnHandler;
    this.wakeWordArmed = true;
    this.machine.transition('sleeping');
    this.events.emit({ type: 'wake-word.armed' });
    await this.startWakeWordListener();
  }

  private async startActiveSession(turnHandler: VoiceTurnHandler): Promise<void> {
    if (this.active) return;
    if (this.errorRecoveryTimer) clearTimeout(this.errorRecoveryTimer);
    this.errorRecoveryTimer = null;
    this.turnHandler = turnHandler;
    this.active = true;
    this.processing = false;
    try {
      this.recognition.start({
        onFinalTranscript: (text) => void this.handleTranscript(text),
        onError: (message) => this.fail(message),
      });
      this.machine.transition('listening');
      this.events.emit({ type: 'voice.started' });
      this.resetInactivityTimer();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Não foi possível iniciar o microfone.';
      this.fail(message);
      throw error;
    }

    // SpeechRecognition already performs endpointing. The local analyser adds
    // onset/silence events and lets the user interrupt TTS without recording audio.
    void this.activity.start({
      onSpeechStart: () => {
        this.resetInactivityTimer();
        this.events.emit({ type: 'voice.activity.started' });
        this.events.emit({ type: 'transcription.started' });
        if (this.machine.state === 'speaking') this.interruptSpeech();
      },
      onSpeechEnd: () => {
        this.resetInactivityTimer();
        this.events.emit({ type: 'voice.activity.stopped' });
      },
    }).then((available) => {
      if (this.active && !available) {
        this.events.emit({
          type: 'assistant.notice',
          message: 'A deteção local de voz não está disponível; o reconhecimento do navegador continuará ativo.',
        });
      }
    }).catch((error: unknown) => {
      if (!this.active) return;
      const message = error instanceof Error ? error.message : 'A deteção local de voz não está disponível.';
      this.events.emit({ type: 'assistant.notice', message });
    });
  }

  private async startWakeWordListener(): Promise<void> {
    if (!this.wakeWordArmed || this.active || !this.wakeTurnHandler) return;
    try {
      await this.wakeWord.start(
        (initialCommand) => void this.activateFromWakeWord(initialCommand),
        (message) => this.fail(message),
      );
    } catch (error) {
      this.fail(error instanceof Error ? error.message : 'Não foi possível iniciar a palavra de despertar.');
    }
  }

  private async activateFromWakeWord(initialCommand?: string): Promise<void> {
    if (!this.wakeWordArmed || this.active) return;
    const handler = this.wakeTurnHandler;
    if (!handler) {
      this.fail('A palavra de despertar não tem um comando de voz associado.');
      return;
    }
    this.wakeWord.stop();
    this.events.emit({ type: 'wake-word.detected' });
    try {
      await this.startActiveSession(handler);
      if (initialCommand?.trim() && this.active) void this.handleTranscript(initialCommand);
    } catch {
      // startActiveSession already reports provider failures through the event bus.
    }
  }

  private disarmWakeWord(): void {
    if (!this.wakeWordArmed) return;
    this.wakeWordArmed = false;
    this.wakeTurnHandler = null;
    this.wakeWord.stop();
    this.events.emit({ type: 'wake-word.disarmed' });
    if (!this.active && this.machine.state === 'sleeping') this.machine.transition('idle');
  }

  stop(reason: 'user' | 'inactivity' = 'user'): void {
    if (!this.active && !this.wakeWordArmed && this.machine.state === 'idle') return;
    const returnToWakeWord = reason === 'inactivity' && this.wakeWordArmed && Boolean(this.wakeTurnHandler);
    this.active = false;
    this.processing = false;
    this.turnHandler = null;
    this.clearTimers();
    this.speechGeneration += 1;
    this.recognition.stop();
    this.speech.cancel();
    this.activity.stop();
    if (!returnToWakeWord) this.disarmWakeWord();
    this.events.emit({ type: 'voice.stopped', reason });
    if (this.machine.state !== 'idle') this.machine.transition('idle');
    if (returnToWakeWord) {
      this.machine.transition('sleeping');
      void this.startWakeWordListener();
    }
  }

  private async handleTranscript(rawText: string): Promise<void> {
    const transcript = rawText.trim();
    if (!this.active || !transcript || this.processing) return;
    this.processing = true;
    this.clearInactivityTimer();
    this.recognition.pause();
    this.events.emit({ type: 'transcription.completed', text: transcript });
    this.machine.transition('thinking');
    this.events.emit({ type: 'thinking.started' });

    try {
      const handler = this.turnHandler;
      if (!handler) throw new VoiceProviderError('A sessão de voz foi encerrada.');
      const reply = await this.withTimeout(
        Promise.resolve().then(() => handler(transcript)),
        this.thinkingTimeoutMs,
        'A IRIS demorou demasiado a preparar a resposta.',
      );
      if (!this.active) return;
      this.events.emit({ type: 'thinking.completed' });
      if (reply.trim()) await this.speak(reply);
      else this.resumeListening();
    } catch (error) {
      if (!this.active) return;
      this.fail(error instanceof Error ? error.message : 'Não foi possível preparar uma resposta.');
    } finally {
      this.processing = false;
    }
  }

  private async speak(reply: string): Promise<void> {
    if (!this.active) return;
    if (!this.speech.available) {
      this.events.emit({
        type: 'assistant.notice',
        message: 'A resposta ficou escrita; a fala não está disponível neste navegador ou WebView.',
      });
      this.resumeListening();
      return;
    }

    const text = reply.slice(0, MAX_SPOKEN_CHARACTERS);
    if (reply.length > MAX_SPOKEN_CHARACTERS) {
      this.events.emit({ type: 'assistant.notice', message: 'A resposta é longa; a IRIS vai falar uma versão abreviada.' });
    }
    const generation = ++this.speechGeneration;
    this.machine.transition('speaking');
    this.events.emit({ type: 'speech.started', text });

    let timedOut = false;
    let playbackFailed = false;
    this.speechTimer = setTimeout(() => {
      if (generation !== this.speechGeneration || !this.active) return;
      timedOut = true;
      this.events.emit({ type: 'assistant.notice', message: 'A resposta continua disponível por escrito; a fala foi interrompida por segurança.' });
      this.speech.cancel();
    }, this.speechTimeoutMs);

    try {
      await this.speech.speak(text, {
        onStart: () => undefined,
        onBoundary: (charIndex) => this.events.emit({ type: 'speech.progress', charIndex }),
      });
    } catch (error) {
      if (generation === this.speechGeneration && this.active) {
        playbackFailed = true;
        this.events.emit({
          type: 'assistant.notice',
          message: error instanceof Error ? error.message : 'A resposta continua disponível por escrito.',
        });
      }
    } finally {
      if (this.speechTimer) clearTimeout(this.speechTimer);
      this.speechTimer = null;
    }

    if (generation !== this.speechGeneration || !this.active) return;
    if (timedOut) {
      this.events.emit({ type: 'speech.interrupted' });
      this.resumeListening();
      this.events.emit({ type: 'assistant.notice', message: 'A resposta continua disponível por escrito; a fala foi interrompida por segurança.' });
      return;
    }
    if (playbackFailed) {
      this.resumeListening();
      return;
    }
    this.events.emit({ type: 'speech.completed' });
    this.resumeListening();
  }

  private interruptSpeech(): void {
    if (!this.active || this.machine.state !== 'speaking') return;
    this.speechGeneration += 1;
    if (this.speechTimer) clearTimeout(this.speechTimer);
    this.speechTimer = null;
    this.speech.cancel();
    this.events.emit({ type: 'speech.interrupted' });
    this.resumeListening();
  }

  private resumeListening(): void {
    if (!this.active) return;
    try {
      if (this.machine.state !== 'listening') this.machine.transition('listening');
      this.recognition.resume();
      this.resetInactivityTimer();
    } catch (error) {
      this.fail(error instanceof Error ? error.message : 'Não foi possível retomar a escuta.');
    }
  }

  private fail(message: string): void {
    if (!this.active && this.machine.state === 'error') return;
    const wakeWordWasArmed = this.wakeWordArmed;
    this.active = false;
    this.wakeWordArmed = false;
    this.processing = false;
    this.turnHandler = null;
    this.wakeTurnHandler = null;
    this.clearTimers();
    this.speechGeneration += 1;
    this.recognition.stop();
    this.speech.cancel();
    this.activity.stop();
    this.wakeWord.stop();
    if (wakeWordWasArmed) this.events.emit({ type: 'wake-word.disarmed' });
    this.events.emit({ type: 'voice.stopped', reason: 'error' });
    if (this.machine.state !== 'error') this.machine.transition('error');
    this.events.emit({ type: 'assistant.error', message });
    if (this.errorRecoveryTimer) clearTimeout(this.errorRecoveryTimer);
    this.errorRecoveryTimer = setTimeout(() => {
      this.errorRecoveryTimer = null;
      if (!this.active && this.machine.state === 'error') this.machine.transition('idle');
    }, ERROR_RECOVERY_DELAY_MS);
  }

  private resetInactivityTimer(): void {
    this.clearInactivityTimer();
    if (!this.active) return;
    this.inactivityTimer = setTimeout(() => {
      this.inactivityTimer = null;
      this.events.emit({
        type: 'assistant.notice',
        message: 'A escuta foi desligada após dois minutos sem voz. Ativa o microfone para retomar.',
      });
      this.stop('inactivity');
    }, this.inactivityTimeoutMs);
  }

  private clearInactivityTimer(): void {
    if (this.inactivityTimer) clearTimeout(this.inactivityTimer);
    this.inactivityTimer = null;
  }

  private clearTimers(): void {
    this.clearInactivityTimer();
    if (this.speechTimer) clearTimeout(this.speechTimer);
    this.speechTimer = null;
  }

  private withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | null = null;
    return Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new VoiceProviderError(message)), timeoutMs);
      }),
    ]).finally(() => {
      if (timer) clearTimeout(timer);
    });
  }
}
