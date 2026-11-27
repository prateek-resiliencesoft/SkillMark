/**
 * English words that Hindi speech recognition writes in Devanagari
 * ("एक्सपीरियंस" for "experience"). Each line: the English spelling, then the
 * Devanagari spellings seen from Gemini / Whisper. Spelling variants (ी/ि, ू/ु,
 * nukta, ं/न्) are folded by the lookup key, so one spelling per sound is enough.
 *
 * AMBIGUOUS words are also real Hindi words (आई = "came", सो = "sleep") or too
 * short to trust; they turn into English only next to another English word.
 */
export const LEXICON = `
experience: एक्सपीरियंस एक्सपीरिएंस एक्सपेरिएंस एक्स्पीरियंस एक्सपिरियंस
experienced: एक्सपीरियंस्ड
developer: डेवलपर डेवेलपर डिवेलपर
developers: डेवलपर्स
development: डेवलपमेंट डेवलपमेन्ट डिवेलपमेंट
develop: डेवलप डिवेलप
developed: डेवलप्ड
currently: करेंटली करंटली
current: करेंट करंट
resilient: रिजिलिएंट रेजिलिएंट रेसिलिएंट रिजिलियंट रेज़िलिएंट
software: सॉफ्टवेयर सॉफ्टवेर सोफ्टवेयर सॉफ्टवेअर
soft: सॉफ्ट
skills: स्किल्स
skill: स्किल
work: वर्क
working: वर्किंग
worked: वर्क्ड
application: एप्लीकेशन एप्लिकेशन ऐप्लिकेशन अप्लीकेशन ऐप्लीकेशन
applications: एप्लीकेशंस एप्लीकेशन्स एप्लिकेशंस ऐप्लिकेशंस
app: ऐप एप
apps: ऐप्स एप्स
gym: जिम
user: यूजर यूज़र
users: यूजर्स यूज़र्स
service: सर्विस
services: सर्विसेज सर्विसेस
provide: प्रोवाइड
provides: प्रोवाइड्स
leads: लीड्स
lead: लीड
manage: मैनेज
managing: मैनेजिंग
management: मैनेजमेंट
manager: मैनेजर
field: फील्ड
ready: रेडी
hello: हेलो हैलो हलो
hi: हाय
India: इंडिया
resume: रिज्यूम रेज्यूमे रिज्यूमे रेज्यूम
company: कंपनी
companies: कंपनीज
project: प्रोजेक्ट
projects: प्रोजेक्ट्स
team: टीम
client: क्लाइंट
clients: क्लाइंट्स
mobile: मोबाइल
frontend: फ्रंटएंड
backend: बैकएंड
Flutter: फ्लटर फ्लूटर फ्लट्टर
Dart: डार्ट
Firebase: फायरबेस
Android: एंड्रॉइड एंड्रॉयड
iOS: आईओएस
React: रिएक्ट
Native: नेटिव
JavaScript: जावास्क्रिप्ट
TypeScript: टाइपस्क्रिप्ट
Python: पाइथन पायथन
Java: जावा
Node: नोड
API: एपीआई
APIs: एपीआईज
database: डेटाबेस डाटाबेस
state: स्टेट
side: साइड
amazing: अमेजिंग अमेज़िंग
please: प्लीज प्लीज़
give: गिव
just: जस्ट
grow: ग्रो
very: वेरी
happy: हैप्पी
messages: मैसेजेस मैसेजिस
message: मैसेज
no: नो
this: दिस
that: दैट
these: दीज
interview: इंटरव्यू
question: क्वेश्चन क्वेश्चन
questions: क्वेश्चंस क्वेश्चन्स
answer: आंसर
sorry: सॉरी
okay: ओके
yes: यस
basically: बेसिकली
actually: एक्चुअली
like: लाइक
also: ऑलसो
really: रियली
because: बिकॉज़ बिकॉज
something: समथिंग
everything: एवरीथिंग
salary: सैलरी
CTC: सीटीसी
LPA: एलपीए
notice: नोटिस
period: पीरियड
days: डेज
months: मंथ्स
month: मंथ
years: इयर्स ईयर्स
year: ईयर इयर
role: रोल
job: जॉब
switch: स्विच
growth: ग्रोथ
learning: लर्निंग
learn: लर्न
opportunity: अपॉर्च्युनिटी ऑपर्च्युनिटी
office: ऑफिस
remote: रिमोट
hybrid: हाइब्रिड
location: लोकेशन
relocate: रिलोकेट
joining: जॉइनिंग
join: जॉइन
immediately: इमीडिएटली
fresher: फ्रेशर
internship: इंटर्नशिप
intern: इंटर्न
degree: डिग्री
college: कॉलेज
engineering: इंजीनियरिंग
engineer: इंजीनियर
computer: कंप्यूटर
science: साइंस
design: डिजाइन डिज़ाइन
designer: डिज़ाइनर डिजाइनर
UI: यूआई
UX: यूएक्स
feature: फीचर
features: फीचर्स
screen: स्क्रीन
screens: स्क्रीन्स
login: लॉगिन
payment: पेमेंट
notification: नोटिफिकेशन
notifications: नोटिफिकेशंस नोटिफिकेशन्स
testing: टेस्टिंग
test: टेस्ट
deploy: डिप्लॉय
deployment: डिप्लॉयमेंट
server: सर्वर
cloud: क्लाउड
code: कोड
coding: कोडिंग
bug: बग
bugs: बग्स
problem: प्रॉब्लम प्रोब्लम
solve: सॉल्व
solution: सॉल्यूशन
performance: परफॉर्मेंस
optimize: ऑप्टिमाइज़ ऑप्टिमाइज
integration: इंटीग्रेशन
integrate: इंटीग्रेट
responsible: रिस्पॉन्सिबल
responsibility: रिस्पॉन्सिबिलिटी
handle: हैंडल
handled: हैंडल्ड
build: बिल्ड
built: बिल्ट
create: क्रिएट
created: क्रिएटेड
customer: कस्टमर
customers: कस्टमर्स
business: बिजनेस बिज़नेस
product: प्रोडक्ट
products: प्रोडक्ट्स
startup: स्टार्टअप
support: सपोर्ट
communication: कम्युनिकेशन
challenge: चैलेंज
challenges: चैलेंजेस चैलेंजेज
challenging: चैलेंजिंग
example: एग्जांपल एग्ज़ाम्पल एग्जाम्पल
background: बैकग्राउंड
microphone: माइक्रोफोन
mic: माइक
voice: वॉइस
audio: ऑडियो
clear: क्लियर
connection: कनेक्शन
network: नेटवर्क
internet: इंटरनेट
sure: श्योर
right: राइट
fine: फाइन
great: ग्रेट
thank: थैंक
thanks: थैंक्स
welcome: वेलकम
phone: फोन
number: नंबर
email: ईमेल
laptop: लैपटॉप
website: वेबसाइट
web: वेब
`;

/**
 * Real Hindi words too, or too short to trust alone: English only beside an
 * English word. A leading "!" marks common Hindi words (इन "these", सो
 * "sleep"): those need English on every side they have a neighbour.
 */
export const AMBIGUOUS = `
!I: आई
am: एम ऍम
a: अ
an: एन
the: द दि
and: एंड
as: एज एज़
is: इज इज़
it: इट
its: इट्स
it's: इट्स
at: एट
of: ऑफ
on: ऑन
!in: इन
for: फॉर
to: टू
!so: सो
my: माय
me: मी
we: वी
you: यू
your: योर
be: बी
was: वॉज
with: विद
from: फ्रॉम
have: हैव
has: हैज
had: हैड
can: कैन
not: नॉट
!but: बट
if: इफ
all: ऑल
about: अबाउट
what: व्हाट
how: हाउ
do: डू
did: डिड
done: डन
make: मेक
made: मेड
use: यूज यूज़
used: यूज्ड
using: यूजिंग
good: गुड
front: फ्रंट
`;

/** Parse one of the lists above into [english, devanagari spellings]. */
export function parseLexicon(src: string): Array<[string, string[]]> {
  const out: Array<[string, string[]]> = [];
  for (const line of src.split("\n")) {
    const m = line.match(/^\s*([^:]+):\s*(.+)$/);
    if (!m) continue;
    out.push([m[1].trim(), m[2].trim().split(/\s+/)]);
  }
  return out;
}
