from fastapi import FastAPI, Request, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
import httpx
from bs4 import BeautifulSoup
from dotenv import load_dotenv
import os
import sseclient
import sys
import aiohttp
import asyncio


from flowise import Flowise, PredictionData

# Load environment variables from .env file
load_dotenv()

# Get configs from environment
USERNAME = os.getenv("SV_USERNAME")
PASSWORD = os.getenv("SV_PASSWORD")
CHATFLOW_ID = os.getenv("CHATFLOW_ID")
BASE_URL = os.getenv("BASE_URL", "https://app-qa.streamlineverify.net")
FLOWISE_BASE_URL = os.getenv("FLOWISE_BASE_URL", "http://localhost:3000")
ENVIRONMENT = os.getenv("ENVIRONMENT")

# Define important URLs
APP_URL = f"{BASE_URL}/app"
LOGIN_FORM_URL = f"{BASE_URL}/ajax_login"
LOGIN_BEARER_URL = f"{BASE_URL}/api/login"
CHATFLOW_URL = f"{FLOWISE_BASE_URL}/api/v1/prediction/{CHATFLOW_ID}"
flowise_client = Flowise(base_url=FLOWISE_BASE_URL)

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
        try:
            # Step 1: GET /app → get csrf_token
            resp = await client.get(APP_URL)
            resp.raise_for_status()
            soup = BeautifulSoup(resp.text, "html.parser")
            csrf_token_tag = soup.find("input", {"name": "csrf_token"})
            if not csrf_token_tag:
                raise Exception("csrf_token input not found on /app page")
            csrf_token = csrf_token_tag["value"]

            # Step 2: POST /ajax_login → form login
            login_payload = {
                "username": USERNAME,
                "password": PASSWORD,
                "csrf_token": csrf_token,
                "timezone": "UTC"
            }
            login_headers = {
                "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                "X-Requested-With": "XMLHttpRequest",
                "Origin": BASE_URL
            }
            login_resp = await client.post(
                LOGIN_FORM_URL,
                data=login_payload,
                headers=login_headers
            )
            if not login_resp.is_success or "Invalid" in login_resp.text:
                raise Exception("Form login failed")

            # Step 3: Extract cookies
            cookies = client.cookies
            csrf_post_token = cookies.get("csrf_token") or cookies.get("csrf_refresh_token")
            csrf_access_token = cookies.get("csrf_access_token") or csrf_post_token
            cookie_header = "; ".join(f"{k}={v}" for k, v in cookies.items())

            # Step 4: POST /api/login → get bearer token
            bearer_resp = await client.post(
                LOGIN_BEARER_URL,
                json={"username": USERNAME, "password": PASSWORD},
                headers={"Content-Type": "application/json"}
            )
            bearer_resp.raise_for_status()
            access_token = bearer_resp.json().get("access_token")

            # Step 5: Store all in auth_data
            auth_data.update({
                "csrf_post_token": csrf_post_token,
                "csrf_access_token": csrf_access_token,
                "cookie_header": cookie_header,
                "access_token": access_token
            })

            print("✅ Authentication complete.")
            print("auth_data:", auth_data)

        except Exception as e:
            print(f"❌ Authentication error: {str(e)}")
            raise HTTPException(status_code=502, detail="Authentication failed")


# Main chat endpoint (streams response)
@app.post("/api/chat")
async def chat(request: Request):
    body = await request.json()
    question = body.get("question")
    sessionID = body.get("sessionID")

    if not question:
        raise HTTPException(status_code=400, detail="Missing 'question' in request")

    if not sessionID:
        raise HTTPException(status_code=400, detail="Missing 'sessionID' in request")


    if ENVIRONMENT == "dev":
        # From in-memory auth_data
        await authenticate()
        csrf_access_token = auth_data.get("csrf_access_token")
        csrf_post_token = auth_data.get("csrf_post_token")
        access_token = auth_data.get("access_token")
        cookie_header = auth_data.get("cookie_header")
    else:
        # From incoming cookies
        cookies = request.cookies
        csrf_access_token = cookies.get("csrf_access_token")
        csrf_post_token = cookies.get("csrf_post_token")
        access_token = cookies.get("access_token")
        cookie_header = request.headers.get("cookie")  # raw cookie header if needed

    # ✅ Check if any missing, re-authenticate (only for dev)
    if ENVIRONMENT == "dev" and not all([
        csrf_access_token,
        csrf_post_token,
        access_token,
        cookie_header
    ]):
        print("🔑 Dev: Cookies incomplete — running authenticate()...")
        await authenticate()

        # Re-fetch after authentication
        csrf_access_token = auth_data.get("csrf_access_token")
        csrf_post_token = auth_data.get("csrf_post_token")
        access_token = auth_data.get("access_token")
        cookie_header = auth_data.get("cookie_header")


    #Build prediction data for Flowise
    prediction_data = PredictionData(
        chatflowId=CHATFLOW_ID,
        question=question,
        streaming=True,
        overrideConfig={
            "sessionId": sessionID,
            "vars": {
                "csrf_access_token": csrf_access_token or "",
                "csrf_post_token": csrf_post_token or "",
                "access_token": access_token or "",
                "cookie_header": cookie_header or ""
            }
        }
    )

    try:
        # Get sync generator from Flowise SDK
        completion_generator = flowise_client.create_prediction(prediction_data)

        # Wrap it into async generator for StreamingResponse
        async def event_stream():
            loop = asyncio.get_event_loop()
            for chunk in completion_generator:
                event_data = str(chunk)
                print(f"⬅️ Flowise chunk: {event_data}", file=sys.stderr)
                yield await loop.run_in_executor(None, lambda: f"data: {event_data}\n\n")

        return StreamingResponse(event_stream(), media_type="text/event-stream")

    except Exception as e:
        print(f"❌ Flowise SDK error: {str(e)}", file=sys.stderr)
        raise HTTPException(status_code=502, detail="Error communicating with Flowise server")