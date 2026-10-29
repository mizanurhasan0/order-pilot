#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';

const VERSION = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
).version;

function usage() {
  console.log(`OrderPilot ${VERSION}

Create a starter integration in the current folder:
  npx orderpilot-messenger-bot init

Create it in a new folder:
  npx orderpilot-messenger-bot init my-shop

Choose a framework (default: express):
  npx orderpilot-messenger-bot init --framework express
  npx orderpilot-messenger-bot init --framework next`);
}

function parseArgs(args) {
  let framework = 'express';
  let target = '.';
  let targetSet = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--help' || arg === '-h') return { help: true };
    if (arg === '--version' || arg === '-v') return { version: true };
    if (arg === '--framework' || arg === '-f') {
      framework = args[index + 1];
      if (!framework) throw new Error(`${arg} needs a value: express or next`);
      index += 1;
    } else if (arg.startsWith('--framework=')) {
      framework = arg.slice('--framework='.length);
    } else if (arg.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}`);
    } else if (!targetSet) {
      target = arg;
      targetSet = true;
    } else {
      throw new Error(`Unexpected argument: ${arg}`);
    }
  }
  if (!['express', 'next'].includes(framework)) {
    throw new Error(`Unsupported framework "${framework}". Choose express or next.`);
  }
  return { framework, target };
}

function expressFiles() {
  return {
    'products.js': `// Replace this example with your own products. Prices are whole currency units.
export const products = [
  {
    id: 'P001',
    name: 'Example product',
    price: 1250,
    currency: 'BDT',
    imageUrl: 'https://example.com/product.jpg',
    description: 'Replace with a short product description.',
  },
];
`,
    'orderpilot.js': `import { createOrderPilot } from 'orderpilot-messenger-bot';
import { products } from './products.js';

export const bot = createOrderPilot({
  shopName: process.env.SHOP_NAME || 'My Shop',
  products,
  onOrder: async (order) => {
    // Save the order to your database here. Avoid logging phone/address details.
    console.log('New order:', order.id);
  },
});
`,
    'server.js': `import 'dotenv/config';
import express from 'express';
import { bot } from './orderpilot.js';

const missing = bot.checkConfig();
if (missing.length) {
  console.error('OrderPilot is missing settings:', missing.join(', '));
  process.exit(1);
}

const app = express();
// Keep this before express.json(): Meta signatures require the original request body.
app.use('/webhook/facebook', bot.webhook);
app.get('/health', (_req, res) => res.json({ ok: true }));

const port = Number(process.env.PORT || 3000);
app.listen(port, () => console.log(\`OrderPilot listening on port \${port}\`));
`,
    'connect-meta.js': `import 'dotenv/config';
import { bot } from './orderpilot.js';

const result = await bot.connect();
for (const step of result.steps) {
  const detail = step.ok
    ? step.skipped ? \`skipped (missing: \${step.missing.join(', ')})\` : 'configured'
    : step.hint || step.reason || 'failed';
  console.log(\`\${step.step}: \${detail}\`);
}
if (!result.ok) process.exitCode = 1;
`,
    '.env.orderpilot.example': `# Copy to .env and add the values from your Meta app and Facebook Page.
PAGE_ACCESS_TOKEN=replace_with_page_access_token
FACEBOOK_PAGE_ID=replace_with_numeric_page_id
META_APP_SECRET=replace_with_meta_app_secret
META_VERIFY_TOKEN=replace_with_a_random_secret
META_GRAPH_API_VERSION=v26.0
SHOP_NAME=My Shop
PORT=3000

# Needed only when running bot.connect() to set up the Meta webhook:
FACEBOOK_APP_ID=replace_with_numeric_app_id
WEBHOOK_URL=https://your-domain.example/webhook/facebook
`,
  };
}

function nextFiles() {
  return {
    'lib/orderpilot.js': `import { createOrderPilot } from 'orderpilot-messenger-bot';
import { products } from '../products.js';

export const bot = createOrderPilot({
  shopName: process.env.SHOP_NAME || 'My Shop',
  products,
});
`,
    'products.js': `// Replace this example with your own products. Prices are whole currency units.
export const products = [
  {
    id: 'P001',
    name: 'Example product',
    price: 1250,
    currency: 'BDT',
    imageUrl: 'https://example.com/product.jpg',
    description: 'Replace with a short product description.',
  },
];
`,
    'app/api/webhook/facebook/route.js': `import { bot } from '../../../../lib/orderpilot.js';

export const GET = bot.fetchHandler;
export const POST = bot.fetchHandler;
`,
    'connect-meta.js': `import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { bot } from './lib/orderpilot.js';

const result = await bot.connect();
for (const step of result.steps) {
  const detail = step.ok
    ? step.skipped ? \`skipped (missing: \${step.missing.join(', ')})\` : 'configured'
    : step.hint || step.reason || 'failed';
  console.log(\`\${step.step}: \${detail}\`);
}
if (!result.ok) process.exitCode = 1;
`,
    '.env.orderpilot.example': `# Add these values to your Next.js .env.local (do not commit real secrets).
PAGE_ACCESS_TOKEN=replace_with_page_access_token
FACEBOOK_PAGE_ID=replace_with_numeric_page_id
META_APP_SECRET=replace_with_meta_app_secret
META_VERIFY_TOKEN=replace_with_a_random_secret
META_GRAPH_API_VERSION=v26.0
SHOP_NAME=My Shop

# Needed only when running bot.connect() to set up the Meta webhook:
FACEBOOK_APP_ID=replace_with_numeric_app_id
WEBHOOK_URL=https://your-domain.example/api/webhook/facebook
`,
  };
}

function init({ framework, target }) {
  const root = isAbsolute(target) ? target : resolve(process.cwd(), target);
  const files = framework === 'express' ? expressFiles() : nextFiles();
  const manifestPath = join(root, 'package.json');
  const hasManifest = existsSync(manifestPath);
  if (framework === 'express' && !hasManifest) {
    files['package.json'] = JSON.stringify({
      name: 'my-orderpilot-shop',
      private: true,
      type: 'module',
      scripts: { start: 'node server.js', dev: 'node --watch server.js', 'connect:meta': 'node connect-meta.js' },
      dependencies: { dotenv: '^18.0.8', express: '^5.3.0', 'orderpilot-messenger-bot': `^${VERSION}` },
    }, null, 2) + '\n';
  }

  const collisions = Object.keys(files).map((path) => join(root, path)).filter(existsSync);
  if (collisions.length) {
    throw new Error(`Refusing to overwrite existing files:\n${collisions.map((path) => `  ${path}`).join('\n')}\nMove them or choose an empty folder.`);
  }

  mkdirSync(root, { recursive: true });
  for (const [path, contents] of Object.entries(files)) {
    const output = join(root, path);
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, contents, { flag: 'wx' });
  }

  console.log(`Created the OrderPilot ${framework} starter in ${root}`);
  if (framework === 'express') {
    if (!hasManifest) {
      console.log('\nNext steps:\n  cp .env.orderpilot.example .env\n  npm install\n  npm run dev\n  # Once deployed with a public HTTPS webhook URL:\n  npm run connect:meta');
    } else {
      console.log('\nNext steps:\n  npm install orderpilot-messenger-bot express dotenv\n  cp .env.orderpilot.example .env\n  npm run start\n  # Once deployed with a public HTTPS webhook URL:\n  node connect-meta.js');
    }
  } else {
    console.log('\nNext steps:\n  npm install orderpilot-messenger-bot dotenv\n  cp .env.orderpilot.example .env.local\n  Set the Meta callback URL to /api/webhook/facebook\n  After deployment, run: node connect-meta.js');
  }
}

try {
  const command = process.argv[2];
  if (!command || command === '--help' || command === '-h') {
    usage();
  } else if (command === '--version' || command === '-v') {
    console.log(VERSION);
  } else if (command !== 'init') {
    throw new Error(`Unknown command: ${command}`);
  } else {
    const options = parseArgs(process.argv.slice(3));
    if (options.help) usage();
    else if (options.version) console.log(VERSION);
    else init(options);
  }
} catch (error) {
  console.error(`orderpilot: ${error.message}`);
  process.exitCode = 1;
}
