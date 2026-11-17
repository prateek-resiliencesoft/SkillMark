import type { Field } from './fields'
import { ICON_NAMES } from './fields'

const iconOptions = [{ value: '', label: 'None' }, ...ICON_NAMES.map((n) => ({ value: n, label: n }))]
const sizes = (values: string[]) => values.map((v) => ({ value: v, label: v.toUpperCase() }))

export type BlockDef = {
  type: string
  label: string
  description: string
  /** Container blocks can hold child blocks. */
  container?: boolean
  fields: Field[]
  defaults: Record<string, unknown>
}

export const BLOCKS: BlockDef[] = [
  {
    type: 'heading', label: 'Heading', description: 'A title, with an optional gradient ending.',
    fields: [
      { kind: 'text', key: 'text', label: 'Text' },
      { kind: 'text', key: 'highlight', label: 'Gradient ending', optional: true },
      { kind: 'select', key: 'level', label: 'Size', options: [{ value: 'h1', label: 'Huge (H1)' }, { value: 'h2', label: 'Large (H2)' }, { value: 'h3', label: 'Medium (H3)' }, { value: 'h4', label: 'Small (H4)' }] },
      { kind: 'text', key: 'kicker', label: 'Small label above', optional: true },
    ],
    defaults: { text: 'A clear heading', level: 'h2' },
  },
  {
    type: 'text', label: 'Paragraph', description: 'Plain text. Blank lines start a new paragraph.',
    fields: [
      { kind: 'textarea', key: 'text', label: 'Text' },
      { kind: 'select', key: 'size', label: 'Size', options: sizes(['sm', 'base', 'lg', 'xl']) },
      { kind: 'boolean', key: 'muted', label: 'Muted color' },
    ],
    defaults: { text: 'Write something helpful here.', size: 'lg', muted: true },
  },
  {
    type: 'richText', label: 'Rich text', description: 'HTML with headings, lists, bold and links. Cleaned before display.',
    fields: [{ kind: 'html', key: 'html', label: 'HTML' }],
    defaults: { html: '<p>Rich <strong>text</strong> with a <a href="/contact">link</a>.</p>' },
  },
  {
    type: 'button', label: 'Button', description: 'A link styled as a button.',
    fields: [
      { kind: 'text', key: 'label', label: 'Label' },
      { kind: 'url', key: 'href', label: 'Link', help: 'Use {appUrl} or {videoUrl} for the global links.' },
      { kind: 'select', key: 'variant', label: 'Style', options: [{ value: 'primary', label: 'Primary' }, { value: 'secondary', label: 'Secondary' }] },
      { kind: 'select', key: 'size', label: 'Size', options: sizes(['sm', 'md', 'lg']) },
      { kind: 'select', key: 'icon', label: 'Icon', options: iconOptions, optional: true },
    ],
    defaults: { label: 'Get started', href: '{appUrl}', variant: 'primary', size: 'lg' },
  },
  {
    type: 'image', label: 'Image', description: 'An uploaded or linked image.',
    fields: [
      { kind: 'image', key: 'src', label: 'Image' },
      { kind: 'text', key: 'alt', label: 'Description for screen readers' },
      { kind: 'boolean', key: 'frame', label: 'Show in a browser frame' },
      { kind: 'text', key: 'caption', label: 'Caption', optional: true },
    ],
    defaults: { src: '/screenshots/dashboard.webp', alt: 'Product screenshot', frame: true },
  },
  {
    type: 'video', label: 'Video', description: 'YouTube, Vimeo or a direct video file.',
    fields: [
      { kind: 'url', key: 'url', label: 'Video link' },
      { kind: 'text', key: 'title', label: 'Title' },
    ],
    defaults: { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', title: 'Product demo' },
  },
  {
    type: 'columns', label: 'Columns', description: 'Places child blocks side by side. Stacks on phones.', container: true,
    fields: [
      { kind: 'select', key: 'count', label: 'Columns', options: ['1', '2', '3', '4'].map((v) => ({ value: v, label: v })) },
      { kind: 'select', key: 'gap', label: 'Gap', options: sizes(['sm', 'md', 'lg']) },
    ],
    defaults: { count: '2', gap: 'md' },
  },
  {
    type: 'row', label: 'Row', description: 'Child blocks in a line that wraps, e.g. a pair of buttons.', container: true,
    fields: [{ kind: 'select', key: 'gap', label: 'Gap', options: sizes(['sm', 'md', 'lg']) }],
    defaults: { gap: 'sm' },
  },
  {
    type: 'card', label: 'Card', description: 'A bordered box with a title and text. Can hold child blocks.', container: true,
    fields: [
      { kind: 'select', key: 'icon', label: 'Icon', options: iconOptions, optional: true },
      { kind: 'text', key: 'title', label: 'Title' },
      { kind: 'textarea', key: 'body', label: 'Text' },
    ],
    defaults: { icon: 'Sparkles', title: 'Card title', body: 'A short description.' },
  },
  {
    type: 'list', label: 'Checklist', description: 'A list of points with icons.',
    fields: [
      { kind: 'stringList', key: 'items', label: 'Points', itemLabel: 'Point' },
      { kind: 'select', key: 'icon', label: 'Icon', options: iconOptions.slice(1) },
    ],
    defaults: { items: ['First point', 'Second point'], icon: 'Check' },
  },
  {
    type: 'spacer', label: 'Spacer', description: 'Empty vertical space.',
    fields: [{ kind: 'select', key: 'size', label: 'Height', options: sizes(['sm', 'md', 'lg', 'xl']) }],
    defaults: { size: 'md' },
  },
  { type: 'divider', label: 'Divider', description: 'A thin horizontal line.', fields: [], defaults: {} },
  {
    type: 'html', label: 'HTML', description: 'Raw HTML for embeds. Scripts are removed.',
    fields: [{ kind: 'html', key: 'html', label: 'HTML' }],
    defaults: { html: '<div>Custom HTML</div>' },
  },
]

export const BLOCK_MAP: Record<string, BlockDef> = Object.fromEntries(BLOCKS.map((b) => [b.type, b]))
