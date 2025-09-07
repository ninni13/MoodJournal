#!/usr/bin/env node
// Wrapper that installs dependencies in reminder/ and runs reminder/index.mjs.
// Maps env var names to what the script expects.
const { spawnSync } = require('node:child_process')
const { join } = require('node:path')

const cwd = process.cwd()
const reminderDir = join(cwd, 'reminder')

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { stdio: 'inherit', ...opts })
  if (res.status !== 0) {
    process.exit(res.status || 1)
  }
}

// Ensure reminder deps are installed
run('npm', ['ci', '--no-audit', '--no-fund'], { cwd: reminderDir })

// Map env names
const env = { ...process.env }
if (!env.FIREBASE_CLIENT_EMAIL && env.CLIENT_EMAIL) env.FIREBASE_CLIENT_EMAIL = env.CLIENT_EMAIL
if (!env.FIREBASE_PRIVATE_KEY && env.PRIVATE_KEY) env.FIREBASE_PRIVATE_KEY = env.PRIVATE_KEY

// Execute the actual script
run('node', ['index.mjs'], { cwd: reminderDir, env })

