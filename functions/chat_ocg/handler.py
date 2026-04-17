"""Lambda: POST /chat — conversational Q&A about an OCG using Bedrock."""

import json
import os
import boto3

MODEL_ID = os.environ.get("BEDROCK_MODEL_ID", "amazon.nova-lite-v1:0")
OCG_TABLE_NAME = os.environ.get("OCG_TABLE_NAME", "ocg-portal-ocgs")

bedrock = boto3.client("bedrock-runtime")
dynamodb = boto3.resource("dynamodb")


def handler(event, context):
    body = json.loads(event.get("body", "{}"))
    ocg_id = body.get("ocg_id")
    messages = body.get("messages", [])

    if not ocg_id or not messages:
        return _response(400, {"message": "ocg_id and messages are required"})

    table = dynamodb.Table(OCG_TABLE_NAME)
    ocg_item = table.get_item(Key={"id": ocg_id}).get("Item")
    if not ocg_item:
        return _response(404, {"message": f"OCG {ocg_id} not found"})

    ocg_text = ocg_item.get("content", "")
    ocg_name = ocg_item.get("name", ocg_id)

    system_prompt = f"""You are a legal billing compliance assistant. Answer questions about this OCG, citing specific sections.

OCG: "{ocg_name}"
---
{ocg_text}
---

Rules: Answer based ONLY on the OCG above. Cite sections using format: 📎 Section X.X — Title. Be concise."""

    # Build Converse API messages array
    converse_messages = []
    for msg in messages:
        role = msg.get("role", "user")
        content = msg.get("content", "")
        converse_messages.append({"role": role, "content": [{"text": content}]})

    try:
        response = bedrock.converse(
            modelId=MODEL_ID,
            system=[{"text": system_prompt}],
            messages=converse_messages,
            inferenceConfig={"maxTokens": 1024, "temperature": 0.3, "topP": 0.9},
        )
        reply = response["output"]["message"]["content"][0]["text"].strip()
    except Exception as e:
        return _response(500, {"message": f"Chat failed: {str(e)}"})

    return _response(200, {"reply": reply})


def _response(status, body):
    return {
        "statusCode": status,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
        },
        "body": json.dumps(body),
    }
