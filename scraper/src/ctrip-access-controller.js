const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const POLICY_VERSION = 'browser-first-v1';
const controllers = new Map();

function abortError() {
  return Object.assign(new Error('任务已取消'), { name: 'AbortError' });
}

function wait(ms, signal) {
  if (signal?.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const finish = () => {
      signal?.removeEventListener('abort', cancel);
      resolve();
    };
    const timer = setTimeout(finish, Math.max(0, ms));
    const cancel = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
      reject(abortError());
    };
    signal?.addEventListener('abort', cancel, { once: true });
  });
}

function waitForRecovery(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const cancel = () => {
      signal.removeEventListener('abort', cancel);
      reject(abortError());
    };
    signal.addEventListener('abort', cancel, { once: true });
    promise.then(() => {
      signal.removeEventListener('abort', cancel);
      resolve();
    }, reject);
  });
}

function retryAfterMs(headers = {}, now = Date.now()) {
  const value = Object.entries(headers).find(([key]) => key.toLowerCase() === 'retry-after')?.[1];
  if (value === undefined || String(value).trim() === '') return null;
  if (/^\d+$/.test(String(value).trim())) return Number(value) * 1000;
  if (!/GMT$/i.test(String(value).trim())) return null;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : null;
}

function classifyAccessIssue(
  { httpStatus, businessCode, headers, challenge = false, login = false, source = '' } = {},
  now = Date.now()
) {
  let kind = '';
  if (Number(businessCode) === 203 || challenge) kind = 'risk_control';
  else if (Number(httpStatus) === 403) kind = 'access_denied';
  else if (Number(httpStatus) === 429) kind = 'rate_limited';
  else if (login) kind = 'login_required';
  if (!kind) return null;
  return {
    kind,
    source,
    httpStatus: Number(httpStatus) || null,
    businessCode: Number(businessCode) || null,
    detectedAt: new Date(now).toISOString(),
    resumeAt: kind === 'rate_limited' ? now + (retryAfterMs(headers, now) ?? 60000) : null,
    requiresUserAction: kind !== 'rate_limited'
  };
}

function accessError(issue) {
  const messages = {
    risk_control: '携程要求验证，已暂停自动采集。请人工处理后明确确认恢复。',
    access_denied: '携程拒绝访问，已停止自动重试。',
    rate_limited: '携程请求限流，采集正在等待允许恢复时间。',
    login_required: '携程登录状态需要确认；关闭浏览器不会自动恢复任务。'
  };
  return Object.assign(new Error(messages[issue.kind] || '采集已暂停'), {
    name: 'CtripAccessError',
    code: 'CTRIP_ACCESS_PAUSED',
    accessIssue: { ...issue }
  });
}

class CtripAccessController {
  constructor({ statePath = '', now = Date.now, sleep = wait, random = Math.random } = {}) {
    this.statePath = statePath;
    this.now = now;
    this.sleep = sleep;
    this.random = random;
    this.listeners = new Set();
    this.issue = null;
    this.probing = false;
    this.recoveryListeners = new Set();
    this.epoch = 0;
    this.metrics = {
      pauses: 0,
      recoveries: 0,
      retryCount: 0,
      cooldownMs: 0,
      blockedActions: 0,
      businessRequests: 0,
      duplicateRequests: 0,
      actionsAfterRisk: 0,
      inFlightAtPause: 0
    };
    if (statePath && fs.existsSync(statePath)) {
      // An unreadable state must not silently clear an access restriction.
      const saved = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      this.issue = saved.accessIssue || null;
      if (this.issue?.probeAttempted) this.issue.requiresUserAction = true;
      this.epoch = Number(saved.epoch) || 0;
    }
  }

  persist() {
    if (!this.statePath) return;
    fs.mkdirSync(path.dirname(this.statePath), { recursive: true });
    const temporary = `${this.statePath}.${process.pid}.tmp`;
    fs.writeFileSync(
      temporary,
      JSON.stringify({ accessIssue: this.issue, epoch: this.epoch }),
      'utf8'
    );
    fs.renameSync(temporary, this.statePath);
  }

  report(signal) {
    const issue = classifyAccessIssue(signal, this.now());
    if (!issue) return null;
    if (this.issue?.requiresUserAction) return this.issue;
    if (this.probing || this.issue?.probeAttempted) issue.requiresUserAction = true;
    this.issue = issue;
    this.metrics.pauses += 1;
    this.persist();
    for (const listener of this.listeners) listener(issue);
    return issue;
  }

  assertAllowed() {
    if (this.issue) {
      this.metrics.blockedActions += 1;
      throw accessError(this.issue);
    }
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onRecovery(listener) {
    this.recoveryListeners.add(listener);
    return () => this.recoveryListeners.delete(listener);
  }

  confirmRecovery({ userConfirmed = false, pageVerified = false } = {}) {
    if (!userConfirmed || !pageVerified) return false;
    this.issue = null;
    this.epoch += 1;
    this.metrics.recoveries += 1;
    for (const listener of this.recoveryListeners) listener();
    this.persist();
    return true;
  }

  async run(operation, { signal } = {}) {
    let transientRetried = false;
    let rateRetried = false;
    let probeIssue = null;
    for (;;) {
      if (signal?.aborted) throw abortError();
      if (this.probing && !rateRetried) {
        await waitForRecovery(this.probeDone, signal);
        continue;
      }
      if (this.issue) {
        if (
          this.issue.kind !== 'rate_limited' ||
          this.issue.requiresUserAction ||
          rateRetried ||
          this.probing
        ) {
          throw accessError(this.issue);
        }
        const pending = this.issue;
        const started = this.now();
        // Chunk long server delays to avoid the Node timer overflow limit.
        while (pending === this.issue && this.now() < pending.resumeAt) {
          await this.sleep(Math.min(60000, pending.resumeAt - this.now()), signal);
        }
        this.metrics.cooldownMs += Math.max(
          0,
          this.now() - Math.max(started, this.cooldownAccountedThrough || started)
        );
        this.cooldownAccountedThrough = this.now();
        if (this.issue !== pending) continue;
        if (this.probing) throw accessError(pending);
        this.probing = true;
        this.probeDone = new Promise((resolve) => {
          this.resolveProbe = resolve;
        });
        probeIssue = pending;
        rateRetried = true;
        // Other callers stay blocked while this operation owns the one recovery probe.
        pending.probeAttempted = true;
        this.persist();
        this.issue = null;
      }
      const recoveriesBefore = this.metrics.recoveries;
      const abort = new AbortController();
      const cancel = () => abort.abort(signal?.reason);
      signal?.addEventListener('abort', cancel, { once: true });
      const unsubscribe = this.subscribe((issue) => abort.abort(accessError(issue)));
      try {
        const value = await operation(abort.signal);
        this.assertAllowed();
        if (rateRetried) {
          this.metrics.recoveries += 1;
          for (const listener of this.recoveryListeners) listener();
          this.persist();
        }
        return value;
      } catch (error) {
        if (signal?.aborted) throw abortError();
        if (this.probing && !rateRetried) {
          await waitForRecovery(this.probeDone, signal);
          continue;
        }
        if (
          !this.issue &&
          abort.signal.reason?.accessIssue?.kind === 'rate_limited' &&
          this.metrics.recoveries > recoveriesBefore
        )
          continue;
        if (!this.issue && error.accessIssue) this.issue = error.accessIssue;
        if (!this.issue)
          this.report({
            httpStatus: error.status,
            source: 'http',
            headers:
              error.headers ||
              (Number.isFinite(error.retryAfterMs)
                ? { 'Retry-After': String(Math.ceil(error.retryAfterMs / 1000)) }
                : {})
          });
        if (this.issue) {
          if (this.issue.kind === 'rate_limited' && !this.issue.requiresUserAction && !rateRetried)
            continue;
          throw accessError(this.issue);
        }
        if (rateRetried) {
          this.report({ httpStatus: 429, source: 'recovery_probe_failed' });
          throw accessError(this.issue);
        }
        const transient =
          [502, 503, 504].includes(Number(error.status)) ||
          /ETIMEDOUT|ECONNRESET|ECONNABORTED|EAI_AGAIN|CDP_TIMEOUT/.test(String(error.code || ''));
        if (!transient || transientRetried) throw error;
        transientRetried = true;
        this.metrics.retryCount += 1;
        await this.sleep(1000 + Math.floor(this.random() * 1001), signal);
      } finally {
        unsubscribe();
        signal?.removeEventListener('abort', cancel);
        if (rateRetried) {
          if (signal?.aborted && !this.issue) {
            this.issue = { ...probeIssue, requiresUserAction: true };
            this.persist();
          }
          this.probing = false;
          this.resolveProbe?.();
        }
      }
    }
  }
}

function getCtripAccessController(userDataDir) {
  const root = path.resolve(userDataDir || 'state/edge-profile');
  const key = process.platform === 'win32' ? root.toLowerCase() : root;
  if (!controllers.has(key)) {
    const hash = crypto.createHash('sha256').update(key).digest('hex').slice(0, 16);
    controllers.set(
      key,
      new CtripAccessController({
        statePath: path.join(path.dirname(root), `ctrip-access-${hash}.json`)
      })
    );
  }
  return controllers.get(key);
}

module.exports = {
  POLICY_VERSION,
  CtripAccessController,
  getCtripAccessController,
  classifyAccessIssue,
  accessError,
  retryAfterMs,
  wait
};
