/**
 * File Scanner Utility
 * Scans project folders and generates file trees for AI context
 */

import fs from 'fs';
import path from 'path';

// Default ignore patterns (similar to .gitignore)
const DEFAULT_IGNORE_PATTERNS = [
  'node_modules',
  '.git',
  '.svn',
  '.hg',
  'dist',
  'build',
  'coverage',
  '.next',
  '.nuxt',
  '.cache',
  '__pycache__',
  '.pytest_cache',
  'venv',
  '.venv',
  'env',
  '.env.local',
  '.DS_Store',
  'Thumbs.db',
  '*.log',
  '*.lock',
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  '.idea',
  '.vscode',
  '*.pyc',
  '*.pyo',
  '*.class',
  '*.o',
  '*.so',
  '*.dylib',
];

/**
 * Check if a path should be ignored
 */
function shouldIgnore(name, ignorePatterns = DEFAULT_IGNORE_PATTERNS) {
  return ignorePatterns.some(pattern => {
    if (pattern.includes('*')) {
      // Simple glob matching
      const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
      return regex.test(name);
    }
    return name === pattern;
  });
}

/**
 * Scan a directory and return its structure
 * @param {string} dirPath - Directory path to scan
 * @param {object} options - Scan options
 * @returns {object} - File tree structure
 */
export function scanDirectory(dirPath, options = {}) {
  const {
    maxDepth = 5,
    maxFiles = 1000,
    ignorePatterns = DEFAULT_IGNORE_PATTERNS,
    includeHidden = false,
  } = options;

  let fileCount = 0;

  function scan(currentPath, depth = 0) {
    if (depth > maxDepth || fileCount > maxFiles) {
      return null;
    }

    const stats = fs.statSync(currentPath);
    const name = path.basename(currentPath);

    // Skip hidden files unless included
    if (!includeHidden && name.startsWith('.') && depth > 0) {
      return null;
    }

    // Skip ignored patterns
    if (shouldIgnore(name, ignorePatterns)) {
      return null;
    }

    if (stats.isFile()) {
      fileCount++;
      return {
        name,
        type: 'file',
        path: currentPath,
        size: stats.size,
        extension: path.extname(name).slice(1) || null,
      };
    }

    if (stats.isDirectory()) {
      const children = [];

      try {
        const entries = fs.readdirSync(currentPath);

        for (const entry of entries) {
          if (fileCount > maxFiles) break;

          const childPath = path.join(currentPath, entry);
          const child = scan(childPath, depth + 1);

          if (child) {
            children.push(child);
          }
        }
      } catch (error) {
        // Permission denied or other read error
        console.warn(`Cannot read directory: ${currentPath}`, error.message);
      }

      // Sort: directories first, then files, alphabetically
      children.sort((a, b) => {
        if (a.type === b.type) return a.name.localeCompare(b.name);
        return a.type === 'directory' ? -1 : 1;
      });

      return {
        name,
        type: 'directory',
        path: currentPath,
        children,
      };
    }

    return null;
  }

  // Validate path exists
  if (!fs.existsSync(dirPath)) {
    throw new Error(`Path does not exist: ${dirPath}`);
  }

  const result = scan(dirPath);

  return {
    tree: result,
    stats: {
      totalFiles: fileCount,
      maxDepth,
      scannedAt: new Date().toISOString(),
    },
  };
}

/**
 * Generate a text representation of the file tree for AI context
 * @param {object} tree - File tree from scanDirectory
 * @param {object} options - Generation options
 * @returns {string} - Text representation
 */
export function generateTreeText(tree, options = {}) {
  const {
    prefix = '',
    showSize = false,
    maxLines = 500,
  } = options;

  let lines = [];
  let lineCount = 0;

  function traverse(node, indent = '') {
    if (lineCount >= maxLines) return;

    const isLast = false; // Will be set by parent
    let line = indent + node.name;

    if (node.type === 'file' && showSize) {
      line += ` (${formatSize(node.size)})`;
    }

    lines.push(line);
    lineCount++;

    if (node.type === 'directory' && node.children) {
      for (let i = 0; i < node.children.length && lineCount < maxLines; i++) {
        const child = node.children[i];
        const isLastChild = i === node.children.length - 1;
        const childIndent = indent + (isLastChild ? '└── ' : '├── ');
        const nextIndent = indent + (isLastChild ? '    ' : '│   ');

        let childLine = childIndent + child.name;
        if (child.type === 'file' && showSize) {
          childLine += ` (${formatSize(child.size)})`;
        }
        if (child.type === 'directory') {
          childLine += '/';
        }
        lines.push(childLine);
        lineCount++;

        if (child.type === 'directory' && child.children) {
          for (let j = 0; j < child.children.length && lineCount < maxLines; j++) {
            traverse(child.children[j], nextIndent);
          }
        }
      }
    }
  }

  if (tree) {
    lines.push(tree.name + '/');
    lineCount++;

    if (tree.children) {
      for (let i = 0; i < tree.children.length && lineCount < maxLines; i++) {
        const child = tree.children[i];
        const isLastChild = i === tree.children.length - 1;
        const childIndent = isLastChild ? '└── ' : '├── ';
        const nextIndent = isLastChild ? '    ' : '│   ';

        let childLine = childIndent + child.name;
        if (child.type === 'directory') {
          childLine += '/';
        }
        lines.push(childLine);
        lineCount++;

        if (child.type === 'directory' && child.children) {
          for (const grandchild of child.children) {
            if (lineCount >= maxLines) break;
            traverseWithIndent(grandchild, nextIndent);
          }
        }
      }
    }
  }

  function traverseWithIndent(node, baseIndent) {
    if (lineCount >= maxLines) return;

    const children = node.children || [];

    for (let i = 0; i < children.length && lineCount < maxLines; i++) {
      const child = children[i];
      const isLastChild = i === children.length - 1;
      const prefix = isLastChild ? '└── ' : '├── ';
      const nextIndent = baseIndent + (isLastChild ? '    ' : '│   ');

      let line = baseIndent + prefix + child.name;
      if (child.type === 'directory') {
        line += '/';
      }
      lines.push(line);
      lineCount++;

      if (child.type === 'directory' && child.children) {
        traverseWithIndent(child, nextIndent);
      }
    }
  }

  if (lineCount >= maxLines) {
    lines.push('... (truncated)');
  }

  return lines.join('\n');
}

/**
 * Format file size
 */
function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

/**
 * Read a file's contents safely
 * @param {string} filePath - Path to the file
 * @param {object} options - Read options
 * @returns {object} - File contents and metadata
 */
export function readFileContents(filePath, options = {}) {
  const {
    maxSize = 1024 * 1024, // 1MB default
    encoding = 'utf-8',
  } = options;

  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const stats = fs.statSync(filePath);

  if (!stats.isFile()) {
    throw new Error(`Not a file: ${filePath}`);
  }

  if (stats.size > maxSize) {
    return {
      path: filePath,
      name: path.basename(filePath),
      size: stats.size,
      truncated: true,
      content: null,
      error: `File too large (${formatSize(stats.size)}). Max: ${formatSize(maxSize)}`,
    };
  }

  // Check if binary
  const extension = path.extname(filePath).toLowerCase();
  const binaryExtensions = [
    '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.webp',
    '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
    '.zip', '.tar', '.gz', '.rar', '.7z',
    '.exe', '.dll', '.so', '.dylib',
    '.mp3', '.mp4', '.avi', '.mov', '.wav',
    '.ttf', '.otf', '.woff', '.woff2',
  ];

  if (binaryExtensions.includes(extension)) {
    return {
      path: filePath,
      name: path.basename(filePath),
      size: stats.size,
      binary: true,
      content: null,
    };
  }

  try {
    const content = fs.readFileSync(filePath, encoding);
    return {
      path: filePath,
      name: path.basename(filePath),
      size: stats.size,
      extension: extension.slice(1) || null,
      content,
    };
  } catch (error) {
    return {
      path: filePath,
      name: path.basename(filePath),
      error: error.message,
    };
  }
}

/**
 * Validate that a path is safe (within allowed directories)
 * @param {string} requestedPath - Path to validate
 * @param {string} basePath - Base allowed path
 * @returns {boolean} - Whether the path is safe
 */
export function isPathSafe(requestedPath, basePath) {
  const resolvedRequested = path.resolve(requestedPath);
  const resolvedBase = path.resolve(basePath);

  return resolvedRequested.startsWith(resolvedBase);
}

/**
 * Get key project files for context (README, package.json, etc.)
 * @param {string} dirPath - Project directory
 * @returns {object[]} - Array of key files with contents
 */
export function getKeyProjectFiles(dirPath) {
  const keyFiles = [
    'README.md',
    'readme.md',
    'README',
    'package.json',
    'tsconfig.json',
    'pyproject.toml',
    'requirements.txt',
    'Cargo.toml',
    'go.mod',
    'pom.xml',
    'build.gradle',
    '.env.example',
    'docker-compose.yml',
    'Dockerfile',
    'Makefile',
  ];

  const found = [];

  for (const fileName of keyFiles) {
    const filePath = path.join(dirPath, fileName);
    if (fs.existsSync(filePath)) {
      try {
        const result = readFileContents(filePath, { maxSize: 100 * 1024 }); // 100KB max
        if (result.content) {
          found.push(result);
        }
      } catch (error) {
        // Skip files we can't read
      }
    }
  }

  return found;
}

export default {
  scanDirectory,
  generateTreeText,
  readFileContents,
  isPathSafe,
  getKeyProjectFiles,
  DEFAULT_IGNORE_PATTERNS,
};
