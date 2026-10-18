import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const ROOT_DIR = path.resolve(here, '..');
export const DATA_DIR = path.join(here, 'data');
export const BACKUP_DIR = path.join(DATA_DIR, 'backups');

export const CONFIG = {
  port: Number(process.env.SYNC_PORT) || 3002,
  host: process.env.SYNC_HOST || '0.0.0.0',
  dbFile: process.env.DB_FILE ? path.resolve(process.env.DB_FILE) : path.join(ROOT_DIR, 'db.json'),
  devicesFile: path.join(DATA_DIR, 'devices.json'),
  logFile: path.join(DATA_DIR, 'server.log'),
  dashboardFile: path.join(here, 'public', 'index.html'),
  maxBodyBytes: 25 * 1024 * 1024,
  bodyTimeoutMs: 30_000,
  maxBackups: 10,
  onlineWindowMs: 2 * 60 * 1000,
  arpCacheMs: 15_000,
};
