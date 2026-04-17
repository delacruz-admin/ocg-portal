# OCG Timecard Analyzer — Architecture & Roadmap

## Overview

The OCG Timecard Analyzer is a web application for Cooley LLP that allows attorneys and billing staff to validate timecard entries against Outside Counsel Guidelines (OCGs) using AI. Users select a pre-indexed OCG, enter one or more timecard line-items (description + hours), and receive per-entry feedback on whether the work is likely billable — with citations to specific OCG clauses. A conversational chat interface also allows free-form Q&A about the selected OCG.

Live URL: `https://d19dntnemluddo.cloudfront.net`
GitHub: `https://github.com/delacruz-admin/ocg-portal`

---

## Project Structure

```
ocg-portal/
├── frontend/                          # React SPA
│   ├── src/
│   │   ├── main.jsx                   # React root mount
│   │   ├── App.jsx                    # All components (single-file app)
│   │   ├── index.css                  # Tailwind directives + custom animations
│   │   ├── auth.js                    # Cognito hosted UI auth helper
│   │   └── api/
│   │       └── client.js              # API client with Authorization header
│   ├── index.html                     # HTML shell with Google Fonts
│   ├── vite.config.js                 # Vite config (React plugin, port 5173)
│   ├── tailwind.config.js             # Cooley design tokens mapped to Tailwind
│   ├── postcss.config.js              # PostCSS with Tailwind + Autoprefixer
│   ├── package.json                   # Dependencies: React 19, Vite 6, Tailwind 3
│   ├── .env.production                # Production env vars (API URLs, Cognito)
│   └── dist/                          # Build output (deployed to S3)
├── functions/                         # Lambda handlers (Python 3.12)
│   ├── list_ocgs/
│   │   └── handler.py                 # GET /ocgs — list available OCGs
│   ├── analyze_timecard/
│   │   └── handler.py                 # POST /analyze — Bedrock analysis
│   └── chat_ocg/
│       └── handler.py                 # POST /chat — Bedrock conversational Q&A
├── infra/                             # Terraform IaC
│   ├── main.tf                        # All AWS resources
│   ├── variables.tf                   # Input variables with defaults
│   ├── outputs.tf                     # Stack outputs (URLs, IDs)
│   ├── backend.tf                     # S3 remote state + DynamoDB locking
│   ├── dev.tfvars                     # Dev environment overrides (Cognito URLs)
│   └── _seed_ocg.json                 # DynamoDB seed data for sample OCGs
├── .gitignore
├── README.md
└── roadmap.md                         # This file
```

---

## AWS Architecture

All infrastructure is serverless, defined in Terraform, and deployed to `us-east-1` in AWS account `173051740680`.

### Resource Inventory

| Service | Resource | Name/ID | Purpose |
|---|---|---|---|
| DynamoDB | Table | `ocg-portal-ocgs` | Stores OCG documents (id, name, content) |
| Lambda | Function | `ocg-portal-list-ocgs` | Returns list of available OCGs |
| Lambda | Function | `ocg-portal-analyze-timecard` | Analyzes timecard entries via Bedrock |
| Lambda | Function | `ocg-portal-chat-ocg` | Conversational OCG Q&A via Bedrock |
| API Gateway | REST API | `ocg-portal-api` (`lomyk2u8sa`) | HTTP endpoints with Cognito auth |
| Cognito | User Pool | `ocg-portal-users` (`us-east-1_hcp3OqFzD`) | Email-based authentication |
| Cognito | App Client | `ocg-portal-web` (`43qii8es4oimqtlfkigffb734o`) | Implicit OAuth flow, no secret |
| Cognito | Domain | `ocg-portal` | Hosted UI login page |
| S3 | Bucket | `ocg-portal-frontend-173051740680` | Static frontend hosting |
| CloudFront | Distribution | `E1F2SJ94LZF781` | HTTPS CDN with SPA fallback |
| IAM | Role | `ocg-portal-lambda-exec` | Shared Lambda execution role |

### Tagging Strategy

All resources use `default_tags` on the AWS provider:

| Tag | Value |
|---|---|
| `Project` | `ocg-portal` |
| `Environment` | `dev` (variable) |
| `Owner` | `technology-infrastructure` (variable) |
| `CostCenter` | `CC-1511` (variable) |
| `ManagedBy` | `terraform` |

Per-resource `Component` tags: `data`, `api`, `auth`, `frontend`.

### Terraform State

- Backend: S3 bucket `cooley-terraform-state`, key `ocg-portal/terraform.tfstate`
- Locking: DynamoDB table `terraform-locks`
- Encryption: enabled

---

## API Endpoints

Base URL: `https://lomyk2u8sa.execute-api.us-east-1.amazonaws.com/prod`

All endpoints (except OPTIONS) require a Cognito JWT in the `Authorization` header (raw token, no `Bearer` prefix).

### GET /ocgs

Returns the list of available OCGs from DynamoDB.

Response:
```json
{
  "ocgs": [
    { "id": "ocg-001", "name": "Acme Corp — Outside Counsel Guidelines 2026" }
  ]
}
```

Lambda: `ocg-portal-list-ocgs` (10s timeout, 128MB)

### POST /analyze

Analyzes timecard entries against a selected OCG using Amazon Bedrock.

Request:
```json
{
  "ocg_id": "ocg-001",
  "entries": [
    { "id": "uuid", "description": "Drafted motion for summary judgment", "hours": 2.5 }
  ]
}
```

Response:
```json
{
  "results": [
    {
      "id": "uuid",
      "billable": true,
      "confidence": "high",
      "explanation": "This work falls within permitted billable activities.",
      "citation": "Section 4.2(a) — Permitted Billable Activities",
      "citation_id": "section-4-2-a",
      "cited_text": "The following activities are billable: legal research..."
    }
  ]
}
```

Lambda: `ocg-portal-analyze-timecard` (90s timeout, 256MB)

### POST /chat

Conversational Q&A about a selected OCG using Amazon Bedrock. Supports multi-turn conversation via the `messages` array.

Request:
```json
{
  "ocg_id": "ocg-001",
  "messages": [
    { "role": "user", "content": "What activities are non-billable?" }
  ]
}
```

Response (structured format — summary, optional bullets, citation on last line):
```json
{
  "reply": "The OCG lists several categories of non-billable work.\n\n• Internal firm meetings not related to the matter\n• Invoice preparation and conflicts checks\n• File organization and administrative tasks\n• Training of junior associates on general skills\n\n📎 Section 6.1(a) — Non-Billable Internal Activities"
}
```

Lambda: `ocg-portal-chat-ocg` (90s timeout, 256MB)

### CORS

All three resource paths (`/ocgs`, `/analyze`, `/chat`) have OPTIONS methods with `authorization = "NONE"` returning CORS headers:
- `Access-Control-Allow-Headers: Content-Type,Authorization`
- `Access-Control-Allow-Methods: GET,POST,OPTIONS`
- `Access-Control-Allow-Origin: *`

Integration responses for OPTIONS use `depends_on` to avoid race conditions with method responses during Terraform apply.

### API Gateway Deployment

The `aws_api_gateway_deployment` resource uses a `triggers` block with a SHA1 hash of all integration and method resource IDs. This forces Terraform to create a new deployment whenever any route configuration changes, preventing stale deployments where new routes (like `/chat`) exist in the config but aren't deployed to the live stage. The resource also uses `lifecycle { create_before_destroy = true }` to avoid downtime.

---

## Lambda Implementation Details

### Shared Configuration

- Runtime: Python 3.12
- IAM Role: `ocg-portal-lambda-exec` with permissions for:
  - `logs:CreateLogGroup`, `logs:CreateLogStream`, `logs:PutLogEvents`
  - `dynamodb:Scan`, `dynamodb:GetItem` on `ocg-portal-ocgs`
  - `bedrock:InvokeModel`, `bedrock:Converse` (all resources)
- Environment variables: `OCG_TABLE_NAME`, `BEDROCK_MODEL_ID`
- Bedrock model: `amazon.nova-lite-v1:0` (configurable via env var)

### Bedrock Integration

Both `analyze_timecard` and `chat_ocg` use the **Bedrock Converse API** (`bedrock.converse()`), not the legacy `invoke_model` with `inputText`. The Converse API is required for Amazon Nova models and uses a structured `messages` array with `system` prompt.

**Analyze pattern** (single-turn, JSON output):
```python
response = bedrock.converse(
    modelId=MODEL_ID,
    system=[{"text": system_prompt}],
    messages=[{"role": "user", "content": [{"text": user_prompt}]}],
    inferenceConfig={"maxTokens": 1024, "temperature": 0.2, "topP": 0.9},
)
output = response["output"]["message"]["content"][0]["text"]
```

The analyze Lambda instructs the model to return a JSON array and strips markdown fences if present before parsing.

**Chat pattern** (multi-turn, natural language output):
```python
response = bedrock.converse(
    modelId=MODEL_ID,
    system=[{"text": system_prompt}],
    messages=converse_messages,  # full conversation history
    inferenceConfig={"maxTokens": 1024, "temperature": 0.3, "topP": 0.9},
)
reply = response["output"]["message"]["content"][0]["text"]
```

The chat Lambda passes the full conversation history as the `messages` array for multi-turn support. The system prompt instructs the model to format responses as: summary → optional bullets → citation on its own line prefixed with `📎`.

### API Gateway 29-Second Limit

API Gateway REST APIs have a hard 29-second integration timeout. To stay within this:
- Prompts are kept concise (system prompt + OCG content + minimal instructions)
- `maxTokens` is capped at 1024
- Lambda memory is 256MB (more memory = more CPU = faster boto3/Bedrock calls)

Lambda Function URLs are also provisioned in Terraform as a fallback (90s timeout, no API Gateway limit), but are currently blocked by an account-level SCP. The frontend routes all traffic through API Gateway.

---

## DynamoDB Schema

Table: `ocg-portal-ocgs`

| Attribute | Type | Description |
|---|---|---|
| `id` | String (hash key) | OCG identifier, e.g., `ocg-001` |
| `name` | String | Display name, e.g., "Acme Corp — Outside Counsel Guidelines 2026" |
| `content` | String | Full OCG text, sections separated by `\n\n`, each prefixed with section header |

Billing mode: PAY_PER_REQUEST (on-demand).

### Seed Data

The table is seeded with 3 sample OCGs via `aws dynamodb batch-write-item --request-items file://infra/_seed_ocg.json`. The content field contains the full OCG as a single string with section headers like `Section 4.2(a) — Permitted Billable Activities` followed by the section text.

Current OCGs:
- `ocg-001`: Acme Corp — Outside Counsel Guidelines 2026 (12 sections)
- `ocg-002`: Globex Inc — Billing & Staffing Guidelines v3 (8 sections)
- `ocg-003`: Initech — Approved Task & Rate Schedule (7 sections)

---

## Authentication

### Cognito Configuration

- User Pool: `ocg-portal-users` (email-based sign-up, password policy: 12+ chars, upper/lower/number/symbol)
- App Client: `ocg-portal-web` (implicit OAuth flow, no secret, scopes: openid/email/profile)
- Domain: `ocg-portal.auth.us-east-1.amazoncognito.com`
- Callback URLs: `http://localhost:5173`, `https://d19dntnemluddo.cloudfront.net`
- Logout URLs: same as callback

### Frontend Auth Flow (`auth.js`)

1. On load, `handleCallback()` checks the URL hash for `id_token` (Cognito redirect) and stores it in `sessionStorage`
2. `getToken()` retrieves the raw token from `sessionStorage`
3. `isAuthenticated()` decodes the JWT and checks `exp` claim against `Date.now()`
4. `tokenMinutesLeft()` returns minutes until expiry (used by session warning banner)
5. Every API request checks `isAuthenticated()` before calling — if expired, redirects to Cognito login via `redirectAndHalt()` (returns a never-resolving promise to prevent downstream catch blocks from firing)
6. On 401 or 403 response from API, same redirect-and-halt behavior
7. On `fetch` NetworkError (e.g., CORS preflight failure from expired token), checks `isAuthenticated()` and redirects if expired
8. `logout()` clears `sessionStorage` and redirects to Cognito logout endpoint
9. A background timer checks token expiry every 30 seconds and shows a yellow warning banner when < 5 minutes remain, with a "Refresh Session" button

### Token Lifetime

Cognito implicit flow tokens expire after 1 hour (default). There is no refresh token in implicit flow. When the token expires, the user must re-authenticate through the Cognito Hosted UI. If the Cognito session cookie is still valid, this is instant (no login screen).

### API Gateway Authorization

All non-OPTIONS methods use a `COGNITO_USER_POOLS` authorizer that validates the JWT from the `Authorization` header against the Cognito User Pool.

---

## Frontend Architecture

### Tech Stack

- React 19 with functional components and hooks (no class components)
- Vite 6 as build tool
- Tailwind CSS 3 with custom design tokens (Cooley brand colors)
- No routing library (single-page, single-view app)
- No state management library (React useState/useCallback sufficient)

### Design System

The UI follows the Cooley ARB design system documented in `.kiro/steering/ui-style-guide.md`. Key tokens mapped to Tailwind:

- Brand red: `#C8102E` (nav border, buttons, accents)
- Three typefaces: Inter (UI), Georgia (headings), Fira Code (mono/badges)
- 6px border radius (`rounded-cooley`)
- Signature borders: 2px red bottom on nav, 3px red top on cards/modals

### Component Structure (all in App.jsx)

| Component | Purpose |
|---|---|
| `App` | Root — state management, OCG selector, layout, modal orchestration, session expiry banner |
| `TimecardEntry` | Single timecard line-item form (description textarea + hours input) |
| `FeedbackBox` | Colored result box below each entry (green=billable, red=flagged) with clickable citation |
| `ChatCitation` | Parses section references in chat messages into clickable links (handles both `📎`-prefixed and inline `Section X.X` patterns) |
| `OcgChatPanel` | Collapsible chat interface for OCG Q&A with typing indicator |
| `OcgViewerModal` | Full-screen modal showing OCG sections with citation highlighting and auto-scroll |

### Key UI Behaviors

1. **OCG selector** — populated from `GET /ocgs` API, falls back to hardcoded mock list if API fails
2. **OCG switching** — resets all timecard entries (back to 1 blank), clears chat messages and input, collapses chat panel, clears cached OCG viewer data
3. **Timecard entries** — starts with 1 blank entry, "+ Add Line Item" button appends more, entries removable (minimum 1)
4. **Analyze** — sends all valid entries to `POST /analyze`, displays feedback inline below each entry
5. **Feedback boxes** — green (likely billable) or red (potential issue) with confidence badge, explanation, quoted OCG text, and clickable citation
6. **Chat panel** — collapsible, appears below the analyze button, only enabled when an OCG is selected. Supports multi-turn conversation.
7. **Chat response format** — LLM is prompted to return: 1-2 sentence summary, optional bullet points, citation on its own line with `📎` prefix
8. **Citation clicking** — both feedback citations and chat citations open the OCG Viewer Modal, which auto-scrolls to the cited section and highlights it with a red border + "CITED" badge
9. **Citation detection in chat** — matches lines starting with `📎` OR containing `Section X.X` patterns. Standalone citation lines render as full clickable buttons; inline references render as clickable inline links. Buttons use `type="button"` and `e.stopPropagation()` to prevent event bubbling issues.
10. **Session expiry banner** — yellow warning bar appears when token has < 5 minutes left, with "Refresh Session" button
11. **Sign Out** — ghost-style button in nav bar, clears session and redirects to Cognito logout

### OCG Viewer Modal

- Uses `MOCK_OCG_CONTENT` (hardcoded section-level data for all 3 OCGs) since no `GET /ocgs/{id}` endpoint exists yet
- Renders each section as a card with `data-section-id` attribute
- On open with an anchor, uses `querySelector` + `scrollIntoView` with a 100ms delay
- Highlighted section gets: red left border, red-light background, "CITED" badge
- Dismissible via close button, backdrop click, or Escape key

### Animations

- `animate-fade-in`: opacity 0→1 + translateY(4px→0), 0.22s ease (feedback boxes, chat panel)
- `animate-slide-up`: opacity 0→1 + translateY(12px→0), 0.22s ease (modals)
- Typing indicator: 3 bouncing dots with 180ms stagger

---

## Frontend Hosting

- S3 bucket with all public access blocked
- CloudFront distribution with OAC (Origin Access Control)
- HTTPS redirect, gzip compression, CachingOptimized policy
- SPA routing: custom error responses for 403/404 → `/index.html` with 200

### Deploy Flow

```bash
cd frontend
npm run build
aws s3 sync dist/ s3://ocg-portal-frontend-173051740680 --delete --region us-east-1
aws cloudfront create-invalidation --distribution-id E1F2SJ94LZF781 --paths "/*" --region us-east-1
```

### Environment Variables (baked at build time via `.env.production`)

| Variable | Value | Used By |
|---|---|---|
| `VITE_API_BASE_URL` | `https://lomyk2u8sa.execute-api.us-east-1.amazonaws.com/prod` | API client for all endpoints |
| `VITE_COGNITO_DOMAIN` | `https://ocg-portal.auth.us-east-1.amazoncognito.com` | Auth redirects |
| `VITE_COGNITO_CLIENT_ID` | `43qii8es4oimqtlfkigffb734o` | Auth redirects |
| `VITE_REDIRECT_URI` | `https://d19dntnemluddo.cloudfront.net` | Cognito callback |

Note: `VITE_ANALYZE_URL` and `VITE_CHAT_URL` (Lambda Function URLs) are also in `.env.production` but are not currently used by the frontend — all traffic routes through API Gateway.

---

## Known Constraints & Lessons Learned

1. **API Gateway 29-second hard limit** — Bedrock calls must complete within this window. Prompts are kept concise and `maxTokens` capped at 1024. Lambda memory at 256MB helps (more CPU).
2. **API Gateway deployment staleness** — Terraform's `aws_api_gateway_deployment` does not automatically redeploy when routes change. A `triggers` block with a hash of all integration/method IDs is required to force redeployment. Without this, new routes (like `/chat`) can exist in the config but return 403 `MissingAuthenticationTokenException` on OPTIONS preflight because the live stage points to an old deployment.
3. **Lambda Function URLs blocked by SCP** — The AWS account has a Service Control Policy that blocks Lambda Function URL invocations (403 Forbidden). Function URLs are provisioned in Terraform but unused. All traffic goes through API Gateway.
4. **Cognito implicit flow — no refresh tokens** — Tokens expire after 1 hour. The frontend handles this with: pre-request `isAuthenticated()` check, NetworkError catch with auth check, 401/403 auto-redirect, and a proactive session expiry warning banner.
5. **Redirect-and-halt pattern** — When the token is expired and a redirect is needed, the API client returns `new Promise(() => {})` (a never-resolving promise) instead of throwing. This prevents downstream catch blocks from displaying error messages before the browser navigates to Cognito login.
6. **Bedrock Converse API required** — Amazon Nova models (`amazon.nova-lite-v1:0`) require the Converse API (`bedrock.converse()`), not the legacy `invoke_model` with `inputText`. Using the wrong API returns `ValidationException: required key [messages] not found`.
7. **OCG Viewer uses frontend mock data** — No `GET /ocgs/{id}` endpoint exists. The viewer modal uses `MOCK_OCG_CONTENT` (hardcoded section-level data for all 3 OCGs). This must be kept in sync with the DynamoDB seed data.
8. **Chat conversation history is ephemeral** — Held in React state only. Refreshing the page or switching OCGs clears it.
9. **CORS integration response ordering** — API Gateway integration responses for OPTIONS must use `depends_on` referencing both the method response and the integration, otherwise Terraform may try to create them before their dependencies exist, causing `BadRequestException: Invalid mapping expression`.

---

## Future Features

- **OCG upload and ingestion pipeline** — Allow users to upload PDF/DOCX OCG documents, extract text, chunk into sections, and store in DynamoDB. Could use S3 for raw file storage + a processing Lambda with Textract or a PDF parsing library.
- **Bedrock Knowledge Bases integration** — Index OCGs into a Bedrock Knowledge Base for RAG-based retrieval instead of passing the full document in every prompt. Would improve response quality and reduce token usage/latency.
- **Structured section storage in DynamoDB** — Store OCG sections as a list of objects (`{id, title, text}`) rather than a flat string. This would make the OCG Viewer Modal work from real API data instead of relying on frontend mock content.
- **GET /ocgs/{id} endpoint** — Return full OCG content with structured sections for the viewer modal. Would eliminate the need for `MOCK_OCG_CONTENT` in the frontend.
- **Persistent chat history** — Store conversation sessions in DynamoDB keyed by user + OCG, so users can resume conversations across sessions.
- **Batch analysis export** — Allow users to export analysis results as CSV or PDF for attachment to billing submissions.
- **Timekeeper rate validation** — Extend the analysis to check whether billed hours × rate exceed OCG rate caps.
- **Multi-entry analysis optimization** — Currently all entries are sent in a single prompt. For large batches (10+ entries), split into parallel Lambda invocations to stay within the 29-second API Gateway limit.
- **OCG diff/comparison view** — Compare two OCG versions side-by-side to identify changes in billing rules.
- **Admin interface for OCG management** — CRUD operations for OCGs with a dedicated admin role in Cognito.
- **Streaming responses** — Use Bedrock's streaming Converse API with Lambda response streaming to show chat responses as they generate, improving perceived latency.
- **Audit logging** — Log all analysis requests and results to a separate DynamoDB table or S3 for compliance and review.
- **User activity tracking** — Record which OCGs are queried most, common timecard descriptions, and rejection patterns to surface billing training opportunities.
