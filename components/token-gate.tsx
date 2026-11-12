'use client';
import { useState } from 'react';
import { AlertCircle, ArrowRight, Eye, EyeOff, LoaderCircle, LockKeyhole, MessagesSquare, PlugZap } from 'lucide-react';
import { api } from '@/hooks/use-scraper';

export type TokenGateOptions = { verified:boolean; notice?:string };
type Pending = { token:string; notice:string };

/**
 * Entry screen. The app has no Facebook login: the workspace opens after an access
 * token has been checked. `/me` is advisory, because Page and System User tokens are
 * often rejected there while still working for Page and post endpoints.
 */
export default function TokenGate({ onConnect, notice }: { onConnect:(token:string, identity:string, options?:TokenGateOptions)=>void; notice?:string }) {
  const [token,setToken] = useState('');
  const [show,setShow] = useState(false);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  const [pending,setPending] = useState<Pending|null>(null);
  const message = error || notice || '';
  const submit = async (event:React.FormEvent) => {
    event.preventDefault();
    const value = token.trim();
    if (!value || busy) return;
    setBusy(true); setError(''); setPending(null);
    try {
      const user = await api('validate',{token:value});
      if (user?.verified === false) {
        setPending({token:value, notice: typeof user.notice === 'string' && user.notice ? user.notice : 'Meta did not accept this token on /me.'});
        return;
      }
      if (typeof user?.id !== 'string' || !user.id) throw new Error('Meta did not return a valid identity for this token.');
      onConnect(value,typeof user.name === 'string' && user.name ? user.name : user.id,{verified:true});
    } catch (e) {
      setError((e as Error).message || 'The token could not be validated.');
    } finally { setBusy(false); }
  };
  return (
    <div className="gate">
      <div className="gate-shell">
        <div className="gate-brand">
          <div className="brand-icon"><MessagesSquare size={20}/></div>
          <div><strong>threadline</strong><span>COMMENT WORKSPACE</span></div>
        </div>
        <form className="gate-card" onSubmit={submit}>
          <div className="eyebrow"><span className="eyebrow-dot"/> ACCESS TOKEN REQUIRED</div>
          <h1>Open your workspace</h1>
          <p className="gate-lead">Enter a Facebook access token to unlock the dashboard. There is no Facebook login here: the app never asks for a password, cookie or verification code.</p>
          <label htmlFor="gate-token">Access token</label>
          <div className="token-wrap">
            <textarea
              id="gate-token"
              className={show ? '' : 'masked'}
              value={token}
              onChange={event => setToken(event.target.value)}
              placeholder="Paste your user or Page access token"
              autoComplete="off"
              spellCheck={false}
              disabled={busy}
            />
            <button type="button" className="reveal" onClick={() => setShow(!show)} aria-label={show ? 'Hide token' : 'Reveal token'}>
              {show ? <EyeOff size={17}/> : <Eye size={17}/>}
            </button>
          </div>
          <div className="field-help"><LockKeyhole size={13}/> Kept in this browser tab only and never saved on the server.</div>
          {message && <div className="alert error"><AlertCircle size={16}/>{message}</div>}
          {pending && (
            <div className="alert warning gate-warning">
              <AlertCircle size={16}/>
              <div>
                <strong>Meta did not confirm this token on /me.</strong>
                <p>{pending.notice}</p>
                <p>Page access tokens and Business Manager System User tokens are often valid only for Page and post endpoints, not <code>/me</code>. You can continue; the first request will confirm access.</p>
                <div className="gate-warning-actions">
                  <button type="button" className="btn primary small" onClick={() => onConnect(pending.token,'Token not verified',{verified:false,notice:pending.notice})}>
                    Continue anyway <ArrowRight size={14}/>
                  </button>
                  <button type="button" className="text-link" onClick={() => setPending(null)}>Use a different token</button>
                </div>
              </div>
            </div>
          )}
          <button className="btn primary gate-submit" type="submit" disabled={!token.trim() || busy}>
            {busy ? <LoaderCircle className="spin" size={16}/> : <PlugZap size={16}/>}
            {busy ? 'Validating…' : 'Open dashboard'} <ArrowRight size={15}/>
          </button>
          <div className="gate-features">
            <div><strong>Multiple Pages</strong><span>Select several Pages and their posts.</span></div>
            <div><strong>1,000–2,000+ comments</strong><span>One queue across every selected post.</span></div>
            <div><strong>Session only</strong><span>No accounts, database or history.</span></div>
          </div>
          <div className="gate-foot">
            <span>Uses the official Graph API. No browser automation.</span>
            <a href="https://developers.facebook.com/tools/explorer/" target="_blank" rel="noreferrer">Get a token <ArrowRight size={13}/></a>
          </div>
        </form>
        <p className="gate-note">Closing this tab or clicking Disconnect clears the token. Export your results before you leave.</p>
      </div>
    </div>
  );
}
