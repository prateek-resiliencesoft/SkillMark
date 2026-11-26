import type { Field } from './fields'
import { ICON_NAMES } from './fields'
import { PRESET_DEFAULTS } from './defaults'

export type PresetCategory = 'home' | 'library' | 'page'

export type PresetDef = {
  type: string
  label: string
  description: string
  category: PresetCategory
  /** Content fields. Empty for library components that have no editable content yet. */
  fields: Field[]
  defaults: Record<string, unknown>
}

const icon = (key = 'icon'): Field => ({ kind: 'select', key, label: 'Icon', options: ICON_NAMES.map((n) => ({ value: n, label: n })) })
const LINK_HELP = 'Use {appUrl}, {videoUrl} or {contactEmail} to reuse the global settings.'

const PRESET_LIST: Omit<PresetDef, 'defaults'>[] = [
  {
    type: 'hero', label: 'Hero', category: 'home', description: 'Big headline, two buttons and the product screen switcher.',
    fields: [
      { kind: 'text', key: 'titleLead', label: 'Headline' },
      { kind: 'text', key: 'titleHighlight', label: 'Headline gradient ending' },
      { kind: 'textarea', key: 'subtitle', label: 'Subtitle' },
      { kind: 'text', key: 'primaryLabel', label: 'Main button label' },
      { kind: 'url', key: 'primaryHref', label: 'Main button link', help: LINK_HELP },
      { kind: 'text', key: 'secondaryLabel', label: 'Second button label', help: 'Leave empty to hide the second button.' },
      { kind: 'url', key: 'secondaryHref', label: 'Second button link', help: LINK_HELP },
      { kind: 'list', key: 'points', label: 'Points under the buttons', itemLabel: 'Point', titleKey: 'text', max: 6, fields: [icon(), { kind: 'text', key: 'text', label: 'Text' }] },
      { kind: 'list', key: 'screens', label: 'Product screens', itemLabel: 'Screen', titleKey: 'label', max: 3, help: 'Up to three. The first is shown large.', fields: [
        { kind: 'text', key: 'label', label: 'Tab label' }, icon(), { kind: 'image', key: 'src', label: 'Screenshot' }, { kind: 'text', key: 'alt', label: 'Image description' },
      ] },
    ],
  },
  {
    type: 'featureShowcase', label: 'Feature showcase', category: 'home', description: 'Scrolling list of features with a sticky screenshot.',
    fields: [
      { kind: 'text', key: 'kicker', label: 'Small label' },
      { kind: 'text', key: 'title', label: 'Title' },
      { kind: 'textarea', key: 'subtitle', label: 'Subtitle' },
      { kind: 'list', key: 'features', label: 'Features', itemLabel: 'Feature', titleKey: 'title', max: 12, fields: [
        icon(), { kind: 'text', key: 'tag', label: 'Tag' }, { kind: 'text', key: 'title', label: 'Title' }, { kind: 'textarea', key: 'line', label: 'Description' },
        { kind: 'image', key: 'src', label: 'Screenshot' }, { kind: 'text', key: 'alt', label: 'Image description' },
      ] },
    ],
  },
  {
    type: 'howItWorks', label: 'How it works', category: 'home', description: 'Numbered steps with a progress line.',
    fields: [
      { kind: 'text', key: 'kicker', label: 'Small label' },
      { kind: 'text', key: 'title', label: 'Title' },
      { kind: 'list', key: 'steps', label: 'Steps', itemLabel: 'Step', titleKey: 'title', max: 6, fields: [icon(), { kind: 'text', key: 'title', label: 'Title' }, { kind: 'textarea', key: 'line', label: 'Description' }] },
    ],
  },
  {
    type: 'integrityStrip', label: 'Integrity strip', category: 'home', description: 'Card explaining the cheating checks.',
    fields: [
      { kind: 'text', key: 'kicker', label: 'Small label' },
      { kind: 'text', key: 'title', label: 'Title' },
      { kind: 'textarea', key: 'subtitle', label: 'Subtitle' },
      { kind: 'list', key: 'items', label: 'Checks', itemLabel: 'Check', titleKey: 'title', max: 6, fields: [icon(), { kind: 'text', key: 'title', label: 'Title' }, { kind: 'textarea', key: 'line', label: 'Description' }] },
    ],
  },
  {
    type: 'stats', label: 'Stats', category: 'home', description: 'Numbers that count up when scrolled into view.',
    fields: [
      { kind: 'list', key: 'items', label: 'Stats', itemLabel: 'Stat', titleKey: 'label', max: 8, fields: [
        icon(), { kind: 'number', key: 'value', label: 'Number', min: 0 }, { kind: 'text', key: 'suffix', label: 'Text after the number' },
        { kind: 'text', key: 'label', label: 'Label' }, { kind: 'text', key: 'sub', label: 'Small print' },
      ] },
    ],
  },
  {
    type: 'pricing', label: 'Pricing', category: 'home', description: 'Plans with regional prices and a monthly/yearly toggle.',
    fields: [
      { kind: 'text', key: 'kicker', label: 'Small label' },
      { kind: 'text', key: 'title', label: 'Title' },
      { kind: 'textarea', key: 'subtitle', label: 'Subtitle' },
      { kind: 'text', key: 'yearlyBadge', label: 'Yearly badge' },
      { kind: 'text', key: 'popularLabel', label: 'Recommended badge' },
      { kind: 'list', key: 'plans', label: 'Plans', itemLabel: 'Plan', titleKey: 'name', max: 4, fields: [
        { kind: 'select', key: 'priceKey', label: 'Price table', help: 'Which regional price list to show.', options: [
          { value: 'starter', label: 'Starter prices' }, { value: 'business', label: 'Growth prices' }, { value: 'enterprise', label: 'Enterprise prices' },
        ] },
        { kind: 'text', key: 'customPrice', label: 'Custom price text', help: 'Replaces the number, e.g. "Custom".', optional: true },
        { kind: 'text', key: 'name', label: 'Name' },
        { kind: 'textarea', key: 'description', label: 'Description' },
        { kind: 'text', key: 'cta', label: 'Button label' },
        { kind: 'url', key: 'href', label: 'Button link', help: LINK_HELP },
        { kind: 'boolean', key: 'popular', label: 'Highlight as recommended' },
        { kind: 'stringList', key: 'features', label: 'Features', itemLabel: 'Feature' },
      ] },
    ],
  },
  {
    type: 'faq', label: 'FAQ', category: 'home', description: 'Accordion of questions and answers.',
    fields: [
      { kind: 'text', key: 'kicker', label: 'Small label' },
      { kind: 'text', key: 'title', label: 'Title' },
      { kind: 'textarea', key: 'subtitle', label: 'Subtitle' },
      { kind: 'list', key: 'items', label: 'Questions', itemLabel: 'Question', titleKey: 'q', max: 30, fields: [{ kind: 'text', key: 'q', label: 'Question' }, { kind: 'textarea', key: 'a', label: 'Answer' }] },
    ],
  },
  {
    type: 'ctaBand', label: 'Call to action', category: 'home', description: 'Closing card with buttons and a tilted screenshot.',
    fields: [
      { kind: 'text', key: 'titleLead', label: 'Headline' },
      { kind: 'text', key: 'titleHighlight', label: 'Headline gradient ending' },
      { kind: 'textarea', key: 'subtitle', label: 'Subtitle' },
      { kind: 'list', key: 'points', label: 'Points', itemLabel: 'Point', titleKey: 'text', max: 6, fields: [icon(), { kind: 'text', key: 'text', label: 'Text' }] },
      { kind: 'text', key: 'primaryLabel', label: 'Main button label' },
      { kind: 'url', key: 'primaryHref', label: 'Main button link', help: LINK_HELP },
      { kind: 'text', key: 'secondaryLabel', label: 'Second button label', help: 'Leave empty to hide the second button.' },
      { kind: 'url', key: 'secondaryHref', label: 'Second button link', help: LINK_HELP },
      { kind: 'image', key: 'image', label: 'Screenshot' },
      { kind: 'text', key: 'imageAlt', label: 'Image description' },
      { kind: 'text', key: 'imageLabel', label: 'Browser frame label' },
    ],
  },
  { type: 'features', label: 'Feature grid', category: 'library', description: 'Bento grid of product capabilities.', fields: [] },
  { type: 'useCases', label: 'Use cases', category: 'library', description: 'Tabs for technical, behavioral, research and practice interviews.', fields: [] },
  { type: 'productShowcase', label: 'Product showcase', category: 'library', description: 'Tabbed tour of app screens.', fields: [] },
  { type: 'interviewDemo', label: 'Interview demo', category: 'library', description: 'Animated mock interview conversation.', fields: [] },
  { type: 'reportInspector', label: 'Report inspector', category: 'library', description: 'Interactive sample candidate report.', fields: [] },
  { type: 'technicalScreenPreview', label: 'Technical screen preview', category: 'library', description: 'Coding and whiteboard interview preview.', fields: [] },
  { type: 'integrityHub', label: 'Integrity hub', category: 'library', description: 'Detailed anti-cheating feature tour.', fields: [] },
  { type: 'batchCv', label: 'Batch CV upload', category: 'library', description: 'Upload many CVs and invite in bulk.', fields: [] },
  { type: 'privacyByok', label: 'Privacy and own keys', category: 'library', description: 'Data privacy and bring-your-own AI key story.', fields: [] },
  { type: 'integrations', label: 'Integrations', category: 'library', description: 'Logos and descriptions of integrations.', fields: [] },
  { type: 'comparisonMatrix', label: 'Comparison table', category: 'library', description: 'How the product compares with alternatives.', fields: [] },
  { type: 'roiCalculator', label: 'ROI calculator', category: 'library', description: 'Interactive time and cost savings calculator.', fields: [] },
  { type: 'stackMarquee', label: 'Tech marquee', category: 'library', description: 'Scrolling strip of technology logos.', fields: [] },
  { type: 'page.about', label: 'About page content', category: 'page', description: 'The built-in About page.', fields: [] },
  { type: 'page.contact', label: 'Contact page content', category: 'page', description: 'The built-in Contact page with contact details.', fields: [] },
  { type: 'page.privacy', label: 'Privacy policy content', category: 'page', description: 'The built-in privacy policy.', fields: [] },
  { type: 'page.terms', label: 'Terms of service content', category: 'page', description: 'The built-in terms of service.', fields: [] },
  { type: 'page.status', label: 'Status page content', category: 'page', description: 'Live app status from the monitors.', fields: [] },
]

export const PRESETS: PresetDef[] = PRESET_LIST.map((p) => ({
  ...p,
  defaults: (PRESET_DEFAULTS as Record<string, Record<string, unknown>>)[p.type] ?? {},
}))

export const PRESET_MAP: Record<string, PresetDef> = Object.fromEntries(PRESETS.map((p) => [p.type, p]))

export const CUSTOM_SECTION = 'custom'
