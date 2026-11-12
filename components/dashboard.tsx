'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertCircle,
  ArrowDownToLine,
  ArrowRight,
  Check,
  ChevronDown,
  CircleHelp,
  Clipboard,
  Clock3,
  Database,
  Download,
  ExternalLink,
  FileJson,
  FileSpreadsheet,
  FileText,
  Filter,
  Globe2,
  LayoutDashboard,
  ListChecks,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  Menu,
  MessageCircle,
  MessagesSquare,
  Pause,
  Play,
  PlugZap,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Square,
  X,
} from 'lucide-react';
import PostPicker from '@/components/post-picker';
import TokenGate from '@/components/token-gate';
import { api, useScraper } from '@/hooks/use-scraper';
import { usePostSelection } from '@/hooks/use-post-selection';
import { exportData } from '@/lib/export';
import { clearSessionToken, readSessionToken, writeSessionToken } from '@/lib/session-token';
import type { Page } from '@/lib/types';

type Section = 'Overview' | 'New Scraper' | 'Results' | 'Export Center' | 'API Information';
const nav: { label: Section; icon: typeof LayoutDashboard }[] = [
  { label: 'Overview', icon: LayoutDashboard },
  { label: 'New Scraper', icon: ListChecks },
  { label: 'Results', icon: MessagesSquare },
  { label: 'Export Center', icon: ArrowDownToLine },
  { label: 'API Information', icon: Settings2 },
];
const activeStates = ['Resolving Posts', 'Fetching Comments', 'Fetching Replies', 'Resuming', 'Retrying'];
const clip = (text: string, max: number) => {
  const value = text.replace(/\s+/g, ' ').trim();
  if (!value) return '';
  return value.length > max ? `${value.slice(0, max)}…` : value;
};
type Session = { token: string; identity: string; verified: boolean; notice?: string };

export default function Dashboard() {
  const [section, setSection] = useState<Section>('Overview');
  const [mobileNav, setMobileNav] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [gateNotice, setGateNotice] = useState('');
  const [pages, setPages] = useState<Page[]>([]);
  const [loadingPages, setLoadingPages] = useState(false);
  const [pageWarning, setPageWarning] = useState('');
  const connectionSerial = useRef(0);
  const [batchSize, setBatchSize] = useState(100);
  const [includeReplies, setIncludeReplies] = useState(true);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [postFilter, setPostFilter] = useState('all');
  const [sort, setSort] = useState('newest');
  const [tablePage, setTablePage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [copied, setCopied] = useState('');
  const [exportFilter, setExportFilter] = useState('all');
  const [exporting, setExporting] = useState('');
  const [exportError, setExportError] = useState('');
  const scraper = useScraper();
  const picker = usePostSelection(session?.token ?? '');
  const { records, status, batches, current, targets, origin } = scraper;
  const busy = activeStates.includes(status);
  const identity = session?.identity ?? '';
  const parentCount = records.filter(record => !record.reply_to_id).length;
  const replyCount = records.length - parentCount;
  const selectedCount = picker.plan.inputs.length;

  // Restore a token kept for this browser tab and validate it. The token screen is
  // rendered meanwhile, so a reload never flashes an empty dashboard.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // Read storage after the effect body so no state is set during the render pass.
      await Promise.resolve();
      const stored = readSessionToken();
      if (!stored) return;
      try {
        const user = await api('validate', { token: stored });
        // A token entered or cleared while this request was in flight wins.
        if (cancelled || readSessionToken() !== stored) return;
        setLoadingPages(true);
        const verified = user?.verified !== false;
        setSession({
          token: stored,
          identity: verified ? (typeof user.name === 'string' && user.name ? user.name : typeof user.id === 'string' ? user.id : 'Connected') : 'Token not verified',
          verified,
          notice: verified ? undefined : (typeof user.notice === 'string' ? user.notice : undefined),
        });
      } catch (e) {
        if (readSessionToken() !== stored) return;
        clearSessionToken();
        if (!cancelled) setGateNotice((e as Error).message || 'Your saved token is no longer valid. Enter a new one.');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Listing Pages is best-effort: a Page token may not support it, and post links
  // or IDs can still be pasted in the picker.
  useEffect(() => {
    if (!session) return;
    const serial = ++connectionSerial.current;
    void (async () => {
      try {
        const found: Page[] = []; let cursor: string | null = null; const seen = new Set<string>();
        do {
          const data = await api('pages', { token: session.token, cursor });
          if (serial !== connectionSerial.current) return;
          found.push(...(Array.isArray(data.pages) ? data.pages as Page[] : []));
          cursor = typeof data.nextCursor === 'string' ? data.nextCursor : null;
          if (cursor && seen.has(cursor)) throw new Error('Page list pagination repeated a cursor.');
          if (cursor) seen.add(cursor);
          if (seen.size > 100) throw new Error('Page list exceeded the safety limit.');
        } while (cursor);
        if (serial !== connectionSerial.current) return;
        const unique = Array.from(new Map(found.map(page => [page.id, page])).values());
        setPages(unique);
        if (!unique.length) setPageWarning('No Pages were listed. Page tokens may not support listing; you can still paste post links or IDs.');
      } catch (e) {
        if (serial !== connectionSerial.current) return;
        const error = e as Error & { code?: string };
        // Listing Pages is optional. A Page access token cannot call /me/accounts at all
        // (Meta answers with code 190), so this must never end the session: the same
        // token can still read every post that is pasted or picked. Only the validation
        // call decides whether a token is usable.
        setPageWarning(error.code === 'TOKEN'
          ? 'This token cannot list Pages — Page access tokens may not use /me/accounts. Nothing is wrong with the token itself; paste post links or IDs to continue with this Page.'
          : 'Could not list Pages with this token. You can still paste post links or IDs with a suitable Page token.');
      } finally {
        if (serial === connectionSerial.current) setLoadingPages(false);
      }
    })();
  }, [session]);

  const connect = (token: string, name: string, options?: { verified: boolean; notice?: string }) => {
    writeSessionToken(token);
    setGateNotice('');
    setSection('Overview');
    setPages([]); setPageWarning(''); setLoadingPages(true); setPostFilter('all'); setTablePage(1);
    setSession({ token, identity: name, verified: options?.verified ?? true, notice: options?.notice });
  };
  const disconnect = () => {
    ++connectionSerial.current;
    clearSessionToken();
    scraper.reset();
    setPages([]);
    setPageWarning('');
    setLoadingPages(false);
    setSession(null);
    setSection('Overview');
  };
  const results = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return records
      .filter(record =>
        (filter === 'all' || (filter === 'parents' ? !record.reply_to_id : !!record.reply_to_id)) &&
        (postFilter === 'all' || origin[record.id] === postFilter) &&
        (!needle || [record.author, record.text, record.id, record.author_id].some(value => value.toLocaleLowerCase().includes(needle))))
      .sort((a, b) => sort === 'likes' ? b.likes - a.likes : sort === 'oldest' ? a.created_at.localeCompare(b.created_at) : b.created_at.localeCompare(a.created_at));
  }, [records, query, filter, postFilter, origin, sort]);
  const pagesCount = Math.max(1, Math.ceil(results.length / pageSize));
  const currentPage = Math.min(tablePage, pagesCount);
  const visible = results.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const targetById = useMemo(() => new Map(targets.map(target => [target.id, target])), [targets]);
  const postName = useCallback((postId: string) => {
    const target = targetById.get(postId);
    if (!target) return '—';
    return clip(target.message, 40) || `Post ${target.id}`;
  }, [targetById]);
  const exportRows = records.filter(record => exportFilter === 'all' || (exportFilter === 'parents' ? !record.reply_to_id : !!record.reply_to_id));
  const doExport = async (format: 'json' | 'csv' | 'xlsx') => {
    setExportError(''); setExporting(format);
    try {
      await new Promise(resolve => setTimeout(resolve, 30));
      await exportData(exportRows, format);
    } catch {
      setExportError('Export failed. Try a smaller selection or another format.');
    } finally { setExporting(''); }
  };
  const go = (next: Section) => { setSection(next); setMobileNav(false); };
  const start = () => {
    if (!session || !selectedCount || busy || status === 'Paused') return;
    setPostFilter('all'); setTablePage(1);
    void scraper.start(session.token, picker.plan.inputs, batchSize, includeReplies);
  };

  if (!session) return <TokenGate onConnect={connect} notice={gateNotice}/>;

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileNav ? 'mobile-open' : ''}`}>
        <div className="brand">
          <div className="brand-icon"><MessagesSquare size={20}/></div>
          <div><strong>threadline</strong><span>COMMENT WORKSPACE</span></div>
          <button className="mobile-close icon-button" onClick={() => setMobileNav(false)} aria-label="Close menu"><X size={18}/></button>
        </div>
        <div className="workspace">
          <div className="workspace-icon">T</div>
          <div><strong>My workspace</strong><span>Personal workspace</span></div>
          <ChevronDown size={15}/>
        </div>
        <div className="nav-label">WORKSPACE</div>
        <nav>
          {nav.map(({ label, icon: Icon }) => (
            <button key={label} className={`nav-item ${section === label ? 'active' : ''}`} onClick={() => go(label)}>
              <Icon size={18}/><span>{label}</span>
              {label === 'Results' && records.length > 0 && <small>{records.length.toLocaleString()}</small>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="privacy-icon"><ShieldCheck size={18}/></div>
          <div>
            <strong>Private by design</strong>
            <p>Your data stays in this browser session.</p>
            <button onClick={() => go('API Information')}>Learn more <ArrowRight size={12}/></button>
          </div>
        </div>
        <div className="sidebar-footer">
          <div className="avatar">{identity.charAt(0).toUpperCase() || 'T'}</div>
          <div><strong>{identity || 'My workspace'}</strong><span>Session only</span></div>
          <span className="online-dot"/>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <button className="mobile-menu icon-button" onClick={() => setMobileNav(true)} aria-label="Open menu"><Menu size={20}/></button>
          <div className="breadcrumbs"><span>Workspace</span><span className="slash">/</span><strong>{section}</strong></div>
          <div className="top-actions">
            <span className="session-pill"><span className="green-dot"/> Session only</span>
            <button className="help-button" onClick={() => go('API Information')} aria-label="API information"><CircleHelp size={19}/></button>
            <div className="top-avatar" title={identity}>{identity.charAt(0).toUpperCase() || 'T'}</div>
          </div>
        </header>
        <div className="content">
          {section === 'Overview' && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow"><span className="eyebrow-dot"/> YOUR WORKSPACE</div>
                  <h1>Overview</h1>
                  <p>A little clarity for every conversation.</p>
                </div>
                <button className="btn primary" onClick={() => go('New Scraper')}><span>+</span> New scraper</button>
              </div>
              <div className="welcome-banner">
                <div className="banner-copy">
                  <div className="banner-kicker"><span className="sparkle">✳</span> YOUR CONVERSATIONS, IN ONE PLACE</div>
                  <h2>Get more from your<br/>Facebook conversations.</h2>
                  <p>Select several Pages and posts, collect their comments and replies together, then export the combined result.</p>
                  <button onClick={() => go('New Scraper')}>Get started <ArrowRight size={16}/></button>
                </div>
                <div className="banner-art" aria-hidden="true">
                  <div className="art-ring ring-one"/>
                  <div className="art-ring ring-two"/>
                  <div className="art-card art-back">
                    <div className="art-avatar purple"/>
                    <div className="art-lines"><i/><i/></div>
                    <div className="art-bubble tiny"><MessageCircle size={14}/></div>
                  </div>
                  <div className="art-card art-front">
                    <div className="art-avatar blue"/>
                    <div className="art-lines"><i/><i/><i/></div>
                    <div className="art-heart">♥</div>
                  </div>
                  <div className="art-float"><MessagesSquare size={22}/></div>
                  <div className="art-dot dot-one"/><div className="art-dot dot-two"/><div className="art-dot dot-three"/>
                </div>
              </div>
              <div className="section-heading">
                <div><h2>At a glance</h2><p>Your current session, summed up.</p></div>
                <span className="live-label"><span className="green-dot"/> LIVE SESSION</span>
              </div>
              <div className="stats-grid">
                <Stat icon={MessageCircle} color="blue" label="Total comments" value={parentCount} note="Parent comments collected"/>
                <Stat icon={MessagesSquare} color="purple" label="Total replies" value={replyCount} note="Replies collected"/>
                <Stat icon={Database} color="orange" label="Total records" value={records.length} note="Comments and replies"/>
                <Stat icon={Activity} color="green" label="Scraper status" value={status} note={batches ? `${batches} batches completed` : 'No active scrape'} text/>
              </div>
              <div className="overview-grid">
                <div className="panel connection-panel">
                  <div className="panel-header">
                    <div><h3>Connection</h3><p>Your Facebook connection details.</p></div>
                    <div className={`status-badge ${session.verified ? 'success' : ''}`}><span className={session.verified ? 'green-dot' : 'gray-dot'}/> {session.verified ? 'Connected' : 'Connected · unverified'}</div>
                  </div>
                  <div className="connection-body">
                    <div className="facebook-mark">f</div>
                    <div>
                      <strong>{identity}</strong>
                      <p>Token validated for this session</p>
                    </div>
                    <button className="btn secondary small" onClick={() => go('New Scraper')}>Manage <ArrowRight size={14}/></button>
                  </div>
                  <div className="detail-row"><span>Pages listed</span><strong>{loadingPages ? 'Loading…' : pages.length ? pages.length : pageWarning ? 'Unavailable' : 0}</strong></div>
                  <div className="detail-row"><span>Posts selected</span><strong>{selectedCount}</strong></div>
                  <div className="detail-row"><span>Token type</span><strong>Not determined</strong></div>
                  <div className="detail-row"><span>Token check</span><strong>{session.verified ? 'Confirmed by /me' : 'Not confirmed by /me'}</strong></div>
                </div>
                <div className="panel activity-panel">
                  <div className="panel-header">
                    <div><h3>Current activity</h3><p>Updates from this session.</p></div>
                    <Clock3 size={18} className="muted-icon"/>
                  </div>
                  {records.length || status !== 'Ready' ? (
                    <div className="activity-content">
                      <div className="activity-symbol"><Activity size={19}/></div>
                      <strong>{status}</strong>
                      <p>{current}</p>
                      <span>{batches} batches · {records.length.toLocaleString()} records</span>
                    </div>
                  ) : (
                    <div className="empty-activity">
                      <div className="empty-icon"><Activity size={20}/></div>
                      <strong>Nothing here yet</strong>
                      <p>Once you start a scraper, your<br/>activity will show up here.</p>
                    </div>
                  )}
                </div>
              </div>
              <div className="bottom-note">
                <ShieldCheck size={16}/>
                <span><strong>Your privacy matters.</strong> The token and results stay in this browser tab and disappear when you close it.</span>
                <button onClick={() => go('API Information')}>Learn more <ArrowRight size={14}/></button>
              </div>
            </>
          )}
          {section === 'New Scraper' && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow"><span className="eyebrow-dot"/> COLLECT CONVERSATIONS</div>
                  <h1>New scraper</h1>
                  <p>Choose one or more Pages, pick their posts, and collect every comment in one run.</p>
                </div>
              </div>
              <div className="form-layout">
                <div className="form-main">
                  <div className="panel">
                    <div className="step-header">
                      <span className="step-number">01</span>
                      <div><h3>Connected account</h3><p>Your access token was validated before the dashboard opened.</p></div>
                      <span className={`status-badge ${session.verified ? 'success' : ''}`}><span className={session.verified ? 'green-dot' : 'gray-dot'}/> {session.verified ? 'Connected' : 'Connected · unverified'}</span>
                    </div>
                    <div className="form-body">
                      <div className="account-row">
                        <div className="facebook-mark">f</div>
                        <div><strong>{identity}</strong><span>Token kept in this browser tab · type not determined</span></div>
                        <button className="btn secondary small" onClick={disconnect} disabled={busy}><LogOut size={14}/> Disconnect</button>
                      </div>
                      {!session.verified && (
                        <div className="alert warning">
                          <AlertCircle size={16}/>
                          <span>
                            <strong>Meta did not confirm this token on /me.</strong> {session.notice} Page and System User tokens often work only on Page and post endpoints, so the first request will confirm access; Page listing may stay unavailable, in which case paste post links or IDs.
                          </span>
                        </div>
                      )}
                      <p className="helper">Pages, posts and comments are read with this token. To use a different token, disconnect and enter a new one.</p>
                    </div>
                  </div>
                  <div className="panel">
                    <div className="step-header">
                      <span className="step-number">02</span>
                      <div><h3>Choose Pages and posts</h3><p>Select as many posts as you need; they are scraped together.</p></div>
                      <span className="status-badge"><span className={selectedCount ? 'green-dot' : 'gray-dot'}/>{selectedCount} selected</span>
                    </div>
                    <div className="form-body">
                      <PostPicker picker={picker} pages={pages} pageWarning={pageWarning} disabled={busy}/>
                      <div className="settings-row">
                        <div>
                          <label htmlFor="batch">Batch size</label>
                          <div className="select-wrap batch-select">
                            <select id="batch" value={batchSize} onChange={event => setBatchSize(Number(event.target.value))} disabled={busy}>
                              <option value={25}>25 records</option>
                              <option value={50}>50 records</option>
                              <option value={100}>100 records</option>
                            </select>
                            <ChevronDown size={16}/>
                          </div>
                        </div>
                        <label className="toggle-label">
                          <span><strong>Include replies</strong><small>Fetch replies separately</small></span>
                          <input type="checkbox" checked={includeReplies} onChange={event => setIncludeReplies(event.target.checked)} disabled={busy}/>
                          <span className="toggle"/>
                        </label>
                      </div>
                      <p className="helper">A batch of 100 reads up to 100 comments per request, so 1,000–2,000 comments need roughly 10–20 requests per post. Keep this tab open.</p>
                      <div className="form-divider"/>
                      <div className="button-row">
                        <button className="btn primary" disabled={!selectedCount || busy || status === 'Paused'} onClick={start}>
                          <Play size={15} fill="currentColor"/> Start scraping{selectedCount > 1 ? ` ${selectedCount} posts` : ''}
                        </button>
                        <span className="helper inline">
                          {selectedCount ? `${selectedIdleLabel(picker.summary.posts, picker.summary.manual)} selected. Only accessible comments are collected.` : 'Select at least one post to start.'}
                        </span>
                      </div>
                    </div>
                  </div>
                  <Progress scraper={scraper}/>
                </div>
                <div className="form-aside">
                  <div className="panel tips-panel">
                    <div className="tips-icon"><ShieldCheck size={20}/></div>
                    <h3>Before you start</h3>
                    <p>Make sure your token can read every Page and post you select.</p>
                    <ul>
                      <li><Check size={15}/> Use an authorized Page access token</li>
                      <li><Check size={15}/> Keep this tab open during scraping</li>
                      <li><Check size={15}/> Export results before leaving</li>
                    </ul>
                    <button className="text-link" onClick={() => go('API Information')}>View API requirements <ArrowRight size={14}/></button>
                  </div>
                  <div className="aside-note">
                    <CircleHelp size={17}/>
                    <p>Meta controls which comments and fields are available to your token. A post that cannot be read is skipped; the others still finish.</p>
                  </div>
                </div>
              </div>
            </>
          )}
          {section === 'Results' && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow"><span className="eyebrow-dot"/> YOUR DATA</div>
                  <h1>Results</h1>
                  <p>Explore the conversations collected in this session.</p>
                </div>
                <button className="btn secondary" onClick={() => go('Export Center')}><Download size={16}/> Export results</button>
              </div>
              <div className="results-summary">
                <div><strong>{records.length.toLocaleString()}</strong><span>Total records</span></div>
                <div><strong>{parentCount.toLocaleString()}</strong><span>Comments</span></div>
                <div><strong>{replyCount.toLocaleString()}</strong><span>Replies</span></div>
                <div><strong>{status}</strong><span>Scrape status</span></div>
              </div>
              <div className="panel results-panel">
                <div className="panel-header">
                  <div><h3>All conversations</h3><p>{results.length.toLocaleString()} matching records · session only</p></div>
                </div>
                <div className="table-tools">
                  <div className="search-wrap">
                    <Search size={16}/>
                    <input placeholder="Search comments, authors or IDs..." value={query} onChange={event => { setQuery(event.target.value); setTablePage(1); }}/>
                  </div>
                  <div className="select-wrap tool-select">
                    <Filter size={15}/>
                    <select aria-label="Filter records" value={filter} onChange={event => { setFilter(event.target.value); setTablePage(1); }}>
                      <option value="all">All records</option>
                      <option value="parents">Comments only</option>
                      <option value="replies">Replies only</option>
                    </select>
                    <ChevronDown size={14}/>
                  </div>
                  {targets.length > 0 && (
                    <div className="select-wrap tool-select">
                      <select aria-label="Filter by post" value={postFilter} onChange={event => { setPostFilter(event.target.value); setTablePage(1); }}>
                        <option value="all">All posts</option>
                        {targets.map((target, index) => <option key={target.id} value={target.id}>{`Post ${index + 1}: ${clip(target.message, 26) || target.id}`}</option>)}
                      </select>
                      <ChevronDown size={14}/>
                    </div>
                  )}
                  <div className="select-wrap tool-select">
                    <select aria-label="Rows per page" value={pageSize} onChange={event => { setPageSize(Number(event.target.value)); setTablePage(1); }}>
                      <option value={10}>10 rows</option>
                      <option value={25}>25 rows</option>
                      <option value={50}>50 rows</option>
                      <option value={100}>100 rows</option>
                    </select>
                    <ChevronDown size={14}/>
                  </div>
                  <div className="select-wrap tool-select">
                    <select aria-label="Sort records" value={sort} onChange={event => setSort(event.target.value)}>
                      <option value="newest">Newest first</option>
                      <option value="oldest">Oldest first</option>
                      <option value="likes">Most liked</option>
                    </select>
                    <ChevronDown size={14}/>
                  </div>
                </div>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>AUTHOR</th><th>COMMENT</th><th>DATE</th><th>LIKES</th><th>REPLIES</th><th>COMMENT ID</th><th>REPLY TO ID</th><th>AUTHOR ID</th><th>POST</th><th>TYPE</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visible.map(record => (
                        <tr key={record.id}>
                          <td><strong>{record.author || 'Unavailable'}</strong></td>
                          <td className="comment-cell">
                            <button className="comment-text" onClick={() => setExpanded(expanded === record.id ? null : record.id)}>
                              {expanded === record.id ? record.text : (record.text.length > 110 ? `${record.text.slice(0, 110)}…` : record.text) || '—'}
                            </button>
                          </td>
                          <td>{record.created_at ? new Date(record.created_at).toLocaleString() : '—'}</td>
                          <td>{record.likes}</td>
                          <td>{record.replies}</td>
                          <td>
                            <button className="copy-id" onClick={() => { void navigator.clipboard.writeText(record.id).then(() => { setCopied(record.id); setTimeout(() => setCopied(''), 1500); }); }} title="Copy ID">
                              {record.id} {copied === record.id ? <Check size={13}/> : <Clipboard size={13}/>}
                            </button>
                          </td>
                          <td>{record.reply_to_id || '—'}</td>
                          <td>{record.author_id || '—'}</td>
                          <td className="post-cell">{postName(origin[record.id] || '')}</td>
                          <td><span className="type-badge">{record.reply_to_id ? 'Reply' : 'Parent'}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!visible.length && (
                    <div className="table-empty">
                      <div className="empty-icon"><MessagesSquare size={21}/></div>
                      <strong>No conversations to show</strong>
                      <p>{records.length ? 'Try changing your search or filters.' : 'Start a scraper to see your results here.'}</p>
                    </div>
                  )}
                </div>
                <div className="table-footer">
                  <span>
                    Showing {visible.length ? `${(currentPage - 1) * pageSize + 1}–${(currentPage - 1) * pageSize + visible.length}` : '0'} of {results.length.toLocaleString()}
                  </span>
                  <div>
                    <button disabled={currentPage === 1} onClick={() => setTablePage(currentPage - 1)}>Previous</button>
                    <span>Page {currentPage} of {pagesCount}</span>
                    <button disabled={currentPage === pagesCount} onClick={() => setTablePage(currentPage + 1)}>Next</button>
                  </div>
                </div>
              </div>
              <div className="bottom-note">
                <AlertCircle size={16}/>
                <span>Unavailable fields use schema defaults. Zero reactions do not confirm that no reactions exist. The Post column is display-only; the export keeps the 20-field schema.</span>
              </div>
            </>
          )}
          {section === 'Export Center' && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow"><span className="eyebrow-dot"/> TAKE YOUR DATA WITH YOU</div>
                  <h1>Export center</h1>
                  <p>Download your results in the format that works for you.</p>
                </div>
              </div>
              <div className="export-intro panel">
                <div className="export-icon"><Download size={22}/></div>
                <div>
                  <h3>Ready when you are</h3>
                  <p>{records.length.toLocaleString()} records available in this session. {status !== 'Completed' && records.length > 0 ? 'This is a partial export.' : ''}</p>
                </div>
                <span className="status-badge">{status}</span>
              </div>
              <div className="export-options">
                <label htmlFor="export-filter">What would you like to export?</label>
                <div className="select-wrap export-select">
                  <select id="export-filter" value={exportFilter} onChange={event => setExportFilter(event.target.value)}>
                    <option value="all">All comments and replies</option>
                    <option value="parents">Parent comments only</option>
                    <option value="replies">Replies only</option>
                  </select>
                  <ChevronDown size={16}/>
                </div>
                <span>{exportRows.length.toLocaleString()} records selected</span>
              </div>
              <div className="export-grid">
                {([
                  { format: 'json', icon: FileJson, title: 'JSON', desc: 'Structured data with the exact 20-field schema.' },
                  { format: 'csv', icon: FileText, title: 'CSV', desc: 'A flexible format for spreadsheets and analysis.' },
                  { format: 'xlsx', icon: FileSpreadsheet, title: 'Excel', desc: 'A ready-to-use Microsoft Excel workbook.' },
                ] as const).map(({ format, icon: Icon, title, desc }) => (
                  <div className="panel export-card" key={format}>
                    <div className={`file-icon ${format}`}><Icon size={23}/></div>
                    <h3>{title}</h3>
                    <p>{desc}</p>
                    <button className="btn secondary" disabled={!exportRows.length || !!exporting} onClick={() => void doExport(format)}>
                      {exporting === format ? <LoaderCircle className="spin" size={16}/> : <Download size={16}/>} Download .{format}
                    </button>
                  </div>
                ))}
              </div>
              {exportError && <div className="alert error"><AlertCircle size={16}/>{exportError}</div>}
              <div className="bottom-note">
                <LockKeyhole size={16}/>
                <span>Files are generated in your browser. Export before refreshing or closing this tab.</span>
              </div>
            </>
          )}
          {section === 'API Information' && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow"><span className="eyebrow-dot"/> GOOD TO KNOW</div>
                  <h1>API information</h1>
                  <p>Understand access, privacy and the limits of your data.</p>
                </div>
              </div>
              <div className="info-grid">
                <div className="panel info-card">
                  <div className="tips-icon"><PlugZap size={20}/></div>
                  <h3>Getting an access token</h3>
                  <p>Use Meta’s Graph API Explorer to generate a user token and, where eligible, a Page token for a Page you manage. Paste the token on the entry screen; this app does not implement Facebook login.</p>
                  <a href="https://developers.facebook.com/tools/explorer/" target="_blank" rel="noreferrer">Open Graph API Explorer <ExternalLink size={14}/></a>
                </div>
                <div className="panel info-card">
                  <div className="tips-icon"><ShieldCheck size={20}/></div>
                  <h3>Permissions & access</h3>
                  <p>Page listing generally requires <code>pages_show_list</code>. Reading Page engagement and user content may require <code>pages_read_engagement</code> and <code>pages_read_user_content</code>, an appropriate Page role, app review and a Page access token. Access varies by app and object.</p>
                  <a href="https://developers.facebook.com/docs/graph-api/reference/object/comments/" target="_blank" rel="noreferrer">Meta comments documentation <ExternalLink size={14}/></a>
                </div>
                <div className="panel info-card">
                  <div className="tips-icon"><Globe2 size={20}/></div>
                  <h3>Multiple Pages and posts</h3>
                  <p>Selecting posts only lists them; nothing is read until you start. Each selected post is validated and scraped in one queue, and its comments and replies are de-duplicated across the run. A post your token cannot read is skipped and reported.</p>
                </div>
                <div className="panel info-card">
                  <div className="tips-icon"><LockKeyhole size={20}/></div>
                  <h3>Private, temporary sessions</h3>
                  <p>No database, accounts or persistent history. The token is kept in this tab’s session storage, so closing the tab or clicking Disconnect clears it. Results live in memory and scraping does not continue in the background.</p>
                </div>
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}

const selectedIdleLabel = (posts: number, manual: number) => {
  const parts: string[] = [];
  if (posts) parts.push(`${posts} from Pages`);
  if (manual) parts.push(`${manual} pasted`);
  return parts.join(' · ') || '0 posts';
};

function Stat({ icon: Icon, color, label, value, note, text = false }: { icon: typeof Activity; color: string; label: string; value: number | string; note: string; text?: boolean }) {
  return (
    <div className="panel stat">
      <div className="stat-top"><span>{label}</span><div className={`stat-icon ${color}`}><Icon size={18}/></div></div>
      <strong className={text ? 'status-value' : ''}>{value}</strong>
      <p>{note}</p>
    </div>
  );
}

function Progress({ scraper }: { scraper: ReturnType<typeof useScraper> }) {
  const { status, records, batches, error, current, targets, skipped, origin, retryable, pause, resume, stop } = scraper;
  const busy = activeStates.includes(status);
  const counts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const record of records) {
      const postId = origin[record.id];
      if (postId) map[postId] = (map[postId] ?? 0) + 1;
    }
    return map;
  }, [records, origin]);
  return (
    <div className="panel progress-panel">
      <div className="panel-header">
        <div><h3>Scraping progress</h3><p>Live updates from the current session.</p></div>
        <span className={`status-badge ${status === 'Completed' ? 'success' : ''}`}><span className={busy ? 'green-dot' : 'gray-dot'}/>{status}</span>
      </div>
      <div className="progress-body">
        {targets.length > 0 && (
          <div className="target-list">
            {targets.map((target, index) => (
              <div className="target-item" key={target.id}>
                <span className="target-index">{index + 1}</span>
                <div><strong>{clip(target.message, 70) || `Post ${target.id}`}</strong><small>{target.id}</small></div>
                <span className="count-badge">{(counts[target.id] ?? 0).toLocaleString()}</span>
              </div>
            ))}
          </div>
        )}
        {skipped.length > 0 && (
          <div className="alert warning">
            <AlertCircle size={16}/>
            <span>
              {skipped.length} post{skipped.length === 1 ? '' : 's'} could not be resolved:{' '}
              {skipped.slice(0, 2).map(item => `${clip(item.input, 40)} — ${item.error}`).join(' ')}{skipped.length > 2 ? ' …' : ''}
            </span>
          </div>
        )}
        <div className="progress-track"><div className={busy ? 'indeterminate' : ''}/></div>
        <div className="progress-meta">
          <span>{current}</span>
          <strong>{batches} batches · {records.length.toLocaleString()} records</strong>
        </div>
        {error && <div className="alert error"><AlertCircle size={16}/><span>{error}</span></div>}
        {busy && status !== 'Resolving Posts' && (
          <div className="alert info"><AlertCircle size={16}/><span>Keep this tab open. Batches run one at a time across every selected post.</span></div>
        )}
        {['Partially Completed', 'Failed', 'Stopped'].includes(status) && records.length > 0 && (
          <div className="alert warning"><AlertCircle size={16}/><span>The scrape is incomplete. Retrieved records remain available for export.</span></div>
        )}
        <div className="button-row">
          {busy && status !== 'Resolving Posts' && (
            <button className="btn secondary small" onClick={pause}><Pause size={14}/> Pause</button>
          )}
          {!busy && (status === 'Paused' || retryable) && (
            <button className="btn secondary small" onClick={resume}><RefreshCw size={14}/> {status === 'Paused' ? 'Resume' : 'Retry failed batches'}</button>
          )}
          {(busy || status === 'Paused' || retryable) && (
            <button className="btn secondary small" onClick={stop}><Square size={13}/> Stop</button>
          )}
        </div>
      </div>
    </div>
  );
}
