// Catalogue unique des « pastilles » : chaque module de Compi déclare ici son
// identité visuelle. L'îlot, le panneau et les notifications lisent ce registre
// plutôt que de coder les couleurs en dur.

import type { Mood } from './types'

export type PillCategory = 'assistant' | 'agent' | 'system' | 'media'

export interface PillDef {
  id: PillId
  label: string
  category: PillCategory
  /** Couleur d'accent (LED, halo, badges). */
  color: string
  /** Nom d'icône lucide-react. */
  icon: string
  /** Humeur de la mascotte quand cette pastille est au premier plan. */
  mood: Mood
}

export type PillId =
  | 'chat'
  | 'thinking'
  | 'approval'
  | 'question'
  | 'claude-session'
  | 'claude-done'
  | 'reminder'
  | 'today'
  | 'meeting'
  | 'timer'
  | 'music'
  | 'speaking'
  | 'memory'
  | 'routine'
  | 'message'
  | 'file'
  | 'error'

export const PILLS: Record<PillId, PillDef> = {
  chat: { id: 'chat', label: 'Discussion', category: 'assistant', color: '#38E1FF', icon: 'MessageCircle', mood: 'listening' },
  thinking: { id: 'thinking', label: 'Réflexion', category: 'assistant', color: '#A78BFA', icon: 'Sparkles', mood: 'thinking' },
  approval: { id: 'approval', label: 'Validation', category: 'system', color: '#FBBF24', icon: 'ShieldQuestion', mood: 'waiting' },
  question: { id: 'question', label: 'Question', category: 'agent', color: '#FBBF24', icon: 'MessageCircleQuestion', mood: 'waiting' },
  'claude-session': { id: 'claude-session', label: 'Claude Code', category: 'agent', color: '#F59E7B', icon: 'TerminalSquare', mood: 'thinking' },
  'claude-done': { id: 'claude-done', label: 'Terminé', category: 'agent', color: '#4ADE80', icon: 'CheckCircle2', mood: 'happy' },
  reminder: { id: 'reminder', label: 'Rappel', category: 'system', color: '#60A5FA', icon: 'BellRing', mood: 'surprised' },
  today: { id: 'today', label: 'Ta journée', category: 'system', color: '#FDBA74', icon: 'Sun', mood: 'happy' },
  meeting: { id: 'meeting', label: 'Réunion', category: 'system', color: '#34D399', icon: 'Video', mood: 'surprised' },
  timer: { id: 'timer', label: 'Minuteur', category: 'system', color: '#F472B6', icon: 'Timer', mood: 'surprised' },
  music: { id: 'music', label: 'Musique', category: 'media', color: '#4ADE80', icon: 'Music2', mood: 'happy' },
  speaking: { id: 'speaking', label: 'Je parle', category: 'assistant', color: '#38E1FF', icon: 'AudioLines', mood: 'listening' },
  memory: { id: 'memory', label: 'Mémoire', category: 'assistant', color: '#C084FC', icon: 'Brain', mood: 'wink' },
  routine: { id: 'routine', label: 'Routine', category: 'system', color: '#2DD4BF', icon: 'Repeat', mood: 'happy' },
  message: { id: 'message', label: 'Messages', category: 'system', color: '#E879F9', icon: 'MessageSquareText', mood: 'surprised' },
  file: { id: 'file', label: 'Fichier', category: 'assistant', color: '#2DD4BF', icon: 'FileText', mood: 'surprised' },
  error: { id: 'error', label: 'Erreur', category: 'system', color: '#F87171', icon: 'TriangleAlert', mood: 'error' }
}

/** Couleur des LED selon l'humeur. */
export const MOOD_COLORS: Record<Mood, string> = {
  idle: '#38E1FF',
  listening: '#38E1FF',
  thinking: '#A78BFA',
  waiting: '#FBBF24',
  happy: '#4ADE80',
  error: '#F87171',
  sleeping: '#1E7F93',
  surprised: '#38E1FF',
  wink: '#38E1FF'
}
