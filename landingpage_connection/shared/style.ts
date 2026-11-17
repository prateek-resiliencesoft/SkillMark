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
  { kind: 'css', key: 'customCss', label: 'Custom CSS', help: 'Applies to this element only. Nest selectors with &, e.g. "& h2 { color: red }".', optional: true },
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
 * Wrap admin CSS so it only reaches one element.
 * Strips angle brackets (can't close a <style> tag) and rejects brace-unbalanced
 * input so a `}` can't terminate the wrapper and inject global rules.
 */
export function scopeCss(selector: string, css: string | undefined): string {
  const body = (css ?? '').replace(/</g, '').trim()
  if (!body) return ''
  let depth = 0
  for (const ch of body) {
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth < 0) return '' // would escape the wrapper
    }
  }
  if (depth !== 0) return '' // unclosed blocks — refuse rather than guess
  return `${selector}{${body}}`
}
