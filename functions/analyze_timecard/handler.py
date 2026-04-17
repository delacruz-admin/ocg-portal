"""Lambda: POST /analyze — analyzes timecard entries against an OCG using Bedrock."""

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
    entries = body.get("entries", [])

    if not ocg_id or not entries:
        return _response(400, {"message": "ocg_id and entries are required"})

    table = dynamodb.Table(OCG_TABLE_NAME)
    ocg_item = table.get_item(Key={"id": ocg_id}).get("Item")
    if not ocg_item:
        return _response(404, {"message": f"OCG {ocg_id} not found"})

    ocg_text = ocg_item.get("content", "")
    ocg_name = ocg_item.get("name", ocg_id)

    entries_text = "\n".join(
        f"Entry {i+1} (ID: {e['id']}): Description: \"{e['description']}\" | Hours: {e['hours']}"
        for i, e in enumerate(entries)
    )

    system_prompt = "You are a legal billing compliance analyst. Analyze timecard entries against Outside Counsel Guidelines. Return ONLY a JSON array."

    user_prompt = f"""OCG: "{ocg_name}"
---
{ocg_text}
---

Entries:
{entries_text}

For each entry return JSON with: "id", "billable" (bool), "confidence" ("high"/"medium"/"low"), "explanation" (1 sentence), "citation" (e.g. "Section 4.2(a) — Title"), "citation_id" (e.g. "section-4-2-a"), "cited_text" (1 sentence quote from OCG).
Return ONLY a JSON array."""

    try:
        response = bedrock.converse(
            modelId=MODEL_ID,
            system=[{"text": system_prompt}],
            messages=[{"role": "user", "content": [{"text": user_prompt}]}],
            inferenceConfig={"maxTokens": 1024, "temperature": 0.2, "topP": 0.9},
        )
        output_text = response["output"]["message"]["content"][0]["text"]

        cleaned = output_text.strip()
        if cleaned.startswith("```"):
            cleaned = cleaned.split("\n", 1)[-1].rsplit("```", 1)[0].strip()

        results = json.loads(cleaned)
    except Exception as e:
        return _response(500, {"message": f"Analysis failed: {str(e)}"})

    return _response(200, {"results": results})


def _response(status, body):
    return {
        "statusCode": status,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
        },
        "body": json.dumps(body),
    }
