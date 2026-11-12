import type { CommentRecord } from './types';
export function exportData(records:CommentRecord[], format:'json'|'csv'|'xlsx'):Promise<void> {
  return new Promise((resolve,reject)=>{
    const worker = new Worker(new URL('./export-worker.ts',import.meta.url));
    worker.onmessage = (event:MessageEvent<{blob?:Blob;error?:boolean}>) => {
      worker.terminate(); if(!event.data.blob){reject(new Error('Export failed'));return;}
      const url=URL.createObjectURL(event.data.blob);const a=document.createElement('a');a.href=url;a.download=`threadline-comments.${format}`;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);resolve();
    };
    worker.onerror=()=>{worker.terminate();reject(new Error('Export failed'));};
    worker.postMessage({records,format});
  });
}
