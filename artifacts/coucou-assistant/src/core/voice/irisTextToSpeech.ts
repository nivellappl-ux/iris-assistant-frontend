import { irisSpeech } from "@workspace/api-client-react";
import { VoiceProviderError, type TextToSpeechCallbacks, type TextToSpeechProvider } from "./contracts";

function serverErrorMessage(error: unknown): string | null {
  if (typeof error !== "object" || error === null || !("data" in error)) return null;
  const data = error.data;
  if (typeof data !== "object" || data === null || !("error" in data)) return null;
  return typeof data.error === "string" ? data.error : null;
}

export class IrisTextToSpeechProvider implements TextToSpeechProvider {
  private generation = 0;
  private audio: HTMLAudioElement | null = null;
  private objectUrl: string | null = null;
  private pendingRequest: AbortController | null = null;
  private finishCurrent: (() => void) | null = null;
  private speechSynthesis: SpeechSynthesis | null = null;
  private utterance: SpeechSynthesisUtterance | null = null;

  constructor(private readonly isEnabled: () => boolean = () => true) {}

  get available(): boolean {
    return this.isEnabled()
      && typeof window !== "undefined"
      && (typeof Audio !== "undefined" || typeof window.speechSynthesis !== "undefined");
  }

  async speak(text: string, callbacks: TextToSpeechCallbacks): Promise<void> {
    if (!this.available) {
      throw new VoiceProviderError("A voz está desligada ou indisponível.");
    }

    this.cancel();
    const generation = this.generation;
    const controller = new AbortController();
    this.pendingRequest = controller;

    let result: Awaited<ReturnType<typeof irisSpeech>>;
    try {
      result = await irisSpeech({ text }, { signal: controller.signal });
    } catch (error) {
      if (generation !== this.generation) return;
      throw new VoiceProviderError(serverErrorMessage(error) ?? "Não consegui preparar a voz agora.");
    } finally {
      if (this.pendingRequest === controller) this.pendingRequest = null;
    }

    if (generation !== this.generation) return;
    if (result.mode === "browser") {
      await this.speakInBrowser(text, callbacks);
      return;
    }

    const binary = atob(result.audioBase64);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: result.mimeType }));
    const audio = new Audio(url);
    audio.preload = "auto";
    this.audio = audio;
    this.objectUrl = url;

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        audio.onended = null;
        audio.onerror = null;
        audio.onplay = null;
        if (this.audio === audio) this.audio = null;
        if (this.objectUrl === url) this.objectUrl = null;
        URL.revokeObjectURL(url);
        if (this.finishCurrent === cancelPlayback) this.finishCurrent = null;
        if (error) reject(error);
        else resolve();
      };
      const cancelPlayback = () => finish();

      this.finishCurrent = cancelPlayback;
      audio.onplay = callbacks.onStart;
      audio.onended = () => finish();
      audio.onerror = () => finish(new VoiceProviderError("Não consegui reproduzir a voz neste dispositivo."));
      void audio.play().catch(() => finish(new VoiceProviderError("Não consegui iniciar a voz neste dispositivo.")));
    });
  }

  private async speakInBrowser(text: string, callbacks: TextToSpeechCallbacks): Promise<void> {
    if (typeof window === "undefined" || typeof SpeechSynthesisUtterance === "undefined") {
      throw new VoiceProviderError("A voz do browser não está disponível neste dispositivo.");
    }

    const synthesis = window.speechSynthesis;
    if (!synthesis) throw new VoiceProviderError("A voz do browser não está disponível neste dispositivo.");

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "pt-PT";
    utterance.rate = 1;
    utterance.pitch = 1;
    this.speechSynthesis = synthesis;
    this.utterance = utterance;

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        utterance.onstart = null;
        utterance.onboundary = null;
        utterance.onend = null;
        utterance.onerror = null;
        if (this.utterance === utterance) this.utterance = null;
        if (this.speechSynthesis === synthesis) this.speechSynthesis = null;
        if (this.finishCurrent === cancelPlayback) this.finishCurrent = null;
        if (error) reject(error);
        else resolve();
      };
      const cancelPlayback = () => {
        synthesis.cancel();
        finish();
      };

      this.finishCurrent = cancelPlayback;
      utterance.onstart = callbacks.onStart;
      utterance.onboundary = (event) => callbacks.onBoundary(event.charIndex);
      utterance.onend = () => finish();
      utterance.onerror = (event) => {
        const error = event as SpeechSynthesisErrorEvent;
        if (error.error === "canceled" || error.error === "interrupted") finish();
        else finish(new VoiceProviderError("Não consegui reproduzir a voz do browser."));
      };
      synthesis.speak(utterance);
    });
  }

  cancel(): void {
    this.generation += 1;
    this.pendingRequest?.abort();
    this.pendingRequest = null;

    const audio = this.audio;
    this.audio = null;
    if (audio) {
      audio.onended = null;
      audio.onerror = null;
      audio.onplay = null;
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }

    const url = this.objectUrl;
    this.objectUrl = null;
    if (url) URL.revokeObjectURL(url);

    const finish = this.finishCurrent;
    this.finishCurrent = null;
    finish?.();
  }
}
