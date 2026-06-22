// Creates an iOS App Store distribution certificate and provisioning profile(s)
// via the App Store Connect API, so the build can sign manually without
// Apple's cloud-managed signing (which the API key isn't granted access to).
//
// Flow:
//   1. Submit the provided CSR -> get an "Apple Distribution" certificate.
//   2. For the app bundle id (and, if EXT_BUNDLE_ID is set, the Share Extension
//      bundle id): ensure it's registered, then recreate a named App Store
//      provisioning profile linked to the cert.
//
// Outputs (for the surrounding shell step):
//   - <OUT_DIR>/dist.cer                  (DER certificate)
//   - <OUT_DIR>/profile.mobileprovision        + PROFILE_NAME / PROFILE_UUID
//   - <OUT_DIR>/profile-ext.mobileprovision    + EXT_PROFILE_NAME / EXT_PROFILE_UUID  (only if EXT_BUNDLE_ID)
//   - appends the PROFILE_* / EXT_PROFILE_* vars to $GITHUB_ENV for later steps.
//
// Env: KEY_ID, ISSUER_ID, P8_PATH, BUNDLE_ID, CSR_PATH, OUT_DIR, GITHUB_ENV,
//      EXT_BUNDLE_ID (optional).

import crypto from 'node:crypto';
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';

const { KEY_ID, ISSUER_ID, P8_PATH, BUNDLE_ID, EXT_BUNDLE_ID, CSR_PATH, OUT_DIR, GITHUB_ENV, CERT_ID } = process.env;
// CERT_ID (a pre-existing, reused distribution cert) makes CSR_PATH optional —
// in that mode we don't create a cert at all, only the provisioning profiles.
const required = { KEY_ID, ISSUER_ID, P8_PATH, BUNDLE_ID, OUT_DIR, ...(CERT_ID ? {} : { CSR_PATH }) };
for (const [k, v] of Object.entries(required)) {
  if (!v) { console.error(`Missing env ${k}`); process.exit(1); }
}

const APP_PROFILE_NAME = 'Rally App Store (CI)';
const EXT_PROFILE_NAME = 'Rally ShareExt App Store (CI)';
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

// Find the bundle id's internal id, registering it first if it doesn't exist
// yet (the extension's bundle id won't on the first run that adds it).
async function ensureBundleId(identifier, displayName) {
  const found = await api(`/v1/bundleIds?filter[identifier]=${encodeURIComponent(identifier)}&limit=200`);
  const existing = (found.data || []).find(b => b.attributes.identifier === identifier);
  if (existing) return existing.id;
  console.log(`Registering bundle id ${identifier}…`);
  const created = await api('/v1/bundleIds', {
    method: 'POST',
    body: JSON.stringify({
      data: { type: 'bundleIds', attributes: { identifier, name: displayName, platform: 'IOS' } },
    }),
  });
  return created.data.id;
}

// (Re)create a uniquely-named App Store profile for one bundle id.
async function makeProfile({ name, bundleInternalId, certId, outFile, envPrefix }) {
  const existing = await api(`/v1/profiles?filter[name]=${encodeURIComponent(name)}&limit=200`);
  for (const p of (existing.data || [])) {
    await api(`/v1/profiles/${p.id}`, { method: 'DELETE' });
  }
  const profile = await api('/v1/profiles', {
    method: 'POST',
    body: JSON.stringify({
      data: {
        type: 'profiles',
        attributes: { name, profileType: 'IOS_APP_STORE' },
        relationships: {
          bundleId: { data: { type: 'bundleIds', id: bundleInternalId } },
          certificates: { data: [{ type: 'certificates', id: certId }] },
        },
      },
    }),
  });
  const uuid = profile.data.attributes.uuid;
  writeFileSync(`${OUT_DIR}/${outFile}`, Buffer.from(profile.data.attributes.profileContent, 'base64'));
  writeFileSync(`${OUT_DIR}/${envPrefix}_NAME`, name);
  writeFileSync(`${OUT_DIR}/${envPrefix}_UUID`, uuid);
  if (GITHUB_ENV) appendFileSync(GITHUB_ENV, `${envPrefix}_NAME=${name}\n${envPrefix}_UUID=${uuid}\n`);
  console.log(`Created App Store profile "${name}" (${uuid})`);
  return uuid;
}

async function main() {
  // 1. Distribution certificate. Reuse the saved one (CERT_ID) when provided so
  //    we never create/revoke certs; otherwise create a fresh one from the CSR.
  let certId;
  if (CERT_ID) {
    certId = CERT_ID;
    console.log(`Using existing distribution certificate ${certId}`);
  } else {
    const csrContent = readFileSync(CSR_PATH, 'utf8');
    const cert = await api('/v1/certificates', {
      method: 'POST',
      body: JSON.stringify({
        data: { type: 'certificates', attributes: { certificateType: 'DISTRIBUTION', csrContent } },
      }),
    });
    certId = cert.data.id;
    writeFileSync(`${OUT_DIR}/dist.cer`, Buffer.from(cert.data.attributes.certificateContent, 'base64'));
    console.log(`Created distribution certificate ${certId}`);
  }

  // 2. App profile.
  const appBundleId = await ensureBundleId(BUNDLE_ID, 'Rally');
  await makeProfile({
    name: APP_PROFILE_NAME, bundleInternalId: appBundleId, certId,
    outFile: 'profile.mobileprovision', envPrefix: 'PROFILE',
  });

  // 3. Share Extension profile (optional).
  if (EXT_BUNDLE_ID) {
    const extBundleId = await ensureBundleId(EXT_BUNDLE_ID, 'Rally Share Extension');
    await makeProfile({
      name: EXT_PROFILE_NAME, bundleInternalId: extBundleId, certId,
      outFile: 'profile-ext.mobileprovision', envPrefix: 'EXT_PROFILE',
    });
  }
}

main().catch((err) => { console.error(err.message || err); process.exit(1); });
