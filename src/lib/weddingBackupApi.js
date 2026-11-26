// The guest list's restore points, over HTTP (api/wedding-backup.js).
export async function callBackupApi(user, body) {
  const token = await user.getIdToken();
  const res = await fetch('/api/wedding-backup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json;
}
