/**
 * Validate section/block props against the field descriptors for their type.
 * Presets and known blocks use their field schemas; custom sections allow any
 * known block types; unknown preset types must have empty/object props only.
 */
import { fieldsToZod } from './fields'
import { BLOCK_MAP } from './blocks'
import { CUSTOM_SECTION, PRESET_MAP } from './presets'
import type { Block, Section, SiteDocument } from './schema'

export type ValidateOpts = { strict: boolean }

function issue(path: string, message: string): Error {
  return new Error(`${path}: ${message}`)
}

function validateProps(
  path: string,
  _type: string,
  props: Record<string, unknown>,
  fields: ReturnType<typeof fieldsToZod> | null,
  opts: ValidateOpts,
): Record<string, unknown> {
  if (!fields) {
    // Unknown type / empty field list: allow any JSON object, reject non-objects.
    if (props == null || typeof props !== 'object' || Array.isArray(props)) {
      if (opts.strict) throw issue(path, 'Props must be an object')
      return {}
    }
    return props
  }
  const result = fields.safeParse(props)
  if (result.success) return result.data as Record<string, unknown>
  if (opts.strict) {
    const first = result.error.issues[0]
    throw issue(`${path}.${first?.path?.join('.') || 'props'}`, first?.message ?? 'Invalid props')
  }
  // Soft: keep only keys that pass individually is too hard; fall back to {}.
  return {}
}

function validateBlock(block: Block, path: string, opts: ValidateOpts): Block {
  const def = BLOCK_MAP[block.type]
  const fields = def && def.fields.length > 0 ? fieldsToZod(def.fields) : null
  const props = validateProps(`${path}.props`, block.type, block.props, fields, opts)
  const children = (block.children ?? []).map((c, i) => validateBlock(c, `${path}.children[${i}]`, opts))
  return { ...block, props, children }
}

function validateSection(section: Section, path: string, opts: ValidateOpts): Section {
  if (section.type === CUSTOM_SECTION) {
    const blocks = (section.blocks ?? []).map((b, i) => validateBlock(b, `${path}.blocks[${i}]`, opts))
    return { ...section, props: section.props && typeof section.props === 'object' ? section.props : {}, blocks }
  }

  const preset = PRESET_MAP[section.type]
  const fields =
    preset && preset.fields.length > 0 ? fieldsToZod(preset.fields) : null
  // Library presets with no editable fields: props should be empty-ish.
  const props = validateProps(`${path}.props`, section.type, section.props ?? {}, fields, opts)
  // Custom blocks on a preset section are ignored at render; strip in strict mode.
  const blocks =
    opts.strict && section.blocks?.length
      ? []
      : (section.blocks ?? []).map((b, i) => validateBlock(b, `${path}.blocks[${i}]`, opts))
  return { ...section, props, blocks }
}

export function validateSectionProps(doc: SiteDocument, opts: ValidateOpts): SiteDocument {
  return {
    ...doc,
    pages: doc.pages.map((page, pi) => ({
      ...page,
      sections: page.sections.map((section, si) =>
        validateSection(section, `pages[${pi}].sections[${si}]`, opts),
      ),
    })),
  }
}
