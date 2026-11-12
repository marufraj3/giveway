'use client';
import { useMemo, useState } from 'react';
import { AlertCircle, Check, Layers, LoaderCircle, RefreshCw, Search, X } from 'lucide-react';
import type { PostSelection } from '@/hooks/use-post-selection';
import type { Page } from '@/lib/types';

const clip = (text:string, max:number) => {
  const value = text.replace(/\s+/g,' ').trim();
  if (!value) return '';
  return value.length > max ? `${value.slice(0,max)}…` : value;
};
const when = (iso:string) => {
  const date = new Date(iso);
  return iso && !Number.isNaN(date.valueOf()) ? date.toLocaleDateString(undefined,{day:'numeric',month:'short',year:'numeric'}) : 'Date unavailable';
};
const commentCount = (count:number|null) => count === null ? 'comment count unavailable' : `${count.toLocaleString()} comment${count === 1 ? '' : 's'}`;

/** Multi-Page and multi-post picker: tick Pages, tick their posts, or paste links. */
export default function PostPicker({ picker, pages, pageWarning, disabled }: { picker:PostSelection; pages:Page[]; pageWarning:string; disabled:boolean }) {
  const [pageQuery,setPageQuery] = useState('');
  const filteredPages = useMemo(() => {
    const query = pageQuery.trim().toLocaleLowerCase();
    if (!query) return pages;
    return pages.filter(page => page.name.toLocaleLowerCase().includes(query) || page.id.includes(query));
  },[pages,pageQuery]);
  const allPagesSelected = pages.length > 0 && pages.every(page => picker.selectedPages.includes(page.id));
  return (
    <>
      <div className="picker-toolbar">
        <label>Facebook Pages <span className="optional">SELECT ONE OR MORE</span></label>
        {pages.length > 0 && (
          <div className="picker-actions">
            <button type="button" className="text-link" onClick={() => (allPagesSelected ? picker.clearPages() : picker.selectAllPages(pages.map(page => page.id)))} disabled={disabled}>
              <Layers size={13}/> {allPagesSelected ? 'Clear Pages' : 'Select all Pages'}
            </button>
          </div>
        )}
      </div>
      {pages.length > 6 && (
        <div className="picker-search">
          <Search size={15}/>
          <input value={pageQuery} onChange={event => setPageQuery(event.target.value)} placeholder="Search Pages" aria-label="Search Pages" disabled={disabled}/>
        </div>
      )}
      {!pages.length ? (
        <div className="alert warning">
          <AlertCircle size={16}/>
          <span>{pageWarning || 'No Pages were listed for this token. You can still paste post links or IDs below.'}</span>
        </div>
      ) : (
        <div className="checkbox-list">
          {filteredPages.map(page => {
            const state = picker.postsByPage[page.id];
            const checked = picker.selectedPages.includes(page.id);
            return (
              <label key={page.id} className={`check-row ${checked ? 'checked' : ''}`}>
                <input type="checkbox" checked={checked} onChange={() => picker.selectPage(page.id)} disabled={disabled}/>
                <span className="check-box"><Check size={12}/></span>
                <span className="check-text"><strong>{page.name}</strong><small>Page ID {page.id}</small></span>
                <span className="check-meta">
                  {checked ? (state?.loading ? 'Loading…' : `${state?.posts.length ?? 0}${state?.cursor ? '+' : ''} posts`) : 'Select to load posts'}
                </span>
              </label>
            );
          })}
          {!filteredPages.length && <p className="helper">No Page matches “{pageQuery}”.</p>}
        </div>
      )}

      {picker.selectedPages.length > 0 && (
        <div className="post-groups">
          {picker.selectedPages.map(pageId => {
            const page = pages.find(item => item.id === pageId);
            const state = picker.postsByPage[pageId] ?? {posts:[],cursor:null,loading:false,error:''};
            const allLoadedSelected = state.posts.length > 0 && state.posts.every(post => picker.isSelected(post.id));
            return (
              <div className="post-group" key={pageId}>
                <div className="post-group-head">
                  <div><strong>{page?.name || `Page ${pageId}`}</strong><small>{state.posts.length} post{state.posts.length === 1 ? '' : 's'} loaded</small></div>
                  <div className="post-group-actions">
                    <button type="button" className="text-link" onClick={() => picker.togglePagePosts(pageId)} disabled={disabled || !state.posts.length}>
                      {allLoadedSelected ? 'Unselect loaded' : 'Select loaded'}
                    </button>
                    {state.cursor && (
                      <button type="button" className="text-link" onClick={() => void picker.loadPosts(pageId,state.cursor)} disabled={disabled || state.loading}>
                        {state.loading ? <LoaderCircle className="spin" size={13}/> : <RefreshCw size={13}/>} Load more
                      </button>
                    )}
                  </div>
                </div>
                {state.loading && !state.posts.length ? (
                  <div className="picker-loading"><LoaderCircle className="spin" size={16}/> Loading posts…</div>
                ) : state.posts.length ? (
                  <div className="checkbox-list compact">
                    {state.posts.map(post => (
                      <label key={post.id} className={`check-row post-row ${picker.isSelected(post.id) ? 'checked' : ''}`}>
                        <input type="checkbox" checked={picker.isSelected(post.id)} onChange={() => picker.togglePost(post)} disabled={disabled}/>
                        <span className="check-box"><Check size={12}/></span>
                        <span className="check-text">
                          <strong>{clip(post.message,96) || `Post ${post.id}`}</strong>
                          <small>{when(post.created_time)} · {commentCount(post.comment_count)} · {post.id}</small>
                        </span>
                      </label>
                    ))}
                  </div>
                ) : (
                  <p className="helper">No posts were returned for this Page. It may have none, or this token may not be allowed to read them.</p>
                )}
                {state.error && (
                  <div className="alert error">
                    <AlertCircle size={15}/><span>{state.error}</span>
                    <button type="button" className="text-link" onClick={() => void picker.loadPosts(pageId,state.cursor)} disabled={disabled || state.loading}>Retry</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="form-divider"/>
      <div className="picker-toolbar">
        <label htmlFor="manual-posts">Post links or IDs <span className="optional">OPTIONAL</span></label>
        <div className="picker-actions">
          <span className="helper inline">{picker.plan.inputs.length} selected</span>
          {picker.plan.inputs.length > 0 && (
            <button type="button" className="text-link" onClick={() => { picker.clearPosts(); picker.setManual(''); }} disabled={disabled}>
              <X size={12}/> Clear selection
            </button>
          )}
        </div>
      </div>
      <textarea
        id="manual-posts"
        className="manual-input"
        value={picker.manual}
        onChange={event => picker.setManual(event.target.value)}
        placeholder={'One post per line:\nhttps://www.facebook.com/share/p/…\nhttps://www.facebook.com/123/posts/456/\n123_456'}
        spellCheck={false}
        disabled={disabled}
      />
      <p className="helper">Numeric IDs, /posts/ links, story/permalink links and /share/p/ share links. Share links are resolved on the server from Facebook’s redirect; if one can’t be resolved, enter its numeric ID manually.</p>
      {picker.manualParts.invalid.length > 0 && (
        <div className="alert warning">
          <AlertCircle size={16}/>
          <span>
            {picker.manualParts.invalid.length} entr{picker.manualParts.invalid.length === 1 ? 'y is' : 'ies are'} not a supported post ID or link and will be ignored: {picker.manualParts.invalid.slice(0,3).join(', ')}{picker.manualParts.invalid.length > 3 ? '…' : ''}
          </span>
        </div>
      )}
      {picker.summary.truncated && (
        <div className="alert info">
          <AlertCircle size={16}/>
          <span>Only the first {picker.summary.max} posts are included in one scrape.</span>
        </div>
      )}
    </>
  );
}
