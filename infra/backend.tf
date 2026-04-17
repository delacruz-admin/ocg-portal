terraform {
  backend "s3" {
    bucket         = "cooley-terraform-state"
    key            = "ocg-portal/terraform.tfstate"
    region         = "us-east-1"
    dynamodb_table = "terraform-locks"
    encrypt        = true
  }
}
