import {
  type IntegrationProvider,
  type PersistedIrisState,
  type PersistedStateKey,
  type StateCapability,
} from './irisCore';
import { openLocalAttachment, removeLocalAttachment, saveLocalAttachment } from './irisFiles';

const LOCAL_STORAGE_KEYS = {
  tasks: 'coucou.tasks.v1',
  chat: 'coucou.chat.v1',
  inbox: 'iris.inbox.v1',
  projects: 'iris.projects.v1',
  focus: 'iris.focus.v1',
  sound: 'iris.sound.v1',
  wakeWordAutoStart: 'iris.wake-word-auto-start.v1',
  aiConversationEnabled: 'iris.ai-conversation-enabled.v1',
} as const satisfies Record<PersistedStateKey, string>;

export class LocalProvider implements IntegrationProvider {
  readonly id = 'local';
  readonly kind = 'local' as const;

  readonly capabilities: IntegrationProvider['capabilities'] = {
    tasks: this.stateCapability('tasks'),
    conversation: this.stateCapability('chat'),
    quickCapture: this.stateCapability('inbox'),
    projects: this.stateCapability('projects'),
    focus: this.stateCapability('focus'),
    preferences: this.stateCapability('sound'),
    voicePreferences: this.stateCapability('wakeWordAutoStart'),
    aiPreferences: this.stateCapability('aiConversationEnabled'),
    attachments: {
      save: saveLocalAttachment,
      open: openLocalAttachment,
      remove: removeLocalAttachment,
    },
  };

  private stateCapability<K extends PersistedStateKey>(key: K): StateCapability<PersistedIrisState[K]> {
    return {
      read: (fallback) => this.readState(key, fallback),
      write: (value) => this.writeState(key, value),
    };
  }

  private readState<K extends PersistedStateKey>(key: K, fallback: PersistedIrisState[K]): PersistedIrisState[K] {
    try {
      const value = localStorage.getItem(LOCAL_STORAGE_KEYS[key]);
      return value ? JSON.parse(value) as PersistedIrisState[K] : fallback;
    } catch {
      return fallback;
    }
  }

  private writeState<K extends PersistedStateKey>(key: K, value: PersistedIrisState[K]): void {
    localStorage.setItem(LOCAL_STORAGE_KEYS[key], JSON.stringify(value));
  }
}