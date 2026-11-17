import type { Field } from './fields'
import { fieldsToZod } from './fields'

const opt = (values: string[]) => values.map((v) => ({ value: v, label: v[0].toUpperCase() + v.slice(1).replace(/-/g, ' ') }))

export const SPACING = ['none', 'sm', 'md', 'lg', 'xl'] as const

/** Style controls shared by sections and blocks. Every key is optional; unset means "component default". */
export const STYLE_FIELDS: Field[] = [
  { kind: 'select', key: 'paddingTop', label: 'Space above', options: opt([...SPACING]), optional: true },
  { kind: 'select', key: 'paddingBottom', label: 'Space below', options: opt([...SPACING]), optional: true },
  { kind: 'select', key: 'width', label: 'Content width', options: opt(['narrow', 'default', 'wide', 'full']), optional: true },
  { kind: 'select', key: 'align', label: 'Text alignment', options: opt(['left', 'center', 'right']), optional: true },
  { kind: 'select', key: 'background', label: 'Background', options: opt(['none', 'card', 'muted', 'primary', 'gradient']), optional: true },
  { kind: 'color', key: 'bgColor', label: 'Custom background (light)', optional: true },
  { kind: 'color', key: 'bgColorDark', label: 'Custom background (dark)', optional: true },
  { kind: 'color', key: 'textColor', label: 'Text color (light)', optional: true },
  { kind: 'color', key: 'textColorDark', label: 'Text color (dark)', optional: true },
  { kind: 'select', key: 'rounded', label: 'Corners', options: opt(['none', 'md', 'xl', '3xl']), optional: true },
  { kind: 'boolean', key: 'border', label: 'Border', optional: true },
  { kind: 'select', key: 'animation', label: 'Entrance animation', options: opt(['none', 'fade', 'slide-up', 'zoom']), optional: true },
  { kind: 'boolean', key: 'hideOnMobile', label: 'Hide on mobile', optional: true },
  { kind: 'boolean', key: 'hideOnDesktop', label: 'Hide on desktop', optional: true },
  { kind: 'text', key: 'anchorId', label: 'Anchor id', help: 'Lets links like /#pricing jump here. Letters, numbers and dashes.', optional: true },
  {
    kind: 'css',
    key: 'customCss',
    label: 'Custom CSS declarations',
    help: 'Flat declarations only (no { } blocks, @rules, or url()). Example: color: red; padding: 1rem;',
    optional: true,
  },
]

export const styleSchema = fieldsToZod(STYLE_FIELDS)
  .refine((s) => !s.anchorId || /^[a-z][a-z0-9-]*$/i.test(String(s.anchorId)), { message: 'Anchor id: letters, numbers and dashes, starting with a letter', path: ['anchorId'] })

export type Style = {
  paddingTop?: (typeof SPACING)[number]
  paddingBottom?: (typeof SPACING)[number]
  width?: 'narrow' | 'default' | 'wide' | 'full'
  align?: 'left' | 'center' | 'right'
  background?: 'none' | 'card' | 'muted' | 'primary' | 'gradient'
  bgColor?: string
  bgColorDark?: string
  textColor?: string
  textColorDark?: string
  rounded?: 'none' | 'md' | 'xl' | '3xl'
  border?: boolean
  animation?: 'none' | 'fade' | 'slide-up' | 'zoom'
  hideOnMobile?: boolean
  hideOnDesktop?: boolean
  anchorId?: string
  customCss?: string
}

/**
 * Only allow a flat CSS declaration list (no braces / at-rules / urls).
 * Wrapping that in `selector{…}` cannot escape the scope — there are no `}`
 * in the input for the browser to close the wrapper early.
 */
export function isFlatDeclarationList(css: string): boolean {
  const raw = css.trim()
  if (!raw) return true
  if (/[{}]/.test(raw)) return false
  if (/@[\w-]+/.test(raw)) return false
  if (/url\s*\(/i.test(raw)) return false
  if (/expression\s*\(/i.test(raw)) return false
  if (/<\/|\bjavascript:/i.test(raw)) return false
  // Property-ish tokens only: names, values, units, commas, quotes, hashes.
  // Includes * for calc() multiplication and = for modern comparison funcs.
  return /^[\s\w\-.:#%(),;'"\/\\!+*=]+$/i.test(raw)
}

/** @deprecated Prefer isFlatDeclarationList — kept for tests that strip noise. */
export function stripCssNoise(css: string): string {
  // No longer used by scopeCss; retained so older imports keep compiling.
  return css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(["'])(?:\\.|(?!\1).)*\1/g, '""')
}

/**
 * Wrap admin CSS so it only reaches one element.
 * Free-form CSS with blocks is rejected; only flat declarations are applied.
 */
export function scopeCss(selector: string, css: string | undefined): string {
  const raw = (css ?? '').replace(/</g, '').trim()
  if (!raw) return ''
  if (!isFlatDeclarationList(raw)) return ''
  return `${selector}{${raw}}`
}
