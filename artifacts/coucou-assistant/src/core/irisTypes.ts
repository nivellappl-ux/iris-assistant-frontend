export type TaskPriority = 'low' | 'normal' | 'high';
export type InboxCategory = 'note' | 'idea' | 'reference' | 'document';
export type AppSection = 'home' | 'inbox' | 'tasks' | 'projects' | 'focus' | 'chat' | 'settings' | 'help';
export type TaskFilter = 'all' | 'open' | 'done';

export interface Task {
  id: string;
  title: string;
  done: boolean;
  createdAt: number;
  dueAt?: number;
  dueHasTime?: boolean;
  priority?: TaskPriority;
  projectId?: string;
}

export interface Project {
  id: string;
  name: string;
  createdAt: number;
}

export interface AttachmentInfo {
  id: string;
  name: string;
  type: string;
  size: number;
}

export interface InboxItem {
  id: string;
  text: string;
  category: InboxCategory;
  createdAt: number;
  attachment?: AttachmentInfo;
}

export interface ChatMessage {
  id: string;
  role: 'assistant' | 'user';
  text: string;
  time: number;
  source?: 'local' | 'ai';
}