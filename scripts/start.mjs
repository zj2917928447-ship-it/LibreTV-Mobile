import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const nextCli = fileURLToPath(new URL('../node_modules/next/dist/bin/next', import.meta.url));
const port = process.env.PORT || '8080';
const host = process.env.HOST || '0.0.0.0';

const child = spawn(
  process.execPath,
  [nextCli, 'start', '--hostname', host, '--port', port],
  { stdio: 'inherit', env: process.env }
);

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (!child.killed) child.kill(signal);
  });
}

child.on('error', (error) => {
  console.error('Failed to start the Next.js production server:', error);
  process.exitCode = 1;
});

child.on('exit', (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
