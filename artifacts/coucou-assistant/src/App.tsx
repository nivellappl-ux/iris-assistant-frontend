import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  Activity, Archive, ArrowDownRight, ArrowUpRight, Bell, CalendarCheck, CalendarClock,
  Check, CheckCheck, ChevronDown, CircleHelp, Command, FileText, Focus, FolderKanban,
  Inbox as InboxIcon, Lightbulb, ListTodo, MessageCircle, Mic, MicOff, MoreHorizontal,
  Plus, Radio, Search, Send, Settings, Sparkles, Trash2, Volume2, X,
  type LucideIcon,
} from 'lucide-react';
import { isTauri } from '@tauri-apps/api/core';
import { irisChat } from '@workspace/api-client-react';
import { BotEngine } from './mochi/engine';
import type { BotEmoteName, BotStateName } from './core/layout';
import { irisCore } from './core/runtime';
import { Sound } from './core/sound';
import { AudioController, botStateForVoice, VOICE_STATE_LABELS, type IrisVoiceEvent, type IrisVoiceState } from './core/voice';
import { IrisTextToSpeechProvider } from './core/voice/irisTextToSpeech';
import { LiveKitVoiceSession } from './core/voice/liveKitVoice';
import { IRISIsland } from './components/IRISIsland';
import { MochiCanvas } from './components/MochiCanvas';
import type {
  AppSection, ChatMessage, InboxCategory, InboxItem, Project, Task, TaskFilter, TaskPriority,
} from './core/irisTypes';
import './iris-redesign.css';

const FOCUS_DURATION = 45 * 60;

const INITIAL_TASKS: Task[] = [
  { id: 'seed-1', title: 'Rever o relatório de março', done: false, createdAt: Date.now() - 3_600_000 },
  { id: 'seed-2', title: 'Preparar notas para a reunião', done: false, createdAt: Date.now() - 7_200_000 },
  { id: 'seed-3', title: 'Enviar a proposta à Leonor', done: true, createdAt: Date.now() - 86_400_000 },
];

const INITIAL_CHAT: ChatMessage[] = [{
  id: 'welcome',
  role: 'assistant',
  text: 'Olá. Sou a IRIS. Posso conversar contigo por texto ou voz.',
  time: Date.now(),
  source: 'local',
}];

const SECTION_LABELS: Record<AppSection, string> = {
  home: 'Hoje',
  inbox: 'Inbox',
  tasks: 'Tarefas',
  projects: 'Projetos',
  focus: 'Foco',
  chat: 'Conversar',
  settings: 'Definições',
  help: 'Ajuda',
};

const NAV_ITEMS: { id: AppSection; label: string; icon: LucideIcon; group: string }[] = [
  { id: 'home', label: 'Hoje', icon: CalendarCheck, group: 'O teu espaço' },
  { id: 'chat', label: 'Conversar', icon: MessageCircle, group: 'Rotina' },
];

const MOBILE_NAV_ITEMS: { id: AppSection; label: string; icon: LucideIcon }[] = [
  { id: 'home', label: 'Hoje', icon: CalendarCheck },
  { id: 'chat', label: 'Conversar', icon: MessageCircle },
  { id: 'settings', label: 'Definições', icon: Settings },
  { id: 'help', label: 'Ajuda', icon: CircleHelp },
];

interface TaskDraft {
  title: string;
  date: string;
  time: string;
  priority: TaskPriority;
  projectId: string;
}

type CaptureChoice = 'auto' | InboxCategory;

const IRIS_TIME_ZONE = 'Africa/Luanda';

function localDateInput(timestamp?: number) {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function localTimeInput(timestamp?: number) {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function dayStart(date = new Date()) {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  return start.getTime();
}

function tomorrowAtNine() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(9, 0, 0, 0);
  return date.getTime();
}

function cleanTitle(value: string) {
  return value.trim().replace(/[.!?]+$/, '');
}

function classifyInboxText(text: string): InboxCategory {
  if (/https?:\/\/\S+/i.test(text)) return 'reference';
  if (/\b(ideia|ideia de|talvez|e se|inspiração|inspiracao)\b/i.test(text)) return 'idea';
  if (/\.(pdf|docx?|txt|md)\b/i.test(text)) return 'document';
  return 'note';
}

function parseTaskDue(text: string) {
  const match = text.match(/\b(hoje|amanhã|amanha)\b(?:\s+(?:às|as)\s+(\d{1,2})(?::(\d{2}))?)?/i);
  if (!match) return { title: cleanTitle(text), dueAt: undefined as number | undefined, dueHasTime: false };
  const date = new Date();
  date.setDate(date.getDate() + (/amanh/i.test(match[1]) ? 1 : 0));
  date.setHours(Number(match[2] ?? 9), Number(match[3] ?? 0), 0, 0);
  return {
    title: cleanTitle(text.replace(match[0], '')),
    dueAt: date.getTime(),
    dueHasTime: Boolean(match[2]),
  };
}

function shortTime(timestamp: number) {
  return new Intl.DateTimeFormat('pt-PT', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: IRIS_TIME_ZONE,
  }).format(new Date(timestamp));
}

function dateLabel(timestamp: number) {
  return new Intl.DateTimeFormat('pt-PT', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: IRIS_TIME_ZONE,
  }).format(new Date(timestamp));
}

function dateHeading() {
  return new Intl.DateTimeFormat('pt-PT', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: IRIS_TIME_ZONE,
  }).format(new Date());
}

function timeOfDayGreeting() {
  const hour = Number(new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    hourCycle: 'h23',
    timeZone: IRIS_TIME_ZONE,
  }).format(new Date()));
  return hour < 5 ? 'Boa madrugada.' : hour < 12 ? 'Bom dia.' : hour < 18 ? 'Boa tarde.' : 'Boa noite.';
}

function formatDuration(seconds: number) {
  const safeSeconds = Math.max(0, seconds);
  return `${String(Math.floor(safeSeconds / 60)).padStart(2, '0')}:${String(safeSeconds % 60).padStart(2, '0')}`;
}

type VoiceReplyKind = 'greeting' | 'saved' | 'updated' | 'fallback';

function voiceReplyKind(reply: string): VoiceReplyKind {
  if (reply.startsWith('Olá')) return 'greeting';
  if (reply.startsWith('Fica guardado:') || reply.startsWith('Guardei')) return 'saved';
  if (/^(Feito|Tens |Está tudo concluído|Ainda não tens tarefas|Iniciei|Adiei)/.test(reply)) return 'updated';
  return 'fallback';
}

const VOICE_SOUND: Record<VoiceReplyKind, string> = {
  greeting: 'greet',
  saved: 'approval',
  updated: 'finish',
  fallback: 'question',
};

function safeLocalVoiceReply(reply: string) {
  if (reply.startsWith('Olá')) return 'Olá! Estou aqui para ajudar.';
  return reply;
}

function serverErrorMessage(error: unknown): string | null {
  if (typeof error !== 'object' || error === null || !('data' in error)) return null;
  const data = error.data;
  if (typeof data !== 'object' || data === null || !('error' in data)) return null;
  return typeof data.error === 'string' ? data.error : null;
}

const REMOVED_FEATURE_MESSAGE =
  'Tarefas, inbox, projetos e foco foram removidos. Os dados antigos continuam guardados neste dispositivo, mas já não estão disponíveis na IRIS.';

function requestsRemovedFeature(input: string) {
  const mentionsRemovedArea = /\b(tarefas?|tasks?|afazeres?|inbox|capturas?|captures?|notas?|notes?|ideias?|ideas?|projetos?|projects?|foco|focus|pomodoro)\b/i.test(input);
  const asksAboutOrUsesIt = /\b(adiciona|adicionar|add|cria|criar|create|guarda|guardar|save|captura|capturar|anota|regista|conclui|concluir|complete|termina|fecha|marca|adia|adiar|apaga|apagar|remove|elimina|delete|edita|editar|altera|atualiza|mostra|mostrar|lista|listar|abre|abrir|inicia|iniciar|começa|comeca|start|quais|qual|quantos|quantas|tenho|consulta|consultar|ver|verifica|mostra|show|list|view|what|which|display|summarize|summary|tell)\b/i.test(input);
  return mentionsRemovedArea && asksAboutOrUsesIt;
}

function explicitlyTargetsDuvion(input: string) {
  return /\bduvion\b/i.test(input);
}

interface CaptureDialogProps {
  text: string;
  category: CaptureChoice;
  file: File | null;
  saving: boolean;
  setText: (value: string) => void;
  setCategory: (value: CaptureChoice) => void;
  setFile: (value: File | null) => void;
  onSubmit: (event: FormEvent) => void;
  onClose: () => void;
}

function CaptureDialog({ text, category, file, saving, setText, setCategory, setFile, onSubmit, onClose }: CaptureDialogProps) {
  return (
    <div className="iris-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="iris-modal iris-capture-modal" role="dialog" aria-modal="true" aria-labelledby="iris-capture-title">
        <div className="iris-modal-heading"><div><span className="iris-section-kicker">CAPTURA RÁPIDA</span><h2 id="iris-capture-title">Guarda para mais tarde.</h2></div><button className="iris-quiet-icon" type="button" onClick={onClose} aria-label="Fechar"><X /></button></div>
        <form onSubmit={onSubmit}>
          <label className="iris-form-field"><span>Nota, ideia, ligação ou documento</span><textarea autoFocus rows={4} value={text} onChange={(event) => setText(event.target.value)} placeholder="Escreve sem precisares de organizar agora…" /></label>
          <div className="iris-capture-modal-meta">
            <label className="iris-form-field"><span>Organizar como</span><select value={category} onChange={(event) => setCategory(event.target.value as CaptureChoice)}><option value="auto">Automaticamente</option><option value="note">Nota</option><option value="idea">Ideia</option><option value="reference">Referência</option><option value="document">Documento</option></select></label>
            <label className="iris-file-pick modal-file" htmlFor="iris-capture-file"><FileText />{file ? file.name : 'Escolher documento'}</label>
            <input id="iris-capture-file" type="file" accept=".pdf,.doc,.docx,.txt,.md,application/pdf,text/plain" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
          </div>
          <p className="iris-local-hint"><span />Tudo fica guardado neste dispositivo. Ficheiros até 15 MB.</p>
          <div className="iris-modal-actions"><button className="iris-secondary-button" type="button" onClick={onClose}>Cancelar</button><button className="iris-primary-button" type="submit" disabled={saving}>{saving ? 'A guardar…' : 'Guardar na inbox'}</button></div>
        </form>
      </section>
    </div>
  );
}

function App() {
  const desktopMode = isTauri();
  const [tasks, setTasks] = useState<Task[]>(() => irisCore.readState('tasks', INITIAL_TASKS));
  const [messages, setMessages] = useState<ChatMessage[]>(() => irisCore.readState('chat', INITIAL_CHAT));
  const [inboxItems, setInboxItems] = useState<InboxItem[]>(() => irisCore.readState('inbox', []));
  const [projects, setProjects] = useState<Project[]>(() => irisCore.readState('projects', []));
  const initialFocus = irisCore.readState('focus', { remaining: FOCUS_DURATION, endAt: null as number | null });
  const [focusRemaining, setFocusRemaining] = useState(() => initialFocus.endAt
    ? Math.max(0, Math.ceil((initialFocus.endAt - Date.now()) / 1000))
    : initialFocus.remaining);
  const [focusEndAt, setFocusEndAt] = useState<number | null>(initialFocus.endAt);
  const [section, setSection] = useState<AppSection>('home');
  const [filter, setFilter] = useState<TaskFilter>('open');
  const [inboxFilter, setInboxFilter] = useState<'all' | InboxCategory>('all');
  const [selectedProject, setSelectedProject] = useState<string>('all');
  const [focusedTaskId, setFocusedTaskId] = useState('');
  const [mochiState, setMochiState] = useState<BotStateName>('idle');
  const [soundOn, setSoundOn] = useState(() => irisCore.readState('sound', true));
  const [voiceActive, setVoiceActive] = useState(false);
  const [wakeWordArmed, setWakeWordArmed] = useState(false);
  const [wakeWordAutoStart, setWakeWordAutoStart] = useState(() => irisCore.readState('wakeWordAutoStart', true));
  const [aiConversationEnabled, setAIConversationEnabled] = useState(() => irisCore.readState('aiConversationEnabled', true));
  const [voiceState, setVoiceState] = useState<IrisVoiceState>('idle');
  const [voiceNotice, setVoiceNotice] = useState('');
  const [toast, setToast] = useState('');
  const [taskModalOpen, setTaskModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [taskDraft, setTaskDraft] = useState<TaskDraft>({ title: '', date: '', time: '', priority: 'normal', projectId: '' });
  const [captureOpen, setCaptureOpen] = useState(false);
  const [captureText, setCaptureText] = useState('');
  const [captureCategory, setCaptureCategory] = useState<CaptureChoice>('auto');
  const [captureFile, setCaptureFile] = useState<File | null>(null);
  const [savingCapture, setSavingCapture] = useState(false);
  const [inboxText, setInboxText] = useState('');
  const [inboxCategory, setInboxCategory] = useState<CaptureChoice>('auto');
  const [inboxFile, setInboxFile] = useState<File | null>(null);
  const [projectName, setProjectName] = useState('');
  const [taskSearch, setTaskSearch] = useState('');
  const [chatInput, setChatInput] = useState('');
  const [focusTick, setFocusTick] = useState(Date.now());
  const [activeEmote, setActiveEmote] = useState<BotEmoteName | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const audioControllerRef = useRef<AudioController | null>(null);
  const liveKitVoiceRef = useRef<LiveKitVoiceSession | null>(null);
  const aiConversationEnabledRef = useRef(aiConversationEnabled);
  aiConversationEnabledRef.current = aiConversationEnabled;
  const chatRequestInFlightRef = useRef(false);
  const voiceTurnHandlerRef = useRef<(transcript: string) => string | Promise<string>>(() => '');
  const mochiEngineRef = useRef<BotEngine | null>(null);
  if (!audioControllerRef.current) {
    audioControllerRef.current = new AudioController({
      speech: new IrisTextToSpeechProvider(() => aiConversationEnabledRef.current),
      thinkingTimeoutMs: 60_000,
    });
  }
  if (!liveKitVoiceRef.current) liveKitVoiceRef.current = new LiveKitVoiceSession();
  if (!mochiEngineRef.current) mochiEngineRef.current = new BotEngine();

  const openTasks = tasks.filter((task) => !task.done);
  const doneTasks = tasks.filter((task) => task.done);
  const openCount = openTasks.length;
  const doneCount = doneTasks.length;
  const inboxCount = inboxItems.length;
  const now = focusEndAt ? focusTick : Date.now();
  const liveFocusRemaining = focusEndAt ? Math.max(0, Math.ceil((focusEndAt - now) / 1000)) : focusRemaining;
  const focusRunning = Boolean(focusEndAt && liveFocusRemaining > 0);
  const todayStart = dayStart();
  const tomorrowStart = dayStart(new Date(todayStart + 86_400_000));
  const overdueTasks = openTasks.filter((task) => task.dueAt && task.dueAt < Date.now()).sort((a, b) => (a.dueAt ?? 0) - (b.dueAt ?? 0));
  const todayTasks = openTasks.filter((task) => task.dueAt && task.dueAt >= todayStart && task.dueAt < tomorrowStart && task.dueAt >= Date.now()).sort((a, b) => (a.dueAt ?? 0) - (b.dueAt ?? 0));
  const upNextTasks = openTasks.filter((task) => !task.dueAt || task.dueAt >= tomorrowStart).sort((a, b) => {
    if (!a.dueAt) return b.dueAt ? 1 : a.createdAt - b.createdAt;
    if (!b.dueAt) return -1;
    return a.dueAt - b.dueAt;
  });

  const showToast = useCallback((message: string) => setToast(message), []);

  useEffect(() => {
    irisCore.writeState('chat', messages);
  }, [messages]);
  useEffect(() => {
    irisCore.writeState('sound', soundOn);
    Sound.setEnabled(soundOn);
  }, [soundOn]);
  useEffect(() => {
    irisCore.writeState('wakeWordAutoStart', wakeWordAutoStart);
  }, [wakeWordAutoStart]);
  useEffect(() => {
    irisCore.writeState('aiConversationEnabled', aiConversationEnabled);
  }, [aiConversationEnabled]);
  useEffect(() => {
    const controller = audioControllerRef.current;
    if (!controller) return;
    return controller.subscribe((event: IrisVoiceEvent) => {
      switch (event.type) {
        case 'iris.state.changed':
          setVoiceState(event.state);
          break;
        case 'wake-word.armed':
          setWakeWordArmed(true);
          setVoiceActive(true);
          setVoiceNotice('À espera de “Acorda IRIS” ou “Wake up Iris”.');
          break;
        case 'wake-word.detected':
          setVoiceActive(true);
          setVoiceNotice('Acordei. Diz o que precisas.');
          Sound.play('open');
          break;
        case 'wake-word.disarmed':
          setWakeWordArmed(false);
          setVoiceActive(controller.isActive);
          if (!controller.isActive) setVoiceNotice('Espera por voz desligada.');
          break;
        case 'voice.started':
          setVoiceActive(true);
          setVoiceNotice(controller.isWakeWordArmed ? 'Acordei. Diz o que precisas.' : 'À escuta. Podes falar sem carregar novamente.');
          break;
        case 'voice.stopped':
          setVoiceActive(controller.isActive || controller.isWakeWordArmed);
          if (event.reason === 'user') setVoiceNotice('Escuta desligada.');
          if (event.reason === 'inactivity') {
            setVoiceNotice(controller.isWakeWordArmed
              ? 'Voltei a aguardar “Acorda IRIS” ou “Wake up Iris”.'
              : 'A escuta foi desligada após dois minutos sem voz.');
          }
          break;
        case 'transcription.completed':
          setVoiceNotice('A IRIS está a preparar uma resposta…');
          break;
        case 'transcription.started':
          setVoiceNotice('A ouvir a tua voz…');
          break;
        case 'thinking.started':
          setVoiceNotice('A IRIS está a pensar…');
          break;
        case 'speech.started':
          setVoiceNotice('A IRIS está a falar…');
          break;
        case 'speech.completed':
          setVoiceNotice(controller.isActive ? 'À escuta para continuares.' : 'Resposta de voz concluída.');
          break;
        case 'speech.interrupted':
          setVoiceNotice('Interrompida. Estou a ouvir-te.');
          break;
        case 'assistant.notice':
        case 'assistant.error':
          setVoiceNotice(event.message);
          break;
        default:
          break;
      }
    });
  }, []);
  useEffect(() => {
    const controller = audioControllerRef.current;
    if (!controller) return;
    if (!wakeWordAutoStart) {
      if (controller.isWakeWordArmed) controller.stop('user');
      return;
    }
    if (controller.isWakeWordArmed) return;
    let cancelled = false;
    const startWhenAuthorized = async () => {
      if (!controller.wakeWordAvailable) {
        setVoiceNotice('O reconhecimento de voz não está disponível neste navegador ou WebView.');
        return;
      }
      if (!navigator.permissions?.query) {
        setVoiceNotice('Toca no botão de voz uma vez para autorizar o microfone.');
        return;
      }
      try {
        const permission = await navigator.permissions.query({ name: 'microphone' as PermissionName });
        if (cancelled) return;
        if (permission.state !== 'granted') {
          setVoiceNotice(permission.state === 'denied'
            ? 'Permite o acesso ao microfone nas definições do navegador para iniciar a espera ao abrir.'
            : 'Toca no botão de voz uma vez para autorizar o microfone; depois a IRIS pode iniciar ao abrir.');
          return;
        }
      } catch {
        if (!cancelled) setVoiceNotice('Toca no botão de voz uma vez para autorizar o microfone.');
        return;
      }
      if (cancelled || controller.isWakeWordArmed) return;
      await controller.armWakeWord((transcript) => voiceTurnHandlerRef.current(transcript));
    };
    void startWhenAuthorized().catch((error: unknown) => {
      if (cancelled) return;
      setWakeWordArmed(false);
      setVoiceActive(false);
      setVoiceNotice(error instanceof Error ? error.message : 'Não foi possível iniciar a espera por voz.');
    });
    return () => {
      cancelled = true;
    };
  }, [wakeWordAutoStart]);
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, section]);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(''), 2800);
    return () => window.clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    void Sound.preload().catch((error: unknown) => console.error('Não foi possível preparar os sons da IRIS.', error));
    const resumeAudio = () => Sound.resume();
    window.addEventListener('pointerdown', resumeAudio);
    window.addEventListener('keydown', resumeAudio);
    return () => {
      window.removeEventListener('pointerdown', resumeAudio);
      window.removeEventListener('keydown', resumeAudio);
      audioControllerRef.current?.stop();
      void liveKitVoiceRef.current?.stop();
    };
  }, []);
  const addTask = (rawTitle: string, options: { dueAt?: number; dueHasTime?: boolean; priority?: TaskPriority; projectId?: string } = {}) => {
    const title = cleanTitle(rawTitle);
    if (!title) return false;
    const task: Task = {
      id: crypto.randomUUID(),
      title,
      done: false,
      createdAt: Date.now(),
      ...(options.dueAt ? { dueAt: options.dueAt } : {}),
      ...(options.dueAt ? { dueHasTime: options.dueHasTime ?? false } : {}),
      priority: options.priority ?? 'normal',
      ...(options.projectId ? { projectId: options.projectId } : {}),
    };
    setTasks((current) => [task, ...current]);
    setMochiState('approval');
    Sound.play('approval');
    window.setTimeout(() => setMochiState('finished'), 350);
    window.setTimeout(() => setMochiState('idle'), 1200);
    return true;
  };

  const toggleTask = (id: string) => {
    const task = tasks.find((item) => item.id === id);
    if (!task) return;
    setTasks((current) => current.map((item) => item.id === id ? { ...item, done: !item.done } : item));
    setMochiState(task.done ? 'idle' : 'finished');
    Sound.play(task.done ? 'open' : 'finish');
    if (!task.done) window.setTimeout(() => setMochiState('idle'), 1000);
  };

  const deleteTask = (id: string) => {
    setTasks((current) => current.filter((task) => task.id !== id));
    showToast('Tarefa removida.');
  };

  const addInboxItem = (rawText: string, choice: CaptureChoice = 'auto', attachment?: InboxItem['attachment']) => {
    const text = rawText.trim() || attachment?.name || '';
    if (!text) return false;
    const category: InboxCategory = attachment ? 'document' : choice === 'auto' ? classifyInboxText(text) : choice;
    const item: InboxItem = { id: crypto.randomUUID(), text, category, createdAt: Date.now(), ...(attachment ? { attachment } : {}) };
    setInboxItems((current) => [item, ...current]);
    setMochiState('approval');
    Sound.play('approval');
    window.setTimeout(() => setMochiState('idle'), 900);
    return true;
  };

  const captureTextOnly = (text: string) => {
    if (!addInboxItem(text)) return false;
    showToast('Guardado na inbox local.');
    return true;
  };

  const addInboxFromForm = async (text: string, choice: CaptureChoice, file: File | null) => {
    if (!text.trim() && !file) {
      showToast('Escreve algo ou escolhe um documento.');
      return false;
    }
    if (file && file.size > 15 * 1024 * 1024) {
      showToast('O ficheiro deve ter menos de 15 MB.');
      return false;
    }
    try {
      const attachment = file ? await irisCore.getCapability('attachments').save(file) : undefined;
      const saved = addInboxItem(text, choice, attachment);
      if (saved) showToast(attachment ? 'Documento guardado neste dispositivo.' : 'Guardado na inbox local.');
      return saved;
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Não foi possível guardar o ficheiro.');
      return false;
    }
  };

  const openNewTask = () => {
    setEditingTask(null);
    setTaskDraft({ title: '', date: '', time: '', priority: 'normal', projectId: selectedProject === 'all' ? '' : selectedProject });
    setTaskModalOpen(true);
  };

  const openTaskEditor = (task: Task) => {
    setEditingTask(task);
    setTaskDraft({
      title: task.title,
      date: localDateInput(task.dueAt),
      time: task.dueHasTime ? localTimeInput(task.dueAt) : '',
      priority: task.priority ?? 'normal',
      projectId: task.projectId ?? '',
    });
    setTaskModalOpen(true);
  };

  const saveTaskDraft = (event: FormEvent) => {
    event.preventDefault();
    const title = cleanTitle(taskDraft.title);
    if (!title) return;
    const dueAt = taskDraft.date
      ? new Date(`${taskDraft.date}T${taskDraft.time || '09:00'}:00`).getTime()
      : undefined;
    if (editingTask) {
      setTasks((current) => current.map((task) => task.id === editingTask.id
        ? { ...task, title, dueAt, dueHasTime: Boolean(dueAt && taskDraft.time), priority: taskDraft.priority, projectId: taskDraft.projectId || undefined }
        : task));
      showToast('Tarefa atualizada.');
      setMochiState('finished');
      window.setTimeout(() => setMochiState('idle'), 850);
    } else {
      addTask(title, { dueAt, dueHasTime: Boolean(dueAt && taskDraft.time), priority: taskDraft.priority, projectId: taskDraft.projectId || undefined });
      showToast('Tarefa guardada.');
    }
    setTaskModalOpen(false);
    setEditingTask(null);
  };

  const removeInboxItem = async (item: InboxItem) => {
    setInboxItems((current) => current.filter((entry) => entry.id !== item.id));
    if (item.attachment) {
      try {
          await irisCore.getCapability('attachments').remove(item.attachment.id);
      } catch (error) {
        console.error('Não foi possível remover o anexo local.', error);
      }
    }
    showToast('Item removido da inbox.');
  };

  const turnInboxItemIntoTask = (item: InboxItem) => {
    if (!addTask(item.text, { priority: 'normal' })) return;
    setInboxItems((current) => current.filter((entry) => entry.id !== item.id));
    showToast('Item convertido numa tarefa.');
  };

  const addProject = (event: FormEvent) => {
    event.preventDefault();
    const name = projectName.trim();
    if (!name) return;
    const project: Project = { id: crypto.randomUUID(), name, createdAt: Date.now() };
    setProjects((current) => [...current, project]);
    setSelectedProject(project.id);
    setProjectName('');
    showToast(`Projeto “${name}” criado.`);
  };

  const focusStart = () => {
    const duration = focusRemaining > 0 ? focusRemaining : FOCUS_DURATION;
    setFocusRemaining(duration);
    setFocusEndAt(Date.now() + duration * 1000);
    setMochiState('working');
    Sound.play('work');
  };

  const focusPause = () => {
    if (!focusEndAt) return;
    const remaining = Math.max(0, Math.ceil((focusEndAt - Date.now()) / 1000));
    setFocusRemaining(remaining);
    setFocusEndAt(null);
    setMochiState('idle');
    showToast('Sessão de foco em pausa.');
  };

  const focusReset = () => {
    setFocusEndAt(null);
    setFocusRemaining(FOCUS_DURATION);
    setMochiState('idle');
    showToast('Temporizador reposto para 45 minutos.');
  };

  const appendMessage = (role: ChatMessage['role'], text: string, source: ChatMessage['source'] = 'local') => {
    setMessages((current) => [...current, { id: crypto.randomUUID(), role, text, time: Date.now(), source }]);
  };

  const localReply = (input: string) => {
    const normalized = input.trim().toLocaleLowerCase('pt-PT');
    if (/^(ol[áa]|oi|bom dia|boa tarde|boa noite)(?:\s+iris)?[.!?]*$/.test(normalized)) {
      return 'Olá! Estou aqui contigo.';
    }

    if (/\b(ajuda|comandos|o que sabes fazer)\b/.test(normalized)) {
      return 'Podes conversar comigo por texto ou voz, e ajustar a conversa e as preferências nas definições.';
    }
    return null;
  };

  const requestAIReply = async (value: string) => {
    const history = messages
      .filter((message) => message.source === 'ai')
      .slice(-8)
      .map((message) => ({
        role: message.role,
        content: message.text.slice(-2000),
      }));
    const response = await irisChat({ message: value, history });
    return response.text;
  };

  const sendChatText = async (rawValue: string) => {
    const value = rawValue.trim();
    if (!value) return;
    if (chatRequestInFlightRef.current) return;
    if (value.length > 4000) {
      showToast('A mensagem deve ter até 4000 caracteres.');
      return;
    }

    const duvionRequest = explicitlyTargetsDuvion(value);
    if (!duvionRequest && requestsRemovedFeature(value)) {
      appendMessage('user', value, 'local');
      appendMessage('assistant', REMOVED_FEATURE_MESSAGE, 'local');
      return;
    }

    const local = duvionRequest ? null : localReply(value);
    if (local !== null) {
      appendMessage('user', value, 'local');
      appendMessage('assistant', local, 'local');
      return;
    }

    appendMessage('user', value, aiConversationEnabled ? 'ai' : 'local');
    if (!aiConversationEnabled) {
      appendMessage('assistant', 'A conversa com IA está desligada. Podes ativá-la nas definições.', 'local');
      setMochiState('idle');
      return;
    }

    chatRequestInFlightRef.current = true;
    setMochiState('thinking');
    try {
      const reply = await requestAIReply(value);
      appendMessage('assistant', reply, 'ai');
    } catch (error) {
      const message = serverErrorMessage(error)
        ?? 'Não consegui responder agora. Tenta novamente daqui a pouco; os teus dados locais continuam disponíveis.';
      appendMessage('assistant', message, 'local');
      showToast(serverErrorMessage(error) ?? 'Não foi possível contactar a IA.');
    } finally {
      chatRequestInFlightRef.current = false;
      setMochiState('idle');
    }
  };

  voiceTurnHandlerRef.current = async (rawValue: string) => {
    const value = rawValue.trim();
    if (!value) return '';
    const normalized = value.toLocaleLowerCase('pt-PT').replace(/[.!?,;:]+$/, '');
    if (/^(pára|para|parar)(?:\s+(?:de ouvir|a ouvir|o microfone|a voz|comando de voz))?$|^(desliga|desligar|desativa|desativar)\s+(?:o\s+)?(?:microfone|comando de voz)$/.test(normalized)) {
      appendMessage('user', value, 'local');
      appendMessage('assistant', 'Tudo bem, parei de ouvir.', 'local');
      setWakeWordAutoStart(false);
      audioControllerRef.current?.stop('user');
      Sound.play('close');
      return '';
    }

    if (value.length > 4000) {
      appendMessage('user', value, 'local');
      appendMessage('assistant', 'A mensagem de voz era demasiado longa para enviar à IA. Não foi enviada.', 'local');
      return '';
    }

    const duvionRequest = explicitlyTargetsDuvion(value);
    if (!duvionRequest && requestsRemovedFeature(value)) {
      appendMessage('user', value, 'local');
      appendMessage('assistant', REMOVED_FEATURE_MESSAGE, 'local');
      return REMOVED_FEATURE_MESSAGE;
    }

    const local = duvionRequest ? null : localReply(value);
    if (local !== null) {
      appendMessage('user', value, 'local');
      appendMessage('assistant', local, 'local');
      Sound.play(VOICE_SOUND[voiceReplyKind(local)]);
      return safeLocalVoiceReply(local);
    }

    if (!aiConversationEnabled) {
      appendMessage('user', value, 'local');
      appendMessage('assistant', 'A conversa com IA está desligada. Podes ativá-la nas definições.', 'local');
      return '';
    }

    if (chatRequestInFlightRef.current) {
      appendMessage('user', value, 'local');
      appendMessage('assistant', 'Ainda estou a preparar a resposta anterior. Tenta novamente daqui a pouco.', 'local');
      return '';
    }

    chatRequestInFlightRef.current = true;
    appendMessage('user', value, 'ai');
    setMochiState('thinking');
    try {
      const reply = await requestAIReply(value);
      appendMessage('assistant', reply, 'ai');
      Sound.play(VOICE_SOUND.fallback);
      return reply;
    } catch (error) {
      const fallback = serverErrorMessage(error)
        ?? 'Não consegui responder agora. Podes tentar novamente daqui a pouco.';
      appendMessage('assistant', fallback, 'local');
      setVoiceNotice(fallback);
      return '';
    } finally {
      chatRequestInFlightRef.current = false;
      setMochiState('idle');
    }
  };

  const toggleVoice = () => {
    const liveKitVoice = liveKitVoiceRef.current;
    if (!liveKitVoice) return;
    if (liveKitVoice.isActive) {
      setWakeWordAutoStart(false);
      void liveKitVoice.stop();
      setVoiceActive(false);
      setVoiceState('idle');
      setVoiceNotice('A sessão de voz foi terminada e o microfone foi desligado.');
      setMochiState('idle');
      Sound.play('close');
      return;
    }

    const audioController = audioControllerRef.current;
    if (audioController?.isActive || audioController?.isWakeWordArmed) audioController.stop('user');
    setWakeWordAutoStart(false);
    setWakeWordArmed(false);
    setVoiceNotice('A ligar à sessão de voz LiveKit…');
    setVoiceState('listening');
    Sound.resume();
    void liveKitVoice.start((status) => {
      setVoiceActive(status !== 'idle');
      setVoiceState(status);
      if (status === 'listening') setVoiceNotice('À escuta. O áudio é enviado ao LiveKit para a conversa em tempo real.');
      if (status === 'idle') setMochiState('idle');
    }).then(() => {
      setVoiceNotice('Sessão LiveKit ativa. Podes falar ou interromper a resposta.');
      Sound.play('open');
    }).catch((error: unknown) => {
      setVoiceActive(false);
      setVoiceState('error');
      setVoiceNotice(error instanceof Error ? error.message : 'Não foi possível iniciar a voz LiveKit.');
      Sound.play('error');
    });
    void Sound.preload().catch((error: unknown) => console.error('Não foi possível preparar o som de ativação.', error));
  };

  const toggleWakeWord = () => {
    const audioController = audioControllerRef.current;
    if (!audioController) return;
    if (audioController.isWakeWordArmed) {
      setWakeWordAutoStart(false);
      audioController.stop('user');
      setMochiState('idle');
      Sound.play('close');
      return;
    }
    if (liveKitVoiceRef.current?.isActive) {
      void liveKitVoiceRef.current.stop();
      setVoiceActive(false);
      setVoiceState('idle');
    }
    setWakeWordAutoStart(true);
    Sound.resume();
    void audioController.armWakeWord((transcript) => voiceTurnHandlerRef.current(transcript)).catch((error: unknown) => {
      setWakeWordArmed(false);
      setVoiceActive(false);
      setVoiceNotice(error instanceof Error ? error.message : 'Não foi possível ativar a palavra de despertar.');
      Sound.play('error');
    });
    void Sound.preload().catch((error: unknown) => console.error('Não foi possível preparar o som de ativação.', error));
  };

  const sendChat = (event: FormEvent) => {
    event.preventDefault();
    if (!chatInput.trim()) return;
    sendChatText(chatInput);
    setChatInput('');
  };

  const submitCaptureModal = async (event: FormEvent) => {
    event.preventDefault();
    setSavingCapture(true);
    const saved = await addInboxFromForm(captureText, captureCategory, captureFile);
    setSavingCapture(false);
    if (saved) {
      setCaptureOpen(false);
      setCaptureText('');
      setCaptureCategory('auto');
      setCaptureFile(null);
    }
  };

  const submitInlineInbox = async (event: FormEvent) => {
    event.preventDefault();
    const saved = await addInboxFromForm(inboxText, inboxCategory, inboxFile);
    if (saved) {
      setInboxText('');
      setInboxCategory('auto');
      setInboxFile(null);
      const input = document.getElementById('iris-inbox-file') as HTMLInputElement | null;
      if (input) input.value = '';
    }
  };

  const runEmote = (emote: BotEmoteName) => {
    mochiEngineRef.current?.triggerEmote(emote);
    setActiveEmote(emote);
    setMochiState('finished');
    window.setTimeout(() => {
      setActiveEmote(null);
      setMochiState('idle');
    }, 1000);
  };

  const toggleSound = () => {
    const enabled = !soundOn;
    setSoundOn(enabled);
    if (enabled) void Sound.preload().then(() => Sound.play('greet'));
  };

  const navSection = (next: AppSection) => {
    if (!['home', 'chat', 'settings', 'help'].includes(next)) return;
    setSection(next);
  };

  const today = dateHeading();
  const greeting = timeOfDayGreeting();
  const displayedMochiState = botStateForVoice(voiceState, mochiState);
  const showVoiceStatus = voiceActive || voiceState === 'error';
  const startupVoiceStatus = wakeWordAutoStart && !wakeWordArmed && !voiceActive && voiceNotice
    ? voiceNotice.toLocaleLowerCase('pt-PT').includes('não está disponível')
      ? 'Voz indisponível'
      : voiceNotice.toLocaleLowerCase('pt-PT').includes('permite o acesso')
        ? 'Permite o microfone'
        : 'Toca para autorizar voz'
    : '';
  const taskMatches = useMemo(() => {
    const query = taskSearch.trim().toLocaleLowerCase('pt-PT');
    return tasks.filter((task) => {
      const matchesFilter = filter === 'all' || (filter === 'open' ? !task.done : task.done);
      const matchesProject = selectedProject === 'all' || task.projectId === selectedProject;
      const matchesSearch = !query || task.title.toLocaleLowerCase('pt-PT').includes(query);
      return matchesFilter && matchesProject && matchesSearch;
    }).sort((a, b) => Number(a.done) - Number(b.done) || (a.dueAt ?? Number.MAX_SAFE_INTEGER) - (b.dueAt ?? Number.MAX_SAFE_INTEGER) || b.createdAt - a.createdAt);
  }, [tasks, filter, selectedProject, taskSearch]);
  const visibleInbox = inboxItems.filter((item) => inboxFilter === 'all' || item.category === inboxFilter);
  const projectFor = (id?: string) => projects.find((project) => project.id === id)?.name;
  const appleShortcut = /Mac|iPhone|iPad/.test(navigator.platform);
  const captureShortcut = appleShortcut ? '⌘ ⇧ Espaço' : 'Ctrl Espaço';

  const taskRow = (task: Task, compact = false) => {
    const overdue = !task.done && Boolean(task.dueAt && task.dueAt < Date.now());
    return (
      <article className={`iris-task-row${task.done ? ' is-done' : ''}${overdue ? ' is-overdue' : ''}${compact ? ' is-compact' : ''}`} key={task.id}>
        <button className="iris-task-check" type="button" onClick={() => toggleTask(task.id)} aria-label={task.done ? `Reabrir ${task.title}` : `Concluir ${task.title}`}>
          {task.done && <Check />}
        </button>
        <button className="iris-task-copy" type="button" onClick={() => openTaskEditor(task)}>
          <span className="iris-task-title">{task.title}</span>
          <span className="iris-task-meta">
            {task.dueAt ? <span className={overdue ? 'is-overdue-text' : ''}>{overdue ? 'Atrasada · ' : ''}{dateLabel(task.dueAt)}{task.dueHasTime ? ` · ${shortTime(task.dueAt)}` : ''}</span> : <span>Sem prazo</span>}
            {task.priority && task.priority !== 'normal' && <span className={`iris-priority-tag ${task.priority}`}>{task.priority === 'high' ? 'Prioritária' : 'Baixa prioridade'}</span>}
            {projectFor(task.projectId) && <span className="iris-project-tag">{projectFor(task.projectId)}</span>}
          </span>
        </button>
        <div className="iris-task-actions">
          <button className="iris-quiet-icon" type="button" onClick={() => openTaskEditor(task)} aria-label={`Editar ${task.title}`}><MoreHorizontal /></button>
          <button className="iris-quiet-icon delete" type="button" onClick={() => deleteTask(task.id)} aria-label={`Remover ${task.title}`}><Trash2 /></button>
        </div>
      </article>
    );
  };

  const inboxCategoryLabel: Record<InboxCategory, string> = {
    note: 'Nota',
    idea: 'Ideia',
    reference: 'Referência',
    document: 'Documento',
  };

  if (desktopMode) {
    return (
      <div className="iris-root is-native-window">
        <IRISIsland
          desktopMode
          mochiState={displayedMochiState}
          voiceActive={voiceActive}
          voiceState={voiceState}
          voiceNotice={voiceNotice}
          wakeWordArmed={wakeWordArmed}
          onNavigate={navSection}
          onSendChat={sendChatText}
          onToggleVoice={toggleVoice}
          onToggleWakeWord={toggleWakeWord}
        />
        {toast && <div className="iris-toast" role="status">{toast}</div>}
      </div>
    );
  }

  return (
    <div className="iris-root">
      <IRISIsland
        desktopMode={false}
        mochiState={displayedMochiState}
        voiceActive={voiceActive}
        voiceState={voiceState}
        voiceNotice={voiceNotice}
        wakeWordArmed={wakeWordArmed}
        onNavigate={navSection}
        onSendChat={sendChatText}
        onToggleVoice={toggleVoice}
        onToggleWakeWord={toggleWakeWord}
      />

      <div className="iris-workspace">
        <aside className="iris-sidebar">
          <button className="iris-brand" type="button" onClick={() => navSection('home')} aria-label="IRIS — Hoje">
            <span className="iris-brand-mark"><MochiCanvas state="idle" size={58} className="iris-brand-character" /></span>
            <span><strong>IRIS</strong><small>o teu espaço</small></span>
          </button>

          {['O teu espaço', 'Rotina'].map((group) => (
            <div className="iris-nav-group" key={group}>
              <div className="iris-nav-label">{group}</div>
              <nav aria-label={group}>
                {NAV_ITEMS.filter((item) => item.group === group).map(({ id, label, icon: Icon }) => (
                  <button
                    className={`iris-nav-item${section === id ? ' active' : ''}`}
                    type="button"
                    key={id}
                    onClick={() => navSection(id)}
                    data-testid={`nav-${id}`}
                  >
                    <Icon />
                    <span>{label}</span>
                  </button>
                ))}
              </nav>
            </div>
          ))}

          <div className="iris-sidebar-bottom">
            <div className="iris-local-state"><span className="iris-local-dot" /><span>Guardado neste dispositivo</span></div>
            <button className={`iris-nav-item${section === 'settings' ? ' active' : ''}`} type="button" onClick={() => navSection('settings')}><Settings /><span>Definições</span></button>
            <button className={`iris-nav-item${section === 'help' ? ' active' : ''}`} type="button" onClick={() => navSection('help')}><CircleHelp /><span>Ajuda</span></button>
              <div className="iris-profile"><span className="iris-profile-mark">M</span><span><strong>Local</strong><small>Conversa e voz</small></span><ChevronDown /></div>
          </div>
        </aside>

        <main className="iris-main">
          <header className="iris-topbar">
            <div className="iris-breadcrumb"><span>IRIS</span><span>/</span><strong>{SECTION_LABELS[section]}</strong></div>
            <div className="iris-top-actions">
              <span className="iris-private-label"><span />{voiceActive ? 'Voz via LiveKit' : 'Dados locais · provider de IA'}</span>
              <button className="iris-quiet-icon help" type="button" aria-label="Ajuda" onClick={() => navSection('help')}><CircleHelp /></button>
            </div>
          </header>

          <div className="iris-content">
            <div className="iris-page-heading">
              <div>
                <div className="iris-eyebrow">{section === 'home' ? today : 'O TEU ESPAÇO · ' + SECTION_LABELS[section].toLocaleUpperCase('pt-PT')}</div>
                <h1>{section === 'home' ? greeting : SECTION_LABELS[section]}</h1>
                <p>{section === 'home'
                  ? 'Conversa com a IRIS por texto ou voz.'
                  : section === 'chat' ? 'Conversa por texto ou voz.'
                    : section === 'settings' ? 'Ajusta a conversa e as preferências ao teu ritmo.'
                      : 'Como conversar com a IRIS e usar a voz.'}</p>
              </div>
              <div className="iris-date-chip"><CalendarClock /><span>{today}</span></div>
            </div>

            {section === 'home' && (
              <div className="iris-home-layout">
                <aside className="iris-home-companion">
                  <div className="iris-mochi-status" title={startupVoiceStatus ? voiceNotice : undefined}><span className={`iris-status-dot${showVoiceStatus ? ` is-${voiceState}` : ''}`} />{showVoiceStatus ? VOICE_STATE_LABELS[voiceState] : startupVoiceStatus || 'Por perto'}</div>
                  <MochiCanvas state={displayedMochiState} size={190} engine={mochiEngineRef.current ?? undefined} />
                  <div className="iris-companion-copy">
                    <span className="iris-section-kicker">A IRIS</span>
                    <h2>{voiceActive ? 'Estou à escuta.' : 'Estou aqui contigo.'}</h2>
                    <p>Conversa comigo por texto ou voz. Os dados locais antigos foram mantidos neste dispositivo.</p>
                  </div>
                  <div className="iris-companion-actions">
                    <button type="button" onClick={() => navSection('chat')}><MessageCircle />Conversar</button>
                    <button type="button" onClick={toggleVoice}>{voiceActive ? <MicOff /> : <Mic />}{voiceActive ? 'Desativar voz' : 'Ativar voz'}</button>
                  </div>
                </aside>
              </div>
            )}

            {section === 'tasks' && (
              <section className="iris-page-section">
                <div className="iris-task-toolbar">
                  <div className="iris-filter-tabs" role="tablist" aria-label="Filtrar tarefas">
                    {(['open', 'all', 'done'] as TaskFilter[]).map((value) => (
                      <button className={filter === value ? 'active' : ''} type="button" role="tab" aria-selected={filter === value} key={value} onClick={() => setFilter(value)}>
                        {value === 'open' ? `Por tratar · ${openCount}` : value === 'all' ? `Todas · ${tasks.length}` : `Concluídas · ${doneCount}`}
                      </button>
                    ))}
                  </div>
                  <div className="iris-task-tools">
                    <label className="iris-search"><Search /><input value={taskSearch} onChange={(event) => setTaskSearch(event.target.value)} placeholder="Procurar" aria-label="Procurar tarefas" /></label>
                    <select value={selectedProject} onChange={(event) => setSelectedProject(event.target.value)} aria-label="Filtrar por projeto">
                      <option value="all">Todos os contextos</option>{projects.map((project) => <option value={project.id} key={project.id}>{project.name}</option>)}
                    </select>
                    <button className="iris-primary-button" type="button" onClick={openNewTask}><Plus />Nova tarefa</button>
                  </div>
                </div>
                <div className="iris-task-list page-list">
                  {taskMatches.length ? taskMatches.map((task) => taskRow(task)) : (
                    <div className="iris-empty-state">
                      <MochiCanvas state="idle" size={84} />
                      <h2>{filter === 'done' ? 'Ainda sem vitórias.' : 'Tudo tratado por agora.'}</h2>
                      <p>{filter === 'done' ? 'As tarefas concluídas vão aparecer aqui.' : 'Adiciona uma tarefa ou guarda algo na inbox.'}</p>
                      <button className="iris-text-button" type="button" onClick={openNewTask}><Plus />Criar tarefa</button>
                    </div>
                  )}
                </div>
              </section>
            )}

            {section === 'inbox' && (
              <section className="iris-page-section">
                <form className="iris-inbox-capture" onSubmit={submitInlineInbox}>
                  <div className="iris-capture-icon"><InboxIcon /></div>
                  <div className="iris-capture-fields">
                    <label htmlFor="iris-inbox-text">Deixa aqui o que não queres esquecer</label>
                    <textarea id="iris-inbox-text" value={inboxText} onChange={(event) => setInboxText(event.target.value)} placeholder="Uma ideia, uma ligação, uma nota…" rows={2} />
                    <div className="iris-capture-meta">
                      <select value={inboxCategory} onChange={(event) => setInboxCategory(event.target.value as CaptureChoice)} aria-label="Organizar captura">
                        <option value="auto">Organizar automaticamente</option><option value="note">Nota</option><option value="idea">Ideia</option><option value="reference">Referência</option><option value="document">Documento</option>
                      </select>
                      <label className="iris-file-pick" htmlFor="iris-inbox-file"><FileText />{inboxFile ? inboxFile.name : 'Anexar ficheiro'}</label>
                      <input id="iris-inbox-file" type="file" accept=".pdf,.doc,.docx,.txt,.md,application/pdf,text/plain" onChange={(event) => setInboxFile(event.target.files?.[0] ?? null)} />
                      <button className="iris-primary-button" type="submit"><Plus />Guardar</button>
                    </div>
                  </div>
                </form>
                <div className="iris-inbox-tools">
                  <div className="iris-filter-tabs" role="tablist" aria-label="Filtrar inbox">
                    {(['all', 'note', 'idea', 'reference', 'document'] as ('all' | InboxCategory)[]).map((value) => (
                      <button className={inboxFilter === value ? 'active' : ''} type="button" role="tab" aria-selected={inboxFilter === value} key={value} onClick={() => setInboxFilter(value)}>
                        {value === 'all' ? `Tudo · ${inboxItems.length}` : inboxCategoryLabel[value]}
                      </button>
                    ))}
                  </div>
                  <span className="iris-auto-note"><Sparkles />Classificação local, sem enviar conteúdo</span>
                </div>
                <div className="iris-inbox-list">
                  {visibleInbox.length ? visibleInbox.map((item) => (
                    <article className="iris-inbox-row" key={item.id}>
                      <span className={`iris-inbox-type ${item.category}`}>
                        {item.category === 'idea' ? <Lightbulb /> : item.category === 'reference' ? <ArrowUpRight /> : item.category === 'document' ? <FileText /> : <Archive />}
                      </span>
                      <div className="iris-inbox-copy">
                        <div className="iris-inbox-labels"><span>{inboxCategoryLabel[item.category]}</span><time>{dateLabel(item.createdAt)} · {shortTime(item.createdAt)}</time></div>
                        <p>{item.text}</p>
                        {item.attachment && <button className="iris-attachment-link" type="button" onClick={() => void irisCore.getCapability('attachments').open(item.attachment!.id).catch((error: unknown) => showToast(error instanceof Error ? error.message : 'Não foi possível abrir o anexo.'))}><FileText />{item.attachment.name} · {(item.attachment.size / 1024 / 1024).toFixed(1)} MB</button>}
                        {item.category === 'reference' && (() => {
                          const link = item.text.match(/https?:\/\/\S+/i)?.[0];
                          return link ? <a className="iris-reference-link" href={link} target="_blank" rel="noreferrer">Abrir ligação <ArrowUpRight /></a> : null;
                        })()}
                      </div>
                      <div className="iris-inbox-actions">
                        <button className="iris-text-button" type="button" onClick={() => turnInboxItemIntoTask(item)}><ListTodo />Criar tarefa</button>
                        <button className="iris-quiet-icon delete" type="button" onClick={() => void removeInboxItem(item)} aria-label="Remover item"><Trash2 /></button>
                      </div>
                    </article>
                  )) : (
                    <div className="iris-empty-state inbox-empty">
                      <MochiCanvas state="idle" size={90} />
                      <h2>A inbox está tranquila.</h2>
                      <p>Guarda uma nota, ideia, referência ou documento. A IRIS ajuda a organizar localmente.</p>
                    </div>
                  )}
                </div>
              </section>
            )}

            {section === 'projects' && (
              <section className="iris-projects-layout">
                <div className="iris-project-list">
                  <div className="iris-section-heading"><div><span className="iris-section-kicker">CONTEXTOS</span><h2>Os teus projetos</h2></div><span className="iris-count-subtle">{projects.length}</span></div>
                  <form className="iris-project-form" onSubmit={addProject}>
                    <input value={projectName} onChange={(event) => setProjectName(event.target.value)} placeholder="Nome do novo projeto" aria-label="Nome do novo projeto" />
                    <button type="submit" aria-label="Criar projeto"><Plus /></button>
                  </form>
                  {projects.length ? projects.map((project) => {
                    const count = openTasks.filter((task) => task.projectId === project.id).length;
                    return (
                      <button className={`iris-project-row${selectedProject === project.id ? ' active' : ''}`} key={project.id} type="button" onClick={() => setSelectedProject(project.id)}>
                        <span className="iris-project-mark"><FolderKanban /></span>
                        <span><strong>{project.name}</strong><small>{count} {count === 1 ? 'tarefa por tratar' : 'tarefas por tratar'}</small></span>
                        <ArrowUpRight />
                      </button>
                    );
                  }) : <div className="iris-empty-line"><FolderKanban /><span>Cria um contexto para agrupar tarefas.</span></div>}
                </div>
                <div className="iris-project-detail">
                  <div className="iris-section-heading"><div><span className="iris-section-kicker">TAREFAS DO CONTEXTO</span><h2>{projects.find((project) => project.id === selectedProject)?.name ?? 'Escolhe um projeto'}</h2></div></div>
                  {selectedProject !== 'all' ? (
                    <div className="iris-task-list">{tasks.filter((task) => task.projectId === selectedProject).map((task) => taskRow(task))}{!tasks.some((task) => task.projectId === selectedProject) && <div className="iris-empty-line"><span>Ainda não há tarefas neste contexto.</span></div>}</div>
                  ) : <div className="iris-empty-line"><span>Seleciona um projeto para ver as tarefas associadas.</span></div>}
                  {selectedProject !== 'all' && <button className="iris-text-button" type="button" onClick={openNewTask}><Plus />Adicionar tarefa ao projeto</button>}
                </div>
              </section>
            )}

            {section === 'focus' && (
              <section className="iris-focus-view">
                <div className="iris-focus-main">
                  <div className="iris-section-kicker">UM BLOCO DE CADA VEZ</div>
                  <div className={`iris-focus-clock${focusRunning ? ' running' : ''}`} aria-live="polite">{formatDuration(liveFocusRemaining)}</div>
                  <p>{focusRunning ? 'A IRIS fica aqui contigo. Mantém o ritmo que te faz bem.' : liveFocusRemaining < FOCUS_DURATION ? 'Retoma quando estiveres pronto.' : '45 minutos para uma coisa de cada vez.'}</p>
                  <div className="iris-focus-controls">
                    {focusRunning
                      ? <button className="iris-primary-button" type="button" onClick={focusPause}>Pausar</button>
                      : <button className="iris-primary-button" type="button" onClick={focusStart}>{liveFocusRemaining < FOCUS_DURATION ? 'Retomar foco' : 'Começar foco'}</button>}
                    <button className="iris-secondary-button" type="button" onClick={focusReset}>Repor 45 min</button>
                  </div>
                  <label className="iris-focus-task"><span>Uma tarefa para acompanhar (opcional)</span><select value={focusedTaskId} onChange={(event) => setFocusedTaskId(event.target.value)}><option value="">Sem tarefa escolhida</option>{openTasks.map((task) => <option value={task.id} key={task.id}>{task.title}</option>)}</select></label>
                  {focusedTaskId && tasks.find((task) => task.id === focusedTaskId) && <div className="iris-focus-selected">{tasks.find((task) => task.id === focusedTaskId)?.title}</div>}
                </div>
                <aside className="iris-focus-companion">
                  <div className="iris-mochi-status"><span className={`iris-status-dot${showVoiceStatus ? ` is-${voiceState}` : focusRunning ? ' is-focused' : ''}`} />{showVoiceStatus ? VOICE_STATE_LABELS[voiceState] : focusRunning ? 'Em foco contigo' : 'Pronta quando tu estiveres'}</div>
                  <MochiCanvas state={displayedMochiState === 'idle' ? focusRunning ? 'working' : 'idle' : displayedMochiState} size={190} engine={mochiEngineRef.current ?? undefined} />
                  <p>{focusRunning ? 'Respira. Faz só o próximo passo.' : 'Sem pressa. Quando começares, eu fico por aqui.'}</p>
                </aside>
              </section>
            )}

            {section === 'chat' && (
              <div className="iris-chat-layout">
                <section className="iris-chat-panel">
                  <div className="iris-chat-title">
                    <MochiCanvas state={displayedMochiState} size={48} />
                    <div>
                      <strong>Conversa com a IRIS</strong>
                      <span>{wakeWordArmed && voiceState === 'sleeping'
                        ? 'À espera de “Acorda IRIS” ou “Wake up Iris”'
                        : voiceActive
                          ? VOICE_STATE_LABELS[voiceState]
                          : aiConversationEnabled ? 'Provider de conversa configurado' : 'Conversa com IA desligada nas definições'}</span>
                    </div>
                    <button className={`iris-voice-button${voiceActive ? ` is-${voiceState}` : ''}`} type="button" aria-label={voiceActive ? 'Desativar voz' : 'Ativar voz'} aria-pressed={voiceActive} onClick={toggleVoice}>{voiceActive ? <Mic /> : <MicOff />}</button>
                    <button
                      className={`iris-voice-wake-button${wakeWordArmed ? ' is-armed' : ''}`}
                      type="button"
                      onClick={toggleWakeWord}
                      aria-pressed={wakeWordArmed}
                      aria-label={wakeWordArmed ? 'Desativar Acorda IRIS' : 'Ativar Acorda IRIS'}
                      title={wakeWordArmed ? 'À espera de “Acorda IRIS” ou “Wake up Iris”' : 'Ativar palavra de despertar'}
                    ><Radio /></button>
                  </div>
                  <div className="iris-messages" aria-live="polite">
                    {messages.map((message) => <div className={`iris-message ${message.role}`} key={message.id}><span className="iris-message-avatar">{message.role === 'assistant' ? <Sparkles /> : 'Tu'}</span><div><div className="iris-message-bubble">{message.text}</div><time>{shortTime(message.time)}</time></div></div>)}
                    <div ref={chatEndRef} />
                  </div>
                  <form className="iris-chat-compose" onSubmit={sendChat}>
                    <input value={chatInput} onChange={(event) => setChatInput(event.target.value)} placeholder="Escreve uma mensagem à IRIS…" aria-label="Mensagem para a IRIS" maxLength={4000} />
                    <button className="iris-quiet-icon" type="button" onClick={toggleVoice} aria-label={voiceActive ? 'Desativar voz' : 'Ativar voz'} aria-pressed={voiceActive}>{voiceActive ? <Mic /> : <MicOff />}</button>
                    <button className="iris-send-button" type="submit" aria-label="Enviar mensagem"><Send /></button>
                  </form>
                  {voiceNotice && <p className={`iris-voice-status is-${voiceState}`} role="status" aria-live="polite">{voiceNotice}</p>}
                </section>
                <aside className="iris-command-guide">
                  <span className="iris-section-kicker">CONVERSA</span>
                  <h2>Escreve com naturalidade</h2>
                  <p>As mensagens livres são processadas pelo Gemini através da integração de IA da Replit e cobradas nos créditos Replit. A IRIS ainda não está ligada ao Duvion e não pode consultar dados empresariais nem executar ações.</p>
                  <p>Também podes ativar a voz. O navegador ou WebView pode processar áudio segundo as suas regras; a IRIS não guarda gravações.</p>
                </aside>
              </div>
            )}

            {section === 'settings' && (
              <section className="iris-settings">
                <div className="iris-settings-group">
                  <div className="iris-section-heading"><div><span className="iris-section-kicker">PREFERÊNCIAS</span><h2>O teu espaço</h2></div></div>
                  <div className="iris-setting-row"><div><strong>Sons da IRIS</strong><p>Pequenos sons de interface e de voz.</p></div><button className={`iris-switch${soundOn ? ' on' : ''}`} type="button" onClick={toggleSound} role="switch" aria-checked={soundOn} aria-label={soundOn ? 'Silenciar sons' : 'Ativar sons'}><span /></button></div>
                  <div className="iris-setting-row"><div><strong>IA de conversa</strong><p>As mensagens livres são processadas pelo Gemini através da integração de IA da Replit e cobradas nos créditos Replit. A IRIS não está ligada ao Duvion. Só AI_PROVIDER=openai envia mensagens à OpenAI; os registos locais antigos não são enviados.</p></div><button className={`iris-switch${aiConversationEnabled ? ' on' : ''}`} type="button" onClick={() => setAIConversationEnabled((enabled) => !enabled)} role="switch" aria-checked={aiConversationEnabled} aria-label={aiConversationEnabled ? 'Desativar IA de conversa e voz' : 'Ativar IA de conversa e voz'}><span /></button></div>
                  <div className="iris-setting-row"><div><strong>Dados locais</strong><p>A conversa atual continua guardada neste dispositivo.</p></div><span className="iris-setting-status"><span />Ativo</span></div>
                  <div className="iris-setting-row"><div><strong>Despertar ao abrir</strong><p>A IRIS tenta ficar à espera de “Acorda IRIS” ou “Wake up Iris” ao abrir. O navegador pode exigir autorização ou um primeiro toque.</p></div><button className={`iris-switch${wakeWordAutoStart ? ' on' : ''}`} type="button" onClick={() => setWakeWordAutoStart((enabled) => !enabled)} role="switch" aria-checked={wakeWordAutoStart} aria-label={wakeWordAutoStart ? 'Desativar espera por voz ao abrir' : 'Ativar espera por voz ao abrir'}><span /></button></div>
                  <div className="iris-setting-row"><div><strong>Privacidade de voz</strong><p>A conversa LiveKit só começa após tocares no botão e autorizares o microfone; durante a sessão, o áudio é enviado aos serviços configurados de reconhecimento, modelo e síntese de voz. Se ativares a espera pela palavra de ativação, o navegador ou WebView pode processar áudio segundo as respetivas regras. A IRIS não guarda gravações. O protótipo LiveKit está limitado ao desenvolvimento e não consulta dados da Duvion.</p></div><span className="iris-setting-status">{wakeWordArmed ? 'À espera da palavra' : voiceActive ? 'Ativa' : wakeWordAutoStart ? 'A tentar ao abrir' : 'Desligada'}</span></div>
                </div>
                <div className="iris-settings-group">
                  <div className="iris-section-heading"><div><span className="iris-section-kicker">DADOS</span><h2>Gerir o que guardaste</h2></div></div>
                  <div className="iris-setting-row"><div><strong>Limpar conversa</strong><p>Apaga as mensagens guardadas neste dispositivo.</p></div><button className="iris-secondary-button" type="button" onClick={() => { if (window.confirm('Apagar a conversa guardada neste dispositivo?')) { setMessages([]); showToast('Conversa apagada.'); } }}>Limpar conversa</button></div>
                  <div className="iris-setting-row"><div><strong>Registos anteriores</strong><p>Os dados locais antigos de tarefas, inbox, projetos e foco foram mantidos neste dispositivo, mas estas funcionalidades já não estão disponíveis.</p></div><span className="iris-setting-status">Preservados</span></div>
                </div>
                <div className="iris-settings-group">
                  <div className="iris-section-heading"><div><span className="iris-section-kicker">A IRIS</span><h2>Um pouco de personalidade</h2></div></div>
                  <p className="iris-settings-intro">A mesma IRIS de sempre, com algumas reações para acompanhar o teu ritmo.</p>
                  <div className="iris-emote-actions">{([['happy', 'Alegre'], ['proud', 'Orgulhosa'], ['wink', 'Piscar']] as [BotEmoteName, string][]).map(([emote, label]) => <button className="iris-secondary-button" type="button" key={emote} onClick={() => runEmote(emote)}>{label}</button>)}</div>
                  {activeEmote && <span className="iris-settings-intro">A IRIS está {activeEmote === 'proud' ? 'orgulhosa' : activeEmote === 'wink' ? 'a piscar' : 'alegre'}.</span>}
                </div>
              </section>
            )}

            {section === 'help' && (
              <section className="iris-help-page">
                <div className="iris-section-heading"><div><span className="iris-section-kicker">COMEÇAR</span><h2>Conversa com a IRIS</h2></div></div>
                <p className="iris-help-lead">A IRIS mantém conversa por texto e voz usando Gemini através da integração da Replit, cobrada nos créditos Replit. A IRIS não está ligada ao Duvion e não pode consultar dados empresariais nem executar ações. Os registos locais anteriores de tarefas, inbox, projetos e foco foram preservados, mas já não podem ser consultados nesta versão.</p>
                <div className="iris-help-list">
                  <div><MessageCircle /><span><strong>Conversa por texto</strong><small>Escreve à IRIS na secção Conversar. Gemini é o provider padrão através da Replit; a OpenAI só é usada se AI_PROVIDER=openai estiver configurado.</small></span></div>
                  <div><Mic /><span><strong>Conversa por voz</strong><small>O reconhecimento depende do navegador ou WebView e da autorização do microfone. Podes desligar a espera automática nas definições.</small></span></div>
                  <div><Settings /><span><strong>Privacidade e preferências</strong><small>Ativa ou desativa a conversa com IA, a voz e os sons nas definições. A IRIS não guarda gravações.</small></span></div>
                </div>
              </section>
            )}
          </div>
        </main>
      </div>

      {toast && <div className="iris-toast" role="status" data-testid="status-toast">{toast}</div>}
      <nav className="iris-mobile-nav" aria-label="Navegação móvel">
        {MOBILE_NAV_ITEMS.map(({ id, label, icon: Icon }) => <button className={section === id ? 'active' : ''} type="button" key={id} onClick={() => navSection(id)} aria-label={label}><Icon /><span>{label}</span></button>)}
      </nav>
    </div>
  );
}

export default App;