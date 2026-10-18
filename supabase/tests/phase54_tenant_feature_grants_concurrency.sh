#!/usr/bin/env bash
# Tenant feature grants V1 (Frente A1): real interleavings with separate sessions,
# then an exact rollback round trip.
#   C1 v2 ∥ v2 (same override) -> serialized on the row; one event per call and
#      an unbroken history chain; the row equals the last event
#   C2 v2 ∥ v1 ∥ clear loops (same override) -> every change recorded exactly
#      once, chain intact, row terms only from the last v2 event
#   C3 a held v2 blocks only its own override: other features and tenants go on,
#      the same override times out on the lock
#   C4 clear ∥ v2 -> v2 waits for the deletion and creates the override again
#   C5 a failed or rolled back transaction leaves neither override nor event
#   C6 tenant deletion ∥ v2 -> v2 fails on the foreign key; no orphan override;
#      the history of the deleted tenant survives
#   C7 review_at in the past revokes nothing; the review report lists it
#   R  rollback refused without opt-in; with opt-in it restores the pre-A1
#      schema (verify script) without touching any override; re-applying the
#      migration recreates the same objects plus baseline events, and the SQL
#      suite passes again. Runs on the full migration chain: if a later
#      migration builds on A1, retire this block (A1 can then only be rolled
#      back together with it).
# Local only. Uses fixed ids and removes its fixtures on exit (their history,
# being append-only, stays).
set -euo pipefail

DB_URL="${1:?usage: phase54_tenant_feature_grants_concurrency.sh <database-url>}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
MIGRATION="$ROOT/supabase/migrations/20261018180000_tenant_feature_grants_audit_v1.sql"
ROLLBACK="$ROOT/supabase/rollbacks/20261018180000_tenant_feature_grants_audit_v1.sql"
VERIFY="$ROOT/supabase/rollbacks/verify_20261018180000_tenant_feature_grants_audit_v1.sql"

OWNER='e5410000-0000-4000-8000-000000000001'
TENANT='e5410000-0000-4000-8000-000000000011'
OTHER='e5410000-0000-4000-8000-000000000012'
DOOMED='e5410000-0000-4000-8000-000000000013'
WORK="$(mktemp -d)"

psql_value() {
  psql "$DB_URL" -v ON_ERROR_STOP=1 -qAtc "$1"
}

fail() {
  echo "phase54 concurrency FAIL: $*" >&2
  exit 1
}

AS_SERVICE="select set_config('request.jwt.claim.role', 'service_role', true) is null; set local role service_role;"
AS_OWNER="select set_config('request.jwt.claim.sub', '$OWNER', true) is null;
  select set_config('request.jwt.claim.role', 'authenticated', true) is null;
  set local role authenticated;"

cleanup() {
  psql "$DB_URL" -v ON_ERROR_STOP=1 -qAtc "
    delete from public.tenant_feature_overrides where tenant_id in ('$TENANT', '$OTHER', '$DOOMED');
    delete from public.memberships where tenant_id in ('$TENANT', '$OTHER', '$DOOMED');
    delete from public.tenants where id in ('$TENANT', '$OTHER', '$DOOMED');
    delete from public.profiles where id = '$OWNER';
    delete from auth.users where id = '$OWNER';
  " >/dev/null 2>&1 || true
  rm -rf "$WORK"
}

trap cleanup EXIT
cleanup
WORK="$(mktemp -d)"

psql "$DB_URL" -v ON_ERROR_STOP=1 -q >/dev/null <<SQL
  insert into auth.users (id, email, raw_user_meta_data) values ('$OWNER', 'owner@phase54c.test', '{}');
  insert into public.profiles (id, full_name) values ('$OWNER', 'Owner C');
  insert into public.tenants (id, name, slug, active) values
    ('$TENANT', 'Phase54 Conc', 'phase54conc', true),
    ('$OTHER', 'Phase54 Other', 'phase54other', true),
    ('$DOOMED', 'Phase54 Doomed', 'phase54doomed', true);
  insert into public.memberships (tenant_id, user_id, role, active) values ('$TENANT', '$OWNER', 'owner', true);
SQL
# History of earlier runs stays (append-only): only look at events after this id.
START="$(psql_value "select coalesce(max(id), 0) from public.tenant_feature_override_events")"

# Broken links in the history of the fixtures' overrides: an event that does
# not start from the values the previous one left, or a creation that does
# not follow nothing / a withdrawal.
chain_breaks() {
  psql_value "
    select count(*) from (
      select e.*,
        lag(e.action) over w as prev_action,
        lag(e.new_enabled) over w as prev_enabled,
        lag(e.new_limit_value) over w as prev_limit,
        lag(e.new_review_at) over w as prev_review
      from public.tenant_feature_override_events e
      where e.tenant_id in ('$TENANT', '$OTHER', '$DOOMED') and e.id > $START
      window w as (partition by e.tenant_id, e.feature_id order by e.id)
    ) c
    where (c.prev_action is null or c.prev_action = 'cleared') <> (c.action in ('created', 'baseline'))
       or (c.action not in ('created', 'baseline') and (
             c.old_enabled is distinct from c.prev_enabled
             or c.old_limit_value is distinct from c.prev_limit
             or c.old_review_at is distinct from c.prev_review))"
}

# Overrides of the fixtures that do not match their last event (or whose terms
# do not come from it).
row_mismatches() {
  psql_value "
    select count(*)
    from public.tenant_feature_overrides o
    left join lateral (
      select e.* from public.tenant_feature_override_events e
      where e.tenant_id = o.tenant_id and e.feature_id = o.feature_id
      order by e.id desc limit 1
    ) last on true
    where o.tenant_id in ('$TENANT', '$OTHER', '$DOOMED')
      and (last.id is null or last.action = 'cleared'
        or o.enabled is distinct from last.new_enabled
        or o.limit_value is distinct from last.new_limit_value
        or o.review_at is distinct from last.new_review_at
        or (o.reason is not null and (last.source <> 'set_tenant_feature_v2'
              or o.reason <> last.reason or o.granted_by <> last.operator)))"
}

events_of() { # tenant feature
  psql_value "select count(*) from public.tenant_feature_override_events e
    join public.features f on f.id = e.feature_id
    where e.tenant_id = '$1' and f.code = '$2' and e.id > $START"
}

# C1 -------------------------------------------------------------------------
for i in 1 2 3 4 5 6; do
  psql "$DB_URL" -v ON_ERROR_STOP=1 -qAt -c "begin;
    select public.set_tenant_feature_v2('phase54conc', 'clients_import', $([ $((i % 2)) -eq 0 ] && echo true || echo false), $i,
      'c1 call $i', now() + interval '$i days', 'op-$i') ->> 'action';
    select pg_sleep(0.3);
    commit;" > "$WORK/c1-$i" 2>&1 &
  eval "c1_$i=\$!"
done
for i in 1 2 3 4 5 6; do
  eval "pid=\$c1_$i"
  wait "$pid" || fail "C1 session $i: $(cat "$WORK/c1-$i")"
done
actions="$(grep -hE '^(created|updated)$' "$WORK"/c1-* | sort | uniq -c | awk '{print $2 "=" $1}' | tr '\n' ',')"
[ "$actions" = "created=1,updated=5," ] || fail "C1 expected one creation and five updates, got $actions"
[ "$(events_of "$TENANT" clients_import)" = "6" ] || fail "C1 expected 6 events"
[ "$(chain_breaks)" = "0" ] || fail "C1 broken history chain"
[ "$(row_mismatches)" = "0" ] || fail "C1 row does not match its last event"

# C2 -------------------------------------------------------------------------
before="$(events_of "$TENANT" quotes)"
(
  for i in 1 2 3 4 5 6 7 8; do
    psql "$DB_URL" -v ON_ERROR_STOP=1 -qAt -c "select public.set_tenant_feature_v2('phase54conc', 'quotes',
      $([ $((i % 2)) -eq 0 ] && echo true || echo false), null, 'c2 v2 $i', now() + interval '1 day', 'op-v2') ->> 'action'"
  done
) > "$WORK/c2-v2" 2>&1 &
p_v2=$!
(
  for i in 1 2 3 4 5 6 7 8; do
    psql "$DB_URL" -v ON_ERROR_STOP=1 -qAt -c "begin; $AS_SERVICE
      select public.set_tenant_feature('phase54conc', 'quotes', $([ $((i % 3)) -eq 0 ] && echo false || echo true), $i);
      commit;"
  done
) > "$WORK/c2-v1" 2>&1 &
p_v1=$!
(
  for i in 1 2 3 4 5 6 7 8; do
    psql "$DB_URL" -v ON_ERROR_STOP=1 -qAt -c "select public.clear_tenant_feature_override('phase54conc', 'quotes',
      'c2 clear $i', 'op-clear') ->> 'removed'"
  done
) > "$WORK/c2-clear" 2>&1 &
p_clear=$!
wait "$p_v2" || fail "C2 v2 worker: $(cat "$WORK/c2-v2")"
wait "$p_v1" || fail "C2 v1 worker: $(cat "$WORK/c2-v1")"
wait "$p_clear" || fail "C2 clear worker: $(cat "$WORK/c2-clear")"
v2_calls="$(grep -cE '^(created|updated)$' "$WORK/c2-v2" || true)"
removed="$(grep -c '^true$' "$WORK/c2-clear" || true)"
[ "$v2_calls" = "8" ] || fail "C2 expected 8 v2 results, got $v2_calls: $(cat "$WORK/c2-v2")"
after="$(events_of "$TENANT" quotes)"
expected=$((before + 8 + 8 + removed))
[ "$after" = "$expected" ] || fail "C2 expected $expected events (8 v2, 8 v1, $removed clears), got $after"
[ "$(psql_value "select count(*) from public.tenant_feature_override_events e
    join public.features f on f.id = e.feature_id
    where e.tenant_id = '$TENANT' and f.code = 'quotes' and e.source = 'clear_tenant_feature_override'
      and e.id > $START")" = "$removed" ] \
  || fail "C2 clears recorded differ from clears that removed a row"
[ "$(chain_breaks)" = "0" ] || fail "C2 broken history chain"
[ "$(row_mismatches)" = "0" ] || fail "C2 row does not match its last event"

# C3 -------------------------------------------------------------------------
psql "$DB_URL" -v ON_ERROR_STOP=1 -qAt -c "begin;
  select public.set_tenant_feature_v2('phase54conc', 'quotes', true, null, 'c3 holder', null, 'op') is not null;
  select pg_sleep(3);
  commit;" > "$WORK/c3-holder" 2>&1 &
p_holder=$!
sleep 0.7
psql "$DB_URL" -v ON_ERROR_STOP=1 -qAt -c "set lock_timeout = '1s';
  select public.set_tenant_feature_v2('phase54conc', 'clients_import', true, null, 'c3 other feature', null, 'op') ->> 'action';
  select public.set_tenant_feature_v2('phase54other', 'quotes', true, null, 'c3 other tenant', null, 'op') ->> 'action';" \
  > "$WORK/c3-free" 2>&1 || fail "C3 an unrelated override waited for the held one: $(cat "$WORK/c3-free")"
set +e
psql "$DB_URL" -v ON_ERROR_STOP=1 -qAt -c "set lock_timeout = '500ms';
  select public.set_tenant_feature_v2('phase54conc', 'quotes', false, null, 'c3 same override', null, 'op');" \
  > "$WORK/c3-same" 2>&1
rc_same=$?
set -e
wait "$p_holder" || fail "C3 holder: $(cat "$WORK/c3-holder")"
[ "$rc_same" -ne 0 ] && grep -q 'lock timeout' "$WORK/c3-same" \
  || fail "C3 the same override did not wait for the holder: $(cat "$WORK/c3-same")"
[ "$(psql_value "select reason from public.tenant_feature_overrides o join public.features f on f.id = o.feature_id
    where o.tenant_id = '$TENANT' and f.code = 'quotes'")" = "c3 holder" ] || fail "C3 the timed out call changed the row"

# C4 -------------------------------------------------------------------------
psql "$DB_URL" -v ON_ERROR_STOP=1 -qAt -c "begin;
  select public.clear_tenant_feature_override('phase54conc', 'quotes', 'c4 clear', 'op') ->> 'removed';
  select pg_sleep(2);
  commit;" > "$WORK/c4-clear" 2>&1 &
p_clear=$!
sleep 0.7
psql "$DB_URL" -v ON_ERROR_STOP=1 -qAt -c "select public.set_tenant_feature_v2('phase54conc', 'quotes', true, 9,
  'c4 grant after clear', null, 'op') ->> 'action'" > "$WORK/c4-grant" 2>&1 \
  || fail "C4 grant: $(cat "$WORK/c4-grant")"
wait "$p_clear" || fail "C4 clear: $(cat "$WORK/c4-clear")"
grep -qx 'true' "$WORK/c4-clear" || fail "C4 clear removed nothing: $(cat "$WORK/c4-clear")"
grep -qx 'created' "$WORK/c4-grant" || fail "C4 grant should create after the clear: $(cat "$WORK/c4-grant")"
last_two="$(psql_value "select string_agg(action || ':' || source, ',' order by id) from (
    select e.* from public.tenant_feature_override_events e join public.features f on f.id = e.feature_id
    where e.tenant_id = '$TENANT' and f.code = 'quotes' order by e.id desc limit 2) x")"
[ "$last_two" = "cleared:clear_tenant_feature_override,created:set_tenant_feature_v2" ] \
  || fail "C4 unexpected history order: $last_two"
[ "$(chain_breaks)" = "0" ] || fail "C4 broken history chain"
[ "$(row_mismatches)" = "0" ] || fail "C4 row does not match its last event"

# C5 -------------------------------------------------------------------------
state_of() {
  psql_value "select md5(coalesce((select string_agg(to_jsonb(o)::text, '|' order by o.feature_id)
      from public.tenant_feature_overrides o where o.tenant_id = '$TENANT'), '')
    || (select count(*)::text from public.tenant_feature_override_events where tenant_id = '$TENANT' and id > $START))"
}
state_before="$(state_of)"
set +e
psql "$DB_URL" -v ON_ERROR_STOP=1 -qAt -c "begin;
  select public.set_tenant_feature_v2('phase54conc', 'quotes', false, null, 'c5 doomed', null, 'op');
  select public.clear_tenant_feature_override('phase54conc', 'clients_import', 'c5 doomed', 'op');
  select 1 / 0;
  commit;" > "$WORK/c5-error" 2>&1
rc_error=$?
set -e
[ "$rc_error" -ne 0 ] || fail "C5 the failing transaction succeeded"
psql "$DB_URL" -v ON_ERROR_STOP=1 -qAt -c "begin;
  select public.set_tenant_feature_v2('phase54conc', 'quotes', false, null, 'c5 rolled back', null, 'op') is not null;
  rollback;" > /dev/null
[ "$(state_of)" = "$state_before" ] || fail "C5 an aborted transaction left an override change or an event"

# C6 -------------------------------------------------------------------------
psql "$DB_URL" -v ON_ERROR_STOP=1 -qAt -c "select public.set_tenant_feature_v2('phase54doomed', 'quotes', true, null,
  'c6 before deletion', null, 'op') is not null" > /dev/null
psql "$DB_URL" -v ON_ERROR_STOP=1 -qAt -c "begin;
  delete from public.tenants where id = '$DOOMED';
  select pg_sleep(2);
  commit;" > "$WORK/c6-delete" 2>&1 &
p_delete=$!
sleep 0.7
set +e
psql "$DB_URL" -v ON_ERROR_STOP=1 -qAt -c "select public.set_tenant_feature_v2('phase54doomed', 'clients_import', true, null,
  'c6 racing grant', null, 'op')" > "$WORK/c6-grant" 2>&1
rc_grant=$?
set -e
wait "$p_delete" || fail "C6 delete: $(cat "$WORK/c6-delete")"
[ "$rc_grant" -ne 0 ] && grep -qE 'foreign key|tenant not found' "$WORK/c6-grant" \
  || fail "C6 the racing grant should fail: $(cat "$WORK/c6-grant")"
[ "$(psql_value "select count(*) from public.tenant_feature_overrides where tenant_id = '$DOOMED'")" = "0" ] \
  || fail "C6 orphan override for a deleted tenant"
[ "$(psql_value "select string_agg(action || ':' || source, ',' order by id)
    from public.tenant_feature_override_events where tenant_id = '$DOOMED' and id > $START")" = "created:set_tenant_feature_v2,cleared:tenant_deleted" ] \
  || fail "C6 unexpected history for the deleted tenant"

# C7 -------------------------------------------------------------------------
psql "$DB_URL" -v ON_ERROR_STOP=1 -qAt -c "select public.set_tenant_feature_v2('phase54conc', 'quotes', true, null,
  'c7 short review', now() + interval '2 seconds', 'op') is not null" > /dev/null
events_c7="$(events_of "$TENANT" quotes)"
sleep 3
has="$(psql "$DB_URL" -v ON_ERROR_STOP=1 -qAt -c "begin; $AS_OWNER
  select public.tenant_has_feature('$TENANT', 'quotes'); commit;" | tail -1)"
[ "$has" = "t" ] || fail "C7 a past review_at disabled the feature"
[ "$(psql_value "select count(*) from public.list_tenant_feature_reviews_due() r
    where r.tenant_id = '$TENANT' and r.feature_code = 'quotes' and r.enabled and r.reason = 'c7 short review'")" = "1" ] \
  || fail "C7 the due review is not reported"
[ "$(events_of "$TENANT" quotes)" = "$events_c7" ] || fail "C7 something changed the override after its review date"

# R --------------------------------------------------------------------------
fingerprint() {
  psql_value "
    select md5(string_agg(x, E'\n' order by x)) from (
      select 'col ' || a.attrelid::regclass || '.' || a.attname || ' ' || format_type(a.atttypid, a.atttypmod)
             || ' ' || a.attnotnull || ' ' || a.attidentity::text || ' ' || coalesce(pg_get_expr(d.adbin, d.adrelid), '')
             || ' ' || coalesce(col_description(a.attrelid, a.attnum), '')
      from pg_attribute a
      left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
      where a.attrelid in ('public.tenant_feature_overrides'::regclass, 'public.tenant_feature_override_events'::regclass)
        and a.attnum > 0 and not a.attisdropped
      union all
      select 'con ' || c.conrelid::regclass || ' ' || c.conname || ' ' || pg_get_constraintdef(c.oid)
      from pg_constraint c
      where c.conrelid in ('public.tenant_feature_overrides'::regclass, 'public.tenant_feature_override_events'::regclass)
      union all
      select 'idx ' || pg_get_indexdef(i.indexrelid)
      from pg_index i
      where i.indrelid in ('public.tenant_feature_overrides'::regclass, 'public.tenant_feature_override_events'::regclass)
      union all
      select 'trg ' || pg_get_triggerdef(t.oid) || ' ' || t.tgenabled::text
      from pg_trigger t
      where t.tgrelid in ('public.tenant_feature_overrides'::regclass, 'public.tenant_feature_override_events'::regclass)
        and not t.tgisinternal
      union all
      select 'rel ' || c.relname || ' ' || c.relkind::text || ' ' || c.relrowsecurity || ' ' || coalesce(c.relacl::text, '')
             || ' ' || coalesce(obj_description(c.oid, 'pg_class'), '')
      from pg_class c
      where c.relnamespace = 'public'::regnamespace
        and c.relname in ('tenant_feature_overrides', 'tenant_feature_override_events', 'tenant_feature_override_events_id_seq')
      union all
      select 'fn ' || p.oid::regprocedure || ' ' || md5(pg_get_functiondef(p.oid)) || ' ' || coalesce(p.proacl::text, '')
             || ' ' || coalesce(obj_description(p.oid, 'pg_proc'), '')
      from pg_proc p
      where p.pronamespace = 'public'::regnamespace
        and p.proname in ('set_tenant_feature_v2', 'clear_tenant_feature_override', 'list_tenant_feature_reviews_due',
                          'tg_tenant_feature_overrides_audit_v1', 'tg_tenant_feature_audit_refuse_v1',
                          'set_tenant_feature', 'tenant_has_feature')
    ) f(x)"
}
overrides_state() {
  psql_value "select md5(coalesce(string_agg(tenant_id || ':' || feature_id || ':' || enabled || ':' || coalesce(limit_value::text, '-'),
    '|' order by tenant_id, feature_id), '')) from public.tenant_feature_overrides"
}

fp_before="$(fingerprint)"
ov_before="$(overrides_state)"
set +e
psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f "$ROLLBACK" > "$WORK/r-refused" 2>&1
rc_refused=$?
set -e
[ "$rc_refused" -ne 0 ] && grep -q 'rollback_tenant_feature_grants_refused' "$WORK/r-refused" \
  || fail "R rollback without opt-in should be refused: $(cat "$WORK/r-refused")"
[ "$(fingerprint)" = "$fp_before" ] || fail "R a refused rollback changed the schema"

PGOPTIONS='-c app.rollback_tenant_feature_grants=discard_history' \
  psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f "$ROLLBACK" > "$WORK/r-rollback" 2>&1 \
  || fail "R rollback: $(cat "$WORK/r-rollback")"
psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f "$VERIFY" > "$WORK/r-verify" 2>&1 || fail "R verify: $(cat "$WORK/r-verify")"
[ "$(overrides_state)" = "$ov_before" ] || fail "R rollback changed an override"
has="$(psql "$DB_URL" -v ON_ERROR_STOP=1 -qAt -c "begin; $AS_OWNER
  select public.tenant_has_feature('$TENANT', 'quotes'); commit;" | tail -1)"
[ "$has" = "t" ] || fail "R rollback changed the resolution"

psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f "$MIGRATION" > "$WORK/r-reapply" 2>&1 || fail "R re-apply: $(cat "$WORK/r-reapply")"
[ "$(fingerprint)" = "$fp_before" ] || fail "R re-applied migration differs from the original"
[ "$(overrides_state)" = "$ov_before" ] || fail "R re-apply changed an override"
[ "$(psql_value "select (select count(*) from public.tenant_feature_overrides)
    = (select count(*) from public.tenant_feature_override_events where action = 'baseline' and source = 'migration')
    and not exists (select 1 from public.tenant_feature_override_events where action <> 'baseline')")" = "t" ] \
  || fail "R re-apply should write exactly one baseline event per override"
psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f "$HERE/phase54_tenant_feature_grants.sql" > "$WORK/r-suite" 2>&1 \
  || fail "R SQL suite after re-apply: $(cat "$WORK/r-suite")"

echo "phase54 tenant feature grants concurrency PASS"
