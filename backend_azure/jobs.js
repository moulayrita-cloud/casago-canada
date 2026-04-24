// jobs.js
// central 
// backend/jobs.js
// jobs.js

// jobs.js
export const jobs = new Map();

export const TERMINAL_STATUSES = new Set([
  'Completed',
  'Cancelled',
  'Canceled',
  'Expired',
  'NoDrivers',
  'Failed',
]);

// Minimal normalizer: match your webhook normalization rules
function normPhone(v) {
  if (!v) return '';
  let s = String(v).trim();
  if (s.startsWith('whatsapp:')) s = s.slice('whatsapp:'.length);
  return s;
}
export function dropJobsForDriverPhone(phoneE164) {
  const target = normPhone(phoneE164);
  if (!target) return 0;

  let cleared = 0;
  for (const [jid, j] of jobs.entries()) {
    if (normPhone(j?.currentDriverPhone) === target) {
      j.currentDriverPhone = null;
      if ('driverPhone' in j) j.driverPhone = null;
      if ('driver_phone' in j) j.driver_phone = null;
      jobs.set(jid, j);
      cleared++;
    }
  }

  if (cleared) {
    console.log('[RAM CLEAR DRIVER ONLY]', { phoneE164: target, cleared });
  }
  return cleared;
}

export function upsertJob(jobId, job) {
  const id = String(jobId);
  jobs.set(id, job);
  return job;
}

export function cleanupRideRam(rideId, reason = 'terminal') {
  const id = String(rideId);
  if (!jobs.has(id)) return false;
  jobs.delete(id);
  console.log('[RAM CLEANUP]', { rideId: id, reason });
  return true;
}