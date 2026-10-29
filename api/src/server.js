// Local and VPS entry point: listens on PORT once the configuration is valid. On Vercel this file
// is not used; app.js is served directly.
import './loadEnv.js';
import app, { configProblems } from './app.js';
import { bot } from './bot.js';
import { isAutoReplyEnabled } from './config.js';

// PORT as a number from 1 to 65535 (default 3000), or null when it is anything else.
function parsePort(value) {
  const raw = (value ?? '').trim() || '3000';
  const port = /^\d+$/.test(raw) ? Number(raw) : NaN;
  return port >= 1 && port <= 65535 ? port : null;
}

// Fail fast on bad configuration: app.js has already logged the names of the problem settings.
if (configProblems.length > 0) process.exit(1);

const port = parsePort(process.env.PORT);
if (port === null) {
  console.error('Missing or invalid settings: PORT. See .env.example.');
  process.exit(1);
}

const server = app.listen(port);

server.on('listening', () => {
  console.log(`OrderPilot backend listening on http://localhost:${port}`);
  console.log(
    isAutoReplyEnabled() ? 'Auto-reply: enabled' : 'Auto-reply: disabled (set ENABLE_AUTO_REPLY=true to enable)',
  );
  console.log(
    bot.storage === 'redis'
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
