// Revokes auto-managed Apple signing certificates via the App Store Connect API.
//
// Why: the iOS build uses Xcode automatic signing with -allowProvisioningUpdates,
// which creates Development/Distribution certificates on demand. GitHub's macOS
// runners are ephemeral, so each cert's private key is discarded after the run,
// leaving an orphaned cert registered to the account. Apple caps the number of
// certs per type, so after a couple of builds new ones can't be created and the
// archive fails ("private key is not installed", "No profiles were found").
//
// Running this before each build keeps the slots clear. It only touches the
// cert TYPES that automatic signing regenerates; it never deletes profiles.
// Safe here because there is no Mac doing local development against this account.
//
// Env: KEY_ID, ISSUER_ID, P8_PATH (path to the AuthKey_*.p8 private key).

import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';

const { KEY_ID, ISSUER_ID, P8_PATH } = process.env;
if (!KEY_ID || !ISSUER_ID || !P8_PATH) {
  console.error('Missing KEY_ID, ISSUER_ID, or P8_PATH');
  process.exit(1);
}

const REVOKE_TYPES = new Set([
  'DEVELOPMENT', 'DISTRIBUTION',
  'IOS_DEVELOPMENT', 'IOS_DISTRIBUTION',
]);

const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');

function makeToken() {
  const key = readFileSync(P8_PATH, 'utf8');
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'ES256', kid: KEY_ID, typ: 'JWT' };
  const payload = { iss: ISSUER_ID, iat: now, exp: now + 600, aud: 'appstoreconnect-v1' };
  const signingInput = `${b64url(header)}.${b64url(payload)}`;
  // dsaEncoding 'ieee-p1363' yields the raw r||s signature JOSE/JWT requires.
  const sig = crypto
    .sign('sha256', Buffer.from(signingInput), { key, dsaEncoding: 'ieee-p1363' })
    .toString('base64url');
  return `${signingInput}.${sig}`;
}

async function main() {
  const token = makeToken();
  const auth = { Authorization: `Bearer ${token}` };

  const res = await fetch('https://api.appstoreconnect.apple.com/v1/certificates?limit=200', { headers: auth });
  if (!res.ok) {
    console.error(`List certificates failed: ${res.status} ${await res.text()}`);
    process.exit(1);
  }
  const { data = [] } = await res.json();
  console.log(`Found ${data.length} certificate(s) on the account.`);

  let revoked = 0;
  for (const cert of data) {
    const type = cert.attributes?.certificateType;
    const name = cert.attributes?.displayName || '';
    if (!REVOKE_TYPES.has(type)) {
      console.log(`  keep   ${type} — ${name}`);
      continue;
    }
    const del = await fetch(`https://api.appstoreconnect.apple.com/v1/certificates/${cert.id}`, {
      method: 'DELETE',
      headers: auth,
    });
    if (del.ok || del.status === 204) {
      console.log(`  revoke ${type} — ${name} (${cert.id})`);
      revoked++;
    } else {
      console.log(`  FAILED ${type} — ${name}: ${del.status} ${await del.text()}`);
    }
  }
  console.log(`Revoked ${revoked} certificate(s).`);
}

main().catch((err) => { console.error(err); process.exit(1); });
