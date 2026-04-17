output "api_url" {
  value = "${aws_api_gateway_stage.prod.invoke_url}"
}

output "cognito_user_pool_id" {
  value = aws_cognito_user_pool.pool.id
}

output "cognito_client_id" {
  value = aws_cognito_user_pool_client.client.id
}

output "cognito_domain" {
  value = "https://${aws_cognito_user_pool_domain.domain.domain}.auth.${var.aws_region}.amazoncognito.com"
}

output "cloudfront_url" {
  value = "https://${aws_cloudfront_distribution.frontend.domain_name}"
}

output "frontend_bucket" {
  value = aws_s3_bucket.frontend.id
}

output "cloudfront_distribution_id" {
  value = aws_cloudfront_distribution.frontend.id
}

output "analyze_function_url" {
  value = aws_lambda_function_url.analyze.function_url
}

output "chat_function_url" {
  value = aws_lambda_function_url.chat.function_url
}
