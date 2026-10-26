import type { AttachmentInfo, ChatMessage, InboxItem, Project, Task } from './irisTypes';

export interface FocusState {
  remaining: number;
  endAt: number | null;
}

export interface PersistedIrisState {
  tasks: Task[];
  chat: ChatMessage[];
  inbox: InboxItem[];
  projects: Project[];
  focus: FocusState;
  sound: boolean;
  wakeWordAutoStart: boolean;
  aiConversationEnabled: boolean;
}

export type PersistedStateKey = keyof PersistedIrisState;

export interface StateCapability<T> {
  read(fallback: T): T;
  write(value: T): void;
}

export interface AttachmentCapability {
  save(file: File): Promise<AttachmentInfo>;
  open(id: string): Promise<void>;
  remove(id: string): Promise<void>;
}

export interface CapabilityImplementations {
  tasks: StateCapability<PersistedIrisState['tasks']>;
  conversation: StateCapability<PersistedIrisState['chat']>;
  quickCapture: StateCapability<PersistedIrisState['inbox']>;
  projects: StateCapability<PersistedIrisState['projects']>;
  focus: StateCapability<PersistedIrisState['focus']>;
  preferences: StateCapability<PersistedIrisState['sound']>;
  voicePreferences: StateCapability<PersistedIrisState['wakeWordAutoStart']>;
  aiPreferences: StateCapability<PersistedIrisState['aiConversationEnabled']>;
  attachments: AttachmentCapability;
}

export type CapabilityId = keyof CapabilityImplementations;
export type ProviderKind = 'local' | 'system' | 'remote';

export interface IntegrationProvider {
  readonly id: string;
  readonly kind: ProviderKind;
  readonly capabilities: Partial<CapabilityImplementations>;
}

const STATE_CAPABILITY_BY_KEY = {
  tasks: 'tasks',
  chat: 'conversation',
  inbox: 'quickCapture',
  projects: 'projects',
  focus: 'focus',
  sound: 'preferences',
  wakeWordAutoStart: 'voicePreferences',
  aiConversationEnabled: 'aiPreferences',
} as const satisfies Record<PersistedStateKey, Exclude<CapabilityId, 'attachments'>>;

export class IrisCore {
  private readonly providers = new Map<string, IntegrationProvider>();
  private readonly activeProviders = new Map<CapabilityId, string>();

  registerProvider(provider: IntegrationProvider): void {
    if (this.providers.has(provider.id)) {
      throw new Error(`An integration provider with id "${provider.id}" is already registered.`);
    }

    const availableCapabilities = (Object.keys(provider.capabilities) as CapabilityId[])
      .filter((capability) => provider.capabilities[capability] !== undefined);
    if (availableCapabilities.length === 0) {
      throw new Error(`Integration provider "${provider.id}" does not implement any capabilities.`);
    }

    this.providers.set(provider.id, provider);
    for (const capability of availableCapabilities) {
      if (!this.activeProviders.has(capability)) {
        this.activeProviders.set(capability, provider.id);
      }
    }
  }

  activateProvider(capability: CapabilityId, providerId: string): void {
    const provider = this.providers.get(providerId);
    if (!provider) {
      throw new Error(`Integration provider "${providerId}" is not registered.`);
    }
    if (!provider.capabilities[capability]) {
      throw new Error(`Integration provider "${providerId}" does not implement "${capability}".`);
    }
    this.activeProviders.set(capability, providerId);
  }

  getActiveProviderId(capability: CapabilityId): string | null {
    return this.activeProviders.get(capability) ?? null;
  }

  getCapability<K extends CapabilityId>(capability: K): CapabilityImplementations[K] {
    const providerId = this.activeProviders.get(capability);
    const provider = providerId ? this.providers.get(providerId) : undefined;
    const implementation = provider?.capabilities[capability];
    if (!implementation) {
      throw new Error(`No active integration provider implements "${capability}".`);
    }
    return implementation as CapabilityImplementations[K];
  }

  readState<K extends PersistedStateKey>(key: K, fallback: PersistedIrisState[K]): PersistedIrisState[K] {
    const capability = STATE_CAPABILITY_BY_KEY[key];
    const implementation = this.getCapability(capability) as StateCapability<PersistedIrisState[K]>;
    return implementation.read(fallback);
  }

  writeState<K extends PersistedStateKey>(key: K, value: PersistedIrisState[K]): void {
    const capability = STATE_CAPABILITY_BY_KEY[key];
    const implementation = this.getCapability(capability) as StateCapability<PersistedIrisState[K]>;
    implementation.write(value);
  }
}