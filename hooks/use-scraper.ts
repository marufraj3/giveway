'use client';
import { useCallback, useRef, useState } from 'react';
import type { CommentRecord, JobStatus } from '@/lib/types';

type Task = {kind:'comments'|'replies'; id:string; cursor:string|null; seen:Set<string>};
type Job = {token:string; limit:number; includeReplies:boolean; queue:Task[]; records:Map<string,CommentRecord>; scheduled:Set<string>; batches:number; running:boolean; paused:boolean; cancelled:boolean; abort:AbortController|null; cooldownUntil:number; generation:number};
export class ApiError extends Error { constructor(message:string, public code:string, public retryable:boolean, public retryAfter=0) {super(message);} }
export async function api(action:string, body:object, signal?:AbortSignal) {
  let res:Response;
  try { res = await fetch(`/api/facebook/${action}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal}); }
  catch (e) { if ((e as Error).name === 'AbortError') throw e; throw new ApiError('Network error. Check your connection and retry.','NETWORK',true); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error || 'The server could not complete the request.',data.code || 'UNKNOWN',!!data.retryable,typeof data.retryAfter === 'number' ? data.retryAfter : 0);
  return data;
}
export function useScraper() {
  const [records,setRecords] = useState<CommentRecord[]>([]);
  const [status,setStatus] = useState<JobStatus>('Ready');
  const [batches,setBatches] = useState(0);
  const [error,setError] = useState('');
  const [current,setCurrent] = useState('No active batch');
  const [post,setPost] = useState<{id:string;message:string}|null>(null);
  const jobRef = useRef<Job|null>(null); const serial = useRef(0);
  const run = useCallback(async (job:Job) => {
    if (job.running || job.cancelled) return;
    job.running = true;
    while (job.queue.length && !job.cancelled && jobRef.current === job) {
      const task = job.queue[0];
      setStatus(task.kind === 'comments' ? 'Fetching Comments' : 'Fetching Replies');
      setCurrent(`${task.kind === 'comments' ? 'Comments' : 'Replies'} · ${task.id}`);
      let data; let attempts = 0;
      while (true) {
        try {
          job.abort = new AbortController();
          data = await api(task.kind,{token:job.token,id:task.id,cursor:task.cursor,limit:job.limit},job.abort.signal);
          break;
        } catch (e) {
          if (job.cancelled || jobRef.current !== job) {job.running = false; return;}
          if (job.paused) { job.running=false; setStatus('Paused'); return; }
          const err = e as ApiError;
          if (err.code === 'RATE_LIMIT' && err.retryAfter > 0) job.cooldownUntil = Date.now() + err.retryAfter * 1000;
          if (err.code === 'RATE_LIMIT' && attempts < 2 && err.retryAfter <= 60) {
            attempts++; setStatus('Retrying'); setCurrent(`Rate limited · retry ${attempts} of 2`);
            await new Promise(resolve => setTimeout(resolve, Math.max(attempts * 3, err.retryAfter) * 1000));
            if (job.cancelled || jobRef.current !== job) {job.running=false; return;}
            if (job.paused) {job.running=false; setStatus('Paused'); return;}
            continue;
          }
          job.running = false; setError(err.message || 'Batch failed. Retry to continue.'); setStatus(job.records.size ? 'Partially Completed' : 'Failed'); return;
        }
      }
      if (job.cancelled || jobRef.current !== job) {job.running = false; return;}
      if (!Array.isArray(data.records) || !Array.isArray(data.replyCandidates) || (data.nextCursor !== null && typeof data.nextCursor !== 'string')) {
        job.running = false; setError('Unexpected batch response. Retry to continue.'); setStatus(job.records.size ? 'Partially Completed' : 'Failed'); return;
      }
      // Reject repeated cursors before committing the batch; the failed task remains retryable.
      if (data.nextCursor && (data.nextCursor === task.cursor || task.seen.has(data.nextCursor))) {
        job.running = false; setError('Meta returned a repeated pagination cursor. The scrape is incomplete.'); setStatus(job.records.size ? 'Partially Completed' : 'Failed'); return;
      }
      for (const record of data.records as CommentRecord[]) {
        if (!job.records.has(record.id)) job.records.set(record.id,record);
      }
      if (job.includeReplies) for (const id of data.replyCandidates as string[]) {
        if (!job.scheduled.has(id)) {job.scheduled.add(id); job.queue.push({kind:'replies',id,cursor:null,seen:new Set()});}
      }
      if (data.nextCursor) {task.seen.add(data.nextCursor); task.cursor = data.nextCursor;} else job.queue.shift();
      job.batches++; setBatches(job.batches); setRecords(Array.from(job.records.values())); setError('');
      if (job.paused) {job.running=false; setStatus('Paused'); return;}
    }
    job.running = false;
    if (!job.cancelled && jobRef.current === job) {setStatus('Completed'); setCurrent('All accessible batches processed');}
  },[]);
  const start = useCallback(async (token:string, input:string, limit:number, includeReplies:boolean) => {
    const generation = ++serial.current;
    if (jobRef.current) {jobRef.current.cancelled = true; jobRef.current.abort?.abort();}
    jobRef.current = null; setRecords([]); setBatches(0); setError(''); setPost(null); setStatus('Fetching Comments'); setCurrent('Validating post');
    try {
      const result = await api('post',{token,post:input});
      if (generation !== serial.current) return;
      setPost(result);
      const job:Job = {token,limit,includeReplies,queue:[{kind:'comments',id:result.id,cursor:null,seen:new Set()}],records:new Map(),scheduled:new Set(),batches:0,running:false,paused:false,cancelled:false,abort:null,cooldownUntil:0,generation};
      jobRef.current = job; void run(job);
    } catch(e) { if (generation !== serial.current) return; setError((e as Error).message); setStatus('Failed'); setCurrent('Post validation failed'); }
  },[run]);
  const pause = useCallback(() => { const job=jobRef.current; if(job) {job.paused=true; setStatus('Paused'); setCurrent('Paused · current batch will finish');} },[]);
  const resume = useCallback(() => {const job=jobRef.current; if(job && !job.cancelled) {if (Date.now() < job.cooldownUntil) {setError(`Meta requested a wait. Retry in ${Math.ceil((job.cooldownUntil-Date.now())/1000)} seconds.`);return;} job.paused=false; setError(''); setStatus('Resuming'); if (!job.running) void run(job);}},[run]);
  const stop = useCallback(() => {++serial.current; const job=jobRef.current; if(job) {job.cancelled=true;job.running=false;job.abort?.abort();} setStatus('Stopped');setCurrent('Stopped · partial results preserved');},[]);
  const reset = useCallback(() => {++serial.current; const job=jobRef.current;if(job){job.cancelled=true;job.abort?.abort();}jobRef.current=null;setRecords([]);setBatches(0);setError('');setStatus('Ready');setCurrent('No active batch');setPost(null);},[]);
  return {records,status,batches,error,current,post,start,pause,resume,stop,reset};
}
