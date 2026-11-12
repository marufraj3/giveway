# Threadline — Facebook Comment Workspace

A session-only Facebook Page/post comment and reply scraper using the official Meta Graph API. The app opens on an access-token screen instead of a login: after the token is validated you can select several Pages and any number of their posts and collect their comments and replies in one run. The browser orchestrates small sequential serverless requests, keeps results in memory, and exports a flat 20-field JSON array, CSV or XLSX. No database, OAuth login, server-side persistence, background queue or browser automation is used.

## Run locally

Requires Node.js 20.9 or newer (Node 22 recommended).

```bash
npm install
cp .env.example .env.local  # optional
npm run dev
```

Open http://localhost:3000. Check with `npm test`, `npm run lint`, and `npm run build`; `npm start` serves the production build. The automated tests use mocked Graph and Facebook responses and a simulated browser (jsdom), not real Meta credentials or live network requests.

## Deploy to Vercel

Import the Git repository into Vercel as a Next.js project, optionally set `META_GRAPH_API_VERSION`, and deploy. The default is `v26.0`; change it only to a version supported by your app and Meta. The API route has a 30-second maximum duration and makes one 20-second-bounded Graph request per batch. Resolving a `/share/p/` link adds at most 6 seconds before the post is validated. Check your Vercel plan's function-duration limits. No external storage, worker, secret, or Meta App ID is required. Exports use an in-browser Web Worker, not a server worker.

## Meta token and access

1. Use [Graph API Explorer](https://developers.facebook.com/tools/explorer/) and your Meta app to generate a user token with the relevant approved permissions. For Page listing, `pages_show_list` is generally needed. Reading Page engagement and user content may require `pages_read_engagement` and `pages_read_user_content`, an appropriate Page role/task, app review and/or advanced access depending on the use case. Check Meta's current permission requirements for your app and the specific object.
2. Obtain a **Page access token** for the Page you manage in the Explorer or through your own authorized workflow. Paste it into Threadline. Meta documents that user tokens can return empty results for post comments, and that a Page token is required for user information on Page-owned comments/replies. An ordinary token does not grant access to every Page. Threadline does not acquire or return Page tokens from the Pages list.
3. Enter the token on the entry screen and select **Open dashboard**. It is validated with `GET /me` before the workspace appears. Page listing is best-effort; a Page token may not list Pages. Select one or more Pages to load their recent posts, tick the posts you want, and/or paste post links or IDs one per line. A numeric post ID (optionally `PAGEID_POSTID`) or a supported Facebook `/posts/`, `story.php`, or `permalink.php` link is accepted. Vanity-name post links resolve to the numeric post component only; if Meta cannot resolve it, provide the full Graph post ID manually. Facebook post share links (`https://www.facebook.com/share/p/…`) are resolved on the server from Facebook's redirect when possible; see [Facebook share links](#facebook-share-links-sharep). Other short/share link types are not resolved.
4. Start scraping, keeping the tab open. Every selected post is validated and added to one queue, and the results from all posts are combined. Pause waits for an in-flight batch to finish; resume continues the same queue. Stop cancels the active request and preserves prior batches. Rate limits trigger at most two short automatic retries; retry manually after waiting if needed. A failed batch is kept for retry, and the remaining posts still finish. Export before closing the tab. A new scrape replaces the current results.

Validation uses `GET /me?fields=id,name` with a bearer token. This verifies a request succeeds but does not determine token type, expiry or every permission; the UI reports type as unknown. No app secret is needed. If `/me` works but the Page list or post fails, check the token type, Page role, permissions, app mode and review status.

## Facebook share links (`/share/p/`)

Share links such as `https://www.facebook.com/share/p/1QRxGLCoso/` do not contain a post ID, so they cannot be parsed in the browser. When you start a scrape with one, the server tries to resolve it once and then continues with the normal post validation and scrape.

How resolution works:

- The server sends a plain anonymous `GET` to `https://www.facebook.com/share/p/<code>/` (the host is normalised and any query string or fragment you pasted is dropped) and reads only the HTTP status and `Location` header of Facebook's redirect. The response body is never read or parsed.
- If the redirect points to a supported post URL (`/posts/<numeric>`, `story.php`, `permalink.php` with a numeric `story_fbid`/`fbid`) or a numeric `PAGEID_POSTID` Graph post ID, that ID is validated with `GET /{post-id}` and scraped exactly like a manually entered ID. If Facebook redirects to a login page whose `next` parameter contains such a post URL, that ID is used; the login page itself is never requested.
- Redirects are followed manually. Every hop must be HTTPS on the default port, without embedded credentials, on an exact allowlisted host: `facebook.com`, `www.facebook.com`, `m.facebook.com`, `web.facebook.com` or `mobile.facebook.com`. Anything else (other domains, lookalikes such as `facebook.com.evil.test`, IP addresses, `localhost`, `graph.facebook.com`, the `l.facebook.com` link shim, non-HTTPS URLs) is blocked without being requested, which prevents SSRF. Only further `/share/p/` links are requested; other redirect targets are inspected but never fetched.
- At most 5 redirects are processed (so at most 5 requests), within a single 6-second timeout for the whole chain.
- The access token is never sent in these requests or their URLs: the resolver does not receive the token, and no `Authorization` header or cookie is sent. No browser automation, Facebook cookies, private endpoints or permission workarounds are used. Resolving a link grants no access; the Graph API still decides whether your token can read the post.

Limitations — **not every share link can be resolved**:

- Facebook decides how it answers anonymous server requests, and this can change at any time. It may redirect to a login or checkpoint page, return a normal page with no redirect, return an error, or rate-limit the server.
- Many posts now resolve to URLs with an obfuscated `pfbid…` identifier instead of a numeric ID. Threadline only accepts numeric Graph post IDs, so these cannot be used.
- Private, deleted or age/region-restricted posts usually cannot be resolved, and redirects to other URL formats (videos, reels, photos, `/groups/<id>/permalink/…`) are not supported. Group posts resolve only when the redirect uses `/groups/<numeric-id>/posts/<numeric-id>/`.
- Only `/share/p/` links are supported. Other share types (`/share/v/`, `/share/r/`, `/share/g/`, `/share/<code>/`), `fb.watch` and `l.facebook.com` links are not resolved.

When a link cannot be resolved, the app explains why (for example: login required, `pfbid` URL, unsupported redirect target, unsafe redirect blocked, too many redirects, timeout or network error) and you can still enter the numeric post ID manually. The automated tests use mocked Facebook responses; they verify the safety rules, not Facebook's live behaviour.

## Selecting several Pages and posts

The entry screen is the first screen on every load. Entering a valid access token opens the dashboard; there is no Facebook login, password, cookie or verification step.

- The token is kept in this browser tab's `sessionStorage`, so a reload stays signed in while closing the tab or clicking **Disconnect** clears it. Results are never stored.
- Selecting a Page loads its recent posts with `/{page-id}/posts` (`id`, `message`, `created_time` and `comments.limit(0).summary(true)`), 25 per request, with **Load more** for older posts. Nothing is read from a post until you start a scrape.
- Tick posts from one or several Pages, or paste post links/IDs one per line. Duplicates between picked and pasted posts are collapsed. Up to 50 posts are queued per scrape; the rest of the selection is ignored with a notice.
- The selection survives switching between sections, so you can review the Overview or API information before starting.
- Every post is validated with `GET /{post-id}` before scraping. Posts that cannot be resolved or read are listed with their reason and skipped; the others still finish. Failed batches remain retryable from the progress panel.
- Comments are requested in batches of 25, 50 or 100 (Meta's maximum is 100). A batch of 100 needs roughly 10–20 requests for 1,000–2,000 comments on one post; requests are sequential to stay inside rate limits and each one is bounded to 20 seconds server-side.
- Records are de-duplicated by comment ID across every post, and replies are fetched once per comment even if the comment appears in more than one batch.
- The Results table can filter by post and page through 25, 50 or 100 rows. The **Post** column and the per-post counts in the progress panel are display-only: JSON, CSV and XLSX keep exactly the 20 specified fields, so a combined export has no post column.

## Data and limitations

- Post comments use `/{post-id}/comments` with `filter=toplevel`, followed by separate `/{comment-id}/comments` requests for replies with nonzero or unavailable reply counts. Each queued post keeps its own cursor, all tasks share one queue, and IDs are deduplicated in memory across posts. Pages use cursors extracted server-side; raw `paging.next` URLs are never returned. Meta may restrict reply depth and hide or delete content; completion means the accessible requested batches were processed, **not** that all Facebook content was accessible. If replies are disabled, completion covers parent comments only.
- The API requests `id`, `from`, `message`, `created_time`, `like_count` and `comment_count`. Author fields can be absent. Username is not requested and defaults to an empty string when unavailable. Language, gender, pinned state, avatar and reaction counts/breakdowns are not requested because availability varies; they use the specified defaults. A zero does **not** confirm that Meta reported no reactions. Comment counts may differ from the number accessible due to privacy/deletion. No text is translated.
- JSON uses exactly the 20 specified keys. CSV and XLSX use the same columns. CSV prefixes formula-like values with an apostrophe to prevent spreadsheet formula injection; JSON and XLSX preserve text. Exports run in a browser worker, but very large jobs still require memory proportional to their size.
- The access token is entered on the entry screen and held in this tab's `sessionStorage` (tab-scoped; not `localStorage`, not a cookie, never in a URL). It is sent only in HTTPS request bodies to this application's server, which forwards it in the Graph `Authorization` header, not URLs. It is not logged or returned, and **Disconnect** or closing the tab clears it. Graph errors are sanitized. Comments are never persisted; closing the tab loses the results, and jobs do not continue in the background. Use HTTPS in production, protect your token and comply with Meta Platform Terms and applicable privacy law.

## Troubleshooting

- **Invalid/expired token:** obtain a new token and reconnect. Token validity is not the same as Page access.
- **Page list unavailable:** verify `pages_show_list` and Page role; a Page token can still be used without listing Pages.
- **Token screen keeps appearing:** the token was rejected or the tab's storage was cleared. Paste a fresh token; validation uses `GET /me` and does not prove Page access.
- **No posts shown for a selected Page:** the token may not be allowed to read that Page's posts, or the Page has none. Paste post links or IDs instead, and check the Page role and permissions. Groups are not listed.
- **A post was skipped:** its link/ID could not be resolved or the token cannot read it. The progress panel lists the reason; fix the ID or token and start again, or use **Retry failed batches** for batches that failed after validation.
- **Share link can't be resolved:** open the link in your browser, find the post's numeric ID (or `PAGEID_POSTID`) and enter it manually. Retry only for timeout/network errors; login, `pfbid` and unsupported-redirect results will not change on retry.
- **Post not found / permissions:** verify the full Graph post ID, Page access token, approved scopes, Page task and app access. A user token can return an empty comments edge even if the post is readable.
- **Rate limit:** wait and retry the failed batch manually. The app will not spin forever.
- **Network / timeout / missing cursor:** retry the batch. If Meta continues to return an invalid cursor, the job remains incomplete; export partial results.
- **Missing fields or fewer records than expected:** Meta controls visibility and may omit fields; defaults do not imply confirmed zero values. Review [Meta's comment reference](https://developers.facebook.com/docs/graph-api/reference/comment/), [comments edge](https://developers.facebook.com/docs/graph-api/reference/object/comments/) and [version schedule](https://developers.facebook.com/docs/graph-api/changelog/).
