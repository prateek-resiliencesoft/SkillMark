import { z } from 'zod'
import type { Field } from './fields'
import { fieldsToZod } from './fields'
import type { Style } from './style'
import { styleSchema as rawStyleSchema } from './style'

export const SCHEMA_VERSION = 1

export type Link = { label: string; href: string }

export type SiteSettings = {
  siteName: string
  company: string
  companyUrl: string
  tagline: string
  appUrl: string
  videoUrl: string
  contactEmail: string
  securityEmail: string
  phones: string[]
  whatsapp: string
  address: string
  socials: { facebook: string; instagram: string; youtube: string; x: string }
  seo: { title: string; description: string; ogImage: string }
  accentColor: string
  showChatbot: boolean
}

export type Block = { id: string; type: string; props: Record<string, unknown>; style: Style; children: Block[] }

export type Section = { id: string; type: string; hidden: boolean; props: Record<string, unknown>; style: Style; blocks: Block[] }

export type Page = {
  id: string
  /** '' is the home page; nested paths like "solutions/hr" are allowed. */
  slug: string
  title: string
  hidden: boolean
  seo: { title: string; description: string }
  sections: Section[]
}

export type SiteDocument = {
  schemaVersion: number
  settings: SiteSettings
  nav: { links: Link[]; ctaLabel: string; ctaHref: string }
  footer: { blurb: string; showNewsletter: boolean; columns: { title: string; links: Link[] }[] }
  pages: Page[]
}

const linkFields: Field[] = [
  { kind: 'text', key: 'label', label: 'Label' },
  { kind: 'url', key: 'href', label: 'Link', help: 'A path like /about or /#pricing, a full URL, or mailto:.' },
]

export const SETTINGS_FIELDS: Field[] = [
  { kind: 'text', key: 'siteName', label: 'Site name' },
  { kind: 'text', key: 'company', label: 'Company name' },
  { kind: 'url', key: 'companyUrl', label: 'Company website' },
  { kind: 'text', key: 'tagline', label: 'Tagline' },
  { kind: 'url', key: 'appUrl', label: 'App link ({appUrl})', help: 'Where "Get started" buttons go.' },
  { kind: 'url', key: 'videoUrl', label: 'Demo video link ({videoUrl})' },
  { kind: 'text', key: 'contactEmail', label: 'Contact email ({contactEmail})' },
  { kind: 'text', key: 'securityEmail', label: 'Security email ({securityEmail})' },
  { kind: 'stringList', key: 'phones', label: 'Phone numbers', itemLabel: 'Phone', max: 6 },
  { kind: 'url', key: 'whatsapp', label: 'WhatsApp link' },
  { kind: 'textarea', key: 'address', label: 'Address' },
  { kind: 'group', key: 'socials', label: 'Social links', fields: [
    { kind: 'url', key: 'facebook', label: 'Facebook' },
    { kind: 'url', key: 'instagram', label: 'Instagram' },
    { kind: 'url', key: 'youtube', label: 'YouTube' },
    { kind: 'url', key: 'x', label: 'X' },
  ] },
  { kind: 'group', key: 'seo', label: 'Search and sharing', fields: [
    { kind: 'text', key: 'title', label: 'Default page title' },
    { kind: 'textarea', key: 'description', label: 'Default description' },
    { kind: 'image', key: 'ogImage', label: 'Share image' },
  ] },
  { kind: 'color', key: 'accentColor', label: 'Accent color', help: 'Replaces the violet brand color. Leave empty for the default.' },
  { kind: 'boolean', key: 'showChatbot', label: 'Show the SkillBot assistant' },
]

export const NAV_FIELDS: Field[] = [
  { kind: 'list', key: 'links', label: 'Menu links', itemLabel: 'Link', titleKey: 'label', max: 10, fields: linkFields },
  { kind: 'text', key: 'ctaLabel', label: 'Button label', help: 'Leave empty to hide the button.' },
  { kind: 'url', key: 'ctaHref', label: 'Button link' },
]

export const FOOTER_FIELDS: Field[] = [
  { kind: 'textarea', key: 'blurb', label: 'Short description' },
  { kind: 'boolean', key: 'showNewsletter', label: 'Show the updates sign-up' },
  { kind: 'list', key: 'columns', label: 'Link columns', itemLabel: 'Column', titleKey: 'title', max: 5, fields: [
    { kind: 'text', key: 'title', label: 'Column title' },
    { kind: 'list', key: 'links', label: 'Links', itemLabel: 'Link', titleKey: 'label', max: 12, fields: linkFields },
  ] },
]

export const PAGE_SEO_FIELDS: Field[] = [
  { kind: 'text', key: 'title', label: 'Page title', help: 'Leave empty to use "<page> | <site name>".' },
  { kind: 'textarea', key: 'description', label: 'Description' },
]

// Built dynamically from field lists, so zod cannot infer the static shape.
const styleSchema = rawStyleSchema as unknown as z.ZodType<Style>
const typed = <T>(fields: Field[]) => fieldsToZod(fields) as unknown as z.ZodType<T>

const entityId = z.string().min(1).max(64).regex(/^[A-Za-z0-9_.-]+$/, 'Ids use letters, numbers, dot, dash and underscore')
const props = z.record(z.string(), z.unknown())

export const blockSchema: z.ZodType<Block> = z.lazy(() =>
  z.object({
    id: entityId,
    type: z.string().min(1).max(40),
    props,
    style: styleSchema,
    children: z.array(blockSchema).max(100),
  }),
)

export const sectionSchema: z.ZodType<Section> = z.object({
  id: entityId,
  type: z.string().min(1).max(40),
  hidden: z.boolean(),
  props,
  style: styleSchema,
  blocks: z.array(blockSchema).max(200),
})

export const SLUG_RE = /^$|^[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*$/

export const pageSchema: z.ZodType<Page> = z.object({
  id: entityId,
  slug: z.string().max(120).regex(SLUG_RE, 'Slugs use lowercase letters, numbers and dashes'),
  title: z.string().min(1).max(120),
  hidden: z.boolean(),
  seo: typed<Page['seo']>(PAGE_SEO_FIELDS),
  sections: z.array(sectionSchema).max(60),
})

export const siteDocumentSchema: z.ZodType<SiteDocument> = z
  .object({
    schemaVersion: z.number().int(),
    settings: typed<SiteSettings>(SETTINGS_FIELDS),
    nav: typed<SiteDocument['nav']>(NAV_FIELDS),
    footer: typed<SiteDocument['footer']>(FOOTER_FIELDS),
    pages: z.array(pageSchema).min(1).max(50),
  })
  .superRefine((doc, ctx) => {
    const slugs = new Set<string>()
    const ids = new Set<string>()
    doc.pages.forEach((p, i) => {
      if (slugs.has(p.slug)) ctx.addIssue({ code: 'custom', path: ['pages', i, 'slug'], message: `Two pages use the address "/${p.slug}"` })
      if (ids.has(p.id)) ctx.addIssue({ code: 'custom', path: ['pages', i, 'id'], message: `Duplicate page id "${p.id}"` })
      slugs.add(p.slug)
      ids.add(p.id)
    })
    if (!slugs.has('')) ctx.addIssue({ code: 'custom', path: ['pages'], message: 'The site needs a home page (empty address)' })
  })

/** Replaces {appUrl}, {videoUrl}, {contactEmail} and {securityEmail} with the global settings. */
export function resolveHref(href: string, settings: Pick<SiteSettings, 'appUrl' | 'videoUrl' | 'contactEmail' | 'securityEmail'>): string {
  return href
    .replace(/\{appUrl\}/g, settings.appUrl)
    .replace(/\{videoUrl\}/g, settings.videoUrl)
    .replace(/\{contactEmail\}/g, settings.contactEmail)
    .replace(/\{securityEmail\}/g, settings.securityEmail)
}
