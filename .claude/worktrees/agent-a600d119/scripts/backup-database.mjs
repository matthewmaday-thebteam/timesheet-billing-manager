#!/usr/bin/env node

/**
 * Database Backup Script
 * Exports all Supabase tables to JSON files in the backups directory
 */

import { createClient } from '@supabase/supabase-js';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');

// Supabase configuration
const supabaseUrl = 'https://yptbnsegcfpizwhipeep.supabase.co';
const supabaseKey = process.env.SUPABASE_KEY || process.env.VITE_SUPABASE_KEY;

if (!supabaseKey) {
  console.error('Error: SUPABASE_KEY or VITE_SUPABASE_KEY environment variable is required');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Tables and views to backup
const tables = [
  'resources',
  'employment_types',
  'bulgarian_holidays',
  'projects',
  'user_profiles',
  'timesheet_daily_rollups',
];

const views = [
  'v_timesheet_entries',
  'admin_users_view',
];

async function backupTable(name, isView = false) {
  console.log(`  Backing up ${isView ? 'view' : 'table'}: ${name}...`);

  try {
    const { data, error } = await supabase
      .from(name)
      .select('*');

    if (error) {
      console.error(`    Error: ${error.message}`);
      return null;
    }

    console.log(`    Found ${data?.length || 0} records`);
    return data;
  } catch (err) {
    console.error(`    Error: ${err.message}`);
    return null;
  }
}

async function main() {
  console.log('Starting database backup...\n');

  // Create timestamped backup directory
  const timestamp = new Date().toISOString().replace(/[:-]/g, '').slice(0, 15).replace('T', '_');
  const backupDir = join(projectRoot, 'backups', timestamp);

  if (!existsSync(backupDir)) {
    mkdirSync(backupDir, { recursive: true });
  }

  console.log(`Backup directory: ${backupDir}\n`);

  // Backup tables
  console.log('Backing up tables...');
  for (const table of tables) {
    const data = await backupTable(table);
    if (data !== null) {
      const filePath = join(backupDir, `${table}.json`);
      writeFileSync(filePath, JSON.stringify(data, null, 2));
    }
  }

  // Backup views
  console.log('\nBacking up views...');
  for (const view of views) {
    const data = await backupTable(view, true);
    if (data !== null) {
      const filePath = join(backupDir, `${view}.json`);
      writeFileSync(filePath, JSON.stringify(data, null, 2));
    }
  }

  console.log('\nBackup complete!');
  console.log(`Files saved to: ${backupDir}`);
}

main().catch(console.error);
