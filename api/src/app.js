// The Express app. Vercel's zero-config Express support serves this module's default export as
// one function (src/app.js is the first entry point it looks for); server.js imports it to
// listen on a port everywhere else.
import './loadEnv.js';
import express from 'express';
import { invalidConfigVars } from './config.js';
import facebookWebhook from './routes/facebookWebhook.js';
import ordersRouter from './routes/orders.js';
import productsRouter from './routes/products.js';

const app = express();
app.disable('x-powered-by');

// A serverless function has no process to stop, so bad configuration is logged (variable
// names only, never values) and every request is refused. server.js exits on the same check.
const invalid = invalidConfigVars();
if (invalid.length > 0) {
  console.error(`Invalid or missing environment variables: ${invalid.join(', ')}. See .env.example.`);
  app.use((req, res) => {
    res.status(503).json({ success: false, message: 'Server is not configured' });
  });
}

app.get('/health', (req, res) => {
  res.json({ success: true, message: 'OrderPilot backend is running' });
});

app.use('/api/webhooks/facebook', facebookWebhook);
app.use('/api/products', productsRouter);
app.use('/api/orders', ordersRouter);

app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Not found' });
});

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const status = err.status ?? err.statusCode;
  // Only the error class and status: a JSON parse error message can quote part of the request body.
  console.error(`Request error: ${err.name} (${Number.isInteger(status) ? status : 500})`);
  if (Number.isInteger(status) && status >= 400 && status < 500) {
    const message = status === 413 ? 'Payload too large' : 'Bad request';
    return res.status(status).json({ success: false, message });
  }
  res.status(500).json({ success: false, message: 'Internal server error' });
});

export default app;
