const fs = require('fs');
const path = require('path');

const logsDir = path.join(__dirname, '..', 'logs');
const logFile = path.join(logsDir, 'backend.log');

fs.mkdirSync(logsDir, { recursive: true });

function serialize(meta = {}) {
  return Object.entries(meta)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => {
      const normalized = typeof value === 'string' ? value : JSON.stringify(value);
      return `${key}=${normalized}`;
    })
    .join(' ');
}

function write(level, message, meta = {}) {
  const line = `[${new Date().toISOString()}] ${level} ${message}${serialize(meta) ? ` ${serialize(meta)}` : ''}`;
  fs.appendFile(logFile, `${line}\n`, () => {});
  console.log(line);
}

module.exports = {
  info: (message, meta) => write('INFO', message, meta),
  warn: (message, meta) => write('WARN', message, meta),
  error: (message, meta) => write('ERROR', message, meta)
};
