#!/usr/bin/env node
/**
 * Resolve o interpretador Python (mesma lógica do server.js) e executa
 * o script de teste em Python passado como argumento.
 * Uso: node scripts/python-runner.js test/test_ongrid_losses.py
 */
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const PROJECT_ROOT = path.join(__dirname, '..');
const target = process.argv[2];

if (!target) {
  console.error('Uso: node scripts/run-python-test.js <script.py>');
  process.exit(2);
}

function resolvePythonCmd() {
  if (process.env.PYTHON_CMD) return process.env.PYTHON_CMD;
  const localVenv = path.join(PROJECT_ROOT, '.venv', 'bin', 'python');
  if (fs.existsSync(localVenv)) return localVenv;
  return 'python3';
}

const pythonCmd = resolvePythonCmd();
const scriptPath = path.isAbsolute(target) ? target : path.join(PROJECT_ROOT, target);

console.log(`[test:calc] ${pythonCmd} ${target}`);
const result = spawnSync(pythonCmd, [scriptPath], {
  stdio: 'inherit',
  cwd: PROJECT_ROOT
});

process.exit(result.status === null ? 1 : result.status);
