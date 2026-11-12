# Threadline — Facebook Comment Workspace

A session-only Facebook Page/post comment and reply scraper using the official Meta Graph API. The browser orchestrates small sequential serverless requests, keeps results in memory, and exports a flat 20-field JSON array, CSV or XLSX. No database, OAuth login, persistence, background queue or browser automation is used.

## Run locally

Requires Node.js 20.9 or newer (Node 22 recommended).

```bash
npm install
cp .env.example .env.local  # optional
npm run dev
```

Open http://localhost:3000. Check with `npm test`, `npm run lint`, and `npm run build`; `npm start` serves the production build. The automated tests use mocked Graph responses, not real Meta credentials.

## Deploy to Vercel

Import the Git repository into Vercel as a Next.js project, optionally set `META_GRAPH_API_VERSION`, and deploy. The default is `v26.0`; change it only to a version supported by your app and Meta. The API route has a 30-second maximum duration and makes one 20-second-bounded Graph request per batch. Check your Vercel plan's function-duration limits. No external storage, worker, secret, or Meta App ID is required. Exports use an in-browser Web Worker, not a server worker.

## Meta token and access

1. Use [Graph API Explorer](https://developers.facebook.com/tools/explorer/) and your Meta app to generate a user token with the relevant approved permissions. For Page listing, `pages_show_list` is generally needed. Reading Page engagement and user content may require `pages_read_engagement` and `pages_read_user_content`, an appropriate Page role/task, app review and/or advanced access depending on the use case. Check Meta's current permission requirements for your app and the specific object.
2. Obtain a **Page access token** for the Page you manage in the Explorer or through your own authorized workflow. Paste it into Threadline. Meta documents that user tokens can return empty results for post comments, and that a Page token is required for user information on Page-owned comments/replies. An ordinary token does not grant access to every Page. Threadline does not acquire or return Page tokens from the Pages list.
3. Connect and validate. Page listing is best-effort; a Page token may not list Pages. The selected Page is informational and does not change the token's permissions. Provide a numeric post ID (optionally `PAGEID_POSTID`) or a supported Facebook `/posts/`, `story.php`, or `permalink.php` link. Vanity-name post links resolve to the numeric post component only; if Meta cannot resolve it, provide the full Graph post ID manually. Short/share links are intentionally not resolved.
4. Start scraping, keeping the tab open. Pause waits for an in-flight batch to finish; resume continues the same queue. Stop cancels the active request and preserves prior batches. Rate limits trigger at most two short automatic retries; retry manually after waiting if needed. Failure preserves the failed task and previously collected data. Export before refreshing or closing the tab. A new scrape replaces the current results.

Validation uses `GET /me?fields=id,name` with a bearer token. This verifies a request succeeds but does not determine token type, expiry or every permission; the UI reports type as unknown. No app secret is needed. If `/me` works but the Page list or post fails, check the token type, Page role, permissions, app mode and review status.

## Data and limitations

- Post comments use `/{post-id}/comments` with `filter=toplevel`, followed by separate `/{comment-id}/comments` requests for replies with nonzero or unavailable reply counts. Pages use cursors extracted server-side; raw `paging.next` URLs are never returned. IDs are deduplicated in memory. Meta may restrict reply depth and hide or delete content; completion means the accessible requested batches were processed, **not** that all Facebook content was accessible. If replies are disabled, completion covers parent comments only.
- The API requests `id`, `from`, `message`, `created_time`, `like_count` and `comment_count`. Author fields can be absent. Username is not requested and defaults to an empty string when unavailable. Language, gender, pinned state, avatar and reaction counts/breakdowns are not requested because availability varies; they use the specified defaults. A zero does **not** confirm that Meta reported no reactions. Comment counts may differ from the number accessible due to privacy/deletion. No text is translated.
- JSON uses exactly the 20 specified keys. CSV and XLSX use the same columns. CSV prefixes formula-like values with an apostrophe to prevent spreadsheet formula injection; JSON and XLSX preserve text. Exports run in a browser worker, but very large jobs still require memory proportional to their size.
- Tokens are held in React state and sent only in HTTPS request bodies to this application's server; the server forwards them in the Graph `Authorization` header, not URLs. They are not logged or returned. Graph errors are sanitized. No comments or tokens are persisted. Refreshing/closing the tab loses the session, and jobs do not continue in the background. Use HTTPS in production, protect your token and comply with Meta Platform Terms and applicable privacy law.

## Troubleshooting

- **Invalid/expired token:** obtain a new token and reconnect. Token validity is not the same as Page access.
- **Page list unavailable:** verify `pages_show_list` and Page role; a Page token can still be used without listing Pages.
- **Post not found / permissions:** verify the full Graph post ID, Page access token, approved scopes, Page task and app access. A user token can return an empty comments edge even if the post is readable.
- **Rate limit:** wait and retry the failed batch manually. The app will not spin forever.
- **Network / timeout / missing cursor:** retry the batch. If Meta continues to return an invalid cursor, the job remains incomplete; export partial results.
- **Missing fields or fewer records than expected:** Meta controls visibility and may omit fields; defaults do not imply confirmed zero values. Review [Meta's comment reference](https://developers.facebook.com/docs/graph-api/reference/comment/), [comments edge](https://developers.facebook.com/docs/graph-api/reference/object/comments/) and [version schedule](https://developers.facebook.com/docs/graph-api/changelog/).
