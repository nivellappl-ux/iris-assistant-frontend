import type { IrisVoiceState } from './contracts';
import { IrisEventBus } from './eventBus';

const TRANSITIONS: Record<IrisVoiceState, readonly IrisVoiceState[]> = {
  idle: ['listening', 'sleeping', 'error'],
  listening: ['thinking', 'error', 'idle', 'sleeping'],
  thinking: ['speaking', 'listening', 'error', 'idle', 'confused'],
  speaking: ['listening', 'error', 'idle', 'happy'],
  happy: ['listening', 'idle'],
  confused: ['listening', 'idle', 'error'],
  error: ['idle', 'listening', 'sleeping'],
  sleeping: ['idle', 'listening', 'error'],
};

export class IrisStateMachine {
  private current: IrisVoiceState = 'idle';

  constructor(private readonly events: IrisEventBus) {}

  get state(): IrisVoiceState {
    return this.current;
  }

  transition(next: IrisVoiceState): void {
    if (next === this.current) return;
    if (!TRANSITIONS[this.current].includes(next)) {
      throw new Error(`Invalid IRIS voice-state transition: ${this.current} -> ${next}`);
    }
    const previous = this.current;
    this.current = next;
    this.events.emit({ type: 'iris.state.changed', previous, state: next });
  }
}
