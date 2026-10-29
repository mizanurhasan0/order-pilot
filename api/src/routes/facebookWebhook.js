// The Messenger webhook: Meta's verification request (GET) and its signed event deliveries
// (POST), served by the orderpilot package. app.js mounts it at /api/webhooks/facebook.
import { bot } from '../bot.js';

export default bot.webhook;
