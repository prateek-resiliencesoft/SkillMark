#!/usr/bin/env node
/**
 * Copy landingpage_connection/shared → SkillMark-LandingPage/src/cms/shared
 * and write a hash so CI can detect drift (--check).
 *
 * Usage:
 *   node landingpage_connection/scripts/sync-to-landing.mjs
 *   node landingpage_connection/scripts/sync-to-landing.mjs --check
 */
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../..')
const SRC = path.join(ROOT, 'landingpage_connection/shared')
const DEST_DEFAULT = path.resolve(ROOT, '../SkillMark-LandingPage/src/cms/shared')
const DEST = process.env.LANDING_CMS_SHARED || DEST_DEFAULT
const HASH_NAME = '.sync-hash'
const checkOnly = process.argv.includes('--check')

async function walk(dir) {
  const out = []
  for (const ent of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name)
    if (ent.isDirectory()) out.push(...(await walk(full)))
    else if (ent.isFile() && (ent.name.endsWith('.ts') || ent.name.endsWith('.tsx'))) {
      out.push(full)
    }
  }
  return out
}

async function hashTree(dir) {
  const files = (await walk(dir)).sort()
  const h = createHash('sha256')
  for (const f of files) {
    const rel = path.relative(dir, f).replaceAll('\\', '/')
    h.update(rel)
    h.update('\0')
    h.update(await fs.readFile(f))
    h.update('\0')
  }
  return h.digest('hex')
}

async function copyTree(src, dest) {
  await fs.rm(dest, { recursive: true, force: true })
  await fs.mkdir(dest, { recursive: true })
  const files = await walk(src)
  for (const f of files) {
    const rel = path.relative(src, f)
    const target = path.join(dest, rel)
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.copyFile(f, target)
  }
}

async function main() {
  const srcHash = await hashTree(SRC)

  if (checkOnly) {
    let destHash = null
    let stamped = null
    try {
      destHash = await hashTree(DEST)
      stamped = (await fs.readFile(path.join(DEST, HASH_NAME), 'utf8')).trim()
    } catch {
      console.error(`Missing synced copy at ${DEST}`)
      process.exit(1)
    }
    if (destHash !== srcHash || stamped !== srcHash) {
      console.error('landingpage_connection/shared is out of sync with SkillMark-LandingPage/src/cms/shared')
      console.error(`  source:  ${srcHash}`)
      console.error(`  dest:    ${destHash}`)
      console.error(`  stamped: ${stamped}`)
      console.error('Run: node landingpage_connection/scripts/sync-to-landing.mjs')
      process.exit(1)
    }
    console.log('OK — shared CMS code is in sync')
    return
  }

  await copyTree(SRC, DEST)
  await fs.writeFile(path.join(DEST, HASH_NAME), `${srcHash}\n`)
  console.log(`Synced shared → ${DEST}`)
  console.log(`Hash ${srcHash}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
