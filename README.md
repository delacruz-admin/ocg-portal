# OCG Timecard Analyzer

Cooley Technology Infrastructure portal for analyzing timecard entries against Outside Counsel Guidelines using Amazon Bedrock.

## Local Development

### Frontend

```bash
cd frontend
npm install
npm run dev
```

The app runs at `http://localhost:5173`. Without backend connectivity it uses mock data for OCG selection and mock LLM responses for analysis feedback.

### Environment Variables

Create a `.env.local` in `frontend/` (not committed):

```
VITE_API_BASE_URL=https://your-api-id.execute-api.us-east-1.amazonaws.com/prod
VITE_COGNITO_DOMAIN=https://ocg-portal.auth.us-east-1.amazoncognito.com
VITE_COGNITO_CLIENT_ID=your-client-id
VITE_REDIRECT_URI=http://localhost:5173
```

### Infrastructure

```bash
cd infra
terraform init
terraform plan
terraform apply
```

### Deploy Frontend

```bash
cd frontend
npm run build
aws s3 sync dist/ s3://BUCKET_NAME --delete
aws cloudfront create-invalidation --distribution-id DIST_ID --paths "/*"
```

## Architecture

- Frontend: React + Vite + Tailwind (S3 + CloudFront)
- API: API Gateway + Lambda (Python 3.12) + Cognito Authorizer
- AI: Amazon Bedrock (`amazon.nova-lite-v1:0`)
- Data: DynamoDB (OCG storage)
- Auth: Cognito User Pools + Hosted UI
- IaC: Terraform
