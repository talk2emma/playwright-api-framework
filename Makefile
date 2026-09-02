# Discoverable shortcuts. `make` on its own lists everything.
.DEFAULT_GOAL := help
.PHONY: help install test smoke api contract perf security serial failed report lint fix format typecheck validate docs docs-open clean docker docker-contract

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

install: ## Install dependencies and the browser used for PDF rendering
	npm ci
	npx playwright install --with-deps chromium

test: ## Run every project
	npm test

smoke: ## Run only @smoke-tagged tests
	npm run test:smoke

api: ## Run the functional REST/GraphQL suite
	npm run test:api

contract: ## Run schema and OpenAPI conformance tests
	npm run test:contract

perf: ## Run latency budget checks (single worker)
	npm run test:performance

security: ## Run authorisation and hygiene checks
	npm run test:security

serial: ## Run everything with one worker, for debugging ordering issues
	npm run test:serial

failed: ## Re-run only what failed last time
	npm run test:failed

report: ## Open the HTML report
	npm run report

lint: ## Type-aware lint
	npm run lint

fix: ## Lint with autofix
	npm run lint:fix

format: ## Format every file
	npm run format

typecheck: ## Type-check without emitting
	npm run typecheck

validate: ## Typecheck + lint + format check — what CI runs first
	npm run validate

docs: ## Regenerate the documentation site and PDF
	npm run docs

docs-open: ## Open the generated documentation
	npm run docs:open

clean: ## Remove reports, results and caches
	npm run clean

docker: ## Run the suite in the CI-identical container
	docker compose run --rm api-tests

docker-contract: ## Run contract tests against the stub server, offline
	docker compose run --rm contract-tests
