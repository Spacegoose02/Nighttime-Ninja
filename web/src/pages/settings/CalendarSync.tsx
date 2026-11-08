import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../api.ts';
import { useApp, useLoad } from '../../state.tsx';
import { useDialogs } from '../../components/Dialog.tsx';
import { t } from '../../i18n.ts';

interface Status { available: boolean; connected: boolean; by: string | null; lastSync: string | null; error: string | null; calendarUrl: string | null }

/** What happened on the way back from Google. */
function resultText(result: string): string {
  if (result === 'connected') return t('Google Calendar is connected. Your meals are on their way.');
  if (result === 'cancelled') return t('Google Calendar was not connected.');
  if (result === 'expired') return t('That took too long. Try connecting again.');
  return t("Google Calendar couldn't be connected. Try again.");
}

/** Two-way sync with a Google calendar of its own, for home managers to connect. */
export function CalendarSync({ isManager }: { isManager: boolean }) {
  const { base, toast } = useApp();
  const dialogs = useDialogs();
  const [status, reload] = useLoad<Status>(`${base}/gcal`);
  const [params, setParams] = useSearchParams();
  const [busy, setBusy] = useState(false);

  // Coming back from Google.
  useEffect(() => {
    const result = params.get('calendar');
    if (!result) return;
    toast(resultText(result));
    params.delete('calendar');
    setParams(params, { replace: true });
    void reload();
  }, [params, setParams, toast, reload]);

  if (!status?.available) return null;
  const syncNow = async () => {
    setBusy(true);
    try { await api(`${base}/gcal/sync`, { body: {} }); toast(t('Synced')); } catch (err) { toast((err as Error).message); }
    setBusy(false);
    await reload();
  };

  if (!status.connected) {
    return (
      <div className="stack">
        <p className="small muted" style={{ margin: 0 }}>{t('Or connect Google Calendar both ways: move or delete a meal in the calendar and the plan follows, and events you add there join the plan. It gets a calendar of its own and can’t see your others.')}</p>
        {isManager
          ? <div><a className="btn" href={`${base}/gcal/connect`}>{t('Connect Google Calendar')}</a></div>
          : <p className="small muted" style={{ margin: 0 }}>{t('A home manager can connect it.')}</p>}
      </div>
    );
  }
  return (
    <div className="stack">
      <p style={{ margin: 0 }}>
        ✅ {t('Syncing both ways with Google Calendar')}{status.by ? ` (${status.by})` : ''}.{' '}
        <span className="small muted">{status.lastSync ? `${t('Last synced')} ${new Date(`${status.lastSync.replace(' ', 'T')}Z`).toLocaleString()}` : t('Not synced yet')}</span>
      </p>
      {status.error && <p className="small" role="alert" style={{ margin: 0, color: 'var(--danger)' }}>{status.error}</p>}
      <div className="row">
        {status.calendarUrl && <a className="btn" href={status.calendarUrl} target="_blank" rel="noreferrer">{t('Open in Google Calendar')}</a>}
        <button disabled={busy} onClick={syncNow}>{busy ? t('Syncing…') : t('Sync now')}</button>
        {isManager && (
          <button className="ghost danger" onClick={async () => {
            if (!(await dialogs.confirm(t('Stop syncing with Google Calendar? The calendar stays in Google with what it has now.'), { okLabel: t('Disconnect'), danger: true }))) return;
            await api(`${base}/gcal`, { method: 'DELETE' });
            await reload();
          }}>{t('Disconnect')}</button>
        )}
      </div>
    </div>
  );
}
