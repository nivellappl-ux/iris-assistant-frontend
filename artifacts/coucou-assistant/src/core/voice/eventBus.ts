import type { IrisVoiceEvent } from './contracts';

export class IrisEventBus {
  private readonly listeners = new Set<(event: IrisVoiceEvent) => void>();

  subscribe(listener: (event: IrisVoiceEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event: IrisVoiceEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error('Um listener de eventos da IRIS falhou.', error);
      }
    }
  }
}
