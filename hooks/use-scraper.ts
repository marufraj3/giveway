'use client';
import { useCallback, useRef, useState } from 'react';
import type { CommentRecord, JobStatus } from '@/lib/types';

type Task = {kind:'comments'|'replies'; postId:string; id:string; cursor:string|null; seen:Set<string>};
/** A post selected for a scrape, with the metadata used in progress labels. */
export interface ScrapeTarget { id:string; input:string; message:string; created_time:string }
/** A selected post that could not be turned into a post ID (no request was made or it failed). */
export interface SkippedTarget { input:string; error:string }
type Job = {
  token:string; limit:number; includeReplies:boolean; targets:ScrapeTarget[];
  queue:Task[]; failed:Task[]; failures:string[];
  records:Map<string,CommentRecord>; origin:Map<string,string>; scheduled:Set<string>;
  batches:number; running:boolean; paused:boolean; cancelled:boolean; abort:AbortController|null; cooldownUntil:number;
};
type Batch = {records?:unknown; replyCandidates?:unknown; nextCursor?:unknown};
export class ApiError extends Error { constructor(message:string, public code:string, public retryable:boolean, public retryAfter=0) {super(message);} }
export async function api(action:string, body:object, signal?:AbortSignal) {
  let res:Response;
  try { res = await fetch(`/api/facebook/${action}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal}); }
  catch (e) { if ((e as Error).name === 'AbortError') throw e; throw new ApiError('Network error. Check your connection and retry.','NETWORK',true); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error || 'The server could not complete the request.',data.code || 'UNKNOWN',!!data.retryable,typeof data.retryAfter === 'number' ? data.retryAfter : 0);
  return data;
}
/** Short, human-readable post label for progress messages. */
function targetLabel(job:Job, postId:string) {
  const text = (job.targets.find(t => t.id === postId)?.message || '').replace(/\s+/g,' ').trim();
  if (!text) return `Post ${postId}`;
  return text.length > 44 ? `${text.slice(0,44)}…` : text;
}
const RATE_LIMIT_RETRIES = 2;

export function useScraper() {
  const [records,setRecords] = useState<CommentRecord[]>([]);
  const [origin,setOrigin] = useState<Record<string,string>>({});
  const [targets,setTargets] = useState<ScrapeTarget[]>([]);
  const [skipped,setSkipped] = useState<SkippedTarget[]>([]);
  const [status,setStatus] = useState<JobStatus>('Ready');
  const [batches,setBatches] = useState(0);
  const [error,setError] = useState('');
  const [current,setCurrent] = useState('No active batch');
  const [retryable,setRetryable] = useState(false);
  const jobRef = useRef<Job|null>(null); const serial = useRef(0);
  const run = useCallback(async (job:Job) => {
    if (job.running || job.cancelled || jobRef.current !== job) return;
    job.running = true;
    while (job.queue.length && !job.cancelled && jobRef.current === job) {
      const task = job.queue[0];
      const label = targetLabel(job, task.postId);
      setStatus(task.kind === 'comments' ? 'Fetching Comments' : 'Fetching Replies');
      setCurrent(`${task.kind === 'comments' ? 'Comments' : 'Replies'} · ${label}`);
      let data:Batch|null = null; let attempts = 0; let failed = false;
      while (true) {
        try {
          job.abort = new AbortController();
          data = await api(task.kind,{token:job.token,id:task.id,cursor:task.cursor,limit:job.limit},job.abort.signal) as Batch;
          break;
        } catch (e) {
          if (job.cancelled || jobRef.current !== job) {job.running = false; return;}
          if (job.paused) {job.running = false; setStatus('Paused'); setRetryable(true); return;}
          const err = e as ApiError;
          if (err.code === 'RATE_LIMIT' && err.retryAfter > 0) job.cooldownUntil = Date.now() + err.retryAfter * 1000;
          if (err.code === 'RATE_LIMIT' && attempts < RATE_LIMIT_RETRIES && err.retryAfter <= 60) {
            attempts++; setStatus('Retrying'); setRetryable(true); setCurrent(`Rate limited · retry ${attempts} of ${RATE_LIMIT_RETRIES}`);
            await new Promise(resolve => setTimeout(resolve, Math.max(attempts * 3, err.retryAfter) * 1000));
            if (job.cancelled || jobRef.current !== job) {job.running = false; return;}
            if (job.paused) {job.running = false; setStatus('Paused'); setRetryable(true); return;}
            continue;
          }
          // One inaccessible post or batch must not throw away the results the rest of
          // the selection already produced: mark the task failed and carry on.
          job.failures.push(`${label}: ${err.message || 'This batch failed.'}`);
          setError(job.failures[job.failures.length - 1]);
          failed = true; break;
        }
      }
      if (job.cancelled || jobRef.current !== job) {job.running = false; return;}
      if (failed || !data) {
        job.queue.shift(); job.failed.push(task);
        if (job.queue.length) continue;
        break;
      }
      if (!Array.isArray(data.records) || !Array.isArray(data.replyCandidates) || (data.nextCursor != null && typeof data.nextCursor !== 'string')) {
        job.failures.push(`${label}: unexpected batch response.`);
        setError(job.failures[job.failures.length - 1]);
        job.queue.shift(); job.failed.push(task);
        if (job.queue.length) continue;
        break;
      }
      // Reject repeated cursors before committing the batch; the failed task remains retryable.
      if (data.nextCursor && (data.nextCursor === task.cursor || task.seen.has(data.nextCursor))) {
        job.failures.push(`${label}: Meta returned a repeated pagination cursor. The scrape is incomplete.`);
        setError(job.failures[job.failures.length - 1]);
        job.queue.shift(); job.failed.push(task);
        if (job.queue.length) continue;
        break;
      }
      for (const record of data.records as CommentRecord[]) {
        if (!job.records.has(record.id)) {job.records.set(record.id,record); job.origin.set(record.id,task.postId);}
      }
      if (job.includeReplies) for (const id of data.replyCandidates as string[]) {
        if (!job.scheduled.has(id)) {job.scheduled.add(id); job.queue.push({kind:'replies',postId:task.postId,id,cursor:null,seen:new Set()});}
      }
      if (data.nextCursor) {task.seen.add(data.nextCursor); task.cursor = data.nextCursor;} else job.queue.shift();
      job.batches++;
      setBatches(job.batches); setRecords(Array.from(job.records.values()));
      setOrigin(Object.fromEntries(job.origin)); setError('');
      if (job.paused) {job.running = false; setStatus('Paused'); setRetryable(true); return;}
    }
    job.running = false;
    if (job.cancelled || jobRef.current !== job) return;
    if (job.failed.length) {
      setStatus(job.records.size ? 'Partially Completed' : 'Failed');
      setCurrent(`${job.failed.length} batch${job.failed.length === 1 ? '' : 'es'} failed · retry or export partial results`);
      setRetryable(true);
    } else {
      setStatus('Completed'); setRetryable(false);
      setCurrent(job.targets.length > 1 ? `All accessible batches processed · ${job.targets.length} posts` : 'All accessible batches processed');
    }
  },[]);
  const start = useCallback(async (token:string, inputs:string[], limit:number, includeReplies:boolean) => {
    const generation = ++serial.current;
    const previous = jobRef.current;
    if (previous) {previous.cancelled = true; previous.abort?.abort();}
    const job:Job = {token,limit,includeReplies,targets:[],queue:[],failed:[],failures:[],records:new Map(),origin:new Map(),scheduled:new Set(),batches:0,running:false,paused:false,cancelled:false,abort:null,cooldownUntil:0};
    jobRef.current = job;
    setRecords([]); setOrigin({}); setTargets([]); setSkipped([]); setBatches(0); setError(''); setRetryable(false);
    setStatus('Resolving Posts'); setCurrent('Validating posts');
    const uniqueInputs = Array.from(new Set(inputs.map(value => value.trim()).filter(Boolean)));
    const resolved = new Map<string,ScrapeTarget>();
    const skippedList:SkippedTarget[] = [];
    for (let index = 0; index < uniqueInputs.length; index++) {
      if (generation !== serial.current || job.cancelled) return;
      const input = uniqueInputs[index];
      setCurrent(uniqueInputs.length > 1 ? `Resolving post ${index + 1} of ${uniqueInputs.length}` : 'Validating post');
      try {
        job.abort = new AbortController();
        const result = await api('post',{token,post:input},job.abort.signal);
        if (generation !== serial.current || job.cancelled) return;
        if (typeof result?.id !== 'string' || !result.id) throw new ApiError('Meta did not return a usable post ID.','RESPONSE',true);
        if (!resolved.has(result.id)) resolved.set(result.id,{id:result.id,input,message:typeof result.message === 'string' ? result.message : '',created_time:typeof result.created_time === 'string' ? result.created_time : ''});
      } catch (e) {
        if (generation !== serial.current || job.cancelled) return;
        if ((e as Error).name === 'AbortError') return;
        const err = e as ApiError;
        if (err.code === 'TOKEN') {
          setSkipped(skippedList); setError(err.message); setStatus('Failed'); setCurrent('Token rejected'); return;
        }
        skippedList.push({input,error:err.message || 'This post could not be resolved.'});
        setSkipped([...skippedList]);
      }
    }
    if (generation !== serial.current || job.cancelled) return;
    const list = Array.from(resolved.values());
    job.targets = list;
    setTargets(list); setSkipped(skippedList);
    if (!list.length) {
      setError(skippedList.length === 1 ? skippedList[0].error : 'None of the selected posts could be resolved. Check the post IDs, links and token access.');
      setStatus('Failed'); setRetryable(false);
      setCurrent(skippedList.length === 1 ? 'Post could not be resolved' : 'Posts could not be resolved');
      return;
    }
    if (skippedList.length) setError(`${skippedList.length} of ${uniqueInputs.length} posts could not be resolved and were skipped.`);
    job.queue = list.map(target => ({kind:'comments' as const,postId:target.id,id:target.id,cursor:null,seen:new Set<string>()}));
    void run(job);
  },[run]);
  const pause = useCallback(() => {
    const job = jobRef.current;
    if (job && !job.cancelled && status !== 'Resolving Posts') {job.paused = true; setStatus('Paused'); setRetryable(true); setCurrent('Paused · current batch will finish');}
  },[status]);
  const resume = useCallback(() => {
    const job = jobRef.current;
    if (!job || job.cancelled || job.running) return;
    if (Date.now() < job.cooldownUntil) {setError(`Meta requested a wait. Retry in ${Math.ceil((job.cooldownUntil - Date.now()) / 1000)} seconds.`);return;}
    if (!job.queue.length && job.failed.length) {job.queue = job.failed.splice(0); job.failures = []; setError('');}
    if (!job.queue.length) return;
    job.paused = false; setError(''); setStatus('Resuming'); setRetryable(false);
    void run(job);
  },[run]);
  const stop = useCallback(() => {
    ++serial.current;
    const job = jobRef.current;
    if (job) {job.cancelled = true; job.running = false; job.abort?.abort();}
    setStatus('Stopped'); setRetryable(false); setCurrent('Stopped · partial results preserved');
  },[]);
  const reset = useCallback(() => {
    ++serial.current;
    const job = jobRef.current;
    if (job) {job.cancelled = true; job.abort?.abort();}
    jobRef.current = null;
    setRecords([]); setOrigin({}); setTargets([]); setSkipped([]); setBatches(0); setError('');
    setStatus('Ready'); setRetryable(false); setCurrent('No active batch');
  },[]);
  return {records,origin,targets,skipped,status,batches,error,current,retryable,start,pause,resume,stop,reset};
}
