#!/usr/bin/env node

/**
 * Design Token Enforcement Script
 *
 * Task 017: Checks for hardcoded hex colors in Tailwind classes.
 *
 * This script searches for patterns like:
 * - bg-[#RRGGBB]
 * - text-[#RRGGBB]
 * - border-[#RRGGBB]
 * - hover:bg-[#RRGGBB]
 * - focus:border-[#RRGGBB]
 * - placeholder-[#RRGGBB]
 *
 * Exits with code 1 if violations found, 0 if clean.
 *
 * Usage: npm run lint:tokens
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, extname } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Patterns to detect arbitrary hex colors in Tailwind classes
const HEX_COLOR_PATTERNS = [
  /bg-\[#[0-9A-Fa-f]{3,8}\]/g,
  /text-\[#[0-9A-Fa-f]{3,8}\]/g,
  /border-\[#[0-9A-Fa-f]{3,8}\]/g,
  /hover:bg-\[#[0-9A-Fa-f]{3,8}\]/g,
  /hover:text-\[#[0-9A-Fa-f]{3,8}\]/g,
  /hover:border-\[#[0-9A-Fa-f]{3,8}\]/g,
  /focus:border-\[#[0-9A-Fa-f]{3,8}\]/g,
  /focus:bg-\[#[0-9A-Fa-f]{3,8}\]/g,
  /placeholder-\[#[0-9A-Fa-f]{3,8}\]/g,
];

// Directories to scan
const SCAN_DIR = join(__dirname, '..', 'src');

// Directories to exclude (design-system is dev-only showcase)
const EXCLUDE_DIRS = ['design-system'];

// File extensions to scan
const EXTENSIONS = ['.tsx', '.ts', '.jsx', '.js'];

/**
 * Recursively get all files in a directory
 */
function getAllFiles(dirPath, arrayOfFiles = []) {
  const files = readdirSync(dirPath);

  files.forEach((file) => {
    const fullPath = join(dirPath, file);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      // Skip excluded directories
      if (!EXCLUDE_DIRS.includes(file)) {
        getAllFiles(fullPath, arrayOfFiles);
      }
    } else {
      if (EXTENSIONS.includes(extname(file))) {
        arrayOfFiles.push(fullPath);
      }
    }
  });

  return arrayOfFiles;
}

/**
 * Find hex color violations in a file
 */
function findViolations(filePath) {
  const content = readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const violations = [];

  lines.forEach((line, index) => {
    HEX_COLOR_PATTERNS.forEach((pattern) => {
      const matches = line.match(pattern);
      if (matches) {
        matches.forEach((match) => {
          violations.push({
            file: filePath,
            line: index + 1,
            match,
            lineContent: line.trim(),
          });
        });
      }
    });
  });

  return violations;
}

/**
 * Main execution
 */
function main() {
  console.log('🔍 Checking for design token violations...\n');

  const files = getAllFiles(SCAN_DIR);
  let totalViolations = [];

  files.forEach((file) => {
    const violations = findViolations(file);
    if (violations.length > 0) {
      totalViolations = totalViolations.concat(violations);
    }
  });

  if (totalViolations.length === 0) {
    console.log('✅ No design token violations found!\n');
    console.log(`   Scanned ${files.length} files in src/`);
    console.log('   All colors use design tokens from @theme\n');
    process.exit(0);
  } else {
    console.log(`❌ Found ${totalViolations.length} design token violations:\n`);

    // Group by file
    const byFile = {};
    totalViolations.forEach((v) => {
      if (!byFile[v.file]) {
        byFile[v.file] = [];
      }
      byFile[v.file].push(v);
    });

    Object.entries(byFile).forEach(([file, violations]) => {
      const relativePath = file.replace(join(__dirname, '..') + '/', '');
      console.log(`📄 ${relativePath}`);
      violations.forEach((v) => {
        console.log(`   Line ${v.line}: ${v.match}`);
        console.log(`   ${v.lineContent.substring(0, 80)}${v.lineContent.length > 80 ? '...' : ''}`);
        console.log('');
      });
    });

    console.log('💡 Fix: Replace arbitrary hex colors with design tokens.');
    console.log('   Example: bg-[#FAFAFA] → bg-vercel-gray-50');
    console.log('   See: docs/STYLEGUIDE.md for token reference\n');

    process.exit(1);
  }
}

main();
