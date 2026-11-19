# Enable Gemini recognition on the hosted site

The GitHub Pages frontend is at https://erdemyilmz.github.io/boardlight/. The Python backend supplies OpenCV geometry and two-pass Gemini recognition. API credentials stay on that backend.

1. Create a Gemini API key in [Google AI Studio](https://aistudio.google.com/api-keys). Check the model's free-tier availability and your project's quotas; Gemini API billing is separate from Render hosting.
2. Open [Deploy Boardlight on Render](https://render.com/deploy?repo=https%3A%2F%2Fgithub.com%2Ferdemyilmz%2Fboardlight). Sign in, connect this repository, and use the `render.yaml` Blueprint. It specifies one **Free** Docker web service, with no database or paid instance.
3. Enter the key as the secret `GEMINI_API_KEY` when prompted. Keep `VISION_MODEL=gemini-3.5-flash-lite`, or choose another current image-capable Gemini model that supports structured output. Keep `ALLOWED_ORIGINS=https://erdemyilmz.github.io`. Do not put a key in GitHub Actions variables or any `NEXT_PUBLIC_*` value.
4. After deployment, copy the backend's actual HTTPS origin from Render, for example `https://boardlight-api-xxxx.onrender.com`. Render allocates the name; that example is not a running service. Open `<your-backend>/api/health`. It should report `vision_provider: gemini` and `vision_ready: true`. Readiness confirms configuration, not account quota or recognition accuracy.
5. In [GitHub Actions variables](https://github.com/erdemyilmz/boardlight/settings/variables/actions), create `VISION_BACKEND_URL` containing that origin, without a trailing slash. This URL is public and contains no credentials.
6. Run [Deploy Boardlight to GitHub Pages](https://github.com/erdemyilmz/boardlight/actions/workflows/pages.yml) using **Run workflow**. The next static build connects recognition to Render. Alternatively, send the backend's HTTPS URL to Codex so it can configure the public URL and rerun deployment.
7. Upload a chessboard photo, confirm corners and labeled orientation, and recognize. Review highlighted squares before analysis. If Gemini rejects a request or hits a quota, the site preserves the photo and offers manual editing.

Render's free service sleeps while idle. Wait for its health endpoint to respond after a cold start, then retry the upload. The Blueprint has no background keep-alive or paid resource. A live recognition call sends two images in each of two passes: the corrected board and an indexed contact sheet. Confidence is model-estimated, not calibrated. Model selection remains configurable through `VISION_MODEL`.

The backend has a 10 MB file limit and bounded provider retries. Its public recognition endpoint can be called by anyone with the URL; for a shared production service, apply an authenticated gateway or provider spending controls appropriate to your account. Browser Stockfish remains independent of Gemini and works without any key.

References: [Gemini image input](https://ai.google.dev/gemini-api/docs/image-understanding), [structured output](https://ai.google.dev/gemini-api/docs/structured-output), [pricing](https://ai.google.dev/gemini-api/docs/pricing), [Render free services](https://render.com/docs/free).
