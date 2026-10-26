import { build, createServer } from 'vite';

const command = process.argv[2];

if (command !== 'dev' && command !== 'build') {
  throw new Error('Use "dev" or "build" with this script.');
}

process.env.PORT = '1420';
process.env.BASE_PATH = command === 'dev' ? '/' : './';

if (command === 'dev') {
  const server = await createServer({
    configFile: 'vite.config.ts',
    server: { host: '127.0.0.1', port: 1420, strictPort: true },
  });
  await server.listen();
  server.printUrls();
} else {
  await build({ configFile: 'vite.config.ts' });
}