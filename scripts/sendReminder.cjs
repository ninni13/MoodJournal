#!/usr/bin/env node
// Wrapper that installs dependencies in reminder/ and runs reminder/index.mjs.
// Maps env var names to what the script expects.
const { spawnSync } = require('node:child_process')
const { join } = require('node:path')

const cwd = process.cwd()
const reminderDir = join(cwd, 'reminder')

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { stdio: 'inherit', ...opts })
  return res.status === 0
}

// Ensure reminder deps are installed (fallback to npm i if no lockfile)
if (!run('npm', ['ci', '--no-audit', '--no-fund'], { cwd: reminderDir })) {
  console.log('[reminder] npm ci failed, falling back to npm i')
  if (!run('npm', ['i', '--no-audit', '--no-fund'], { cwd: reminderDir })) {
    console.error('[reminder] dependency install failed')
    process.exit(1)
  }
}

// Map env names
const env = { ...process.env }
if (!env.FIREBASE_CLIENT_EMAIL && env.CLIENT_EMAIL) env.FIREBASE_CLIENT_EMAIL = env.CLIENT_EMAIL
if (!env.FIREBASE_PRIVATE_KEY && env.PRIVATE_KEY) env.FIREBASE_PRIVATE_KEY = env.PRIVATE_KEY

// Execute the actual script
if (!run('node', ['index.mjs'], { cwd: reminderDir, env })) {
  process.exit(1)
}

