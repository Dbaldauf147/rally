// APNs over HTTP/2 with token auth, shared by the push crons
// (api/reachout-badge.js, api/holiday-reachout.js). Kept outside api/ so Vercel
// doesn't route it.
import http2 from 'node:http2';
import crypto from 'node:crypto';
import { Buffer } from 'node:buffer';

const b64url = (input) =>
  Buffer.from(input).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

// Token-based APNs auth: a short-lived ES256 JWT signed with the .p8 key,
// reusable across every request in this run (APNs allows up to 1 hour).
export function apnsJwt({ keyId, teamId, privateKey }) {
  const header = b64url(JSON.stringify({ alg: 'ES256', kid: keyId }));
  const iat = Math.floor(Date.now() / 1000);
  const payload = b64url(JSON.stringify({ iss: teamId, iat }));
  const signingInput = `${header}.${payload}`;
  const signature = crypto.sign('sha256', Buffer.from(signingInput), {
    key: privateKey,
    dsaEncoding: 'ieee-p1363', // raw r||s, as ES256 JWT requires
  });
  return `${signingInput}.${b64url(signature)}`;
}

// Send one push over the shared HTTP/2 connection. Resolves { status, reason }.
export function sendApns(client, { token, jwt, bundleId, payload, pushType, priority }) {
  return new Promise((resolve, reject) => {
    const body = Buffer.from(JSON.stringify(payload));
    const req = client.request({
      ':method': 'POST',
      ':path': `/3/device/${token}`,
      authorization: `bearer ${jwt}`,
      'apns-topic': bundleId,
      'apns-push-type': pushType,
      'apns-priority': priority,
      'content-type': 'application/json',
      'content-length': body.length,
    });
    let status = 0;
    let data = '';
    req.on('response', (headers) => { status = headers[':status']; });
    req.setEncoding('utf8');
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => {
      let reason = '';
      try { reason = data ? (JSON.parse(data).reason || '') : ''; } catch { /* non-JSON */ }
      resolve({ status, reason });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}


const HOSTS = { production: 'api.push.apple.com', sandbox: 'api.sandbox.push.apple.com' };
// Both mean "this token isn't from this environment" — worth the other host.
const WRONG_ENV = new Set(['BadDeviceToken', 'BadEnvironmentKeyInToken']);

// The APNs settings from the environment, or null when any are missing.
export function apnsConfig(env = globalThis.process?.env || {}) {
  const keyId = env.APNS_KEY_ID;
  const teamId = env.APNS_TEAM_ID;
  const bundleId = env.APNS_BUNDLE_ID;
  const privateKey = (env.APNS_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  if (!keyId || !teamId || !bundleId || !privateKey) return null;
  return { keyId, teamId, bundleId, privateKey, production: env.APNS_PRODUCTION !== 'false' };
}

// A sender for one run: one JWT and at most one connection per environment.
// send() tries the expected environment first and falls back to the other on
// a wrong-environment refusal (TestFlight vs Xcode installs), the same as the
// badge cron. Resolves { ok, status, reason, env, stale }; `stale` means the
// token is dead and should be dropped. Call close() when done.
export function apnsSender(config) {
  const primaryEnv = config.production ? 'production' : 'sandbox';
  const otherEnv = primaryEnv === 'production' ? 'sandbox' : 'production';
  const clients = {};
  const clientFor = (env) => (clients[env] ||= http2.connect(`https://${HOSTS[env]}`));
  const jwt = apnsJwt(config);
  async function send(token, payload, { pushType = 'alert', priority = '10' } = {}) {
    const attempt = (env) => sendApns(clientFor(env), { token, jwt, bundleId: config.bundleId, payload, pushType, priority });
    let env = primaryEnv;
    let { status, reason } = await attempt(env);
    if (status !== 200 && WRONG_ENV.has(reason)) {
      const retry = await attempt(otherEnv);
      if (retry.status === 200 || !WRONG_ENV.has(retry.reason)) {
        ({ status, reason } = retry);
        env = otherEnv;
      }
    }
    const stale = status === 410 || reason === 'Unregistered' || reason === 'BadDeviceToken';
    return { ok: status === 200, status, reason: reason || '', env, stale };
  }
  const close = () => { for (const c of Object.values(clients)) c.close(); };
  return { send, close };
}
