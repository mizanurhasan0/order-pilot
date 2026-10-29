import { describeSetting } from './config.js';
import { callGraph, describeFailure, failure } from './graph.js';
import { GET_STARTED_PAYLOAD } from './services/payloads.js';

// connect(): everything that links a Facebook Page to this bot through the Graph API, so a shop
// does not have to click through the Meta App Dashboard.
//
//   1. app_webhook       sets the app's Page webhook to `webhookUrl` with the Verify Token
//                        (needs appId, appSecret, verifyToken and webhookUrl; skipped otherwise).
//                        Meta calls the URL straight away to verify it, so the server must already
//                        be running and reachable at that address.
//   2. page_subscription subscribes the Page to the app's messages, postbacks and m.me referrals.
//   3. get_started       adds Messenger's Get Started button (its tap starts the bot).
//
// Safe to run again: a second run sets the same values once more. Never throws, never logs, never
// returns a token. Result: { ok, steps: [{ step, ok, skipped?, missing?, reason?, hint?, code? }] }.

export const WEBHOOK_FIELDS = Object.freeze(['messages', 'messaging_postbacks', 'messaging_referrals']);

const toStep = (step, result) => (result.ok ? { step, ok: true } : { step, ok: false, ...describeFailure(result) });

// Graph answers the subscription calls with { success: true } and the Messenger Profile API with
// { result: 'success' }; anything else means the setting did not change.
const confirmed = (body) => body.success === true || body.result === 'success';
const succeeded = (result) => (result.ok && !confirmed(result.body) ? failure('invalid_response', { status: 200 }) : result);

export async function connectPage(settings, { getStarted = true } = {}) {
  const steps = [];
  const version = settings.graphApiVersion();

  // 1. The app's webhook (an app access token: "<app id>|<app secret>").
  const appId = settings.appId();
  const appSecret = settings.appSecret();
  const verifyToken = settings.verifyToken();
  const webhookUrl = settings.webhookUrl();
  const missing = Object.entries({ appId, appSecret, verifyToken, webhookUrl })
    .filter(([, value]) => !value)
    .map(([name]) => describeSetting(name));
  if (webhookUrl && !/^https:\/\/[^\s]+$/i.test(webhookUrl)) {
    steps.push({ step: 'app_webhook', ok: false, reason: 'invalid_webhook_url', hint: 'webhookUrl must be a public https:// URL', code: null });
  } else if (missing.length > 0) {
    steps.push({ step: 'app_webhook', ok: true, skipped: true, missing });
  } else {
    const result = await callGraph({ accessToken: `${appId}|${appSecret}`, version }, `${appId}/subscriptions`, {
      method: 'POST',
      body: {
        object: 'page',
        callback_url: webhookUrl,
        verify_token: verifyToken,
        fields: WEBHOOK_FIELDS.join(','),
        include_values: true,
      },
    });
    steps.push(toStep('app_webhook', succeeded(result)));
  }

  // 2 and 3 need the Page.
  const page = settings.sendApi();
  if (!page) {
    const pageMissing = settings.invalidSendApi().map(describeSetting);
    steps.push({ step: 'page_subscription', ok: false, reason: 'config', missing: pageMissing });
    if (getStarted) steps.push({ step: 'get_started', ok: false, reason: 'config', missing: pageMissing });
  } else {
    const subscribed = await callGraph(page, `${page.pageId}/subscribed_apps`, {
      method: 'POST',
      body: { subscribed_fields: WEBHOOK_FIELDS.join(',') },
    });
    steps.push(toStep('page_subscription', succeeded(subscribed)));

    if (getStarted) {
      const button = await callGraph(page, 'me/messenger_profile', {
        method: 'POST',
        body: { get_started: { payload: GET_STARTED_PAYLOAD } },
      });
      steps.push(toStep('get_started', succeeded(button)));
    }
  }

  return { ok: steps.every((step) => step.ok), steps };
}
