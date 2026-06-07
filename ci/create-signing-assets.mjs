// Creates an iOS App Store distribution certificate and provisioning profile
// via the App Store Connect API, so the build can sign manually without
// Apple's cloud-managed signing (which the API key isn't granted access to).
//
// Flow:
//   1. Submit the provided CSR -> get an "Apple Distribution" certificate.
//   2. Look up the registered Bundle ID's internal id.
//   3. Recreate a named App Store provisioning profile linked to that cert.
//
// Outputs (for the surrounding shell step):
//   - <OUT_DIR>/dist.cer            (DER certificate)
//   - <OUT_DIR>/profile.mobileprovision
//   - <OUT_DIR>/PROFILE_NAME, <OUT_DIR>/PROFILE_UUID   (plain text)
//   - appends PROFILE_NAME / PROFILE_UUID to $GITHUB_ENV for later steps.
//
// Env: KEY_ID, ISSUER_ID, P8_PATH, BUNDLE_ID, CSR_PATH, OUT_DIR, GITHUB_ENV.

import crypto from 'node:crypto';
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';

const { KEY_ID, ISSUER_ID, P8_PATH, BUNDLE_ID, CSR_PATH, OUT_DIR, GITHUB_ENV } = process.env;
for (const [k, v] of Object.entries({ KEY_ID, ISSUER_ID, P8_PATH, BUNDLE_ID, CSR_PATH, OUT_DIR })) {
  if (!v) { console.error(`Missing env ${k}`); process.exit(1); }
}

const PROFILE_NAME = 'Rally App Store (CI)';
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
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${opts.method || 'GET'} ${path} -> ${res.status}\n${body}`);
  }
  return res.status === 204 ? null : res.json();
}

async function main() {
  // 1. Distribution certificate from the CSR.
  const csrContent = readFileSync(CSR_PATH, 'utf8');
  const cert = await api('/v1/certificates', {
    method: 'POST',
    body: JSON.stringify({
      data: { type: 'certificates', attributes: { certificateType: 'DISTRIBUTION', csrContent } },
    }),
  });
  const certId = cert.data.id;
  writeFileSync(`${OUT_DIR}/dist.cer`, Buffer.from(cert.data.attributes.certificateContent, 'base64'));
  console.log(`Created distribution certificate ${certId}`);

  // 2. Bundle ID internal id.
  const bids = await api(`/v1/bundleIds?filter[identifier]=${encodeURIComponent(BUNDLE_ID)}&limit=200`);
  const bundle = (bids.data || []).find(b => b.attributes.identifier === BUNDLE_ID);
  if (!bundle) throw new Error(`Bundle ID ${BUNDLE_ID} is not registered in the developer account`);

  // 3. Recreate the App Store profile (names must be unique; drop any prior one).
  const existing = await api(`/v1/profiles?filter[name]=${encodeURIComponent(PROFILE_NAME)}&limit=200`);
  for (const p of (existing.data || [])) {
    await api(`/v1/profiles/${p.id}`, { method: 'DELETE' });
  }
  const profile = await api('/v1/profiles', {
    method: 'POST',
    body: JSON.stringify({
      data: {
        type: 'profiles',
        attributes: { name: PROFILE_NAME, profileType: 'IOS_APP_STORE' },
        relationships: {
          bundleId: { data: { type: 'bundleIds', id: bundle.id } },
          certificates: { data: [{ type: 'certificates', id: certId }] },
        },
      },
    }),
  });
  const uuid = profile.data.attributes.uuid;
  writeFileSync(`${OUT_DIR}/profile.mobileprovision`, Buffer.from(profile.data.attributes.profileContent, 'base64'));
  writeFileSync(`${OUT_DIR}/PROFILE_NAME`, PROFILE_NAME);
  writeFileSync(`${OUT_DIR}/PROFILE_UUID`, uuid);
  if (GITHUB_ENV) appendFileSync(GITHUB_ENV, `PROFILE_NAME=${PROFILE_NAME}\nPROFILE_UUID=${uuid}\n`);
  console.log(`Created App Store profile "${PROFILE_NAME}" (${uuid})`);
}

main().catch((err) => { console.error(err.message || err); process.exit(1); });
