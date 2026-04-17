"""Lambda: GET /ocgs — returns available OCGs from DynamoDB."""

import json
import os
import boto3

TABLE_NAME = os.environ.get("OCG_TABLE_NAME", "ocg-portal-ocgs")
dynamodb = boto3.resource("dynamodb")


def handler(event, context):
    table = dynamodb.Table(TABLE_NAME)
    response = table.scan(ProjectionExpression="id, #n", ExpressionAttributeNames={"#n": "name"})
    ocgs = response.get("Items", [])

    return {
        "statusCode": 200,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
        },
        "body": json.dumps({"ocgs": ocgs}),
    }
