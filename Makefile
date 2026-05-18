SERVICE := document-service
IMAGE   := mis/$(SERVICE)
TAG     ?= dev

.PHONY: help install install-standalone install-azure auth dev build start test lint typecheck \
        prisma-generate prisma-migrate prisma-deploy seed \
        docker-build clean

help:                  ## Show this help
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z_-]+:.*?## / {printf "  %-18s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

install:               ## Install deps for this service (standalone)
	npm install

install-standalone:    ## Install deps + @mis/* from GitHub (no package.json edit)
	npm install --no-save \
	  git+ssh://git@github.com/muling3/mis-pkg-auth-middleware.git \
	  git+ssh://git@github.com/muling3/mis-pkg-audit-logger.git \
	  git+ssh://git@github.com/muling3/mis-pkg-error-formatter.git \
	  git+ssh://git@github.com/muling3/mis-pkg-metrics.git \
	  git+ssh://git@github.com/muling3/mis-pkg-access-control.git \
	  git+ssh://git@github.com/muling3/mis-pkg-validation-schemas.git \
	  git+ssh://git@github.com/muling3/mis-pkg-circuit-breaker.git \
	  git+ssh://git@github.com/muling3/mis-proto.git

auth:                  ## Authenticate npm to the @mis Azure feed (cross-platform)
	@test -f .npmrc || { echo "no .npmrc — cp .npmrc.example .npmrc and set <org>/<project>/<feed>"; exit 1; }
	@if [ -n "$${AZURE_NPM_TOKEN:-}" ]; then \
	  echo "auth: AZURE_NPM_TOKEN set — npm reads it from .npmrc (no action needed)"; \
	elif uname -s 2>/dev/null | grep -qiE 'mingw|msys|cygwin|windows'; then \
	  vsts-npm-auth -config .npmrc; \
	else \
	  echo "auth: no credentials. Linux/macOS/CI:  export AZURE_NPM_TOKEN=<base64 Azure PAT>"; \
	  echo "      Windows: install vsts-npm-auth, then re-run 'make auth'"; \
	  exit 1; \
	fi

install-azure: auth    ## Install @mis/* from the Azure Artifacts feed (.npmrc)
	npm install

dev:                   ## Run in watch mode
	npm run start:dev

build:                 ## nest build
	npm run build

start:                 ## Run compiled build
	npm start

test:                  ## Unit tests (stub)
	npm test

lint:                  ## Lint (stub)
	npm run lint

typecheck:             ## tsc --noEmit
	npm run typecheck

prisma-generate:       ## STUB — no Prisma schema yet
	@echo "prisma-generate: TODO for $(SERVICE)"

prisma-migrate:        ## STUB
	@echo "prisma-migrate: TODO for $(SERVICE)"

prisma-deploy:         ## STUB
	@echo "prisma-deploy: TODO for $(SERVICE)"

seed:                  ## STUB
	@echo "seed: TODO for $(SERVICE)"

docker-build:          ## Build Docker image
	docker build -t $(IMAGE):$(TAG) ..  -f Dockerfile

clean:                 ## Remove build artefacts
	rm -rf dist node_modules
