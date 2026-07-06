import assert from 'node:assert/strict';
import test from 'node:test';
import { buildExecutorPlan, runExecutorPlan } from './vhc-packet-executor.mjs';

test('executor plans approved actions without executing by default', () => {
  const plan = buildExecutorPlan({
    packet: {
      packetId: 'pkt-1',
      actions: [{ id: 'enable_alert_watch_timers' }, { id: 'run_heap_analyzer' }],
    },
    verification: { status: 'pass', blockers: [] },
    execute: false,
    env: {},
  });
  assert.equal(plan.status, 'ready');
  assert.equal(plan.mode, 'dry_run');
  const execution = runExecutorPlan({ plan });
  assert.equal(execution.status, 'dry_run');
});

test('executor blocks live execution without explicit A6 flag', () => {
  const plan = buildExecutorPlan({
    packet: { packetId: 'pkt-2', actions: [{ id: 'restart_publisher_exit69_only' }] },
    verification: { status: 'pass', blockers: [] },
    execute: true,
    env: {},
  });
  assert.equal(plan.status, 'blocked');
  assert.match(plan.blockers.join('\n'), /live_execution_env_flag_missing/);
});

test('executor does not render commands when verification failed', () => {
  const plan = buildExecutorPlan({
    packet: { packetId: 'pkt-3', actions: [{ id: 'restart_publisher_exit69_only' }] },
    verification: { status: 'fail', blockers: ['exit_class_guard_refused_exit_78'] },
    execute: false,
    env: {},
  });
  assert.equal(plan.status, 'blocked');
  assert.deepEqual(plan.commands, []);
});

test('live executor stops after first failed command', () => {
  const plan = buildExecutorPlan({
    packet: {
      packetId: 'pkt-4',
      actions: [{ id: 'enable_alert_watch_timers' }, { id: 'restart_publisher_exit69_only' }],
    },
    verification: { status: 'pass', blockers: [] },
    execute: true,
    env: { VH_PACKET_EXECUTOR_ENABLE_LIVE: '1' },
  });
  const calls = [];
  const execution = runExecutorPlan({
    plan,
    spawnSyncImpl: (cmd, args) => {
      calls.push([cmd, args]);
      return { status: 1 };
    },
  });
  assert.equal(execution.status, 'fail');
  assert.equal(calls.length, 1);
  assert.equal(execution.results.length, 1);
});
