# ---------------------------------------------------------------------------
# The image the suite runs in — locally and in CI, identically.
#
# The tag is pinned to the exact Playwright version in package.json. An
# unpinned tag means the image silently changes underneath the suite, and the
# first symptom is a failure nobody can reproduce on their own machine.
# ---------------------------------------------------------------------------
FROM mcr.microsoft.com/playwright:v1.62.1-jammy

WORKDIR /work

# Dependencies are installed in their own layer, before the source is copied,
# so editing a test does not invalidate the (slow) install layer.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .

# API tests need no browser, but the image ships one and `build-pdf.mjs` uses
# it to render the documentation — so nothing further has to be installed.
ENV CI=true
ENV NODE_ENV=test

ENTRYPOINT ["npx", "playwright", "test"]
