# AGENTS.md - WhatsApp AI CRM OS

## Project Goal
This is a multi-tenant WhatsApp AI CRM SaaS platform similar to AiSensy/Gallabox. It includes:
- Admin panel
- Company/user login
- WhatsApp Cloud API inbox
- Campaigns and broadcasts
- Google Sheets integrations
- AI agent replies
- Lead segmentation
- Orders and human takeover queue
- Tenant-wise integrations and settings

## Important Rules
- Do not break multi-tenant isolation.
- Every tenant/company must only see its own chats, leads, integrations, orders, and settings.
- Never expose WhatsApp tokens, Meta access tokens, Google private keys, OpenAI keys, or database URLs in frontend code, logs, API responses, or Git commits.
- Use masked display for saved integrations.
- Any integration save/test/verify flow must return clear errors, not generic "Something went wrong".
- Do not remove existing features unless clearly asked.
- For tenant-specific changes, modify only that tenant's logic.

## Lead Segmentation Rules
- Hot lead: 6 or more user messages.
- Warm lead: 2 to 5 user messages.
- Scrap lead: fewer than 2 user messages.
- Do not mark a lead as Hot with only 1 message.

## WhatsApp Inbox Rules
- Conversations should appear like WhatsApp.
- New messages should update smoothly without full page refresh.
- Welcome template message and user replies must remain in the same chat thread.
- Use normalized phone numbers so duplicate chats are not created for the same lead.
- Manual replies must work from the inbox.

## Integration Rules
Google Sheets integration must support:
- Sheet ID
- Service account email
- Private key
- Verification before saving
- Clear wrong-key or permission error messages

WhatsApp integration must support:
- Phone number ID
- WABA ID
- Access token
- Verify token
- Template name
- Template language

## Commands
Before changing code, inspect `package.json` and confirm the real commands.

Current commands:
- `npm install`
- `npm run dev`
- `npm run build`
- `npm run start`
- `npm run lint`
- `npm run typecheck`
- `npm run prisma:generate`
- `npm run db:push`
- `npm run db:seed`
- `npx prisma generate`
- `npx prisma migrate deploy`

## Database Rules
- Check `prisma/schema.prisma` before DB changes.
- Do not randomly delete migrations.
- For Supabase pooler issues, check `DATABASE_URL` and `DIRECT_URL`.
- Never hardcode DB credentials.
- If Prisma gives P2022 or missing column errors, compare schema, migration SQL, and actual DB columns.

## Verification
After every meaningful change:
- Run build if possible.
- Run lint if available.
- Check affected API route manually.
- Explain changed files.
- Explain how to test.
- Mention any required env variables.

## Response Style
- Be direct.
- Give exact file paths.
- Give paste-ready code only when needed.
- Avoid vague advice.
