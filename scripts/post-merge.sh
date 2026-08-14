#!/bin/bash
set -e

npm install
psql "$DATABASE_URL" -f server/schema.sql
npx tsx server/seed.ts
