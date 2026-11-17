/**
 * Today's landing content, moved out of the components. A site with no
 * published version renders exactly from these values.
 */
import type { Page, Section, SiteDocument } from './schema'
import { SCHEMA_VERSION } from './schema'

const appUrl = '{appUrl}'
const videoUrl = '{videoUrl}'

export const PRESET_DEFAULTS = {
  hero: {
    titleLead: 'Let AI run your',
    titleHighlight: 'first-round interviews.',
    subtitle: 'Tell us the job. Send candidates one link. Get a simple score and report for each person.',
    primaryLabel: 'Get started',
    primaryHref: appUrl,
    secondaryLabel: 'Watch demo',
    secondaryHref: videoUrl,
    points: [
      { icon: 'Mic', text: 'Talks to candidates by voice' },
      { icon: 'ShieldCheck', text: 'Spots cheating' },
      { icon: 'FileText', text: 'Gives a clear score' },
    ],
    screens: [
      { label: 'Dashboard', icon: 'LayoutDashboard', src: '/screenshots/dashboard.webp', alt: 'Dashboard with interviews, scores and activity' },
      { label: 'Results', icon: 'BarChart3', src: '/screenshots/results.webp', alt: 'A candidate result with scores per skill' },
      { label: 'Candidate view', icon: 'UserRound', src: '/screenshots/candidate.webp', alt: 'What the candidate sees before the interview' },
    ],
  },
  featureShowcase: {
    kicker: 'The product',
    title: 'Everything you need to interview.',
    subtitle: 'These are real screens from the app.',
    features: [
      { icon: 'Mic', tag: 'Voice', title: 'The AI talks to your candidates', line: 'A friendly AI voice asks the questions and listens to answers. Candidates can also type.', src: '/screenshots/candidate.webp', alt: 'Candidate joining an AI voice interview' },
      { icon: 'WandSparkles', tag: 'Create', title: 'Questions written for you', line: 'Write one line about the job. The AI suggests questions and what to score.', src: '/screenshots/new.webp', alt: 'AI interview generator' },
      { icon: 'Library', tag: 'Questions', title: 'Save questions and reuse them', line: 'Keep sets for screening, technical and HR rounds. Use them again any time.', src: '/screenshots/questions.webp', alt: 'Question bank with sections' },
      { icon: 'ListChecks', tag: 'Track', title: 'See every interview in one list', line: 'Check who finished, how long it took and what they scored.', src: '/screenshots/candidates.webp', alt: 'Sessions list across interviews' },
      { icon: 'BarChart3', tag: 'Results', title: 'Easy-to-read results', line: 'A score for each skill, simple charts, the full chat and a clear yes or no.', src: '/screenshots/results.webp', alt: 'Candidate results with skill scores' },
      { icon: 'FileText', tag: 'PDF', title: 'Download a PDF report', line: 'Add your logo, pick what to include and share it with your team.', src: '/screenshots/pdf.webp', alt: 'PDF report builder' },
    ],
  },
  howItWorks: {
    kicker: 'How it works',
    title: 'Four simple steps.',
    steps: [
      { icon: 'PenLine', title: 'Tell us the job', line: 'Write what role you are hiring for. The AI makes the interview.' },
      { icon: 'Link2', title: 'Send one link', line: 'Share it by email or WhatsApp, or invite many people at once.' },
      { icon: 'Mic', title: 'The AI interviews', line: 'Candidates talk or type. Cheating checks run the whole time.' },
      { icon: 'BarChart3', title: 'Read the result', line: 'See scores and a short summary. Download a PDF to share.' },
    ],
  },
  integrityStrip: {
    kicker: 'Integrity',
    title: 'Fair interviews for everyone.',
    subtitle: 'Simple cheating checks run in every interview.',
    items: [
      { icon: 'Eye', title: 'Looking away', line: 'The camera notices when someone keeps looking away.' },
      { icon: 'MonitorX', title: 'Leaving the tab', line: 'We note every time they leave the interview tab.' },
      { icon: 'Ban', title: 'Three warnings', line: 'After three warnings, the interview stops.' },
    ],
  },
  stats: {
    items: [
      { icon: 'Layers', value: 3, suffix: '', label: 'Ways to interview', sub: 'Voice, chat and video' },
      { icon: 'ShieldCheck', value: 3, suffix: '-strike', label: 'Cheating checks', sub: 'Tab leaving and looking away' },
      { icon: 'Gauge', value: 10, suffix: '-point', label: 'Scores', sub: 'For each skill and question' },
      { icon: 'FileDown', value: 1, suffix: '-click', label: 'PDF reports', sub: 'With your logo, ready to share' },
    ],
  },
  pricing: {
    kicker: 'Pricing',
    title: 'Pick a plan that fits your hiring.',
    subtitle: 'Choose by how many interviews you run each month. Change or cancel any time.',
    yearlyBadge: 'Save 20%',
    popularLabel: 'Recommended',
    plans: [
      { priceKey: 'starter', name: 'Starter', description: 'For small teams and founders hiring a few people.', cta: 'Start with Starter', href: appUrl, popular: false,
        features: ['50 AI interviews a month', 'Voice and chat interviews', 'Full transcripts and recordings', 'Scores for every candidate', 'Shareable interview links', 'Email support'] },
      { priceKey: 'business', name: 'Growth', description: 'For hiring teams that interview every week.', cta: 'Start with Growth', href: appUrl, popular: true,
        features: ['250 AI interviews a month', 'Everything in Starter', 'Live coding and whiteboard', 'Upload many CVs at once', 'Cheating checks', 'Your own scoring rules', 'Priority support'] },
      { priceKey: 'enterprise', name: 'Enterprise', description: 'For large companies with extra security needs.', cta: 'Talk to us', href: 'mailto:{contactEmail}?subject=Enterprise%20plan', popular: false,
        features: ['Unlimited interviews', 'Everything in Growth', 'Single sign-on and audit logs', 'Use your own AI keys', 'A dedicated contact person', 'Custom contracts and private cloud'] },
    ],
  },
  faq: {
    kicker: 'Frequently Asked Questions',
    title: 'Questions, answered.',
    subtitle: 'Still unsure? Ask the assistant in the corner or write to the team.',
    items: [
      { q: 'How do I get started?', a: 'Create an account, describe the interview in plain language, and share the link. The AI drafts the questions and criteria, and you can edit anything before you invite candidates.' },
      { q: 'Which languages are supported?', a: 'Set the interview language when you create a template. The AI runs the session and evaluates answers in that language. English and Chinese ship in the interface, and interviews can run in Spanish, French, German and more.' },
      { q: 'How long can an interview be?', a: 'As long as you design it. Typical sessions run from 15 minutes to over an hour.' },
      { q: 'What happens if a candidate loses connection?', a: 'Progress saves automatically. The candidate returns to the same link and resumes where they left off, and you can review everything captured before the drop.' },
      { q: 'Is candidate data secure?', a: 'Data is encrypted while it is sent and while it is stored, and only your team can see your interviews. You decide what to keep and when to delete it.' },
      { q: 'Which browsers work best?', a: 'Chrome on a laptop or desktop works best. Safari and Firefox usually work too. Phones work, but a computer is better for important interviews.' },
    ],
  },
  ctaBand: {
    titleLead: 'Run your first AI interview',
    titleHighlight: 'today.',
    subtitle: 'Create an account and try it with your next open role.',
    points: [
      { icon: 'Clock', text: 'Set up an interview in a few minutes' },
      { icon: 'Link2', text: 'Send one link to every candidate' },
      { icon: 'BarChart3', text: 'Get scores and a PDF report' },
    ],
    primaryLabel: 'Get started',
    primaryHref: appUrl,
    secondaryLabel: 'Watch demo',
    secondaryHref: videoUrl,
    image: '/screenshots/results.webp',
    imageAlt: 'A scored candidate result in ResilienceSoft Interview',
    imageLabel: 'Results',
  },
}

export const DEFAULT_SETTINGS: SiteDocument['settings'] = {
  siteName: 'ResilienceSoft Interview',
  company: 'ResilienceSoft',
  companyUrl: 'https://resiliencesoft.com',
  tagline: 'Measure what matters.',
  appUrl: 'https://app.resiliencesoftinterview.com/dashboard',
  videoUrl: 'https://www.youtube.com/channel/UCLCk552hkub1znblDNwqcBw',
  contactEmail: 'info@resiliencesoft.com',
  securityEmail: 'info@resiliencesoft.com',
  phones: ['+91 91099 11372', '+91 92019 96377', '+91 92019 96378'],
  whatsapp: 'https://wa.me/919109911372',
  address: '2nd Floor, Emerald Plaza, Telephone Exchange Road, Opposite CG Plaza, Bilaspur (C.G.) 495001, India',
  socials: {
    facebook: 'https://www.facebook.com/OfficialResiliencesoft',
    instagram: 'https://www.instagram.com/resiliencesoftofficial',
    youtube: 'https://www.youtube.com/channel/UCLCk552hkub1znblDNwqcBw',
    x: 'https://x.com/ResilienceSoft1',
  },
  seo: {
    title: 'ResilienceSoft Interview | AI interviews for voice, chat and video',
    description: 'Describe an interview in plain language, share a link, and let ResilienceSoft Interview run the conversation and score every candidate.',
    ogImage: '/images/resiliencesoft-interview-ai-logo.png',
  },
  accentColor: '',
  showChatbot: true,
}

export const DEFAULT_NAV: SiteDocument['nav'] = {
  links: [
    { label: 'Features', href: '/#features' },
    { label: 'How it works', href: '/#how-it-works' },
    { label: 'Integrity', href: '/#integrity' },
    { label: 'Pricing', href: '/#pricing' },
    { label: 'FAQ', href: '/#faq' },
  ],
  ctaLabel: 'Get started',
  ctaHref: appUrl,
}

export const DEFAULT_FOOTER: SiteDocument['footer'] = {
  blurb: 'AI interviews by voice, chat and video. Tell us the job and the AI asks the questions.',
  showNewsletter: true,
  columns: [
    { title: 'Product', links: [
      { label: 'Features', href: '/#features' },
      { label: 'Integrity', href: '/#integrity' },
      { label: 'How it works', href: '/#how-it-works' },
      { label: 'Pricing', href: '/#pricing' },
    ] },
    { title: 'Company', links: [
      { label: 'About', href: '/about' },
      { label: 'Contact', href: '/contact' },
    ] },
    { title: 'Legal', links: [
      { label: 'Privacy policy', href: '/privacy' },
      { label: 'Terms of service', href: '/terms' },
      { label: 'Report a vulnerability', href: 'mailto:{securityEmail}' },
    ] },
  ],
}

export function presetSection(type: string, id = type): Section {
  const defaults = (PRESET_DEFAULTS as Record<string, Record<string, unknown>>)[type] ?? {}
  return { id, type, hidden: false, props: structuredClone(defaults), style: {}, blocks: [] }
}

const HOME_SECTIONS = ['hero', 'featureShowcase', 'howItWorks', 'integrityStrip', 'stats', 'pricing', 'faq', 'ctaBand']

function builtinPage(slug: string, title: string, description: string): Page {
  return { id: slug, slug, title, hidden: false, seo: { title: '', description }, sections: [presetSection(`page.${slug}`)] }
}

export function defaultSiteDocument(): SiteDocument {
  return {
    schemaVersion: SCHEMA_VERSION,
    settings: structuredClone(DEFAULT_SETTINGS),
    nav: structuredClone(DEFAULT_NAV),
    footer: structuredClone(DEFAULT_FOOTER),
    pages: [
      { id: 'home', slug: '', title: 'Home', hidden: false, seo: { title: '', description: '' }, sections: HOME_SECTIONS.map((t) => presetSection(t)) },
      builtinPage('about', 'About', 'Who builds ResilienceSoft Interview and why.'),
      builtinPage('contact', 'Contact', 'Talk to the ResilienceSoft Interview team.'),
      builtinPage('privacy', 'Privacy policy', 'How ResilienceSoft Interview handles your data.'),
      builtinPage('terms', 'Terms of service', 'The terms for using ResilienceSoft Interview.'),
      builtinPage('status', 'Status', 'Live status of the ResilienceSoft Interview app.'),
    ],
  }
}
