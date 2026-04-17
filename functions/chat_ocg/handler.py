"""Lambda: POST /chat — conversational Q&A about an OCG using Bedrock."""

import json
import os
import boto3

MODEL_ID = os.environ.get("BEDROCK_MODEL_ID", "amazon.nova-lite-v1:0")
OCG_TABLE_NAME = os.environ.get("OCG_TABLE_NAME", "ocg-portal-ocgs")

bedrock = boto3.client("bedrock-runtime")
dynamodb = boto3.resource("dynamodb")


def handler(event, context):
    print(f"[CHAT] Invoked. Method: {event.get('httpMethod')}, Path: {event.get('path')}")
    print(f"[CHAT] Request ID: {context.aws_request_id}, Remaining: {context.get_remaining_time_in_millis()}ms")

    body = json.loads(event.get("body", "{}"))
    ocg_id = body.get("ocg_id")
    messages = body.get("messages", [])
    print(f"[CHAT] OCG: {ocg_id}, Messages: {len(messages)}")

    if not ocg_id or not messages:
        print("[CHAT] Missing ocg_id or messages")
        return _response(400, {"message": "ocg_id and messages are required"})

    table = dynamodb.Table(OCG_TABLE_NAME)
    ocg_item = table.get_item(Key={"id": ocg_id}).get("Item")
    if not ocg_item:
        print(f"[CHAT] OCG {ocg_id} not found in DynamoDB")
        return _response(404, {"message": f"OCG {ocg_id} not found"})

    ocg_text = ocg_item.get("content", "")
    ocg_name = ocg_item.get("name", ocg_id)
    print(f"[CHAT] OCG loaded: {ocg_name}, content length: {len(ocg_text)} chars")

    system_prompt = f"""You are a legal billing compliance assistant. Answer questions about this OCG, citing specific sections.

OCG: "{ocg_name}"
---
{ocg_text}
---

Response format (follow exactly):
1. Start with a 1-2 sentence summary answer.
2. If helpful, add bullet points with key details. Use "•" for bullets, one per line.
3. End with the citation on its own line, formatted exactly as: 📎 Section X.X — Title

Rules:
- Answer based ONLY on the OCG above.
- Always end with exactly one citation line starting with 📎.
- Keep answers concise."""

    # Build Converse API messages array
    converse_messages = []
    for msg in messages:
        role = msg.get("role", "user")
        content = msg.get("content", "")
        converse_messages.append({"role": role, "content": [{"text": content}]})

    try:
        print(f"[CHAT] Calling Bedrock converse, model: {MODEL_ID}, messages: {len(converse_messages)}")
        import time
        start = time.time()
        response = bedrock.converse(
            modelId=MODEL_ID,
            system=[{"text": system_prompt}],
            messages=converse_messages,
            inferenceConfig={"maxTokens": 1024, "temperature": 0.3, "topP": 0.9},
        )
        elapsed = time.time() - start
        reply = response["output"]["message"]["content"][0]["text"].strip()
        print(f"[CHAT] Bedrock responded in {elapsed:.1f}s, reply length: {len(reply)} chars")
    except Exception as e:
        print(f"[CHAT] Bedrock error: {type(e).__name__}: {e}")
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
