"""Lambda: GET /ocgs/{id} — returns a single OCG with full content."""

import json
import os
import boto3

TABLE_NAME = os.environ.get("OCG_TABLE_NAME", "ocg-portal-ocgs")
dynamodb = boto3.resource("dynamodb")


def handler(event, context):
    ocg_id = (event.get("pathParameters") or {}).get("id")
    if not ocg_id:
        return _response(400, {"message": "OCG ID is required"})

    table = dynamodb.Table(TABLE_NAME)
    result = table.get_item(Key={"id": ocg_id})
    item = result.get("Item")

    if not item:
        return _response(404, {"message": f"OCG {ocg_id} not found"})

    return _response(200, item)


def _response(status, body):
    return {
        "statusCode": status,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
        },
        "body": json.dumps(body, default=str),
    }
