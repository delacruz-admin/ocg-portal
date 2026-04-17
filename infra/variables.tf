variable "project_name" {
  default = "ocg-portal"
}

variable "aws_region" {
  default = "us-east-1"
}

variable "environment" {
  description = "Deployment environment: dev, uat, staging, prod"
  default     = "dev"
}

variable "owner" {
  description = "Team or individual responsible for this product"
  default     = "technology-infrastructure"
}

variable "cost_center" {
  description = "Finance cost-center code for billing attribution"
  default     = "CC-1511"
}

variable "bedrock_model_id" {
  default = "amazon.nova-lite-v1:0"
}

variable "cognito_callback_urls" {
  type    = list(string)
  default = ["http://localhost:5173"]
}

variable "cognito_logout_urls" {
  type    = list(string)
  default = ["http://localhost:5173"]
}
