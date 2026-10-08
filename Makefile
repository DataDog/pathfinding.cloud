.PHONY: help preview validate validate-strict generate generate-labs generate-pathrunner generate-stubs generate-heroes install clean

help:
	@echo "pathfinding.cloud — common targets"
	@echo ""
	@echo "  make preview           Start local dev server at http://localhost:8888"
	@echo "  make validate          Validate all YAML files (drafts allowed)"
	@echo "  make validate-strict   Validate all YAML files (no drafts)"
	@echo "  make generate          Regenerate docs/paths.json from YAML"
	@echo "  make generate-labs     Regenerate docs/labs.json from pathfinding-labs"
	@echo "  make generate-pathrunner  Regenerate docs/pathrunner.json from pathrunner"
	@echo "  make generate-stubs    Regenerate per-lab HTML stubs"
	@echo "  make generate-heroes   Regenerate per-lab hero images (incremental)"
	@echo "  make generate-heroes-force  Regenerate all hero images unconditionally"
	@echo "  make install           Install Python + Node dependencies"

preview:
	cd docs && python3 dev-server.py

validate:
	python scripts/validate-schema.py data/paths/

validate-strict:
	python scripts/validate-schema.py data/paths/ --no-draft

generate:
	python scripts/generate-json.py

generate-labs:
	python scripts/generate-labs-json.py

# Reads docs/labs.json for module->lab deep links, so run `make generate-labs` first.
generate-pathrunner:
	python scripts/generate-pathrunner-json.py

generate-stubs:
	python scripts/generate-lab-stubs.py

generate-heroes:
	node scripts/generate-lab-hero-images.js

generate-heroes-force:
	node scripts/generate-lab-hero-images.js --force

install:
	pip install -r requirements.txt
	npm install
	npx playwright install chromium

clean:
	find . -name "*.pyc" -delete
	find . -name "__pycache__" -type d -exec rm -rf {} + 2>/dev/null; true
