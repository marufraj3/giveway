'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/hooks/use-scraper';
import { extractPostId, isSharePostLink } from '@/lib/facebook';
import { MAX_POSTS_PER_SCRAPE, partitionPostInputs, planTargets } from '@/lib/scrape-plan';
import type { PagePost } from '@/lib/types';

export interface PagePostsState { posts:PagePost[]; cursor:string|null; loading:boolean; error:string }
export interface SelectionSummary { pages:number; posts:number; manual:number; invalid:number; truncated:boolean; max:number }
const emptyPage:PagePostsState = {posts:[],cursor:null,loading:false,error:''};

/**
 * Owns the multi-Page / multi-post selection so it survives switching sections.
 * Posts are loaded lazily per Page through the `pageposts` API action; nothing is
 * scraped until the user starts a scrape.
 */
export function usePostSelection(token:string) {
  const [selectedPages,setSelectedPages] = useState<string[]>([]);
  const [postsByPage,setPostsByPage] = useState<Record<string,PagePostsState>>({});
  const [selectedPosts,setSelectedPosts] = useState<Record<string,PagePost>>({});
  const [manual,setManual] = useState('');
  const requested = useRef(new Set<string>());
  useEffect(() => {
    setSelectedPages([]); setPostsByPage({}); setSelectedPosts({}); setManual('');
    requested.current.clear();
  },[token]);
  const loadPosts = useCallback(async (pageId:string, cursor:string|null) => {
    if (!token) return;
    setPostsByPage(prev => ({...prev,[pageId]:{...(prev[pageId] ?? emptyPage),loading:true,error:''}}));
    try {
      const data = await api('pageposts',{token,page:pageId,cursor});
      const incoming:PagePost[] = Array.isArray(data.posts) ? data.posts as PagePost[] : [];
      setPostsByPage(prev => {
        const current = prev[pageId] ?? emptyPage;
        const seen = new Set(current.posts.map(post => post.id));
        const posts = [...current.posts,...incoming.filter(post => post && typeof post.id === 'string' && !seen.has(post.id))];
        return {...prev,[pageId]:{posts,cursor:typeof data.nextCursor === 'string' ? data.nextCursor : null,loading:false,error:''}};
      });
    } catch (e) {
      setPostsByPage(prev => ({...prev,[pageId]:{...(prev[pageId] ?? emptyPage),loading:false,error:(e as Error).message || 'Could not load posts for this Page.'}}));
    }
  },[token]);
  // Load the first page of posts as soon as a Page is selected.
  useEffect(() => {
    for (const pageId of selectedPages) {
      if (requested.current.has(pageId)) continue;
      requested.current.add(pageId);
      void loadPosts(pageId,null);
    }
  },[selectedPages,loadPosts]);
  const selectPage = useCallback((pageId:string) => {
    setSelectedPages(prev => prev.includes(pageId) ? prev.filter(id => id !== pageId) : [...prev,pageId]);
  },[]);
  const selectAllPages = useCallback((pageIds:string[]) => setSelectedPages(Array.from(new Set(pageIds))),[]);
  const clearPages = useCallback(() => setSelectedPages([]),[]);
  const togglePost = useCallback((post:PagePost) => {
    setSelectedPosts(prev => {
      const next = {...prev};
      if (next[post.id]) delete next[post.id];
      else if (Object.keys(next).length < MAX_POSTS_PER_SCRAPE) next[post.id] = post;
      return next;
    });
  },[]);
  /** Adds every loaded post of one Page (or removes them if all are already selected). */
  const togglePagePosts = useCallback((pageId:string) => {
    setSelectedPosts(prev => {
      const loaded = postsByPage[pageId]?.posts ?? [];
      const next = {...prev};
      const allSelected = loaded.length > 0 && loaded.every(post => !!next[post.id]);
      if (allSelected) for (const post of loaded) delete next[post.id];
      else for (const post of loaded) if (Object.keys(next).length < MAX_POSTS_PER_SCRAPE) next[post.id] = post;
      return next;
    });
  },[postsByPage]);
  const clearPosts = useCallback(() => setSelectedPosts({}),[]);
  const isSelected = useCallback((postId:string) => !!selectedPosts[postId],[selectedPosts]);
  const selectedIds = useMemo(() => Object.keys(selectedPosts),[selectedPosts]);
  const manualParts = useMemo(() => partitionPostInputs(manual,value => extractPostId(value) !== null || isSharePostLink(value)),[manual]);
  const plan = useMemo(() => planTargets(selectedIds,manualParts.valid),[selectedIds,manualParts.valid]);
  const summary = useMemo<SelectionSummary>(() => ({
    pages:selectedPages.length,
    posts:selectedIds.length,
    manual:manualParts.valid.length,
    invalid:manualParts.invalid.length,
    truncated:plan.truncated || manualParts.truncated,
    max:MAX_POSTS_PER_SCRAPE,
  }),[selectedPages.length,selectedIds.length,manualParts.valid.length,manualParts.invalid.length,plan.truncated,manualParts.truncated]);
  return {selectedPages,postsByPage,selectedPosts,selectedIds,manual,setManual,manualParts,plan,summary,selectPage,selectAllPages,clearPages,togglePost,togglePagePosts,clearPosts,isSelected,loadPosts};
}
export type PostSelection = ReturnType<typeof usePostSelection>;
