// Local and VPS entry point: checks the configuration, then listens on PORT. On Vercel this
// file is not used; app.js is served directly.
import './loadEnv.js';
import { getSendApiConfig, invalidConfigVars, isAutoReplyEnabled } from './config.js';

// Fail fast on bad configuration. Only variable names are logged, never values.
const invalid = invalidConfigVars();
const rawPort = (process.env.PORT ?? '').trim() || '3000';
const port = /^\d+$/.test(rawPort) ? Number(rawPort) : NaN;
if (!(port >= 1 && port <= 65535)) invalid.push('PORT');
if (invalid.length > 0) {
  console.error(`Invalid or missing environment variables: ${invalid.join(', ')}. See .env.example.`);
  process.exit(1);
}

// Imported only after the check, so bad configuration stops here with the message above.
const { default: app } = await import('./app.js');
const { storageMode } = await import('./bot.js');

const server = app.listen(port);

server.on('listening', () => {
  console.log(`OrderPilot backend listening on http://localhost:${port}`);
  console.log(
    isAutoReplyEnabled()
      ? `Auto-reply: enabled (Graph API ${getSendApiConfig().version})`
      : 'Auto-reply: disabled (set ENABLE_AUTO_REPLY=true to enable)',
  );
  console.log(
    storageMode === 'redis'
      ? 'Storage: Upstash Redis'
      : 'Storage: memory (orders and sessions are lost on restart; set UPSTASH_REDIS_REST_URL to persist)',
  );
});

// Express 5 also passes listen errors to a listen callback, so use events instead.
server.on('error', (err) => {
  console.error(err.code === 'EADDRINUSE' ? `Port ${port} is already in use` : `Server error: ${err.message}`);
  process.exit(1);
});

// Safety net: a stray rejected promise must not crash the server or leak details.
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection', reason?.name);
});

const shutdown = (signal) => {
  console.log(`${signal} received, shutting down`);
  setTimeout(() => process.exit(1), 5000).unref();
  server.close(() => process.exit(0));
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
