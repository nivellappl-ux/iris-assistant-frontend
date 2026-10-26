import {
  VoiceProviderError,
  type VoiceActivityCallbacks,
  type VoiceActivityProvider,
} from './contracts';

const SAMPLE_INTERVAL_MS = 60;
const END_OF_SPEECH_SILENCE_MS = 720;
const MAX_SPEECH_SEGMENT_MS = 15_000;

type AudioContextWindow = Window & {
  webkitAudioContext?: typeof AudioContext;
};

export class BrowserVoiceActivityDetector implements VoiceActivityProvider {
  private generation = 0;
  private active = false;
  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private sampleBuffer: Uint8Array<ArrayBuffer> | null = null;
  private interval: number | null = null;
  private callbacks: VoiceActivityCallbacks | null = null;
  private speaking = false;
  private loudFrameCount = 0;
  private silenceStartedAt: number | null = null;
  private speechStartedAt = 0;
  private noiseFloor = 0.006;

  async start(callbacks: VoiceActivityCallbacks): Promise<boolean> {
    this.stop();
    if (typeof window === 'undefined' || !navigator.mediaDevices?.getUserMedia) return false;
    const AudioContextConstructor = window.AudioContext ?? (window as AudioContextWindow).webkitAudioContext;
    if (!AudioContextConstructor) return false;

    const generation = ++this.generation;
    this.callbacks = callbacks;
    this.active = true;
    let stream: MediaStream | null = null;
    let context: AudioContext | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      if (!this.active || generation !== this.generation) {
        stream.getTracks().forEach((track) => track.stop());
        return false;
      }

      context = new AudioContextConstructor();
      const source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      source.connect(analyser);
      await context.resume();
      if (!this.active || generation !== this.generation) {
        stream.getTracks().forEach((track) => track.stop());
        void context.close();
        return false;
      }

      this.stream = stream;
      this.context = context;
      this.analyser = analyser;
      this.sampleBuffer = new Uint8Array(new ArrayBuffer(analyser.fftSize));
      this.interval = window.setInterval(() => this.sample(), SAMPLE_INTERVAL_MS);
      return true;
    } catch (error) {
      stream?.getTracks().forEach((track) => track.stop());
      if (context && context.state !== 'closed') void context.close().catch(() => undefined);
      this.stop();
      if (error instanceof DOMException && error.name === 'NotAllowedError') {
        throw new VoiceProviderError('O acesso ao microfone foi recusado. Permite-o nas definições do sistema.');
      }
      if (error instanceof DOMException && error.name === 'NotFoundError') {
        throw new VoiceProviderError('Não encontrei um microfone disponível.');
      }
      throw new VoiceProviderError('A deteção de voz não está disponível neste dispositivo.');
    }
  }

  stop(): void {
    this.generation += 1;
    this.active = false;
    this.callbacks = null;
    if (this.interval !== null && typeof window !== 'undefined') window.clearInterval(this.interval);
    this.interval = null;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    const context = this.context;
    this.context = null;
    if (context && context.state !== 'closed') void context.close().catch(() => undefined);
    this.analyser = null;
    this.sampleBuffer = null;
    this.speaking = false;
    this.loudFrameCount = 0;
    this.silenceStartedAt = null;
    this.speechStartedAt = 0;
    this.noiseFloor = 0.006;
  }

  private sample(): void {
    const analyser = this.analyser;
    const buffer = this.sampleBuffer;
    if (!this.active || !analyser || !buffer) return;
    analyser.getByteTimeDomainData(buffer);

    let sum = 0;
    for (const value of buffer) {
      const sample = (value - 128) / 128;
      sum += sample * sample;
    }
    const rms = Math.sqrt(sum / buffer.length);
    const threshold = Math.max(0.024, this.noiseFloor * 2.7);
    const now = performance.now();

    if (rms > threshold) {
      this.loudFrameCount += 1;
      this.silenceStartedAt = null;
      if (!this.speaking && this.loudFrameCount >= 3) {
        this.speaking = true;
        this.speechStartedAt = now;
        this.callbacks?.onSpeechStart();
      }
      if (this.speaking && now - this.speechStartedAt >= MAX_SPEECH_SEGMENT_MS) this.finishSpeech();
      return;
    }

    this.loudFrameCount = 0;
    if (!this.speaking) {
      this.noiseFloor = Math.min(0.018, this.noiseFloor * 0.92 + rms * 0.08);
      return;
    }

    if (this.silenceStartedAt === null) this.silenceStartedAt = now;
    if (now - this.silenceStartedAt >= END_OF_SPEECH_SILENCE_MS
      || now - this.speechStartedAt >= MAX_SPEECH_SEGMENT_MS) {
      this.finishSpeech();
    }
  }

  private finishSpeech(): void {
    this.speaking = false;
    this.loudFrameCount = 0;
    this.silenceStartedAt = null;
    this.callbacks?.onSpeechEnd();
  }
}
