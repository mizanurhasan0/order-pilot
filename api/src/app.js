// The Express app. Vercel's zero-config Express support serves this module's default export as
// one function (src/app.js is the first entry point it looks for); server.js imports it to
// listen on a port everywhere else.
import './loadEnv.js';
import express from 'express';
import { bot } from './bot.js';
import { invalidConfigVars } from './config.js';
import { errorHandler, notConfigured, notFound } from './middleware/errors.js';
import ordersRouter from './routes/orders.js';
import productsRouter from './routes/products.js';

// Every setting that is missing or malformed, by name (never values): this backend's own
// variables and the bot's. server.js exits when there is any.
export const configProblems = [...invalidConfigVars(), ...bot.checkConfig()];

const app = express();
app.disable('x-powered-by');

// A serverless function has no process to stop, so bad configuration is logged and every request
// is refused.
if (configProblems.length > 0) {
  console.error(`Missing or invalid settings: ${configProblems.join(', ')}. See .env.example.`);
  app.use(notConfigured);
}

app.get('/health', (req, res) => {
  res.json({ success: true, message: 'OrderPilot backend is running' });
});

// The Messenger bot's webhook. It reads the raw body for the signature check, so it comes before
// any JSON body parser.
app.use('/api/webhooks/facebook', bot.webhook);
app.use('/api/products', productsRouter);
app.use('/api/orders', ordersRouter);

app.use(notFound);
app.use(errorHandler);

export default app;
