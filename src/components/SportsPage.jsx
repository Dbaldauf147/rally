import { useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import styles from './SportsPage.module.css';

const OWNER_EMAIL = 'baldaufdan@gmail.com';

// Supported ESPN leagues. sportPath is ESPN's {sport}/{league} segment; the
// api/sports-teams proxy whitelists these exact values.
const LEAGUES = [
  { key: 'nfl', label: 'NFL', sportPath: 'football/nfl' },
  { key: 'nba', label: 'NBA', sportPath: 'basketball/nba' },
  { key: 'mlb', label: 'MLB', sportPath: 'baseball/mlb' },
  { key: 'nhl', label: 'NHL', sportPath: 'hockey/nhl' },
  { key: 'cfb', label: 'College Football', sportPath: 'football/college-football' },
  { key: 'mcbb', label: "Men's College Basketball", sportPath: 'basketball/mens-college-basketball' },
  { key: 'mls', label: 'MLS', sportPath: 'soccer/usa.1' },
  { key: 'epl', label: 'Premier League', sportPath: 'soccer/eng.1' },
];

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, h) => h);
function hourLabel(h) {
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:00 ${period}`;
}

const FREQUENCIES = [
  { key: 'daily', label: 'Every day' },
  { key: 'weekly', label: 'Weekly' },
  { key: 'monthly', label: 'Monthly' },
];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
// Cap monthly at the 28th so it fires in every month, including February.
const DAY_OF_MONTH_OPTIONS = Array.from({ length: 28 }, (_, i) => i + 1);
function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

const BROWSER_TZ = (() => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York'; }
  catch { return 'America/New_York'; }
})();

const DEFAULT_CONFIG = { enabled: false, frequency: 'daily', sendHour: 8, sendWeekday: 1, sendDayOfMonth: 1, timezone: BROWSER_TZ, teams: [] };

export function SportsPage() {
  const { user } = useAuth();
  const isOwner = user?.email === OWNER_EMAIL;

  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(true);
  const [leagueKey, setLeagueKey] = useState('nfl');
  const [leagueTeams, setLeagueTeams] = useState([]);
  const [teamsLoading, setTeamsLoading] = useState(false);
  const [teamsError, setTeamsError] = useState('');
  const [pickTeamId, setPickTeamId] = useState('');
  const [testStatus, setTestStatus] = useState(null); // 'sending' | 'sent' | 'error:msg'

  const league = useMemo(() => LEAGUES.find((l) => l.key === leagueKey) || LEAGUES[0], [leagueKey]);

  // Load saved config.
  useEffect(() => {
    if (!user) return;
    const ref = doc(db, 'users', user.uid);
    const unsub = onSnapshot(ref, (snap) => {
      const cfg = snap.exists() ? snap.data().sportsConfig : null;
      if (cfg) {
        setConfig({
          enabled: !!cfg.enabled,
          frequency: FREQUENCIES.some((f) => f.key === cfg.frequency) ? cfg.frequency : 'daily',
          sendHour: typeof cfg.sendHour === 'number' ? cfg.sendHour : 8,
          sendWeekday: typeof cfg.sendWeekday === 'number' ? cfg.sendWeekday : 1,
          sendDayOfMonth: typeof cfg.sendDayOfMonth === 'number' ? cfg.sendDayOfMonth : 1,
          timezone: cfg.timezone || BROWSER_TZ,
          teams: Array.isArray(cfg.teams) ? cfg.teams : [],
        });
      }
      setLoading(false);
    }, () => setLoading(false));
    return unsub;
  }, [user]);

  // Fetch the selected league's teams for the picker (via our CORS-safe proxy).
  useEffect(() => {
    let cancelled = false;
    setTeamsLoading(true);
    setTeamsError('');
    setLeagueTeams([]);
    setPickTeamId('');
    fetch(`/api/sports-teams?sportPath=${encodeURIComponent(league.sportPath)}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data.error) { setTeamsError(data.error); return; }
        setLeagueTeams(data.teams || []);
      })
      .catch((err) => { if (!cancelled) setTeamsError(err.message); })
      .finally(() => { if (!cancelled) setTeamsLoading(false); });
    return () => { cancelled = true; };
  }, [league.sportPath]);

  async function persist(next) {
    setConfig(next);
    if (!user) return;
    await setDoc(
      doc(db, 'users', user.uid),
      { sportsConfig: { ...next, email: user.email || '' } },
      { merge: true },
    );
  }

  function addTeam() {
    if (!pickTeamId) return;
    const t = leagueTeams.find((x) => x.teamId === pickTeamId);
    if (!t) return;
    if (config.teams.some((x) => x.leagueKey === league.key && x.teamId === t.teamId)) return;
    persist({
      ...config,
      teams: [
        ...config.teams,
        { leagueKey: league.key, leagueLabel: league.label, sportPath: league.sportPath, teamId: t.teamId, name: t.name, abbrev: t.abbrev },
      ],
    });
    setPickTeamId('');
  }

  function removeTeam(leagueK, teamId) {
    persist({ ...config, teams: config.teams.filter((x) => !(x.leagueKey === leagueK && x.teamId === teamId)) });
  }

  async function sendTest() {
    if (!user) return;
    setTestStatus('sending');
    try {
      const res = await fetch('/api/sports-digest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uid: user.uid }),
      });
      const data = await res.json();
      if (res.ok && data.sent) setTestStatus('sent');
      else setTestStatus(`error:${data.skipped || data.error || 'Could not send'}`);
    } catch (err) {
      setTestStatus(`error:${err.message}`);
    }
  }

  if (!user) return null;
  if (!isOwner) return <Navigate to="/" replace />;

  const availableTeams = leagueTeams.filter(
    (t) => !config.teams.some((x) => x.leagueKey === league.key && x.teamId === t.teamId),
  );

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Sports</h1>
          <div className={styles.subtitle}>A daily email with your teams' recent scores &amp; upcoming games.</div>
        </div>
      </div>

      {loading ? (
        <div className={styles.empty}>Loading…</div>
      ) : (
        <div className={styles.grid}>
          {/* Followed teams */}
          <section className={styles.card}>
            <h2 className={styles.cardTitle}>Your teams</h2>
            <div className={styles.addRow}>
              <select className={styles.select} value={leagueKey} onChange={(e) => setLeagueKey(e.target.value)}>
                {LEAGUES.map((l) => <option key={l.key} value={l.key}>{l.label}</option>)}
              </select>
              <select
                className={styles.select}
                value={pickTeamId}
                onChange={(e) => setPickTeamId(e.target.value)}
                disabled={teamsLoading || !!teamsError}
              >
                <option value="">{teamsLoading ? 'Loading teams…' : teamsError ? 'Failed to load' : 'Select a team…'}</option>
                {availableTeams.map((t) => <option key={t.teamId} value={t.teamId}>{t.name}</option>)}
              </select>
              <button className={styles.btnPrimary} onClick={addTeam} disabled={!pickTeamId}>Add</button>
            </div>
            {teamsError && <div className={styles.errorText}>Couldn't load teams: {teamsError}</div>}

            {config.teams.length === 0 ? (
              <div className={styles.empty}>No teams yet — add one above.</div>
            ) : (
              <ul className={styles.teamList}>
                {config.teams.map((t) => (
                  <li key={`${t.leagueKey}-${t.teamId}`} className={styles.teamItem}>
                    <span className={styles.teamName}>{t.name}</span>
                    <span className={styles.teamLeague}>{t.leagueLabel}</span>
                    <button className={styles.removeBtn} onClick={() => removeTeam(t.leagueKey, t.teamId)} title="Remove" aria-label={`Remove ${t.name}`}>×</button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Schedule + delivery */}
          <aside className={styles.card}>
            <h2 className={styles.cardTitle}>Delivery</h2>

            <label className={styles.toggleRow}>
              <input type="checkbox" checked={config.enabled} onChange={(e) => persist({ ...config, enabled: e.target.checked })} />
              <span>Email me a digest</span>
            </label>

            <label className={styles.field}>
              <span className={styles.fieldLabel}>How often</span>
              <select className={styles.select} value={config.frequency} onChange={(e) => persist({ ...config, frequency: e.target.value })}>
                {FREQUENCIES.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
              </select>
            </label>

            {config.frequency === 'weekly' && (
              <label className={styles.field}>
                <span className={styles.fieldLabel}>On</span>
                <select className={styles.select} value={config.sendWeekday} onChange={(e) => persist({ ...config, sendWeekday: parseInt(e.target.value, 10) })}>
                  {WEEKDAYS.map((d, i) => <option key={i} value={i}>{d}</option>)}
                </select>
              </label>
            )}

            {config.frequency === 'monthly' && (
              <label className={styles.field}>
                <span className={styles.fieldLabel}>On the</span>
                <select className={styles.select} value={config.sendDayOfMonth} onChange={(e) => persist({ ...config, sendDayOfMonth: parseInt(e.target.value, 10) })}>
                  {DAY_OF_MONTH_OPTIONS.map((d) => <option key={d} value={d}>{ordinal(d)}</option>)}
                </select>
              </label>
            )}

            <label className={styles.field}>
              <span className={styles.fieldLabel}>Send around</span>
              <select className={styles.select} value={config.sendHour} onChange={(e) => persist({ ...config, sendHour: parseInt(e.target.value, 10) })}>
                {HOUR_OPTIONS.map((h) => <option key={h} value={h}>{hourLabel(h)}</option>)}
              </select>
            </label>
            <div className={styles.tzNote}>Times in {config.timezone}</div>

            <p className={styles.planNote}>
              Sends to <strong>{user.email}</strong>. Your chosen frequency and day apply; on the current plan it goes out at a fixed time of day, and the exact hour takes effect once hourly scheduling is enabled.
            </p>

            <button className={styles.btn} onClick={sendTest} disabled={testStatus === 'sending' || config.teams.length === 0}>
              {testStatus === 'sending' ? 'Sending…' : 'Send test email now'}
            </button>
            {testStatus === 'sent' && <div className={styles.okText}>✓ Sent — check your inbox.</div>}
            {typeof testStatus === 'string' && testStatus.startsWith('error:') && (
              <div className={styles.errorText}>{testStatus.slice(6)}</div>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
