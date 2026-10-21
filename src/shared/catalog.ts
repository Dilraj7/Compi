// Catalogue des modèles locaux conseillés par Compi.
//
// Règle « talent prouvé » : seulement des modèles stables et reconnus, qui
// savent utiliser des outils (tag `tools` sur ollama.com), jamais de préversion.
// Tailles et capacités relevées sur ollama.com/library le 12/10/2026. Les notes
// (1 à 5) s'appuient sur les fiches officielles et les évaluations publiques
// (Artificial Analysis, BFCL pour l'appel d'outils, τ²-bench) et sur l'usage réel.
// À revoir à chaque version de Compi : les familles évoluent tous les mois.

import type { CatalogModel } from './types'

export const CATALOG: CatalogModel[] = [
  {
    id: 'qwen3.5:9b',
    label: 'Qwen 3.5 9B',
    maker: 'Alibaba',
    sizeGb: 6.6,
    needGb: 9,
    vision: true,
    thinking: true,
    scores: { write: 4, docs: 4, reason: 4, code: 4, fr: 4, multi: 5, tools: 5, speed: 4 },
    why: 'La référence des modèles compacts : le plus doué de sa taille pour utiliser des outils (classement BFCL) et il voit les images.'
  },
  {
    id: 'gemma4:12b',
    label: 'Gemma 4 12B',
    maker: 'Google',
    sizeGb: 7.7,
    needGb: 10.5,
    vision: true,
    thinking: true,
    scores: { write: 5, docs: 4, reason: 4, code: 3, fr: 5, multi: 5, tools: 4, speed: 4 },
    why: 'Très belle écriture dans de nombreuses langues, voit les images et tient bien les tâches en plusieurs étapes.'
  },
  {
    id: 'ministral-3:14b',
    label: 'Ministral 3 14B',
    maker: 'Mistral AI',
    sizeGb: 9.1,
    needGb: 12,
    vision: true,
    thinking: false,
    scores: { write: 5, docs: 4, reason: 4, code: 4, fr: 5, multi: 4, tools: 4, speed: 3 },
    why: 'Le modèle de Mistral AI, entreprise française : le plus naturel en français, et il voit les images.'
  },
  {
    id: 'ministral-3:8b',
    label: 'Ministral 3 8B',
    maker: 'Mistral AI',
    sizeGb: 6,
    needGb: 8.5,
    vision: true,
    thinking: false,
    scores: { write: 4, docs: 3, reason: 3, code: 3, fr: 5, multi: 4, tools: 4, speed: 4 },
    why: 'Très bon français dans un format compact, et il voit les images.'
  },
  {
    id: 'qwen3.5:4b',
    label: 'Qwen 3.5 4B',
    maker: 'Alibaba',
    sizeGb: 3.4,
    needGb: 5,
    vision: true,
    thinking: true,
    scores: { write: 3, docs: 3, reason: 3, code: 3, fr: 3, multi: 4, tools: 4, speed: 5 },
    why: 'Petit mais étonnamment capable, il sait utiliser les outils : idéal sans carte graphique.'
  },
  {
    id: 'ministral-3:3b',
    label: 'Ministral 3 3B',
    maker: 'Mistral AI',
    sizeGb: 3,
    needGb: 4.5,
    vision: true,
    thinking: false,
    scores: { write: 3, docs: 2, reason: 2, code: 2, fr: 4, multi: 3, tools: 3, speed: 5 },
    why: 'Le plus léger, pour les PC modestes, avec un bon français.'
  },
  {
    id: 'qwen3:14b',
    label: 'Qwen 3 14B',
    maker: 'Alibaba',
    sizeGb: 9.3,
    needGb: 12,
    vision: false,
    thinking: true,
    scores: { write: 4, docs: 4, reason: 4, code: 4, fr: 4, multi: 4, tools: 4, speed: 3 },
    why: 'Éprouvé et fiable depuis un an, mais texte uniquement.'
  },
  {
    id: 'gpt-oss:20b',
    label: 'gpt-oss 20B',
    maker: 'OpenAI',
    sizeGb: 14,
    needGb: 16,
    vision: false,
    thinking: true,
    scores: { write: 4, docs: 4, reason: 5, code: 4, fr: 3, multi: 3, tools: 3, speed: 4 },
    why: 'Excellent en raisonnement, mais texte uniquement et un peu juste sur 16 Go.'
  },
  {
    id: 'gemma4:26b',
    label: 'Gemma 4 26B',
    maker: 'Google',
    sizeGb: 17,
    needGb: 20,
    vision: true,
    thinking: true,
    scores: { write: 5, docs: 5, reason: 5, code: 4, fr: 5, multi: 5, tools: 4, speed: 4 },
    why: 'Le haut de gamme de Google en local, rapide pour sa taille.'
  },
  {
    id: 'qwen3.6:35b',
    label: 'Qwen 3.6 35B',
    maker: 'Alibaba',
    sizeGb: 23,
    needGb: 26,
    vision: true,
    thinking: true,
    scores: { write: 5, docs: 5, reason: 5, code: 5, fr: 4, multi: 5, tools: 5, speed: 4 },
    why: 'Parmi les plus forts en local, rapide grâce à son architecture, mais très gourmand en mémoire.'
  },
  {
    id: 'qwen3.6:27b',
    label: 'Qwen 3.6 27B',
    maker: 'Alibaba',
    sizeGb: 18,
    needGb: 22,
    vision: true,
    thinking: true,
    scores: { write: 5, docs: 5, reason: 5, code: 5, fr: 4, multi: 5, tools: 5, speed: 2 },
    why: 'Le plus fort en local pour les tâches complexes et le code, mais lent.'
  }
]
