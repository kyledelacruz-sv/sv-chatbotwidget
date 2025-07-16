import os
from fastapi import FastAPI, Request, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
import httpx
from bs4 import BeautifulSoup
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

# Get configs from environment
USERNAME = os.getenv("USERNAME")
PASSWORD = os.getenv("PASSWORD")
CHATFLOW_ID = os.getenv("CHATFLOW_ID")
BASE_URL = os.getenv("BASE_URL", "https://app-qa.streamlineverify.net")
FLOWISE_BASE_URL = os.getenv("FLOWISE_BASE_URL", "http://localhost:3000")

# Define important URLs
APP_URL = f"{BASE_URL}/app"
LOGIN_FORM_URL = f"{BASE_URL}/ajax_login"
LOGIN_BEARER_URL = f"{BASE_URL}/api/login"
CHATFLOW_URL = f"{FLOWISE_BASE_URL}/v2/agentcanvas/{CHATFLOW_ID}"

# Initialize FastAPI app
app = FastAPI()

# Enable CORS so frontend can call this backend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 🚨 Change to your frontend domain in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Store auth session data (cookies + token)
auth_data = {"cookies": None, "bearer_token": None}

# Authenticate to Streamline Verify and get token
async def authenticate():
    async with httpx.AsyncClient(follow_redirects=True) as client:
        # Get CSRF token from login page
        resp = await client.get(APP_URL)
        soup = BeautifulSoup(resp.text, "html.parser")
        csrf_token = soup.find("input", {"name": "csrf_token"}).get("value")

        # Submit login form
        await client.post(
            LOGIN_FORM_URL,
            data={
                "username": USERNAME,
                "password": PASSWORD,
                "csrf_token": csrf_token,
                "timezone": "UTC",
            },
            headers={"Content-Type": "application/x-www-form-urlencoded; charset=UTF-8"},
        )

        # Get bearer token
        bearer_resp = await client.post(
            LOGIN_BEARER_URL, json={"username": USERNAME, "password": PASSWORD}
        )
        bearer_resp.raise_for_status()

        # Store cookies and token for later requests
        auth_data["cookies"] = client.cookies
        auth_data["bearer_token"] = bearer_resp.json().get("access_token")

# Main chat endpoint (streams response)
@app.post("/api/chat")
async def chat(request: Request):
    body = await request.json()
    user_question = body.get("question")

    if not user_question:
        raise HTTPException(status_code=400, detail="Missing 'question' in request body")

    # Authenticate if no token
    if not auth_data["bearer_token"]:
        await authenticate()

    async with httpx.AsyncClient(cookies=auth_data["cookies"]) as client:
        try:
            # Stream POST request to Flowise
            flowise_resp = await client.stream(
                "POST",
                CHATFLOW_URL,
                json={"question": user_question},
                headers={
                    "Authorization": f"Bearer {auth_data['bearer_token']}",
                    "Content-Type": "application/json",
                },
                timeout=60,
            )

            # Async generator to yield chunks
            async def stream_response():
                async for chunk in flowise_resp.aiter_text():
                    yield chunk

            return StreamingResponse(stream_response(), media_type="text/plain")

        except httpx.HTTPStatusError as e:
            if e.response.status_code == 401:
                # Token expired → re-authenticate and retry once
                await authenticate()
                return await chat(request)
            raise HTTPException(status_code=500, detail="Error contacting Flowise server")

# Note: Run with → uvicorn main:app --host 0.0.0.0 --port 3001 --reload
