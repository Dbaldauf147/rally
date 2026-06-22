// One-time helper: create a persistent Apple Distribution certificate from a CSR.
// Writes the DER certificate to <OUT_DIR>/dist.cer and prints the certificate's
// id to stdout (so the bootstrap workflow can store it as a secret).
//
// Unlike the per-build flow, this cert is meant to be KEPT and reused, so the
// main build never has to create/revoke certs (which is what triggers Apple's
// "certificate has been revoked" emails).
//
// Env: KEY_ID, ISSUER_ID, P8_PATH, CSR_PATH, OUT_DIR.

import crypto from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const { KEY_ID, ISSUER_ID, P8_PATH, CSR_PATH, OUT_DIR } = process.env;
for (const [k, v] of Object.entries({ KEY_ID, ISSUER_ID, P8_PATH, CSR_PATH, OUT_DIR })) {
  if (!v) { console.error(`Missing env ${k}`); process.exit(1); }
}

const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
function token() {
  const key = readFileSync(P8_PATH, 'utf8');
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'ES256', kid: KEY_ID, typ: 'JWT' };
  const payload = { iss: ISSUER_ID, iat: now, exp: now + 600, aud: 'appstoreconnect-v1' };
  const input = `${b64url(header)}.${b64url(payload)}`;
  const sig = crypto.sign('sha256', Buffer.from(input), { key, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  return `${input}.${sig}`;
}
async function api(path, opts = {}) {
  const res = await fetch(`https://api.appstoreconnect.apple.com${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  if (!res.ok) throw new Error(`${opts.method || 'GET'} ${path} -> ${res.status}\n${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

const csrContent = readFileSync(CSR_PATH, 'utf8');
const cert = await api('/v1/certificates', {
  method: 'POST',
  body: JSON.stringify({ data: { type: 'certificates', attributes: { certificateType: 'DISTRIBUTION', csrContent } } }),
});
writeFileSync(`${OUT_DIR}/dist.cer`, Buffer.from(cert.data.attributes.certificateContent, 'base64'));
process.stdout.write(cert.data.id);
