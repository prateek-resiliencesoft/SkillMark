/**
 * Field descriptors: one list per preset, block or settings group drives both
 * the zod validation schema and the admin form, so the two never drift.
 *
 * This folder is copied into SkillMark-LandingPage/src/cms/shared. Keep it free
 * of path aliases, enums and runtime-only Node or React imports.
 */
import { z } from 'zod'

export type SelectOption = { value: string; label: string }

type Base = { key: string; label: string; help?: string; optional?: boolean }

export type Field =
  | (Base & { kind: 'text' | 'textarea' | 'url' | 'image' | 'icon' | 'color' | 'html' | 'css' })
  | (Base & { kind: 'number'; min?: number; max?: number })
  | (Base & { kind: 'boolean' })
  | (Base & { kind: 'select'; options: SelectOption[] })
  | (Base & { kind: 'stringList'; itemLabel?: string; max?: number })
  | (Base & { kind: 'list'; itemLabel: string; titleKey?: string; fields: Field[]; max?: number })
  | (Base & { kind: 'group'; fields: Field[] })

const UNSAFE_SCHEME = /^\s*(javascript|vbscript|data(?!:image\/(png|jpe?g|webp|gif|avif);base64,)):/i

/** Allows relative paths, anchors, http(s), mailto, tel and `{appUrl}` style tokens. */
export function isSafeHref(value: string): boolean {
  return !UNSAFE_SCHEME.test(value)
}

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i

export const hexColor = z.string().regex(HEX, 'Use a hex color like #5944f6')

const safeUrl = z.string().max(2000).refine(isSafeHref, 'This link type is not allowed')

function fieldSchema(field: Field): z.ZodType {
  let s: z.ZodType
  switch (field.kind) {
    case 'text':
    case 'icon':
      s = z.string().max(500)
      break
    case 'textarea':
      s = z.string().max(5000)
      break
    case 'html':
    case 'css':
      s = z.string().max(50_000)
      break
    case 'url':
    case 'image':
      s = safeUrl
      break
    case 'color':
      s = z.union([hexColor, z.literal('')])
      break
    case 'number': {
      let n = z.number()
      if (field.min !== undefined) n = n.min(field.min)
      if (field.max !== undefined) n = n.max(field.max)
      s = n
      break
    }
    case 'boolean':
      s = z.boolean()
      break
    case 'select': {
      const values = field.options.map((o) => o.value)
      s = z.string().refine((v) => values.includes(v), `Pick one of: ${values.join(', ')}`)
      break
    }
    case 'stringList':
      s = z.array(z.string().max(1000)).max(field.max ?? 50)
      break
    case 'list':
      s = z.array(fieldsToZod(field.fields)).max(field.max ?? 50)
      break
    case 'group':
      s = fieldsToZod(field.fields)
      break
  }
  return field.optional ? s.optional() : s
}

export function fieldsToZod(fields: Field[]) {
  const shape: Record<string, z.ZodType> = {}
  for (const f of fields) shape[f.key] = fieldSchema(f)
  return z.object(shape)
}

/** An empty value of the right type, used when adding a list item in the admin. */
export function emptyValue(field: Field): unknown {
  switch (field.kind) {
    case 'number':
      return field.min ?? 0
    case 'boolean':
      return false
    case 'select':
      return field.options[0]?.value ?? ''
    case 'stringList':
    case 'list':
      return []
    case 'group':
      return emptyItem(field.fields)
    default:
      return ''
  }
}

export function emptyItem(fields: Field[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const f of fields) if (!f.optional) out[f.key] = emptyValue(f)
  return out
}

/** Icon names the landing site maps to lucide icons (src/cms/icons.ts). */
export const ICON_NAMES = [
  'Mic', 'ShieldCheck', 'FileText', 'Clock', 'Link2', 'BarChart3', 'LayoutDashboard', 'UserRound',
  'Library', 'ListChecks', 'WandSparkles', 'PenLine', 'Eye', 'MonitorX', 'Ban', 'Layers', 'Gauge',
  'FileDown', 'Sparkles', 'Check', 'Star', 'Zap', 'Globe', 'Lock', 'Users', 'Code', 'MessageSquare',
  'Video', 'Rocket', 'Heart', 'Award', 'Target', 'Mail', 'Phone', 'MapPin', 'Calendar', 'Brain',
] as const

export type IconName = (typeof ICON_NAMES)[number]
