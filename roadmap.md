# OCG Timecard Analyzer — Architecture & Roadmap

## Overview

The OCG Timecard Analyzer is a web application for Cooley LLP that allows attorneys and billing staff to validate timecard entries against Outside Counsel Guidelines (OCGs) using AI. Users select a pre-indexed OCG, enter one or more timecard line-items (description + hours), and receive per-entry feedback on whether the work is likely billable — with citations to specific OCG clauses. A conversational chat interface also allows free-form Q&A about the selected OCG.

Live URL: `https://d19dntnemluddo.cloudfront.net`

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
│   └── dev.tfvars                     # Dev environment overrides
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
| API Gateway | REST API | `ocg-portal-api` | HTTP endpoints with Cognito auth |
| Cognito | User Pool | `ocg-portal-users` | Email-based authentication |
| Cognito | App Client | `ocg-portal-web` | Implicit OAuth flow, no secret |
| Cognito | Domain | `ocg-portal` | Hosted UI login page |
| S3 | Bucket | `ocg-portal-frontend-{account_id}` | Static frontend hosting |
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

All endpoints (except OPTIONS) require a Cognito JWT in the `Authorization` header.

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

Response:
```json
{
  "reply": "According to the OCG, the following are non-billable: ...\n\n📎 Section 6.1(a) — Non-Billable Internal Activities"
}
```

Lambda: `ocg-portal-chat-ocg` (90s timeout, 256MB)

### CORS

All three resource paths (`/ocgs`, `/analyze`, `/chat`) have OPTIONS methods with `authorization = "NONE"` returning CORS headers:
- `Access-Control-Allow-Headers: Content-Type,Authorization`
- `Access-Control-Allow-Methods: GET,POST,OPTIONS`
- `Access-Control-Allow-Origin: *`

Integration responses for OPTIONS use `depends_on` to avoid race conditions with method responses during Terraform apply.

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

Both `analyze_timecard` and `chat_ocg` use the Bedrock Converse API (`bedrock.converse()`), not the legacy `invoke_model` with `inputText`. This is required for Amazon Nova models.

Pattern:
```python
response = bedrock.converse(
    modelId=MODEL_ID,
    system=[{"text": system_prompt}],
    messages=[{"role": "user", "content": [{"text": user_prompt}]}],
    inferenceConfig={"maxTokens": 1024, "temperature": 0.2, "topP": 0.9},
)
output = response["output"]["message"]["content"][0]["text"]
```

The analyze Lambda instructs the model to return a JSON array and strips markdown fences if present before parsing. The chat Lambda passes the full conversation history as the `messages` array for multi-turn support.

### API Gateway 29-Second Limit

API Gateway REST APIs have a hard 29-second integration timeout. To stay within this:
- Prompts are kept concise (system prompt + OCG content + minimal instructions)
- `maxTokens` is capped at 1024
- Lambda memory is 256MB (more memory = more CPU = faster boto3/Bedrock calls)

Lambda Function URLs were also provisioned as a fallback (90s timeout, no API Gateway limit), but are currently blocked by an account-level SCP. The frontend currently routes through API Gateway.

---

## DynamoDB Schema

Table: `ocg-portal-ocgs`

| Attribute | Type | Description |
|---|---|---|
| `id` | String (hash key) | OCG identifier, e.g., `ocg-001` |
| `name` | String | Display name, e.g., "Acme Corp — Outside Counsel Guidelines 2026" |
| `content` | String | Full OCG text, sections separated by `\n\n`, each prefixed with section header |

Billing mode: PAY_PER_REQUEST (on-demand).

The table is seeded with 3 sample OCGs via `aws dynamodb batch-write-item`. The content field contains the full OCG as a single string with section headers like `Section 4.2(a) — Permitted Billable Activities` followed by the section text.

---

## Authentication

### Cognito Configuration

- User Pool: `ocg-portal-users` (email-based sign-up, password policy: 12+ chars, upper/lower/number/symbol)
- App Client: `ocg-portal-web` (implicit OAuth flow, no secret, scopes: openid/email/profile)
- Domain: `ocg-portal.auth.us-east-1.amazoncognito.com`
- Callback URLs: `http://localhost:5173`, `https://d19dntnemluddo.cloudfront.net`
- Logout URLs: same as callback

### Frontend Auth Flow

1. On load, `handleCallback()` checks the URL hash for `id_token` (Cognito redirect) and stores it in `sessionStorage`
2. `getToken()` retrieves the token from `sessionStorage`
3. `isAuthenticated()` decodes the JWT and checks `exp` claim
4. Every API request attaches the token as the `Authorization` header
5. On 401 response, `redirectToLogin()` sends the user to the Cognito hosted UI
6. `logout()` clears `sessionStorage` and redirects to Cognito logout endpoint

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
| `App` | Root — state management, OCG selector, layout, modal orchestration |
| `TimecardEntry` | Single timecard line-item form (description textarea + hours input) |
| `FeedbackBox` | Colored result box below each entry (green=billable, red=flagged) |
| `ChatCitation` | Parses section references in chat messages into clickable links |
| `OcgChatPanel` | Collapsible chat interface for OCG Q&A |
| `OcgViewerModal` | Full-screen modal showing OCG sections with citation highlighting |

### Key UI Behaviors

1. OCG selector dropdown — populated from `GET /ocgs` API (falls back to mock data)
2. Switching OCGs resets all timecard entries, chat messages, and cached viewer data
3. Timecard entries — starts with 1 blank entry, "Add Line Item" button appends more, entries can be removed (minimum 1)
4. "Analyze Entries" button — sends all valid entries to `POST /analyze`, displays feedback inline below each entry
5. Feedback boxes — green (likely billable) or red (potential issue) with confidence badge, explanation, quoted OCG text, and clickable citation
6. Chat panel — collapsible, appears below the analyze button, only enabled when an OCG is selected
7. Citation clicking — both feedback citations and chat citations open the OCG Viewer Modal, which auto-scrolls to the cited section and highlights it with a red border + "CITED" badge
8. Citation detection in chat — matches lines starting with `📎` OR containing `Section X.X` patterns anywhere in the text. Standalone citation lines render as full clickable buttons; inline references render as clickable inline links within the sentence.

### OCG Viewer Modal

- Fetches OCG content via `GET /ocgs/{id}` (falls back to `MOCK_OCG_CONTENT`)
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

### Environment Variables (baked at build time)

| Variable | Value |
|---|---|
| `VITE_API_BASE_URL` | `https://lomyk2u8sa.execute-api.us-east-1.amazonaws.com/prod` |
| `VITE_COGNITO_DOMAIN` | `https://ocg-portal.auth.us-east-1.amazoncognito.com` |
| `VITE_COGNITO_CLIENT_ID` | `43qii8es4oimqtlfkigffb734o` |
| `VITE_REDIRECT_URI` | `https://d19dntnemluddo.cloudfront.net` |

---

## Known Constraints

1. API Gateway REST API has a hard 29-second timeout. Bedrock calls with large OCG content can approach this limit. Prompts are kept concise and `maxTokens` capped at 1024 to stay within bounds.
2. Lambda Function URLs are provisioned in Terraform but blocked by an account-level SCP (403 on invocation). They exist as infrastructure but the frontend routes through API Gateway.
3. The DynamoDB table stores OCG content as a single string field. There is no structured section-level storage — the LLM parses sections from the raw text.
4. The frontend `MOCK_OCG_CONTENT` object contains section-level data for the OCG Viewer Modal. When the real `GET /ocgs/{id}` API returns structured sections, the mock can be removed.
5. Chat conversation history is held in React state only — it is not persisted. Refreshing the page or switching OCGs clears it.

---

## Future Features

- OCG upload and ingestion pipeline — allow users to upload PDF/DOCX OCG documents, extract text, chunk into sections, and store in DynamoDB. Could use S3 for raw file storage + a processing Lambda with textract or a PDF parsing library.
- Bedrock Knowledge Bases integration — index OCGs into a Bedrock Knowledge Base for RAG-based retrieval instead of passing the full document in every prompt. Would improve response quality and reduce token usage/latency.
- Structured section storage in DynamoDB — store OCG sections as a list of objects (`{id, title, text}`) rather than a flat string. This would make the OCG Viewer Modal work from real API data instead of relying on frontend mock content.
- GET /ocgs/{id} endpoint — return full OCG content with structured sections for the viewer modal. Currently only `GET /ocgs` (list) exists.
- Persistent chat history — store conversation sessions in DynamoDB keyed by user + OCG, so users can resume conversations across sessions.
- Batch analysis export — allow users to export analysis results as CSV or PDF for attachment to billing submissions.
- Timekeeper rate validation — extend the analysis to check whether billed hours × rate exceed OCG rate caps.
- Multi-entry analysis optimization — currently all entries are sent in a single prompt. For large batches (10+ entries), split into parallel Lambda invocations to stay within the 29-second API Gateway limit.
- OCG diff/comparison view — compare two OCG versions side-by-side to identify changes in billing rules.
- Admin interface for OCG management — CRUD operations for OCGs with a dedicated admin role in Cognito.
- Streaming responses — use Bedrock's streaming Converse API with Lambda response streaming to show chat responses as they generate, improving perceived latency.
- Audit logging — log all analysis requests and results to a separate DynamoDB table or S3 for compliance and review.
- User activity tracking — record which OCGs are queried most, common timecard descriptions, and rejection patterns to surface billing training opportunities.
