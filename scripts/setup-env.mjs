// Creates server/.env from server/.env.example if it doesn't exist yet. Cross-platform.
import fs from 'node:fs';
import path from 'node:path';

const dir = path.resolve(import.meta.dirname, '..', 'server');
const target = path.join(dir, '.env');
if (fs.existsSync(target)) {
  console.log('server/.env already exists — left unchanged.');
} else {
  fs.copyFileSync(path.join(dir, '.env.example'), target);
  console.log('Created server/.env from server/.env.example.');
}
