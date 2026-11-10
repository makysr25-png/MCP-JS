const fs = require('fs');
const path = require('path');
const {
  MAX_CONTENT_LENGTH,
  MAX_QUERY_LENGTH,
  rejectUnknownKeys,
  validateBoolean,
  validateExtension,
  validateLineRange,
  validatePath,
  validateText,
} = require('./validation');

const MAX_FILE_BYTES = 1_000_000;
const MAX_SCANNED_FILES = 10_000;
const MAX_SEARCH_RESULTS = 200;
const MAX_INFO_FILES = 100;
const MAX_RESOURCES = 1_000;
const EXCLUDED_DIRECTORIES = new Set(['.git', 'node_modules', '.next']);

function displayPath(value) {
  return value.replace(/\\/g, '/');
}

function isWithinRoot(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

class WorkspaceService {
  constructor(root = process.env.MCP_WORKSPACE_ROOT || process.cwd()) {
    const resolvedRoot = path.resolve(root);
    this.root = fs.realpathSync(resolvedRoot);
    if (!fs.statSync(this.root).isDirectory()) {
      throw new TypeError('Workspace root must be a directory.');
    }
  }

  resolvePath(relativePath, { createParents = false } = {}) {
    const segments = validatePath(relativePath);
    let current = this.root;

    for (let index = 0; index < segments.length; index += 1) {
      current = path.join(current, segments[index]);
      if (!isWithinRoot(this.root, current)) {
        throw new Error('Access denied: path is outside the workspace.');
      }

      try {
        const stats = fs.lstatSync(current);
        if (stats.isSymbolicLink()) {
          throw new Error(`Symbolic links are not allowed in workspace paths: ${relativePath}`);
        }
        if (index < segments.length - 1 && !stats.isDirectory()) {
          throw new Error(`Path component is not a directory: ${segments[index]}`);
        }
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        if (createParents && index < segments.length - 1) {
          fs.mkdirSync(current);
        }
      }
    }
    return current;
  }

  listDirectory(input = {}) {
    rejectUnknownKeys(input, ['path']);
    const relativePath = input.path === undefined ? '.' : input.path;
    const target = this.resolvePath(relativePath);
    const stats = fs.statSync(target);
    if (!stats.isDirectory()) throw new TypeError('path must identify a directory.');

    return fs.readdirSync(target, { withFileTypes: true }).map((entry) => ({
      name: entry.name,
      path: displayPath(path.join(relativePath, entry.name)),
      isDirectory: entry.isDirectory(),
      isFile: entry.isFile(),
      isSymbolicLink: entry.isSymbolicLink(),
    }));
  }

  readFile(input = {}) {
    rejectUnknownKeys(input, ['path', 'start', 'end']);
    const segments = validatePath(input.path);
    const relativePath = segments.join(path.sep);
    const { start, end } = validateLineRange(input.start, input.end);
    const target = this.resolvePath(relativePath);
    const stats = fs.statSync(target);
    if (!stats.isFile()) throw new TypeError('path must identify a regular file.');
    if (stats.size > MAX_FILE_BYTES) {
      throw new RangeError(`File exceeds the ${MAX_FILE_BYTES}-byte read limit.`);
    }

    const lines = fs.readFileSync(target, 'utf8').split(/\r?\n/);
    const selectedEnd = end === undefined ? Math.min(lines.length, start + 10_000) : Math.min(end, lines.length);
    if (end === undefined && lines.length - start > 10_000) {
      throw new RangeError('A single read cannot return more than 10000 lines; specify an end line.');
    }
    const selectedLines = lines.slice(Math.min(start, lines.length), selectedEnd);

    return {
      path: displayPath(relativePath),
      content: selectedLines.join('\n'),
      lines: selectedLines.length,
      totalLines: lines.length,
    };
  }

  writeFile(input = {}) {
    rejectUnknownKeys(input, ['path', 'content', 'append']);
    const segments = validatePath(input.path);
    if (segments.length === 0) throw new TypeError('path must identify a file.');
    const content = validateText(input.content, 'content', MAX_CONTENT_LENGTH);
    if (Buffer.byteLength(content, 'utf8') > MAX_CONTENT_LENGTH) {
      throw new RangeError(`content must not exceed ${MAX_CONTENT_LENGTH} bytes when encoded as UTF-8.`);
    }
    const append = validateBoolean(input.append, 'append');
    const relativePath = segments.join(path.sep);
    const target = this.resolvePath(relativePath, { createParents: true });

    try {
      const stats = fs.lstatSync(target);
      if (stats.isSymbolicLink() || !stats.isFile()) {
        throw new TypeError('The destination must be a regular file, not a directory or symbolic link.');
      }
      if (append && stats.size + Buffer.byteLength(content, 'utf8') > MAX_CONTENT_LENGTH) {
        throw new RangeError(`The resulting file must not exceed ${MAX_CONTENT_LENGTH} bytes.`);
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }

    fs.writeFileSync(target, content, { encoding: 'utf8', flag: append ? 'a' : 'w' });
    return { path: displayPath(relativePath), written: true, mode: append ? 'append' : 'write' };
  }

  searchFiles(input = {}) {
    rejectUnknownKeys(input, ['query', 'path', 'extension']);
    const query = validateText(input.query, 'query', MAX_QUERY_LENGTH).trim();
    if (!query) throw new TypeError('query must not be empty.');
    const relativePath = input.path === undefined ? '.' : input.path;
    const rootPath = this.resolvePath(relativePath);
    if (!fs.statSync(rootPath).isDirectory()) throw new TypeError('path must identify a directory.');
    const extension = validateExtension(input.extension);
    const normalizedQuery = query.toLowerCase();
    const results = [];
    let scannedFiles = 0;
    const queue = [rootPath];

    while (queue.length > 0 && scannedFiles < MAX_SCANNED_FILES && results.length < MAX_SEARCH_RESULTS) {
      const currentDir = queue.shift();
      for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          if (!EXCLUDED_DIRECTORIES.has(entry.name)) queue.push(path.join(currentDir, entry.name));
          continue;
        }
        if (!entry.isFile()) continue;
        if (extension && path.extname(entry.name).slice(1).toLowerCase() !== extension) continue;

        scannedFiles += 1;
        const fullPath = path.join(currentDir, entry.name);
        const nameMatch = entry.name.toLowerCase().includes(normalizedQuery);
        const stats = fs.statSync(fullPath);
        const contentMatch = stats.size <= MAX_FILE_BYTES
          && fs.readFileSync(fullPath, 'utf8').toLowerCase().includes(normalizedQuery);
        if (nameMatch || contentMatch) {
          results.push({
            path: displayPath(path.relative(this.root, fullPath)),
            name: entry.name,
            matchesContent: contentMatch,
            matchesName: nameMatch,
          });
        }
        if (scannedFiles >= MAX_SCANNED_FILES || results.length >= MAX_SEARCH_RESULTS) break;
      }
    }
    return results;
  }

  getWorkspaceInfo() {
    const files = this.walkFiles(MAX_SCANNED_FILES + 1);
    const truncated = files.length > MAX_SCANNED_FILES;
    const listedFiles = files.slice(0, MAX_SCANNED_FILES);
    return {
      root: displayPath(this.root),
      fileCount: listedFiles.length,
      files: listedFiles.slice(0, MAX_INFO_FILES).map((file) => displayPath(path.relative(this.root, file))),
      truncated,
    };
  }

  listWorkspaceResources() {
    return this.walkFiles(MAX_RESOURCES)
      .map((file) => {
        const relative = displayPath(path.relative(this.root, file));
        const uriPath = relative.split('/').map(encodeURIComponent).join('/');
        return {
          uri: `workspace://${uriPath}`,
          name: path.basename(file),
          mimeType: 'text/plain',
          description: `File: ${relative}`,
        };
      });
  }

  readResource(uri) {
    if (typeof uri !== 'string' || !uri.startsWith('workspace://')) {
      throw new TypeError('Unsupported resource URI.');
    }
    const encodedPath = uri.slice('workspace://'.length);
    let relativePath;
    try {
      relativePath = encodedPath.split('/').map(decodeURIComponent).join(path.sep);
    } catch {
      throw new TypeError('Resource URI contains invalid percent-encoding.');
    }
    const target = this.resolvePath(relativePath || '.');
    const stats = fs.statSync(target);
    if (stats.isDirectory()) {
      return {
        contents: [{
          uri,
          mimeType: 'application/json',
          text: JSON.stringify(this.listDirectory({ path: relativePath || '.' }), null, 2),
        }],
      };
    }
    if (!stats.isFile()) throw new TypeError('Resource must identify a regular file or directory.');
    if (stats.size > MAX_FILE_BYTES) {
      throw new RangeError(`File exceeds the ${MAX_FILE_BYTES}-byte resource limit.`);
    }
    return {
      contents: [{ uri, mimeType: 'text/plain', text: fs.readFileSync(target, 'utf8') }],
    };
  }

  walkFiles(limit) {
    const files = [];
    const queue = [this.root];
    while (queue.length > 0 && files.length < limit) {
      const current = queue.shift();
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          if (!EXCLUDED_DIRECTORIES.has(entry.name)) queue.push(path.join(current, entry.name));
        } else if (entry.isFile()) {
          files.push(path.join(current, entry.name));
          if (files.length >= limit) break;
        }
      }
    }
    return files;
  }
}

module.exports = { WorkspaceService };
