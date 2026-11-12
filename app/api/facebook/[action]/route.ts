import { NextRequest, NextResponse } from 'next/server';
import { GraphError, graph, nextCursor } from '@/lib/graph';
import { extractPostId, mapComment } from '@/lib/facebook';
export const maxDuration = 30;
export const dynamic = 'force-dynamic';
const idPattern = /^\d+(?:_\d+)?$/;
const reply = (data:unknown, status=200) => NextResponse.json(data,{status,headers:{'Cache-Control':'no-store'}});
export async function POST(req:NextRequest, {params}:{params:Promise<{action:string}>}) {
  try {
    if (Number(req.headers.get('content-length') || 0) > 16000) throw new GraphError('INPUT','Request too large.',400);
    const body = await req.json().catch(() => { throw new GraphError('INPUT','Invalid request.',400); });
    const {action} = await params;
    const token = body?.token;
    if (typeof token !== 'string' || !token.trim() || token.length > 8192 || /[\r\n]/.test(token)) throw new GraphError('INPUT','Enter a valid access token.',400);
    const cursor = body.cursor;
    if (cursor != null && (typeof cursor !== 'string' || !cursor || cursor.length > 4096)) throw new GraphError('INPUT','Invalid pagination cursor.',400);
    const paging:Record<string,string> = cursor ? {after:cursor} : {};
    if (action === 'validate') {
      const data = await graph('me',token,{fields:'id,name'});
      if (typeof data.id !== 'string') throw new GraphError('RESPONSE','Meta did not return a valid identity.',502);
      return reply({id:data.id,name:typeof data.name === 'string' ? data.name : '', type:'Unknown'});
    }
    if (action === 'pages') {
      const data = await graph('me/accounts',token,{fields:'id,name',limit:'100',...paging});
      if (!Array.isArray(data.data)) throw new GraphError('RESPONSE','Meta returned an unexpected Page list.',502);
      const pages = data.data.filter((p:unknown): p is {id:string;name:string} => !!p && typeof p === 'object' && typeof (p as Record<string,unknown>).id === 'string' && typeof (p as Record<string,unknown>).name === 'string').map(p => ({id:p.id,name:p.name}));
      return reply({pages,nextCursor:nextCursor(data)});
    }
    if (action === 'post') {
      const id = typeof body.post === 'string' ? extractPostId(body.post) : null;
      if (!id) throw new GraphError('INPUT','Unsupported post link or ID. Enter a numeric post ID manually.',400);
      const data = await graph(id,token,{fields:'id,message,created_time'});
      if (typeof data.id !== 'string') throw new GraphError('RESPONSE','Meta did not return a valid post.',502);
      return reply({id:data.id, message:typeof data.message === 'string' ? data.message : '',created_time:typeof data.created_time === 'string' ? data.created_time : ''});
    }
    if (action === 'comments' || action === 'replies') {
      const id = body.id;
      if (typeof id !== 'string' || !idPattern.test(id) || id.length > 128) throw new GraphError('INPUT','Invalid post or comment ID.',400);
      const limit = Number(body.limit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new GraphError('INPUT','Batch size must be between 1 and 100.',400);
      const data = await graph(`${id}/comments`,token,{fields:'id,from,message,created_time,like_count,comment_count',limit:String(limit),filter:'toplevel',...paging});
      if (!Array.isArray(data.data)) throw new GraphError('RESPONSE','Meta returned an unexpected comments batch.',502);
      if (data.data.some((c:unknown) => !c || typeof c !== 'object' || Array.isArray(c))) throw new GraphError('RESPONSE','Meta returned an invalid comment.',502);
      const comments = data.data as Record<string,unknown>[];
      const records = comments.map(c => mapComment(c, action === 'replies' ? id : ''));
      if (records.some((r: {id:string}) => !r.id || !idPattern.test(r.id))) throw new GraphError('RESPONSE','A comment was missing a usable ID. This batch was not saved.',502);
      return reply({records, replyCandidates:comments.filter(c => typeof c.comment_count !== 'number' || c.comment_count > 0).map(c => c.id),nextCursor:nextCursor(data)});
    }
    throw new GraphError('INPUT','Unknown endpoint.',404);
  } catch (error) {
    if (error instanceof GraphError) return reply({error:error.message,code:error.code,retryable:error.retryable,retryAfter:error.retryAfter},error.status);
    return reply({error:'The request could not be completed. Please try again.',code:'UNKNOWN',retryable:false},500);
  }
}
