import type { Layer } from '../types'

export const LAYER_META: Record<Layer, { label: string; hint: string }> = {
  input: { label: 'Input', hint: 'Human message' },
  deterministic: { label: 'Deterministic', hint: 'Code · data · rules · actions' },
  jev: { label: 'Jev', hint: 'Bounded semantic judgment' },
  llm: { label: 'LLM', hint: 'Generative prose only' },
  action: { label: 'Action', hint: 'Deterministic execution' },
  output: { label: 'Output', hint: 'Final answer' },
}

export const LAYER_ORDER: Layer[] = ['input', 'deterministic', 'jev', 'llm', 'action', 'output']

// Maps a layer to its swatch/chip class (defined in index.css).
export const LAYER_CLASS: Record<Layer, string> = {
  input: 'layer-in',
  deterministic: 'layer-det',
  jev: 'layer-je',
  llm: 'layer-ll',
  action: 'layer-ac',
  output: 'layer-ou',
}

// Maps a layer to its connector/dot color (CSS var, so it tracks the theme).
export const LAYER_COLOR: Record<Layer, string> = {
  input: 'var(--dr-sys)',
  deterministic: 'var(--dr-det)',
  jev: 'var(--dr-jev)',
  llm: 'var(--dr-llm)',
  action: 'var(--dr-action)',
  output: 'var(--dr-ink)',
}