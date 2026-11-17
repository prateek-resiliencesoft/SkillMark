/** Short ids for pages, sections and blocks. Safe for both browser and Node. */
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'

export function newId(prefix = '', size = 10): string {
  const bytes = new Uint8Array(size)
  crypto.getRandomValues(bytes)
  let id = ''
  for (let i = 0; i < size; i++) id += ALPHABET[bytes[i]! % ALPHABET.length]
  return prefix ? `${prefix}_${id}` : id
}
