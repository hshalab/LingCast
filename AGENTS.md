# Role: AI Full-Stack Development Agent

## Mission
Your goal is to build a decoupled "Talking Avatar System" strictly using the required technology stack. You will orchestrate the Frontend, API Backend, Python AI Inference Worker, and an S3-compatible storage layer.

## 1. Required Technology Stack
- **Frontend**: Must clone and build upon `https://github.com/satnaing/shadcn-admin` (React, TypeScript, Vite, Tailwind CSS, shadcn/ui).
- **Backend API**: Go (Gin framework) + GORM.
- **Storage Layer**: RustFS (S3-compatible). You must use standard AWS S3 SDKs (`github.com/aws/aws-sdk-go-v2` in Go, `boto3` in Python) to handle all file IO.
- **AI Worker**: Python 3.10.
- **Infrastructure**: Docker Compose, MySQL 8.0, Redis.

## 2. Feature Implementation Steps

### Step 1: Database & API Setup (Go + Gin + GORM)
1. Define GORM models:
   - `Avatar`: `ID`, `Name`, `ImageS3Key`, `VoiceAudioS3Key`, `CreatedAt`.
   - `BroadcastTask`: `ID`, `AvatarID`, `ScriptText`, `Status` (pending, processing, completed, failed), `OutputVideoS3URL`.
2. Configure AWS SDK v2 in Go to point to the RustFS endpoint (using environment variables for `S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET`).
3. Implement RESTful endpoints:
   - `POST /api/avatars` (Receive multipart files, upload directly to S3 via Go, save keys to DB).
   - `POST /api/tasks` (Create task, push JSON payload including S3 keys to Redis).
   - `GET /api/tasks/:id` (Return task status and final S3 video URL if completed).

### Step 2: The Python AI Worker (Python + boto3)
1. Write a Python daemon that connects to Redis and pops task payloads.
2. Initialize `boto3` client configured for the custom RustFS endpoint.
3. **Workflow for each task**:
   - Download the source image and audio from S3 (RustFS) to a local `/tmp/` directory.
   - *Mock AI Process*: Sleep for 10 seconds, then create a dummy MP4 file (or copy a static one).
   - Upload the resulting MP4 back to S3 (RustFS) and generate a presigned URL or public URL.
   - Connect to MySQL (or call a Go API webhook) to update the task status to `completed` and save the output URL.
4. Keep the AI logic abstracted so real models (GPT-SoVITS / LivePortrait) can be injected later without touching the S3/Redis logic.

### Step 3: Frontend Admin Dashboard (shadcn-admin)
1. Scaffold the UI using the `satnaing/shadcn-admin` template.
2. Create a new route/page: **Avatar Studio**.
3. **Form Section**:
   - File upload components for "Avatar Image" (required) and "Voice Clone Audio" (optional).
   - A large Textarea for "Broadcast Script".
   - Submit button triggers `POST /api/tasks`.
4. **Result Section**:
   - Polling mechanism to check task status.
   - Display a loading spinner while `processing`.
   - Mount an HTML5 `<video>` player to stream the MP4 directly from the returned S3 URL once `completed`.

### Step 4: Dockerization
1. Write `Dockerfile` for the Go Gin API.
2. Write `Dockerfile` for the Vue/React frontend (using Nginx alpine for the Vite build output).
3. Write `Dockerfile` for the Python AI worker.
4. Create a unified `docker-compose.yml` that networks Nginx, API, Python Worker, MySQL, and Redis.
5. Provide a `.env.example` defining all S3 credentials, DB strings, and Redis endpoints.

## 3. Output Rules
- Output clean, modular code.
- Ensure CORS is configured in the Go Gin API to allow requests from the Vite dev server.
- Treat RustFS exactly like AWS S3. Do not use local file paths for inter-service communication; only pass S3 keys/URLs.
- Do not ask for clarification on the AI models; strictly implement the mocked pipeline described in Step 2.