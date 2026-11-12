export interface CommentRecord {
  author:string; username:string; text:string; likes:number; replies:number; created_at:string; language:string; is_pinned:boolean; id:string; reply_to_id:string; avatar_url:string; reaction_count:number; reactions_love:number; reactions_haha:number; reactions_wow:number; reactions_sad:number; reactions_anger:number; reactions_care:number; author_id:string; author_gender:string;
}
export const FIELDS: (keyof CommentRecord)[] = ['author','username','text','likes','replies','created_at','language','is_pinned','id','reply_to_id','avatar_url','reaction_count','reactions_love','reactions_haha','reactions_wow','reactions_sad','reactions_anger','reactions_care','author_id','author_gender'];
export interface Page { id:string; name:string }
/** One object from `/{page-id}/posts`, as shown in the post picker. */
export interface PagePost { id:string; message:string; created_time:string; comment_count:number|null }
export type JobStatus = 'Ready'|'Resolving Posts'|'Fetching Comments'|'Fetching Replies'|'Paused'|'Resuming'|'Retrying'|'Completed'|'Stopped'|'Failed'|'Partially Completed';
