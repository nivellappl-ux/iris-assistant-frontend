import type { BotStateName } from '../layout';
import type { IrisVoiceState } from './contracts';

const BOT_STATE_BY_VOICE_STATE: Record<IrisVoiceState, BotStateName> = {
  idle: 'idle',
  listening: 'listening',
  thinking: 'thinking',
  speaking: 'speaking',
  happy: 'finished',
  confused: 'question',
  error: 'error',
  sleeping: 'sleeping',
};

export const VOICE_STATE_LABELS: Record<IrisVoiceState, string> = {
  idle: 'Pronta',
  listening: 'À escuta',
  thinking: 'A pensar',
  speaking: 'A falar',
  happy: 'Contente',
  confused: 'Confusa',
  error: 'Erro de voz',
  sleeping: 'À espera da palavra',
};

export function botStateForVoice(state: IrisVoiceState, fallback: BotStateName): BotStateName {
  return state === 'idle' ? fallback : BOT_STATE_BY_VOICE_STATE[state];
}
