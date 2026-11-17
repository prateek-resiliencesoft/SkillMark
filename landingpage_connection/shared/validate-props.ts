/**
 * Validate section/block props against the field descriptors for their type.
 *
 * Strict (admin save/publish): reject unknown types and unknown keys.
 * Soft (public migrate): keep valid fields; default only invalid/missing ones.
 */
import { fieldsToZod, softParseProps } from './fields'
import { BLOCK_MAP } from './blocks'
import { CUSTOM_SECTION, PRESET_MAP } from './presets'
import type { Block, Section, SiteDocument } from './schema'

export type ValidateOpts = { strict: boolean }

function issue(path: string, message: string): Error {
  return new Error(`${path}: ${message}`)
}

function emptyPropsObject(): Record<string, unknown> {
  return {}
}

/**
 * Known type with no editable fields (library / page presets, divider block):
 * strict → must be an empty object (no unknown keys).
 * soft → drop everything.
 */
function validateEmptyProps(
  path: string,
  props: Record<string, unknown>,
  opts: ValidateOpts,
): Record<string, unknown> {
  if (props == null || typeof props !== 'object' || Array.isArray(props)) {
    if (opts.strict) throw issue(path, 'Props must be an object')
    return emptyPropsObject()
  }
  const keys = Object.keys(props)
  if (opts.strict && keys.length > 0) {
    throw issue(path, `Unexpected props: ${keys.join(', ')}`)
  }
  return emptyPropsObject()
}

function validateProps(
  path: string,
  props: Record<string, unknown>,
  fields: Parameters<typeof fieldsToZod>[0] | null,
  opts: ValidateOpts,
  /** When true, type is known but has zero fields. */
  knownEmpty: boolean,
): Record<string, unknown> {
  if (fields === null && !knownEmpty) {
    // Unknown type — only reached after callers check maps; keep as safety net.
    if (opts.strict) throw issue(path, 'Unknown type')
    return emptyPropsObject()
  }
  if (fields === null || fields.length === 0) {
    return validateEmptyProps(path, props ?? {}, opts)
  }

  if (props == null || typeof props !== 'object' || Array.isArray(props)) {
    if (opts.strict) throw issue(path, 'Props must be an object')
    return softParseProps(fields, {})
  }

  if (opts.strict) {
    const schema = fieldsToZod(fields, { strict: true })
    const result = schema.safeParse(props)
    if (!result.success) {
      const first = result.error.issues[0]
      throw issue(`${path}.${first?.path?.join('.') || 'props'}`, first?.message ?? 'Invalid props')
    }
    return result.data as Record<string, unknown>
  }

  return softParseProps(fields, props)
}

function validateBlock(block: Block, path: string, opts: ValidateOpts): Block {
  const def = BLOCK_MAP[block.type]
  if (!def) {
    if (opts.strict) throw issue(`${path}.type`, `Unknown block type "${block.type}"`)
    // Soft: drop unknown blocks by returning a spacer with no content impact — caller filters?
    // Better: keep structure but empty props so tree length stays stable for debugging.
    return {
      ...block,
      props: emptyPropsObject(),
      children: [],
    }
  }

  const fields = def.fields.length > 0 ? def.fields : null
  const props = validateProps(`${path}.props`, block.props ?? {}, fields, opts, def.fields.length === 0)
  const children = (block.children ?? []).map((c, i) => validateBlock(c, `${path}.children[${i}]`, opts))
  // Containers only keep children; non-containers strip them in strict mode.
  const nextChildren = def.container ? children : opts.strict ? [] : children
  return { ...block, props, children: nextChildren }
}

function validateSection(section: Section, path: string, opts: ValidateOpts): Section {
  if (section.type === CUSTOM_SECTION) {
    const blocks = (section.blocks ?? []).map((b, i) => validateBlock(b, `${path}.blocks[${i}]`, opts))
    // Soft: drop unknown block types entirely so they don't render blank forever.
    const cleaned = opts.strict
      ? blocks
      : blocks.filter((b) => BLOCK_MAP[b.type])
    return {
      ...section,
      props: validateEmptyProps(`${path}.props`, (section.props as Record<string, unknown>) ?? {}, opts),
      blocks: cleaned,
    }
  }

  const preset = PRESET_MAP[section.type]
  if (!preset) {
    if (opts.strict) throw issue(`${path}.type`, `Unknown section type "${section.type}"`)
    return { ...section, props: emptyPropsObject(), blocks: [] }
  }

  const fields = preset.fields.length > 0 ? preset.fields : null
  const props = validateProps(
    `${path}.props`,
    section.props ?? {},
    fields,
    opts,
    preset.fields.length === 0,
  )
  // Preset sections don't use blocks; strip in strict, ignore in soft.
  const blocks =
    opts.strict
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
