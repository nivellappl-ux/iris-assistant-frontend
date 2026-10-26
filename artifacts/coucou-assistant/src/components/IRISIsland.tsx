import { useEffect, useState, type FormEvent } from 'react';
import { ArrowUpRight, ChevronDown, MessageCircle, Mic, MicOff, Radio, Send, X } from 'lucide-react';
import { VOICE_STATE_LABELS, type IrisVoiceState } from '../core/voice';
import type { AppSection } from '../core/irisTypes';
import type { BotStateName } from '../core/layout';
import { BotEngine } from '../mochi/engine';
import { MochiCanvas } from './MochiCanvas';

type IslandView = 'home' | 'chat';

interface IRISIslandProps {
  desktopMode: boolean;
  mochiState: BotStateName;
  voiceActive: boolean;
  voiceState: IrisVoiceState;
  voiceNotice: string;
  wakeWordArmed: boolean;
  onNavigate: (section: AppSection) => void;
  onSendChat: (text: string) => void;
  onToggleVoice: () => void;
  onToggleWakeWord: () => void;
}

const BOT_STATE_LABELS: Partial<Record<BotStateName, string>> = {
  idle: 'Por perto',
  listening: 'À escuta',
  working: 'A trabalhar',
  thinking: 'A pensar',
  speaking: 'A falar',
  searching: 'A procurar',
  approval: 'À espera de confirmação',
  question: 'A ouvir',
  error: 'Algo correu mal',
  finished: 'Feito',
  ratelimit: 'A fazer uma pausa',
  sleeping: 'À espera da palavra',
  dizzy: 'A recuperar',
};

const VOICE_BUBBLE_COPY: Record<IrisVoiceState, string> = {
  idle: 'Olá. Estou por aqui quando precisares.',
  listening: 'Estou à escuta. Podes falar.',
  thinking: 'Deixa-me pensar nisso.',
  speaking: 'Estou a falar contigo.',
  happy: 'Feito. Continuamos quando quiseres.',
  confused: 'Não percebi bem. Podes tentar outra vez?',
  error: 'A voz encontrou um problema. Podes tentar novamente.',
  sleeping: 'Diz “Acorda IRIS” para começar.',
};

const BOT_BUBBLE_COPY: Partial<Record<BotStateName, string>> = {
  finished: 'Está feito. Estou aqui se precisares.',
  approval: 'Preciso da tua confirmação antes de continuar.',
  question: 'Podes dar-me mais um pouco de contexto?',
  error: 'Algo não correu como esperado. Podes tentar novamente.',
  ratelimit: 'Vou fazer uma pausa breve antes de continuar.',
};

export function IRISIsland({
  desktopMode,
  mochiState,
  voiceActive,
  voiceState,
  voiceNotice,
  wakeWordArmed,
  onNavigate,
  onSendChat,
  onToggleVoice,
  onToggleWakeWord,
}: IRISIslandProps) {
  const [expanded, setExpanded] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [view, setView] = useState<IslandView>('home');
  const [chatText, setChatText] = useState('');
  const [engine] = useState(() => new BotEngine());

  const closePanel = () => {
    setExpanded(false);
    setPinned(false);
    setView('home');
  };

  useEffect(() => {
    if (!expanded) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setExpanded(false);
        setPinned(false);
        setView('home');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [expanded]);

  useEffect(() => {
    if (!desktopMode) return;
    const height = !expanded ? 64 : view === 'chat' ? 320 : 270;
    void import('@tauri-apps/api/window')
      .then(({ getCurrentWindow, LogicalSize }) => getCurrentWindow().setSize(new LogicalSize(390, height)))
      .catch((error: unknown) => console.error('Não foi possível ajustar a janela da IRIS.', error));
  }, [desktopMode, expanded, view]);

  const openChat = () => {
    if (!desktopMode) {
      closePanel();
      onNavigate('chat');
      return;
    }
    setView('chat');
    setPinned(true);
    setExpanded(true);
  };

  const submitChat = (event: FormEvent) => {
    event.preventDefault();
    const message = chatText.trim();
    if (!message) return;
    onSendChat(message);
    setChatText('');
  };

  const togglePin = () => {
    if (pinned && expanded) {
      closePanel();
      return;
    }
    setPinned(true);
    setExpanded(true);
  };

  const listeningInBackground = wakeWordArmed && voiceState === 'idle';
  const stateKey: IrisVoiceState | BotStateName = listeningInBackground ? 'sleeping' : voiceState === 'idle' ? mochiState : voiceState;
  const statusLabel = listeningInBackground
    ? VOICE_STATE_LABELS.sleeping
    : voiceState !== 'idle'
      ? VOICE_STATE_LABELS[voiceState]
      : BOT_STATE_LABELS[mochiState] ?? 'Por perto';
  const bubbleCopy = listeningInBackground
    ? VOICE_BUBBLE_COPY.sleeping
    : voiceState !== 'idle'
      ? VOICE_BUBBLE_COPY[voiceState]
      : BOT_BUBBLE_COPY[mochiState] ?? VOICE_BUBBLE_COPY.idle;
  const hasLiveVoiceState = stateKey === 'listening' || stateKey === 'thinking' || stateKey === 'speaking';
  const isNotice = Boolean(voiceNotice) && !hasLiveVoiceState && stateKey !== 'happy' && stateKey !== 'finished' && stateKey !== 'error';

  return (
    <div
      className={`iris-island${desktopMode ? ' is-native' : ''}${expanded ? ' is-expanded' : ''}`}
      data-testid="dynamic-island"
      data-state={stateKey}
      onMouseEnter={() => {
        if (!pinned) setExpanded(true);
      }}
      onMouseLeave={() => {
        if (!pinned) setExpanded(false);
      }}
    >
      <button
        className="iris-island-trigger"
        type="button"
        aria-expanded={expanded}
        aria-controls="iris-island-panel"
        aria-label={expanded ? 'Fechar o painel da IRIS' : 'Abrir o painel da IRIS'}
        onClick={togglePin}
        data-testid="button-toggle-dynamic-island"
      >
        <span className="iris-island-mochi" aria-hidden="true">
          <MochiCanvas state={mochiState} size={48} engine={engine} />
        </span>
        <span className="iris-island-name">
          <strong>IRIS</strong>
          <span data-testid="status-dynamic-island">{statusLabel}</span>
        </span>
        <span className={`iris-island-presence is-${stateKey}`} aria-hidden="true">
          <i /><i /><i />
        </span>
        <ChevronDown className={`iris-island-chevron${expanded ? ' is-open' : ''}`} aria-hidden="true" />
      </button>

      {expanded && (
        <section className="iris-island-panel" id="iris-island-panel" aria-label="Conversa e estado da IRIS">
          <div className="iris-island-panel-head">
            <span className="iris-island-mode">
              <span className={`iris-status-dot is-${stateKey}`} />
              {isNotice ? 'AVISO DA IRIS' : statusLabel.toLocaleUpperCase('pt-PT')}
            </span>
            <div className="iris-island-tools">
              <button
                className={`iris-island-voice${voiceState !== 'idle' ? ` is-${voiceState}` : ''}`}
                type="button"
                onClick={onToggleVoice}
                aria-pressed={voiceActive}
                aria-label={voiceActive ? 'Desativar comando de voz' : 'Ativar comando de voz'}
                data-testid="button-toggle-island-voice"
              >
                {voiceActive ? <Mic /> : <MicOff />}
                <span>{voiceActive ? 'Voz ativa' : 'Ativar voz'}</span>
              </button>
              <button
                className={`iris-island-wake${wakeWordArmed ? ' is-armed' : ''}`}
                type="button"
                onClick={onToggleWakeWord}
                aria-pressed={wakeWordArmed}
                aria-label={wakeWordArmed ? 'Desativar Acorda IRIS' : 'Ativar Acorda IRIS'}
                title={wakeWordArmed ? 'À espera de “Acorda IRIS” ou “Wake up Iris”' : 'Ativar palavra de despertar'}
                data-testid="button-toggle-wake-word"
              >
                <Radio />
                <span>{wakeWordArmed ? 'Acorda' : 'Wake'}</span>
              </button>
              <button className="iris-island-close" type="button" onClick={closePanel} aria-label="Fechar painel" data-testid="button-close-island">
                <X />
              </button>
            </div>
          </div>

          {view === 'chat' ? (
            <div className="iris-island-view iris-island-chat">
              <div className="iris-island-view-title">
                <strong>Conversar com a IRIS</strong>
                <button type="button" onClick={() => setView('home')}>Voltar</button>
              </div>
              <p className="iris-island-copy">A conversa usa Gemini através da integração da Replit, cobrada nos créditos Replit. A IRIS não está ligada ao Duvion nem acede a dados empresariais.</p>
              <form className="iris-island-form" onSubmit={submitChat}>
                <input
                  autoFocus
                  value={chatText}
                  onChange={(event) => setChatText(event.target.value)}
                  placeholder="Escreve à IRIS…"
                  aria-label="Mensagem para a IRIS"
                  data-testid="input-island-chat"
                />
                <button type="submit" aria-label="Enviar mensagem" data-testid="button-send-island-chat"><Send /></button>
              </form>
            </div>
          ) : (
            <div className="iris-island-view">
              <div
                className={`iris-island-speech${isNotice ? ' is-notice' : ''}`}
                data-kind={isNotice ? 'notice' : stateKey}
                role="status"
                aria-live="polite"
                data-testid="speech-bubble-island"
              >
                <span className="iris-island-speech-mark" aria-hidden="true"><MessageCircle /></span>
                <span className="iris-island-speech-copy">
                  <span className="iris-island-speech-label">{isNotice ? 'AVISO DA IRIS' : statusLabel}</span>
                  <span className="iris-island-speech-text">{voiceNotice || bubbleCopy}</span>
                </span>
              </div>
              <div className="iris-island-panel-actions">
                <button type="button" onClick={openChat} data-testid="button-open-island-chat">
                  <MessageCircle />
                  <span>Conversar</span>
                  {!desktopMode && <ArrowUpRight aria-hidden="true" />}
                </button>
                <p className="iris-island-privacy">A app não guarda gravações. O navegador ou WebView pode processar áudio segundo as respetivas regras.</p>
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
