terraform {
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.0" }
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = var.project_name
      Environment = var.environment
      Owner       = var.owner
      CostCenter  = var.cost_center
      ManagedBy   = "terraform"
    }
  }
}

locals {
  prefix = var.project_name
}

# ─── DynamoDB ──────────────────────────────────────────
resource "aws_dynamodb_table" "ocgs" {
  name         = "${local.prefix}-ocgs"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "id"

  attribute {
    name = "id"
    type = "S"
  }

  tags = { Component = "data" }
}

# ─── Lambda IAM ────────────────────────────────────────
resource "aws_iam_role" "lambda_exec" {
  name = "${local.prefix}-lambda-exec"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })

  tags = { Component = "api" }
}

resource "aws_iam_role_policy" "lambda_policy" {
  name = "${local.prefix}-lambda-policy"
  role = aws_iam_role.lambda_exec.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "arn:aws:logs:*:*:*"
      },
      {
        Effect   = "Allow"
        Action   = ["dynamodb:Scan", "dynamodb:GetItem"]
        Resource = aws_dynamodb_table.ocgs.arn
      },
      {
        Effect   = "Allow"
        Action   = ["bedrock:InvokeModel", "bedrock:Converse"]
        Resource = "*"
      }
    ]
  })
}

# ─── Lambda: list_ocgs ─────────────────────────────────
data "archive_file" "list_ocgs" {
  type        = "zip"
  source_dir  = "${path.module}/../functions/list_ocgs"
  output_path = "${path.module}/.build/list_ocgs.zip"
}

resource "aws_lambda_function" "list_ocgs" {
  function_name    = "${local.prefix}-list-ocgs"
  role             = aws_iam_role.lambda_exec.arn
  handler          = "handler.handler"
  runtime          = "python3.12"
  filename         = data.archive_file.list_ocgs.output_path
  source_code_hash = data.archive_file.list_ocgs.output_base64sha256
  timeout          = 10

  environment {
    variables = {
      OCG_TABLE_NAME = aws_dynamodb_table.ocgs.name
    }
  }

  tags = { Component = "api" }
}

# ─── Lambda: analyze_timecard ──────────────────────────
data "archive_file" "analyze_timecard" {
  type        = "zip"
  source_dir  = "${path.module}/../functions/analyze_timecard"
  output_path = "${path.module}/.build/analyze_timecard.zip"
}

resource "aws_lambda_function" "analyze_timecard" {
  function_name    = "${local.prefix}-analyze-timecard"
  role             = aws_iam_role.lambda_exec.arn
  handler          = "handler.handler"
  runtime          = "python3.12"
  filename         = data.archive_file.analyze_timecard.output_path
  source_code_hash = data.archive_file.analyze_timecard.output_base64sha256
  timeout          = 90
  memory_size      = 256

  environment {
    variables = {
      OCG_TABLE_NAME   = aws_dynamodb_table.ocgs.name
      BEDROCK_MODEL_ID = var.bedrock_model_id
    }
  }

  tags = { Component = "api" }
}

# ─── Lambda: chat_ocg ─────────────────────────────────
data "archive_file" "chat_ocg" {
  type        = "zip"
  source_dir  = "${path.module}/../functions/chat_ocg"
  output_path = "${path.module}/.build/chat_ocg.zip"
}

resource "aws_lambda_function" "chat_ocg" {
  function_name    = "${local.prefix}-chat-ocg"
  role             = aws_iam_role.lambda_exec.arn
  handler          = "handler.handler"
  runtime          = "python3.12"
  filename         = data.archive_file.chat_ocg.output_path
  source_code_hash = data.archive_file.chat_ocg.output_base64sha256
  timeout          = 90
  memory_size      = 256

  environment {
    variables = {
      OCG_TABLE_NAME   = aws_dynamodb_table.ocgs.name
      BEDROCK_MODEL_ID = var.bedrock_model_id
    }
  }

  tags = { Component = "api" }
}

# ─── Lambda Function URLs (bypass API Gateway 29s limit) ──
resource "aws_lambda_function_url" "analyze" {
  function_name      = aws_lambda_function.analyze_timecard.function_name
  authorization_type = "NONE"

  cors {
    allow_origins = ["*"]
    allow_methods = ["POST"]
    allow_headers = ["Content-Type", "Authorization"]
    max_age       = 3600
  }
}

resource "aws_lambda_permission" "analyze_furl" {
  statement_id           = "AllowPublicFunctionURL"
  action                 = "lambda:InvokeFunctionUrl"
  function_name          = aws_lambda_function.analyze_timecard.function_name
  principal              = "*"
  function_url_auth_type = "NONE"
}

resource "aws_lambda_function_url" "chat" {
  function_name      = aws_lambda_function.chat_ocg.function_name
  authorization_type = "NONE"

  cors {
    allow_origins = ["*"]
    allow_methods = ["POST"]
    allow_headers = ["Content-Type", "Authorization"]
    max_age       = 3600
  }
}

resource "aws_lambda_permission" "chat_furl" {
  statement_id           = "AllowPublicFunctionURL"
  action                 = "lambda:InvokeFunctionUrl"
  function_name          = aws_lambda_function.chat_ocg.function_name
  principal              = "*"
  function_url_auth_type = "NONE"
}

# ─── Cognito ───────────────────────────────────────────
resource "aws_cognito_user_pool" "pool" {
  name = "${local.prefix}-users"

  auto_verified_attributes = ["email"]
  username_attributes       = ["email"]

  password_policy {
    minimum_length    = 12
    require_lowercase = true
    require_uppercase = true
    require_numbers   = true
    require_symbols   = true
  }

  schema {
    name                = "email"
    attribute_data_type = "String"
    required            = true
    mutable             = true
  }

  tags = { Component = "auth" }
}

resource "aws_cognito_user_pool_client" "client" {
  name         = "${local.prefix}-web"
  user_pool_id = aws_cognito_user_pool.pool.id

  generate_secret                      = false
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["implicit"]
  allowed_oauth_scopes                 = ["openid", "email", "profile"]
  supported_identity_providers         = ["COGNITO"]
  callback_urls                        = var.cognito_callback_urls
  logout_urls                          = var.cognito_logout_urls
}

resource "aws_cognito_user_pool_domain" "domain" {
  domain       = local.prefix
  user_pool_id = aws_cognito_user_pool.pool.id
}

# ─── API Gateway ───────────────────────────────────────
resource "aws_api_gateway_rest_api" "api" {
  name = "${local.prefix}-api"

  tags = { Component = "api" }
}

resource "aws_api_gateway_authorizer" "cognito" {
  name            = "cognito"
  rest_api_id     = aws_api_gateway_rest_api.api.id
  type            = "COGNITO_USER_POOLS"
  provider_arns   = [aws_cognito_user_pool.pool.arn]
  identity_source = "method.request.header.Authorization"
}

# /ocgs GET
resource "aws_api_gateway_resource" "ocgs" {
  rest_api_id = aws_api_gateway_rest_api.api.id
  parent_id   = aws_api_gateway_rest_api.api.root_resource_id
  path_part   = "ocgs"
}

resource "aws_api_gateway_method" "get_ocgs" {
  rest_api_id   = aws_api_gateway_rest_api.api.id
  resource_id   = aws_api_gateway_resource.ocgs.id
  http_method   = "GET"
  authorization = "COGNITO_USER_POOLS"
  authorizer_id = aws_api_gateway_authorizer.cognito.id
}

resource "aws_api_gateway_integration" "get_ocgs" {
  rest_api_id             = aws_api_gateway_rest_api.api.id
  resource_id             = aws_api_gateway_resource.ocgs.id
  http_method             = aws_api_gateway_method.get_ocgs.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.list_ocgs.invoke_arn
}

resource "aws_lambda_permission" "apigw_list_ocgs" {
  statement_id  = "AllowAPIGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.list_ocgs.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.api.execution_arn}/*/*"
}

# /ocgs OPTIONS (CORS — no auth)
resource "aws_api_gateway_method" "options_ocgs" {
  rest_api_id   = aws_api_gateway_rest_api.api.id
  resource_id   = aws_api_gateway_resource.ocgs.id
  http_method   = "OPTIONS"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "options_ocgs" {
  rest_api_id = aws_api_gateway_rest_api.api.id
  resource_id = aws_api_gateway_resource.ocgs.id
  http_method = aws_api_gateway_method.options_ocgs.http_method
  type        = "MOCK"
  request_templates = { "application/json" = "{\"statusCode\": 200}" }
}

resource "aws_api_gateway_method_response" "options_ocgs" {
  rest_api_id = aws_api_gateway_rest_api.api.id
  resource_id = aws_api_gateway_resource.ocgs.id
  http_method = aws_api_gateway_method.options_ocgs.http_method
  status_code = "200"
  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = true
    "method.response.header.Access-Control-Allow-Methods" = true
    "method.response.header.Access-Control-Allow-Origin"  = true
  }
}

resource "aws_api_gateway_integration_response" "options_ocgs" {
  rest_api_id = aws_api_gateway_rest_api.api.id
  resource_id = aws_api_gateway_resource.ocgs.id
  http_method = aws_api_gateway_method.options_ocgs.http_method
  status_code = "200"
  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = "'Content-Type,Authorization'"
    "method.response.header.Access-Control-Allow-Methods" = "'GET,OPTIONS'"
    "method.response.header.Access-Control-Allow-Origin"  = "'*'"
  }

  depends_on = [
    aws_api_gateway_method_response.options_ocgs,
    aws_api_gateway_integration.options_ocgs,
  ]
}

# /analyze POST
resource "aws_api_gateway_resource" "analyze" {
  rest_api_id = aws_api_gateway_rest_api.api.id
  parent_id   = aws_api_gateway_rest_api.api.root_resource_id
  path_part   = "analyze"
}

resource "aws_api_gateway_method" "post_analyze" {
  rest_api_id   = aws_api_gateway_rest_api.api.id
  resource_id   = aws_api_gateway_resource.analyze.id
  http_method   = "POST"
  authorization = "COGNITO_USER_POOLS"
  authorizer_id = aws_api_gateway_authorizer.cognito.id
}

resource "aws_api_gateway_integration" "post_analyze" {
  rest_api_id             = aws_api_gateway_rest_api.api.id
  resource_id             = aws_api_gateway_resource.analyze.id
  http_method             = aws_api_gateway_method.post_analyze.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.analyze_timecard.invoke_arn
}

resource "aws_lambda_permission" "apigw_analyze" {
  statement_id  = "AllowAPIGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.analyze_timecard.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.api.execution_arn}/*/*"
}

# /analyze OPTIONS (CORS — no auth)
resource "aws_api_gateway_method" "options_analyze" {
  rest_api_id   = aws_api_gateway_rest_api.api.id
  resource_id   = aws_api_gateway_resource.analyze.id
  http_method   = "OPTIONS"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "options_analyze" {
  rest_api_id = aws_api_gateway_rest_api.api.id
  resource_id = aws_api_gateway_resource.analyze.id
  http_method = aws_api_gateway_method.options_analyze.http_method
  type        = "MOCK"
  request_templates = { "application/json" = "{\"statusCode\": 200}" }
}

resource "aws_api_gateway_method_response" "options_analyze" {
  rest_api_id = aws_api_gateway_rest_api.api.id
  resource_id = aws_api_gateway_resource.analyze.id
  http_method = aws_api_gateway_method.options_analyze.http_method
  status_code = "200"
  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = true
    "method.response.header.Access-Control-Allow-Methods" = true
    "method.response.header.Access-Control-Allow-Origin"  = true
  }
}

resource "aws_api_gateway_integration_response" "options_analyze" {
  rest_api_id = aws_api_gateway_rest_api.api.id
  resource_id = aws_api_gateway_resource.analyze.id
  http_method = aws_api_gateway_method.options_analyze.http_method
  status_code = "200"
  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = "'Content-Type,Authorization'"
    "method.response.header.Access-Control-Allow-Methods" = "'POST,OPTIONS'"
    "method.response.header.Access-Control-Allow-Origin"  = "'*'"
  }

  depends_on = [
    aws_api_gateway_method_response.options_analyze,
    aws_api_gateway_integration.options_analyze,
  ]
}

# /chat POST
resource "aws_api_gateway_resource" "chat" {
  rest_api_id = aws_api_gateway_rest_api.api.id
  parent_id   = aws_api_gateway_rest_api.api.root_resource_id
  path_part   = "chat"
}

resource "aws_api_gateway_method" "post_chat" {
  rest_api_id   = aws_api_gateway_rest_api.api.id
  resource_id   = aws_api_gateway_resource.chat.id
  http_method   = "POST"
  authorization = "COGNITO_USER_POOLS"
  authorizer_id = aws_api_gateway_authorizer.cognito.id
}

resource "aws_api_gateway_integration" "post_chat" {
  rest_api_id             = aws_api_gateway_rest_api.api.id
  resource_id             = aws_api_gateway_resource.chat.id
  http_method             = aws_api_gateway_method.post_chat.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.chat_ocg.invoke_arn
}

resource "aws_lambda_permission" "apigw_chat" {
  statement_id  = "AllowAPIGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.chat_ocg.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.api.execution_arn}/*/*"
}

# /chat OPTIONS (CORS — no auth)
resource "aws_api_gateway_method" "options_chat" {
  rest_api_id   = aws_api_gateway_rest_api.api.id
  resource_id   = aws_api_gateway_resource.chat.id
  http_method   = "OPTIONS"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "options_chat" {
  rest_api_id = aws_api_gateway_rest_api.api.id
  resource_id = aws_api_gateway_resource.chat.id
  http_method = aws_api_gateway_method.options_chat.http_method
  type        = "MOCK"
  request_templates = { "application/json" = "{\"statusCode\": 200}" }
}

resource "aws_api_gateway_method_response" "options_chat" {
  rest_api_id = aws_api_gateway_rest_api.api.id
  resource_id = aws_api_gateway_resource.chat.id
  http_method = aws_api_gateway_method.options_chat.http_method
  status_code = "200"
  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = true
    "method.response.header.Access-Control-Allow-Methods" = true
    "method.response.header.Access-Control-Allow-Origin"  = true
  }
}

resource "aws_api_gateway_integration_response" "options_chat" {
  rest_api_id = aws_api_gateway_rest_api.api.id
  resource_id = aws_api_gateway_resource.chat.id
  http_method = aws_api_gateway_method.options_chat.http_method
  status_code = "200"
  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = "'Content-Type,Authorization'"
    "method.response.header.Access-Control-Allow-Methods" = "'POST,OPTIONS'"
    "method.response.header.Access-Control-Allow-Origin"  = "'*'"
  }

  depends_on = [
    aws_api_gateway_method_response.options_chat,
    aws_api_gateway_integration.options_chat,
  ]
}

# Deploy
resource "aws_api_gateway_deployment" "deploy" {
  rest_api_id = aws_api_gateway_rest_api.api.id
  depends_on = [
    aws_api_gateway_integration.get_ocgs,
    aws_api_gateway_integration.post_analyze,
    aws_api_gateway_integration.post_chat,
    aws_api_gateway_integration.options_ocgs,
    aws_api_gateway_integration.options_analyze,
    aws_api_gateway_integration.options_chat,
  ]
}

resource "aws_api_gateway_stage" "prod" {
  rest_api_id   = aws_api_gateway_rest_api.api.id
  deployment_id = aws_api_gateway_deployment.deploy.id
  stage_name    = "prod"

  tags = { Component = "api" }
}

# ─── S3 + CloudFront (Frontend Hosting) ───────────────
resource "aws_s3_bucket" "frontend" {
  bucket = "${local.prefix}-frontend-${data.aws_caller_identity.current.account_id}"
  tags   = { Component = "frontend" }
}

data "aws_caller_identity" "current" {}

resource "aws_s3_bucket_public_access_block" "frontend" {
  bucket                  = aws_s3_bucket.frontend.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_cloudfront_origin_access_control" "frontend" {
  name                              = "${local.prefix}-oac"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_distribution" "frontend" {
  enabled             = true
  default_root_object = "index.html"
  price_class         = "PriceClass_100"

  origin {
    domain_name              = aws_s3_bucket.frontend.bucket_regional_domain_name
    origin_id                = "s3"
    origin_access_control_id = aws_cloudfront_origin_access_control.frontend.id
  }

  default_cache_behavior {
    target_origin_id       = "s3"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true
    cache_policy_id        = "658327ea-f89d-4fab-a63d-7e88639e58f6" # CachingOptimized
  }

  custom_error_response {
    error_code         = 403
    response_code      = 200
    response_page_path = "/index.html"
  }

  custom_error_response {
    error_code         = 404
    response_code      = 200
    response_page_path = "/index.html"
  }

  restrictions {
    geo_restriction { restriction_type = "none" }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }

  tags = { Component = "frontend" }
}

resource "aws_s3_bucket_policy" "frontend" {
  bucket = aws_s3_bucket.frontend.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "cloudfront.amazonaws.com" }
      Action    = "s3:GetObject"
      Resource  = "${aws_s3_bucket.frontend.arn}/*"
      Condition = {
        StringEquals = {
          "AWS:SourceArn" = aws_cloudfront_distribution.frontend.arn
        }
      }
    }]
  })
}
