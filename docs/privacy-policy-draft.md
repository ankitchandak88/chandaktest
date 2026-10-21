> **This is a first draft written to ground app-store privacy disclosures
> in what the app actually does — it is not legal advice and must be
> reviewed by a real lawyer/compliance professional before publishing or
> linking it from either app store listing.** It's scoped to what the
> codebase actually does today (checked `backend/app/Services/Ai/*`,
> `backend/routes/api/v1.php`, and the export/share-link features), not a
> generic template.

# ChandakText Privacy Policy (draft)

_Last updated: [fill in on publish]_

## What we collect

- **Account information**: your name and email address, provided when you
  register.
- **Your documents**: PDF files you upload, and the text extracted from
  them so the app can let you search, excerpt, and annotate them.
- **Your content**: notes, excerpts, annotations, tags, citations, and
  workspace layout you create while using the app.
- **Share links**: if you create a share link, its (optionally
  password-protected) token and expiry date are stored. A share link
  exposes a read-only view of your notes and excerpts to anyone with the
  link — **never the original PDF file**.

## How your content is used

Your documents and content are used solely to provide the app's features
to you and the members of your organization. We do not sell your content
or use it to train any model we operate.

## Third-party sharing — AI assistant feature

If your organization's administrator has enabled a real AI provider
(OpenAI or Anthropic — by default, no real provider is configured and no
data leaves our servers for this feature), using the AI assistant sends:

- The text of the specific document you're summarizing or chatting about
  (up to roughly 12,000 characters of its extracted text),
- Your conversation history for that chat session, and
- The message you type,

to that third-party provider's API, solely to generate the response shown
to you. This only happens when you actively use the summarize or chat
feature on a document — it is not sent automatically or in the background.
Each provider's own privacy/data-use policy governs how they handle that
request (link to the active provider's policy here once one is
configured).

## Data retention and deletion

- You can delete your account at any time from within the app; this
  removes your account, and documents you own are subject to our
  retention/purge policy below.
- Deleted documents are soft-deleted first and permanently removed,
  including their file and all derived excerpts/annotations, after a
  retention window (default 30 days) — see `DOCUMENT_RETENTION_DAYS` in
  the backend configuration.
- To request deletion of your account and associated data, use the
  in-app account deletion option, or contact [support email — fill in].

## Security

- Passwords are hashed, never stored in plain text.
- API access uses bearer tokens (not long-lived session cookies); tokens
  expire after a configurable period.
- Share links can optionally require a password and always have a bounded
  expiry date — they are never permanent-by-default.

## Children's privacy

This app is not directed at children under 13 (or the relevant age of
digital consent in your jurisdiction) and we do not knowingly collect data
from them. [Confirm this stance with legal before publishing — it affects
both stores' review process.]

## Changes to this policy

[Standard "we'll notify you of material changes" language — fill in with
your actual notification mechanism once decided.]

## Contact

[Fill in a real support/privacy contact email before publishing — both
app stores require a reachable contact method, not a placeholder.]
