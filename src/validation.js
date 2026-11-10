const path = require('path');

const MAX_PATH_LENGTH = 1024;
const MAX_CONTENT_LENGTH = 1_000_000;
const MAX_QUERY_LENGTH = 300;
const MAX_LINE_NUMBER = 1_000_000;
const MAX_READ_LINES = 10_000;

function fail(message) {
  throw new TypeError(message);
}

function requireObject(value, label = 'arguments') {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${label} must be an object.`);
  }
  return value;
}

function rejectUnknownKeys(value, allowed, label = 'arguments') {
  requireObject(value, label);
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    fail(`Unknown ${label} field(s): ${unknown.join(', ')}.`);
  }
}

function validatePath(value, label = 'path') {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_PATH_LENGTH) {
    fail(`${label} must be a non-empty relative path of at most ${MAX_PATH_LENGTH} characters.`);
  }
  if (value.includes('\0') || path.isAbsolute(value) || path.win32.isAbsolute(value)) {
    fail(`${label} must be a relative path inside the workspace.`);
  }

  const segments = value.split(/[\\/]+/);
  if (segments.some((segment) => segment === '..')) {
    fail(`${label} must not contain parent-directory segments.`);
  }
  return segments.filter((segment) => segment && segment !== '.');
}

function validateLineRange(start, end) {
  const actualStart = start === undefined ? 0 : start;
  if (!Number.isSafeInteger(actualStart) || actualStart < 0 || actualStart > MAX_LINE_NUMBER) {
    fail(`start must be an integer between 0 and ${MAX_LINE_NUMBER}.`);
  }
  if (end !== undefined && (!Number.isSafeInteger(end) || end < 0 || end > MAX_LINE_NUMBER)) {
    fail(`end must be an integer between 0 and ${MAX_LINE_NUMBER}.`);
  }
  if (end !== undefined && end < actualStart) {
    fail('end must be greater than or equal to start.');
  }
  if (end !== undefined && end - actualStart > MAX_READ_LINES) {
    fail(`A single read cannot return more than ${MAX_READ_LINES} lines.`);
  }
  return { start: actualStart, end };
}

function validateText(value, label, maxLength) {
  if (typeof value !== 'string') {
    fail(`${label} must be a string.`);
  }
  if (value.length > maxLength) {
    fail(`${label} must not exceed ${maxLength} characters.`);
  }
  return value;
}

function validateExtension(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,31}$/.test(value.replace(/^\./, ''))) {
    fail('extension must be a file extension of at most 32 letters, numbers, dots, underscores, or hyphens.');
  }
  return value.replace(/^\./, '').toLowerCase();
}

function validateBoolean(value, label, defaultValue = false) {
  if (value === undefined) return defaultValue;
  if (typeof value !== 'boolean') fail(`${label} must be a boolean.`);
  return value;
}

module.exports = {
  MAX_CONTENT_LENGTH,
  MAX_QUERY_LENGTH,
  MAX_READ_LINES,
  rejectUnknownKeys,
  requireObject,
  validateBoolean,
  validateExtension,
  validateLineRange,
  validatePath,
  validateText,
};
