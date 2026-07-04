#!/usr/bin/env bash
#
# Deploy the Contract Operations Console to Google Cloud Run + Cloud SQL.
# Prerequisites: gcloud CLI authenticated (`gcloud auth login`), a billing-enabled
# project, and the frontend repo cloned as a sibling directory (../frontend).
#
# Usage (from the backend repo root):
#   PROJECT_ID=my-proj REGION=us-central1 DB_PASSWORD=supersecret ./deploy/gcp-deploy.sh
#
set -euo pipefail

PROJECT_ID="${PROJECT_ID:?set PROJECT_ID}"
REGION="${REGION:-us-central1}"
DB_PASSWORD="${DB_PASSWORD:?set DB_PASSWORD}"

INSTANCE="contracts-db"
DB_NAME="contracts"
DB_USER="postgres"
REPO="contracts"
BACKEND_IMAGE="$REGION-docker.pkg.dev/$PROJECT_ID/$REPO/backend"
FRONTEND_IMAGE="$REGION-docker.pkg.dev/$PROJECT_ID/$REPO/frontend"

gcloud config set project "$PROJECT_ID"

echo "==> Enabling APIs"
gcloud services enable run.googleapis.com sqladmin.googleapis.com \
  artifactregistry.googleapis.com cloudbuild.googleapis.com

echo "==> Creating Artifact Registry repo (idempotent)"
gcloud artifacts repositories create "$REPO" --repository-format=docker --location="$REGION" \
  2>/dev/null || echo "repo exists"

echo "==> Creating Cloud SQL Postgres instance (idempotent; this can take several minutes)"
gcloud sql instances create "$INSTANCE" --database-version=POSTGRES_16 \
  --tier=db-f1-micro --region="$REGION" 2>/dev/null || echo "instance exists"
gcloud sql users set-password "$DB_USER" --instance="$INSTANCE" --password="$DB_PASSWORD"
gcloud sql databases create "$DB_NAME" --instance="$INSTANCE" 2>/dev/null || echo "db exists"

CONNECTION_NAME="$(gcloud sql instances describe "$INSTANCE" --format='value(connectionName)')"
# Cloud Run connects to Cloud SQL over a unix socket; pg reads it via the ?host= param.
DATABASE_URL="postgresql://$DB_USER:$DB_PASSWORD@localhost/$DB_NAME?host=/cloudsql/$CONNECTION_NAME&schema=public"

echo "==> Building & pushing images with Cloud Build"
gcloud builds submit . --tag "$BACKEND_IMAGE"

echo "==> Deploying backend to Cloud Run"
gcloud run deploy contracts-backend \
  --image "$BACKEND_IMAGE" --region "$REGION" --allow-unauthenticated \
  --add-cloudsql-instances "$CONNECTION_NAME" \
  --set-env-vars "DATABASE_URL=$DATABASE_URL,PORT=4000,STORAGE_DRIVER=local,SEED_ON_START=true" \
  --session-affinity --port 4000

BACKEND_URL="$(gcloud run services describe contracts-backend --region "$REGION" --format='value(status.url)')"
echo "Backend URL: $BACKEND_URL"

echo "==> Building & deploying frontend (NEXT_PUBLIC_* baked in at build time)"
gcloud builds submit ../frontend \
  --config=/dev/stdin <<EOF
steps:
  - name: gcr.io/cloud-builders/docker
    args:
      - build
      - --build-arg=NEXT_PUBLIC_API_URL=$BACKEND_URL
      - --build-arg=NEXT_PUBLIC_SOCKET_URL=$BACKEND_URL
      - -t=$FRONTEND_IMAGE
      - .
images:
  - $FRONTEND_IMAGE
EOF

gcloud run deploy contracts-frontend \
  --image "$FRONTEND_IMAGE" --region "$REGION" --allow-unauthenticated --port 3000

# Lock backend CORS to the deployed frontend origin.
FRONTEND_URL="$(gcloud run services describe contracts-frontend --region "$REGION" --format='value(status.url)')"
gcloud run services update contracts-backend --region "$REGION" \
  --update-env-vars "CORS_ORIGIN=$FRONTEND_URL"

echo
echo "Deploy complete."
echo "  Frontend: $FRONTEND_URL"
echo "  Backend:  $BACKEND_URL"
echo "  Docs:     $BACKEND_URL/api/docs"
