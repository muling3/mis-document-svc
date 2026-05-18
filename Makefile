SERVICE := document-service
IMAGE   := mis/$(SERVICE)
TAG     ?= dev

.PHONY: help install auth dev build start test lint typecheck \
        prisma-generate prisma-migrate prisma-deploy seed \
        docker-build clean

help:                  ## Show this help
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z_-]+:.*?## / {printf "  %-18s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

install:               ## Install deps for this service (standalone)
	npm install

auth:                  ## No-op in PoC (no Azure Artifacts feed)
	@echo "auth: skipped — PoC uses npm workspaces"

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
