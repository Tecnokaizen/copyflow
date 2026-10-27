#!/usr/bin/env bash
# R5 (20261022120000). Local only: needs a full local stack (supabase start with
# PostgREST and Kong). An API user cannot forge app.order_write: every way a
# client can shape a request (body, headers, cookies, JWT claims, RPC names,
# schema profiles) still hits the guard, while the RPC path keeps working.
#
#   bash supabase/tests/phase58_order_direct_write_guard_api.sh \
#     postgresql://postgres:postgres@127.0.0.1:54322/postgres http://127.0.0.1:54321
#
# Optional env: ANON_KEY, JWT_SECRET (defaults: the Supabase CLI local values).
set -euo pipefail
DB_URL="${1:?local database URL required}"
API_URL="${2:-http://127.0.0.1:54321}"
case "$DB_URL" in
  postgresql://*@127.0.0.1:*/*|postgresql://*@localhost:*/*) ;;
  *) echo 'Local database required' >&2; exit 2 ;;
esac
case "$API_URL" in
  http://127.0.0.1:*|http://localhost:*) ;;
  *) echo 'Local API required' >&2; exit 2 ;;
esac
JWT_SECRET="${JWT_SECRET:-super-secret-jwt-token-with-at-least-32-characters-long}"
ANON_KEY="${ANON_KEY:-eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0}"
REST="$API_URL/rest/v1"

TENANT='e5810000-0000-4000-8000-000000000011'
OWNER='e5810000-0000-4000-8000-000000000001'
STAFF='e5810000-0000-4000-8000-000000000002'
STATUS='e5810000-0000-4000-8000-000000000021'
ORDER='e5810000-0000-4000-8000-000000000031'

sql() { psql "$DB_URL" -v ON_ERROR_STOP=1 -qAtc "$1"; }
fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "ok - $*"; }

b64url() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }
jwt() { # $1 payload json
  local header payload sig
  header=$(printf '%s' '{"alg":"HS256","typ":"JWT"}' | b64url)
  payload=$(printf '%s' "$1" | b64url)
  sig=$(printf '%s' "$header.$payload" | openssl dgst -sha256 -hmac "$JWT_SECRET" -binary | b64url)
  printf '%s.%s.%s' "$header" "$payload" "$sig"
}
EXP=$(( $(date +%s) + 3600 ))
STAFF_JWT=$(jwt "{\"sub\":\"$STAFF\",\"role\":\"authenticated\",\"aud\":\"authenticated\",\"exp\":$EXP}")

# req METHOD PATH JWT BODY [extra curl args...] -> prints "<status> <body>"
req() {
  local method="$1" path="$2" token="$3" body="$4"; shift 4
  local out status
  local data=()
  if [ -n "$body" ]; then data=(--data "$body"); fi
  out=$(mktemp)
  status=$(curl -sS -o "$out" -w '%{http_code}' -X "$method" "$REST$path" \
    -H "apikey: $ANON_KEY" -H "Authorization: Bearer $token" \
    -H 'Content-Type: application/json' "$@" "${data[@]+"${data[@]}"}")
  printf '%s %s' "$status" "$(cat "$out")"
  rm -f "$out"
}
expect() { # $1 label, $2 response, $3 status, $4 substring
  local status="${2%% *}" body="${2#* }"
  [ "$status" = "$3" ] || fail "$1: expected HTTP $3, got $status: $body"
  case "$body" in *"$4"*) ;; *) fail "$1: expected '$4' in: $body" ;; esac
  pass "$1 (HTTP $status)"
}
notes() { sql "select coalesce(notes, '') from public.orders where id = '$ORDER'"; }

cleanup() {
  sql "delete from public.tenants where id = '$TENANT'; delete from auth.users where id in ('$OWNER','$STAFF');" >/dev/null || true
}
trap cleanup EXIT
cleanup

sql "
begin;
select set_config('request.jwt.claim.sub', '$OWNER', true);
insert into auth.users (id, email, raw_user_meta_data) values
  ('$OWNER', 'owner@phase58-api.test', '{}'), ('$STAFF', 'staff@phase58-api.test', '{}');
insert into public.profiles (id, full_name) values ('$OWNER', 'Owner'), ('$STAFF', 'Staff');
insert into public.tenants (id, name, slug, active) values ('$TENANT', 'Phase58 API', 'phase58-api', true);
insert into public.memberships (tenant_id, user_id, role, active) values
  ('$TENANT', '$OWNER', 'owner', true), ('$TENANT', '$STAFF', 'staff', true);
insert into public.order_statuses (id, tenant_id, name, code, active, sort_order, is_initial, is_ready, is_closed, is_cancelled)
  values ('$STATUS', '$TENANT', 'Recibido', 'received', true, 1, true, false, false, false);
insert into public.orders (id, tenant_id, title, status_id, notes, created_by)
  values ('$ORDER', '$TENANT', 'Pedido API', '$STATUS', 'original', '$OWNER');
commit;" >/dev/null

BLOCKED='orders can only change through controlled RPCs'

# 1. Plain PATCH, as the app's own client would send it.
expect 'PATCH /orders is refused' \
  "$(req PATCH "/orders?id=eq.$ORDER" "$STAFF_JWT" '{"notes":"forged"}')" 403 "$BLOCKED"

# 2. Headers and cookies cannot set a GUC named app.order_write.
expect 'PATCH with forged headers and cookie is refused' \
  "$(req PATCH "/orders?id=eq.$ORDER" "$STAFF_JWT" '{"notes":"forged"}' \
      -H 'app.order_write: validated' -H 'X-App-Order-Write: validated' \
      -H 'Prefer: tx=commit' -H 'Cookie: app.order_write=validated')" 403 "$BLOCKED"

# 3. JWT claims land in request.jwt.claims, never in app.order_write.
CLAIMS_JWT=$(jwt "{\"sub\":\"$STAFF\",\"role\":\"authenticated\",\"aud\":\"authenticated\",\"exp\":$EXP,\"app.order_write\":\"validated\",\"app\":{\"order_write\":\"validated\"}}")
expect 'PATCH with marker-looking JWT claims is refused' \
  "$(req PATCH "/orders?id=eq.$ORDER" "$CLAIMS_JWT" '{"notes":"forged"}')" 403 "$BLOCKED"

# 4. set_config is not reachable as an RPC, in any exposed or requested schema.
expect 'POST /rpc/set_config does not exist' \
  "$(req POST /rpc/set_config "$STAFF_JWT" '{"setting_name":"app.order_write","new_value":"validated","is_local":true}')" 404 'PGRST202'
expect 'GET /rpc/set_config does not exist' \
  "$(req GET '/rpc/set_config?setting_name=app.order_write&new_value=validated&is_local=true' "$STAFF_JWT" '')" 404 'PGRST202'
expect 'pg_catalog cannot be selected as a profile' \
  "$(req POST /rpc/set_config "$STAFF_JWT" '{"setting_name":"app.order_write","new_value":"validated","is_local":true}' \
      -H 'Content-Profile: pg_catalog')" 406 'PGRST106'
expect 'the guard itself is not callable' \
  "$(req POST /rpc/tg_orders_write_guard "$STAFF_JWT" '{}')" 404 'PGRST202'

# 5. A token cannot switch to a privileged database role.
POSTGRES_JWT=$(jwt "{\"sub\":\"$STAFF\",\"role\":\"postgres\",\"aud\":\"authenticated\",\"exp\":$EXP}")
resp="$(req PATCH "/orders?id=eq.$ORDER" "$POSTGRES_JWT" '{"notes":"forged"}')"
case "${resp%% *}" in 2*) fail "role=postgres token wrote: $resp" ;; esac
pass "a role=postgres token is rejected (HTTP ${resp%% *})"

[ "$(notes)" = 'original' ] || fail "notes changed by a refused request: $(notes)"
pass 'nothing above changed the order'

# 6. The controlled path works through the same API, then the gate is shut again.
VERSION=$(sql "select row_version from public.orders where id = '$ORDER'")
RPC_BODY=$(printf '{"p_order_id":"%s","p_field":"notes","p_value":"via RPC","p_tenant_id":"%s","p_expected_version":%s}' "$ORDER" "$TENANT" "$VERSION")
expect 'RPC change_order_content_v2 works' \
  "$(req POST /rpc/change_order_content_v2 "$STAFF_JWT" "$RPC_BODY")" 200 '"version"'
[ "$(notes)" = 'via RPC' ] || fail "RPC did not write notes: $(notes)"
expect 'PATCH right after the RPC is still refused' \
  "$(req PATCH "/orders?id=eq.$ORDER" "$STAFF_JWT" '{"notes":"forged"}')" 403 "$BLOCKED"

# 7. R5-B through the API: lifecycle columns refused, the app's columns accepted.
ARCHIVED_BODY=$(printf '{"tenant_id":"%s","title":"x","status_id":"%s","archived_at":"2026-10-22T10:00:00Z"}' "$TENANT" "$STATUS")
AUTHOR_BODY=$(printf '{"tenant_id":"%s","title":"x","status_id":"%s","created_by":"%s"}' "$TENANT" "$STATUS" "$OWNER")
APP_BODY=$(printf '{"tenant_id":"%s","title":"Alta","status_id":"%s","priority":"normal","created_by":"%s"}' "$TENANT" "$STATUS" "$STAFF")
expect 'direct INSERT of an archived order is refused' \
  "$(req POST /orders "$STAFF_JWT" "$ARCHIVED_BODY")" 403 '42501'
expect 'direct INSERT naming another author is refused' \
  "$(req POST /orders "$STAFF_JWT" "$AUTHOR_BODY")" 403 'order created_by must be the current user'
expect 'direct INSERT with the columns POST /api/orders writes works' \
  "$(req POST /orders "$STAFF_JWT" "$APP_BODY" -H 'Prefer: return=minimal')" 201 ''

[ "$(notes)" = 'via RPC' ] || fail "final notes: $(notes)"
echo 'phase58 api: an API user cannot forge app.order_write; all checks passed'
