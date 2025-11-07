#!/usr/bin/env node

// Local testing script for i18n String Reviewer with LLM
// This script sets environment variables with dashes (which shell can't do)

const { spawn } = require('child_process');
const path = require('path');

console.log('🧪 Testing i18n String Reviewer with LLM');
console.log('========================================\n');

// Get command line arguments
const baseFile = process.argv[2] || 'examples/base.pot';
const targetFile = process.argv[3] || 'examples/target.pot';
const openrouterKey = process.env.OPENROUTER_API_KEY || '';
const openrouterModel = process.env.OPENROUTER_MODEL || 'anthropic/claude-3.5-sonnet';

if (!openrouterKey) {
  console.log('⚠️  Warning: OPENROUTER_API_KEY not set');
  console.log('Set it with: export OPENROUTER_API_KEY=\'your-key\'');
  console.log('Testing without LLM feature...\n');
}

console.log(`📁 Base POT:   ${baseFile}`);
console.log(`📁 Target POT: ${targetFile}`);
console.log(`🤖 LLM Model:  ${openrouterModel}\n`);

// Check for debug mode
const debugMode = process.env.DEBUG_LLM === 'true' || process.argv.includes('--debug');
if (debugMode) {
  console.log('🐛 Debug mode enabled\n');
}

// Set environment variables (Node.js can handle dashes in process.env)
const env = {
  ...process.env,
  'INPUT_BASE-POT-FILE': baseFile,
  'INPUT_TARGET-POT-FILE': targetFile,
  'INPUT_FAIL-ON-CHANGES': 'false',
  'INPUT_COMMENT-ON-PR': 'false',
  'INPUT_OPENROUTER-KEY': openrouterKey,
  'INPUT_OPENROUTER-MODEL': openrouterModel,
  'DEBUG_LLM': debugMode ? 'true' : 'false'
};

// Run the action
const child = spawn('node', ['dist/index.js'], {
  env: env,
  stdio: 'inherit',
  cwd: __dirname
});

child.on('close', (code) => {
  console.log(`\n✅ Test complete (exit code: ${code})`);
  process.exit(code);
});

child.on('error', (error) => {
  console.error(`\n❌ Error: ${error.message}`);
  process.exit(1);
});

