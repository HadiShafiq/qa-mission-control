// Production-style single-port start: applies migrations, then serves API + built UI on PORT (default 4000).
import { spawnSync, spawn } from 'node:child_process';
import path from 'node:path';

const server = path.resolve(import.meta.dirname, '..', 'server');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const migrate = spawnSync(npm, ['run', 'db:deploy'], { cwd: server, stdio: 'inherit', shell: process.platform === 'win32' });
if (migrate.status !== 0) process.exit(migrate.status ?? 1);
const child = spawn(process.execPath, ['dist/server.js'], { cwd: server, stdio: 'inherit', env: { ...process.env, NODE_ENV: 'production' } });
child.on('exit', (code) => process.exit(code ?? 0));
